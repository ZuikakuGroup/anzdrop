// 要件書9章。生のshareIdをAnalytics DBへ直接保存しないための一方向変換。
// 同じtransferのupload/downloadイベントを相関できる一方で、Analytics DB側の
// 値だけからshareId(=共有URLの一部)を復元することはできない。

const KEY_CACHE = new Map<string, Promise<CryptoKey>>();

function getHmacKey(secret: string): Promise<CryptoKey> {
  const cached = KEY_CACHE.get(secret);

  if (cached) {
    return cached;
  }

  const promise = crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  KEY_CACHE.set(secret, promise);

  return promise;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function computeAnalyticsTransferId(
  shareId: string,
  secret: string
): Promise<string> {
  // lib/account/session.tsのSESSION_SECRET同様、未設定のまま鍵として使うと
  // 常に同じ("undefined"という文字列由来の)予測可能なHMAC鍵になり、静かに
  // 危険な状態になる。設定漏れは早期に例外で気づけるようにする。
  if (!secret) {
    throw new Error("ANALYTICS_SECRET is not configured");
  }

  const key = await getHmacKey(secret);
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(shareId)
  );

  return toHex(signature);
}
