import type { BrowserContext } from "@playwright/test";

export async function authorizeStagingRequests(
  context: BrowserContext,
  origin: string,
  credentials: { clientId: string; clientSecret: string },
) {
  await context.route(url => url.origin === origin, async route => {
    // route.continue headers follow redirects, including across origins.
    // Fetch a single hop and reject redirects, including same-origin redirects.
    // Playwright does not route every hop of a browser redirect chain.
    try {
      const response = await route.fetch({
        maxRedirects: 0,
        headers: {
          ...route.request().headers(),
          "CF-Access-Client-Id": credentials.clientId,
          "CF-Access-Client-Secret": credentials.clientSecret,
        },
      });
      try {
        if (response.status() >= 300 && response.status() < 400) await route.abort("blockedbyclient");
        else await route.fulfill({ response });
      }
      finally { await response.dispose(); }
    } catch {
      // Playwright network errors may contain request headers; omit the cause.
      throw new Error("Staging Access request failed");
    }
  });
}
