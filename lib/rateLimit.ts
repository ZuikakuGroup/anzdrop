// アプリ層のレート制限(GitHub issue #81)。
//
// Cloudflare WAF の Rate Limiting Rules(ゾーン側で設定)が「1つの送信元 IP からの
// 連打」を止めるのに対し、こちらは「分散した IP から1つの共有 / 1つのアップロード
// セッションへ集中する」濫用を止める、多層防御の内側にあたる。
//
// キーに使うのは fileId / shareId / uploadSessionId / アカウントID といった
// アプリ内の識別子だけで、IP アドレスなどの訪問者情報は一切キーにしない。
// Anzdrop 側のコードで訪問者の IP を収集・加工しないという既存方針
// (lib/turnstile.ts の remoteip 不送信と同じ考え方)を保つためで、IP 単位の
// 制限は Cloudflare 側の WAF ルールに任せる。
//
// バインディングの実体は wrangler.jsonc の `ratelimits`(閾値もそちら)。

import type { ApiResponse } from "@/lib/api/response";

export type RateLimitGuardResult =
  | { ok: true }
  | { ok: false; response: Response };

const RATE_LIMITED_BODY: ApiResponse = {
  success: false,
  error: "リクエストが多すぎます。しばらく待ってから再試行してください",
};

// 429 を返すときの Retry-After(秒)。バインディングの period(60秒)に合わせる。
//
// クライアント側の再試行(lib/download/parallelFetch.ts・lib/upload/chunkUploader.ts)は
// 429 を一時エラーとして指数バックオフで数回だけ再送する。Retry-After は見て
// いないため、再送はその時点でまだ枯れている枠をさらに消費しうるが、試行回数に
// 上限がある(無限には粘らない)ことと、この2経路の閾値が正当な利用では到達
// しない水準にあることから、現状は許容している。ここは目安として伝えるだけ。
const RETRY_AFTER_SECONDS = 60;

function rateLimitedResponse(): Response {
  return Response.json(RATE_LIMITED_BODY, {
    status: 429,
    headers: {
      "Retry-After": String(RETRY_AFTER_SECONDS),
      "Cache-Control": "no-store",
    },
  });
}

// レート制限を1件消費し、超過していれば 429 応答を組み立てて返す。
// lib/turnstile.ts の requireTurnstile() と同じ `{ ok } | { ok, response }` 形。
//
// 意図的に「フェイルオープン」にしている。レート制限は課金コストの暴走を
// 頭打ちにするための保険であって、認証・認可の関門ではない。バインディングが
// 未設定の環境(バインディング追加前にビルドされた Worker、テスト、ローカル)や
// Cloudflare 側の一時障害でファイル配信・アップロードが丸ごと止まる方が、
// 利用者への影響がはるかに大きい。
export async function checkRateLimit(
  limiter: RateLimit | undefined,
  key: string,
  routeLabel: string
): Promise<RateLimitGuardResult> {
  if (!limiter) {
    return { ok: true };
  }

  let outcome: RateLimitOutcome;

  try {
    outcome = await limiter.limit({ key });
  } catch (error) {
    // キー自体はログに残さない(fileId / shareId は共有 URL の一部で、
    // 知っている者だけがダウンロードできるという前提を壊さないため)。
    console.error(`${routeLabel}: rate limit check failed:`, error);

    return { ok: true };
  }

  if (outcome.success) {
    return { ok: true };
  }

  return { ok: false, response: rateLimitedResponse() };
}
