import { extractCookie } from "@/lib/cookie";

export const ADMIN_ACCESS_PATH = "/__internal/admin/access";

export type AdminAccessBinding = { fetch(request: Request): Promise<Response> };

export function isAdminPage(pathname: string): boolean {
  return pathname === "/admin" || pathname.startsWith("/admin/");
}

// Verify before rendering, even when Astro is reached without the public router.
// Send only the Access credentials and original host; never request admin data.
export async function canRenderAdminPage(request: Request, binding?: AdminAccessBinding): Promise<boolean> {
  if (!binding) return false;
  const url = new URL(ADMIN_ACCESS_PATH, request.url);
  const headers = new Headers();
  for (const name of ["Cf-Access-Jwt-Assertion"]) {
    const value = request.headers.get(name);
    if (value) headers.set(name, value);
  }
  const accessCookie = extractCookie(request.headers.get("Cookie"), "CF_Authorization");
  if (accessCookie) headers.set("Cookie", `CF_Authorization=${accessCookie}`);
  headers.set("Host", new URL(request.url).host);
  try {
    const response = await binding.fetch(new Request(url, { headers, redirect: "manual" }));
    return response.status === 204;
  } catch {
    return false;
  }
}
