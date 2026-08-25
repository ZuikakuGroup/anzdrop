import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateAccountId, generateRecoveryCode } from "@/lib/account/id";
import { hashPassword } from "@/lib/account/password";
import { verifyTurnstileToken } from "@/lib/turnstile";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

type SignupRequest = {
  password: string;
  turnstileToken?: string;
};

type SignupResponse =
  | {
      success: true;
      accountId: string;
      recoveryCode: string;
    }
  | {
      success: false;
      error: string;
    };

export async function POST(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const requestBody = (await request.json()) as SignupRequest;
    const { password } = requestBody;

    if (
      typeof password !== "string" ||
      password.length < MIN_PASSWORD_LENGTH ||
      password.length > MAX_PASSWORD_LENGTH
    ) {
      return Response.json(
        {
          success: false,
          error: `Password must be between ${MIN_PASSWORD_LENGTH} and ${MAX_PASSWORD_LENGTH} characters`,
        },
        { status: 400 }
      );
    }

    // アカウント作成はメールもレート制限もない中での主な悪用標的なので、
    // 新規共有作成(/api/upload/start)と同様にTurnstile検証を必須にする。
    const verification = await verifyTurnstileToken(
      requestBody.turnstileToken,
      env.TURNSTILE_SECRET_KEY
    );

    if (!verification.success) {
      return Response.json(
        { success: false, error: "Turnstile verification failed" },
        { status: 403 }
      );
    }

    const accountId = generateAccountId();
    const recoveryCode = generateRecoveryCode();
    const passwordHash = await hashPassword(password);
    const recoveryCodeHash = await hashPassword(recoveryCode);
    const createdAt = new Date().toISOString();

    await env.DB.prepare(
      `
      INSERT INTO accounts (
        id,
        password_hash,
        recovery_code_hash,
        plan,
        created_at
      )
      VALUES (?, ?, ?, 'free', ?)
    `
    )
      .bind(accountId, passwordHash, recoveryCodeHash, createdAt)
      .run();

    // recoveryCodeはこの応答が最初で最後の表示機会(サーバーは平文を保持しない)。
    const responseBody: SignupResponse = {
      success: true,
      accountId,
      recoveryCode,
    };

    return Response.json(responseBody);
  } catch (error) {
    const responseBody: SignupResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, { status: 500 });
  }
}
