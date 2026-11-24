import { readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { test, expect } from "@playwright/test";
import { authorizeStagingRequests } from "../../test/stagingAccess";

test.use({ serviceWorkers: "block", trace: "off", screenshot: "off", video: "off" });

test("staging synthetic encrypted upload, share URL and download", async ({ page, context }, info) => {
  test.skip(process.env.E2E_RELEASE_STAGING !== "1", "Explicit staging release smoke only");
  const origin = process.env.E2E_BASE_URL;
  const local = process.env.E2E_ASTRO_HONO === "1" && origin === "http://localhost:3310";
  if (local) {
    const state = await realpath(process.env.E2E_STATE_DIR ?? "");
    if (path.dirname(state) !== await realpath("tmp") || !path.basename(state).startsWith("astro-hono-state.")) throw new Error("Disposable local storage required");
  } else {
    const plan = JSON.parse(await readFile(process.env.STAGING_PLAN_FILE ?? "tmp/staging-plan.json", "utf8"));
    if (origin !== plan.origin || !new URL(origin!).hostname.startsWith("staging.") || !origin?.startsWith("https://")) throw new Error("Refusing to upload outside the provisioned staging origin");
    if (!process.env.CF_ACCESS_CLIENT_ID || !process.env.CF_ACCESS_CLIENT_SECRET) throw new Error("Protected staging requires an Access service token");
    await authorizeStagingRequests(context, origin, {
      clientId: process.env.CF_ACCESS_CLIENT_ID,
      clientSecret: process.env.CF_ACCESS_CLIENT_SECRET,
    });
  }
  await page.addInitScript(() => {
    Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true });
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText: async (text: string) => { sessionStorage.setItem("release-share-url", text); } } });
  });
  const content = Buffer.from("Anzdrop synthetic staging release smoke; no user data.\n".repeat(100));
  await page.goto("/");
  await expect(page.locator("astro-island")).not.toHaveAttribute("ssr");
  await page.locator('input[type="file"]').setInputFiles({ name: "staging-smoke.txt", mimeType: "text/plain", buffer: content });
  await page.getByRole("button", { name: "詳細設定", exact: true }).click();
  await page.getByRole("button", { name: "1日", exact: true }).click();
  await page.getByRole("button", { name: "アップロードする", exact: true }).click();
  await expect(page.getByRole("button", { name: "URLをコピー", exact: true })).toBeVisible({ timeout: 60_000 });
  await page.getByRole("button", { name: "URLをコピー", exact: true }).click();
  const share = await page.evaluate(() => sessionStorage.getItem("release-share-url"));
  expect(share).toBeTruthy();
  expect(new URL(share!).origin).toBe(origin);
  expect(new URL(share!).hash.length).toBeGreaterThan(1);
  await page.goto(share!);
  const downloadEvent = page.waitForEvent("download");
  await page.getByRole("button", { name: "staging-smoke.txt" }).click();
  const download = await downloadEvent;
  const saved = info.outputPath("staging-smoke.txt");
  await download.saveAs(saved);
  expect(await readFile(saved)).toEqual(content);
});
