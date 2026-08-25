import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyPassword } from "@/lib/account/password";
import { createSessionCookie } from "@/lib/account/session";
import { verifyTurnstileToken } from "@/lib/turnstile";

type LoginRequest = {
  accountId: string;
  password: string;
  turnstileToken?: string;
};

type LoginResponse =
  | { success: true }
  | { success: false; error: string };

const INVALID_CREDENTIALS_ERROR = "Invalid account ID or password";

// アカウントが存在しない場合でも同じだけPBKDF2の計算コストをかけることで、
// 「アカウントIDが存在するかどうか」を応答時間の差から推測できないようにする。
const DUMMY_PASSWORD_HASH =
  "210000$AAAAAAAAAAAAAAAAAAAAAA$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";

export async function POST(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const requestBody = (await request.json()) as LoginRequest;
    const { accountId, password } = requestBody;

    if (typeof accountId !== "string" || typeof password !== "string") {
      return Response.json(
        { success: false, error: "Missing accountId or password" },
        { status: 400 }
      );
    }

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

    const account = await env.DB.prepare(
      `SELECT password_hash FROM accounts WHERE id = ? LIMIT 1`
    )
      .bind(accountId)
      .first<{ password_hash: string }>();

    const passwordMatches = await verifyPassword(
      password,
      account?.password_hash ?? DUMMY_PASSWORD_HASH
    );

    if (!account || !passwordMatches) {
      return Response.json(
        { success: false, error: INVALID_CREDENTIALS_ERROR },
        { status: 403 }
      );
    }

    const setCookie = await createSessionCookie(accountId, env);
    const responseBody: LoginResponse = { success: true };

    return Response.json(responseBody, {
      headers: { "Set-Cookie": setCookie },
    });
  } catch (error) {
    const responseBody: LoginResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, { status: 500 });
  }
}
