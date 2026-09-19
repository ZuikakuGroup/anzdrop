// 署名検証に必要な生の本文を、上限付きで読む。Content-Lengthは早期拒否に
// 使うだけで、偽装されてもストリーム実測値を検証する。
export async function readBodyWithinLimit(
  request: Request,
  maxBytes: number
): Promise<Uint8Array | null> {
  const contentLength = request.headers.get("content-length");
  if (/^\d+$/.test(contentLength?.trim() ?? "") && Number(contentLength) > maxBytes) return null;
  if (!request.body) return new Uint8Array();
  const reader = request.body.getReader();
  // 小さなチャンクを配列にため込まず、上限サイズの固定バッファへ直接コピーする。
  const body = new Uint8Array(maxBytes);
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (totalBytes + value.byteLength > maxBytes) {
      await reader.cancel().catch(() => {});
      return null;
    }
    body.set(value, totalBytes);
    totalBytes += value.byteLength;
  }
  return body.slice(0, totalBytes);
}
