// Route Handler(app/api/**/route.ts)のテスト用に、Miniflareで実際のD1/R2の
// バインディングを起動し、migrations/配下のSQLをそのまま適用したCloudflareEnv
// 相当のオブジェクトを作る。ハンドラ内のSQLは手書きモックではなく本物のSQLite
// (MiniflareのD1エミュレーション)で実行されるため、WHERE句を使った二重処理
// 防止などのSQLの振る舞いそのものを検証できる。
import { Miniflare } from "miniflare";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { hashPassword } from "@/lib/account/password";
import { generateAccountId } from "@/lib/account/id";
import { createSessionCookie } from "@/lib/account/session";

const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");

function loadMigrationStatements(): string[] {
  const files = readdirSync(MIGRATIONS_DIR)
    .filter((name) => name.endsWith(".sql"))
    .sort();

  const statements: string[] = [];

  for (const file of files) {
    const sql = readFileSync(path.join(MIGRATIONS_DIR, file), "utf-8");
    const withoutComments = sql
      .split("\n")
      .filter((line) => !line.trim().startsWith("--"))
      .join("\n");

    for (const statement of withoutComments.split(";")) {
      const trimmed = statement.trim();

      if (trimmed) {
        statements.push(trimmed);
      }
    }
  }

  return statements;
}

export type TestEnv = CloudflareEnv;

export type TestEnvHandle = {
  env: TestEnv;
  dispose: () => Promise<void>;
};

export async function createTestEnv(): Promise<TestEnvHandle> {
  const mf = new Miniflare({
    modules: true,
    script:
      "export default { fetch() { return new Response(null, { status: 404 }); } };",
    d1Databases: ["DB"],
    r2Buckets: ["FILES_BUCKET"],
  });

  const DB = await mf.getD1Database("DB");
  const FILES_BUCKET = await mf.getR2Bucket("FILES_BUCKET");

  for (const statement of loadMigrationStatements()) {
    await DB.prepare(statement).run();
  }

  const env = {
    DB,
    FILES_BUCKET,
    CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    STRIPE_PRICE_ID: "price_test",
    OPENNODE_BTC_CHARGE_AMOUNT_USD: 3,
    OPENNODE_BTC_DAYS_PER_CHARGE: 30,
    TURNSTILE_SECRET_KEY: "test-turnstile-secret",
    SESSION_SECRET: "test-session-secret-thats-long-enough-for-hs256-signing",
    STRIPE_SECRET_KEY: "sk_test_dummy",
    STRIPE_WEBHOOK_SECRET: "whsec_test_dummy",
    OPENNODE_API_KEY: "test-opennode-api-key",
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- MiniflareのD1/R2バインディングは型上完全に一致しないため
  } as any as TestEnv;

  return {
    env,
    dispose: () => mf.dispose(),
  };
}

const ALL_TABLES = [
  "upload_parts",
  "uploads",
  "files",
  "reports",
  "shares",
  "btc_payments",
  "stripe_events",
  "accounts",
];

// テスト間の分離のため、テーブルの中身だけを空にする(スキーマは再利用)。
export async function clearAllTables(env: TestEnv): Promise<void> {
  for (const table of ALL_TABLES) {
    await env.DB.prepare(`DELETE FROM ${table}`).run();
  }
}

// テスト用アカウントをDBへ直接作成する(signup APIのTurnstile検証を経由しない)。
export async function insertTestAccount(
  env: TestEnv,
  overrides: {
    id?: string;
    password?: string;
    recoveryCode?: string;
    plan?: "free" | "paid";
    planExpiresAt?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
  } = {}
): Promise<{ accountId: string; password: string; recoveryCode: string }> {
  const id = overrides.id ?? generateAccountId();
  const password = overrides.password ?? "test-password-123";
  const recoveryCode = overrides.recoveryCode ?? "test-recovery-code-123";
  const passwordHash = await hashPassword(password);
  const recoveryCodeHash = await hashPassword(recoveryCode);

  await env.DB.prepare(
    `
      INSERT INTO accounts (
        id, password_hash, recovery_code_hash, plan, plan_expires_at,
        stripe_customer_id, stripe_subscription_id, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      passwordHash,
      recoveryCodeHash,
      overrides.plan ?? "free",
      overrides.planExpiresAt ?? null,
      overrides.stripeCustomerId ?? null,
      overrides.stripeSubscriptionId ?? null,
      new Date().toISOString()
    )
    .run();

  return { accountId: id, password, recoveryCode };
}

// Turnstile検証(lib/turnstile.ts)が呼ぶsiteverify APIへのfetchをスタブする。
// Responseのbodyは1回読むと消費されるため、呼び出しごとに新しいResponseを
// 返す関数実装にする(mockResolvedValueで同一インスタンスを使い回すと、
// 1つのテスト内で2回目以降の呼び出しがbody読み取りエラーで失敗する)。
export function stubTurnstileSuccess(): void {
  vi.stubGlobal(
    "fetch",
    vi
      .fn()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ success: true }), { status: 200 })
      )
  );
}

export function stubTurnstileFailure(): void {
  vi.stubGlobal(
    "fetch",
    vi.fn().mockImplementation(
      async () =>
        new Response(
          JSON.stringify({
            success: false,
            "error-codes": ["invalid-input-response"],
          }),
          { status: 200 }
        )
    )
  );
}

// 認証済みリクエストを組み立てる際に使う`Cookie`ヘッダーの値
// (`anzdrop_session=<jwt>`)を作る。
export async function sessionCookieHeader(
  env: TestEnv,
  accountId: string,
  sessionVersion = 0
): Promise<string> {
  const setCookie = await createSessionCookie(accountId, sessionVersion, env);

  return setCookie.split(";")[0];
}

// Cloudflare Workers用の型定義下ではResponse#json()がunknownを返すため
// (DOM libのanyより厳格)、Route Handlerのレスポンスボディをテストで直接
// プロパティアクセスすると型エラーになる。テストコード側は「レスポンスの
// 形はこちらで把握している」という前提で読むので、ここで一箇所だけ
// asキャストする。
export async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}
