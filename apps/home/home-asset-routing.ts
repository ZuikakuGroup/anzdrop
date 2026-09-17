const HOME_ASSET_PREFIX = "/_home-next/";

export function normalizeHomeAssetUrl(requestUrl: string): string {
  const url = new URL(requestUrl);

  if (url.pathname.startsWith(HOME_ASSET_PREFIX)) {
    // assetPrefixが付くのはNext.js標準の /_next/ URL全体なので、専用の先頭
    // だけを外す。`/_next`を改めて足すと /_next/_next/ になってしまう。
    url.pathname = `/${url.pathname.slice(HOME_ASSET_PREFIX.length)}`;
  }

  return url.toString();
}
