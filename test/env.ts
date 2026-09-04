// Route Handler(app/api/**/route.ts)のテスト用に、Miniflareで実際のD1/R2の
// バインディングを起動し、migrations/配下のSQLをそのまま適用したCloudflareEnv
// 相当のオブジェクトを作る。ハンドラ内のSQLは手書きモックではなく本物のSQLite
// (MiniflareのD1エミュレーション)で実行されるため、WHERE句を使った二重処理
// 防止などのSQLの振る舞いそのものを検証できる。
import { Miniflare } from "miniflare";
import { nanoid } from "nanoid";
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import { vi } from "vitest";
import { hashPassword } from "@/lib/account/password";
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

// wrangler.jsonc の `ratelimits` で宣言しているレート制限バインディングの名前。
export const RATE_LIMITER_BINDINGS = [
  "FILE_RATE_LIMITER",
  "SHARE_RATE_LIMITER",
  "UPLOAD_RATE_LIMITER",
  "ACCOUNT_RATE_LIMITER",
] as const;

export type RateLimiterBinding = (typeof RATE_LIMITER_BINDINGS)[number];

export type StubRateLimiter = RateLimit & {
  // limit() に渡されたキーを渡された順に記録する。ルートが「何を単位に」
  // 数えているか(fileId なのか shareId なのか等)をテストで確かめるため。
  keys: string[];
  // そのキーへの limit() が、n 回目以降 超過(success: false)を返すようにする。
  // 本物のバインディングと同じくキーごとに独立して数えるので、「別のキーは
  // 巻き込まれない」ことをテストで確かめられる。
  denyKeyFrom: (key: string, callNumber: number) => void;
  // 以降の limit() が例外を投げるようにする(Cloudflare 側の一時障害の再現)。
  failNext: () => void;
  // 記録と設定を初期状態(全許可)へ戻す。
  reset: () => void;
};

// Miniflare は ratelimit バインディングを提供しないうえ、本物のバインディングは
// 60秒窓・データセンター単位のベストエフォートで、テストから決定的に扱えない。
// ルート側が「どのキーで・どの順序で数えているか」「超過時に何を返すか」を
// 検証できれば十分なので、呼び出しを記録できるスタブに差し替える。
//
// 本物と同じく「キーごとに独立したカウンタ」として振る舞わせる。全キー合算で
// 数えるスタブにすると、ルートが誤って固定キーで数えるようになっても
// テストが通ってしまう。
export function createStubRateLimiter(): StubRateLimiter {
  const keys: string[] = [];
  const counts = new Map<string, number>();
  const denyFrom = new Map<string, number>();
  let fail = false;

  return {
    keys,
    denyKeyFrom: (key: string, callNumber: number) => {
      denyFrom.set(key, callNumber);
    },
    failNext: () => {
      fail = true;
    },
    reset: () => {
      keys.length = 0;
      counts.clear();
      denyFrom.clear();
      fail = false;
    },
    limit: async ({ key }: RateLimitOptions): Promise<RateLimitOutcome> => {
      keys.push(key);

      // 例外を投げた呼び出しは keys には残すが counts は進めない(本物の
      // バインディングでは例外時にカウントされたかどうかを観測できないため、
      // どちらでもよい。ここでは「消費しなかった」側に倒す)。
      if (fail) {
        fail = false;
        throw new Error("rate limiter unavailable");
      }

      const count = (counts.get(key) ?? 0) + 1;
      counts.set(key, count);

      return { success: count < (denyFrom.get(key) ?? Infinity) };
    },
  };
}

// レート制限バインディングだけは、テストから挙動を操作できるスタブ型に
// 差し替えて公開する(StubRateLimiter は RateLimit を満たすため、
// ルートへ渡す CloudflareEnv としてはそのまま使える)。
export type TestEnv = Omit<CloudflareEnv, RateLimiterBinding> &
  Record<RateLimiterBinding, StubRateLimiter>;

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
    ...Object.fromEntries(
      RATE_LIMITER_BINDINGS.map((name) => [name, createStubRateLimiter()])
    ),
    CF_ACCESS_TEAM_DOMAIN: "test.cloudflareaccess.com",
    CF_ACCESS_AUD: "test-aud",
    STRIPE_PRICE_ID_STANDARD: "price_test_standard",
    STRIPE_PRICE_ID_PREMIUM: "price_test_premium",
    OPENNODE_BTC_CHARGE_AMOUNT_USD_STANDARD: 2,
    OPENNODE_BTC_CHARGE_AMOUNT_USD_PREMIUM: 3,
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
  "contacts",
  "shares",
  "btc_payments",
  "stripe_events",
  "accounts",
];

// テスト間の分離のため、テーブルの中身だけを空にする(スキーマは再利用)。
//
// `env.DB.prepare()` はプリペアドステートメントを同期的に返すため、Miniflareの
// マジックプロキシ経由(Node側からのバインディングアクセス)では1回ごとに
// workerdへの同期ブロッキング往復が発生する。テーブル数ぶんの同期往復を
// 毎テストのbeforeEachで繰り返すと、CIの並列実行下でこのプロキシの
// メッセージフレーミングが稀に競合し `message?.id === id` で失敗する。
// `exec()` はPromiseを返す非同期プロキシ呼び出しで、改行区切りで複数文を
// 1回にまとめて実行できるため、同期往復をなくしつつ呼び出しも1回で済む。
export async function clearAllTables(env: TestEnv): Promise<void> {
  await env.DB.exec(ALL_TABLES.map((table) => `DELETE FROM ${table};`).join("\n"));
}

// レート制限スタブの記録と設定を初期状態(全許可)へ戻す。env は beforeAll で
// 1つだけ作ってテスト間で使い回すため、呼び出し記録が持ち越されないようにする。
export function resetRateLimiters(env: TestEnv): void {
  for (const name of RATE_LIMITER_BINDINGS) {
    env[name].reset();
  }
}

// テスト用アカウントをDBへ直接作成する(signup APIのTurnstile検証を経由しない)。
export async function insertTestAccount(
  env: TestEnv,
  overrides: {
    id?: string;
    password?: string;
    recoveryCode?: string;
    // "paid"は3値化前の旧値。normalizeStoredPlan()の後方互換テスト専用。
    plan?: "free" | "standard" | "premium" | "paid";
    planExpiresAt?: string | null;
    stripeCustomerId?: string | null;
    stripeSubscriptionId?: string | null;
    failedLoginAttempts?: number;
    lockedUntil?: string | null;
  } = {}
): Promise<{ accountId: string; password: string; recoveryCode: string }> {
  // 本物のsignupではアカウントIDは本人が自由に設定するため、テストでは
  // 衝突しないランダムな文字列を代わりに使う(idの妥当性検証はlib/account/id.test.tsで担保する)。
  const id = overrides.id ?? nanoid(16);
  const password = overrides.password ?? "test-password-123";
  const recoveryCode = overrides.recoveryCode ?? "test-recovery-code-123";
  const passwordHash = await hashPassword(password);
  const recoveryCodeHash = await hashPassword(recoveryCode);

  await env.DB.prepare(
    `
      INSERT INTO accounts (
        id, password_hash, recovery_code_hash, plan, plan_expires_at,
        stripe_customer_id, stripe_subscription_id, created_at,
        failed_login_attempts, locked_until
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
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
      new Date().toISOString(),
      overrides.failedLoginAttempts ?? 0,
      overrides.lockedUntil ?? null
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
