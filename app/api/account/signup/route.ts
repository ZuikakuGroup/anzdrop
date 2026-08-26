import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateRecoveryCode, isValidAccountId } from "@/lib/account/id";
import { hashPassword } from "@/lib/account/password";
import { verifyTurnstileToken } from "@/lib/turnstile";

const MIN_PASSWORD_LENGTH = 8;
const MAX_PASSWORD_LENGTH = 200;

type SignupRequest = {
  accountId: string;
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
    const { accountId, password } = requestBody;

    if (typeof accountId !== "string" || !isValidAccountId(accountId)) {
      return Response.json(
        {
          success: false,
          error:
            "Account ID must be 3-32 characters and contain only letters, numbers, hyphens, and underscores",
        },
        { status: 400 }
      );
    }

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

    const recoveryCode = generateRecoveryCode();
    const passwordHash = await hashPassword(password);
    const recoveryCodeHash = await hashPassword(recoveryCode);
    const createdAt = new Date().toISOString();

    // IDが既に使われている場合はDO NOTHINGで静かに失敗させ、changesで判定する
    // (SELECTでの事前チェックだと、チェックとINSERTの間に別リクエストが割り
    // 込む競合が起きうるため、INSERT自体の原子性に一意性判定を任せる)。
    const result = await env.DB.prepare(
      `
      INSERT INTO accounts (
        id,
        password_hash,
        recovery_code_hash,
        plan,
        created_at
      )
      VALUES (?, ?, ?, 'free', ?)
      ON CONFLICT (id) DO NOTHING
    `
    )
      .bind(accountId, passwordHash, recoveryCodeHash, createdAt)
      .run();

    if (result.meta.changes !== 1) {
      return Response.json(
        { success: false, error: "Account ID is already taken" },
        { status: 409 }
      );
    }

    // recoveryCodeはこの応答が最初で最後の表示機会(サーバーは平文を保持しない)。
    const responseBody: SignupResponse = {
      success: true,
      accountId,
      recoveryCode,
    };

    return Response.json(responseBody);
  } catch (error) {
    console.error("POST /api/account/signup failed:", error);

    const responseBody: SignupResponse = {
      success: false,
      error: "Internal server error",
    };

    return Response.json(responseBody, { status: 500 });
  }
}
