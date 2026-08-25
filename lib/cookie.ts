// Cookieヘッダーから指定した名前の値を取り出す。
export function extractCookie(
  cookieHeader: string | null,
  name: string
): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const part of cookieHeader.split(";")) {
    const separatorIndex = part.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = part.slice(0, separatorIndex).trim();
    const value = part.slice(separatorIndex + 1).trim();

    if (key === name) {
      return value;
    }
  }

  return null;
}

// HttpOnly・Secure・SameSite=StrictなSet-Cookieヘッダー値を組み立てる。
// maxAgeSecondsを省略するとセッションCookie(ブラウザを閉じるまで)、
// 0を渡すと即時失効(ログアウト用)。
export function buildSetCookie(
  name: string,
  value: string,
  maxAgeSeconds?: number
): string {
  const attributes = [
    `${name}=${value}`,
    "Path=/",
    "HttpOnly",
    "Secure",
    "SameSite=Strict",
  ];

  if (maxAgeSeconds !== undefined) {
    attributes.push(`Max-Age=${maxAgeSeconds}`);
  }

  return attributes.join("; ");
}
