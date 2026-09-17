const HOME_ASSET_PREFIX = "/_home-next/";

export function isHomeRequest(pathname: string): boolean {
  return pathname === "/" || pathname.startsWith(HOME_ASSET_PREFIX);
}
