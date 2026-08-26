import { getCloudflareContext } from "@opennextjs/cloudflare";
import { generateRecoveryCode } from "@/lib/account/id";
import { hashPassword } from "@/lib/account/password";
import { requireTurnstile } from "@/lib/turnstile";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  SignupRequestSchema,
  type SignupResponse,
} from "@/app/api/account/signup/schema";

export const POST = withApiHandler(
  "POST /api/account/signup",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const parsed = await parseJsonBody(request, SignupRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const { accountId, password } = parsed.data;

    // アカウント作成はメールもレート制限もない中での主な悪用標的なので、
    // 新規共有作成(/api/upload/start)と同様にTurnstile検証を必須にする。
    const turnstile = await requireTurnstile(
      parsed.data.turnstileToken,
      env.TURNSTILE_SECRET_KEY
    );

    if (!turnstile.ok) {
      return turnstile.response;
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
  }
);
