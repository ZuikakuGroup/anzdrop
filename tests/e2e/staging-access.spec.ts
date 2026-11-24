import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import type { AddressInfo } from "node:net";
import { test, expect } from "@playwright/test";
import { authorizeStagingRequests } from "../../test/stagingAccess";

test.use({ trace: "off", video: "off", screenshot: "off", serviceWorkers: "block" });

async function listen(handler: (request: IncomingMessage, response: ServerResponse) => void) {
  const server = createServer(handler);
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  return { server, origin: `http://127.0.0.1:${(server.address() as AddressInfo).port}` };
}

test("Access credentials never follow a cross-origin redirect", async ({ context, page }) => {
  const credentials = { clientId: "synthetic-access-id", clientSecret: "synthetic-access-secret" };
  const received: { at: string; id: string | string[] | undefined; secret: string | string[] | undefined }[] = [];
  const destination = await listen((request, response) => {
    received.push({ at: "destination", id: request.headers["cf-access-client-id"], secret: request.headers["cf-access-client-secret"] });
    response.end("destination");
  });
  const source = await listen((request, response) => {
    received.push({ at: request.url!, id: request.headers["cf-access-client-id"], secret: request.headers["cf-access-client-secret"] });
    if (request.url === "/ok") { response.end("authenticated staging"); return; }
    if (request.url === "/same") response.writeHead(302, { location: "/cross" });
    else response.writeHead(302, { location: `${destination.origin}/arrived` });
    response.end();
  });
  try {
    await authorizeStagingRequests(context, source.origin, credentials);
    await page.goto(`${source.origin}/ok`);
    await expect(page.locator("body")).toHaveText("authenticated staging");
    await expect(page.goto(`${source.origin}/same`)).rejects.toThrow();
    await expect(page.goto(`${source.origin}/cross`)).rejects.toThrow();
    expect(received.filter(row => row.at === "/same" || row.at === "/cross")).toEqual([
      { at: "/same", id: credentials.clientId, secret: credentials.clientSecret },
      { at: "/cross", id: credentials.clientId, secret: credentials.clientSecret },
    ]);
    expect(received.filter(row => row.at === "destination")).toHaveLength(0);
  } finally {
    source.server.closeAllConnections(); destination.server.closeAllConnections();
    await Promise.all([source.server, destination.server].map(server => new Promise<void>(resolve => server.close(() => resolve()))));
  }
});
