const HOME_ASSET_PREFIX = "/_home-next/";

export function isHomeRequest(pathname: string): boolean {
  return pathname.startsWith(HOME_ASSET_PREFIX);
}

const PUBLIC_PATHS = new Set([
  "/", "/mypage", "/about", "/pricing", "/legal/terms", "/legal/privacy", "/legal/tokushoho",
  "/lp/secure-file-sharing", "/robots.txt", "/sitemap.xml",
]);

export function isPublicRequest(pathname: string): boolean {
  const normalized = pathname.endsWith("/") ? pathname.slice(0, -1) : pathname;
  return pathname === "/" || normalized === "/d" || pathname.startsWith("/d/")
    || pathname.startsWith("/mypage/") || PUBLIC_PATHS.has(normalized) || normalized === "/blog"
    || pathname.startsWith("/blog/") || pathname.startsWith("/_public-astro/");
}
