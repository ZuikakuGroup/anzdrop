import { pathToFileURL } from "node:url";

/** @param {string} origin @param {{expectedOrigin?: string, fetcher?: (url: URL, options: RequestInit) => Promise<Response>, headers?: Record<string, string>}} options */
export async function smokeRelease(origin, { expectedOrigin, fetcher = fetch, headers = {} } = {}) {
  const url = new URL(origin);
  if (url.protocol !== "https:" || url.origin !== origin || origin !== expectedOrigin) throw new Error("Smoke target must match the configured HTTPS origin");
  async function request(path) {
    const response = await fetcher(new URL(path, origin), { headers, redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (response.status >= 300 && response.status < 400) throw new Error("Smoke request redirected; check origin and Access policy");
    return response;
  }
  const home = await request("/");
  if (home.status !== 200 || !home.headers.get("content-type")?.includes("text/html")) throw new Error("HTML smoke failed");
  const html = await home.text();
  const assets = [...new Set([...html.matchAll(/(?:src|href)=["'](\/_public-astro\/[^"']+\.(?:js|css))["']/g)].map(match => match[1]))].slice(0, 3);
  if (!assets.length) throw new Error("HTML does not reference versioned Astro assets");
  for (const asset of assets) {
    const response = await request(asset);
    if (response.status !== 200 || response.headers.get("content-type")?.includes("text/html")) throw new Error("Versioned asset smoke failed");
    await response.body?.cancel();
  }
  const me = await request("/api/account/me");
  if (me.status !== 401 || (await me.json()).success !== false) throw new Error("API binding/authentication smoke failed");
  const internal = await request("/__internal/admin-auth");
  if (internal.status !== 404) throw new Error("Internal route exposure smoke failed");
  await internal.body?.cancel();
  console.log("Read-only smoke passed: HTML, assets, API, internal route isolation");
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  const headers = {};
  if (process.env.CF_ACCESS_CLIENT_ID || process.env.CF_ACCESS_CLIENT_SECRET) {
    if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("Both Access service token fields are required");
    headers["CF-Access-Client-Id"] = process.env.CF_ACCESS_CLIENT_ID;
    headers["CF-Access-Client-Secret"] = process.env.CF_ACCESS_CLIENT_SECRET;
  }
  await smokeRelease(process.env.SMOKE_ORIGIN, { expectedOrigin: process.env.EXPECTED_ORIGIN, headers });
}
