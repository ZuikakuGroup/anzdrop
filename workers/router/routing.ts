export function isApiRequest(pathname: string): boolean {
  return pathname === "/api" || pathname.startsWith("/api/");
}

export function isInternalRequest(pathname: string): boolean {
  return pathname === "/__internal" || pathname.startsWith("/__internal/");
}
