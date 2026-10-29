import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import { createHash } from "node:crypto";
import { readFile, writeFile, rm, realpath } from "node:fs/promises";
import { test, expect, firefox, type Browser, type BrowserContext, type Download, type Page, type TestInfo } from "@playwright/test";
import { unzipSync } from "fflate";
import { createSharingFile, assertSharingFilesEqual, sharingFileSha256, SYNTHETIC_MARKER } from "../../test/sharingFiles";

const baseURL = process.env.E2E_BASE_URL ?? "https://anzdrop.com";
const local = process.env.E2E_ASTRO_HONO === "1" && new URL(baseURL).hostname === "localhost";
const extended = process.env.E2E_EXTENDED === "1";
const MiB = 1024 * 1024;
const transferWaitMs = process.env.E2E_LARGE_MIB === "1024" ? 900_000 : process.env.E2E_LARGE_MIB ? 300_000 : 120_000;
const password = "Synthetic-sharing-password-238!";
type Fixture = { name: string; filename: string };
type BrowserState = { copied: string; release?: () => void };

class PrivacyWatch {
  private keys: Buffer[] = [];
  private violations: { kind: string; field: string }[] = [];
  private requests = 0;
  constructor(private names: string[]) {}

  async attach(context: BrowserContext) {
    await context.exposeBinding("captureSyntheticKey", (_source, raw: number[]) => {
      const bytes = Buffer.from(raw);
      if (!this.keys.some(k => k.equals(bytes))) this.keys.push(bytes);
    });
    await context.addInitScript(() => {
      const state: BrowserState = { copied: "" };
      Object.defineProperty(window, "sharingTestState", { value: state });
      Object.defineProperty(navigator, "clipboard", { configurable: true, value: {
        writeText: async (value: string) => { state.copied = value; },
      } });
      const original = crypto.subtle.exportKey.bind(crypto.subtle);
      Object.defineProperty(crypto.subtle, "exportKey", { value: async (format: KeyFormat, key: CryptoKey) => {
        const result = await original(format as "raw", key);
        if (format === "raw" && key.algorithm.name === "AES-GCM") {
          await (window as unknown as { captureSyntheticKey: (raw: number[]) => Promise<void> }).captureSyntheticKey(Array.from(new Uint8Array(result)));
        }
        return result;
      } });
    });
    context.on("request", request => {
      const url = new URL(request.url());
      if (!url.protocol.startsWith("http")) return;
      this.requests++;
      const kind = url.pathname.startsWith("/api/") ? url.pathname.split("/").slice(0, 3).join("/") : "other";
      const body = request.postDataBuffer() ?? Buffer.alloc(0);
      const fields = [body, Buffer.from(request.url()), Buffer.from(JSON.stringify(request.headers()))];
      const secrets = [SYNTHETIC_MARKER, password, ...this.names];
      if (secrets.some(value => fields.some(field => field.includes(Buffer.from(value)) || field.includes(Buffer.from(encodeURIComponent(value)))))) {
        this.violations.push({ kind, field: "plaintext/name/password" });
      }
      if (this.keys.some(key => fields.some(field => [key, Buffer.from(key.toString("base64url")), Buffer.from(key.toString("base64")), Buffer.from(key.toString("hex"))].some(value => field.includes(value))))) {
        this.violations.push({ kind, field: "raw-key" });
      }
    });
  }
  async verify(info: TestInfo) {
    expect(this.keys.length, "actual client key exports observed").toBeGreaterThan(0);
    expect(this.requests).toBeGreaterThan(0);
    expect(this.violations, "outgoing request privacy violations (values omitted)").toEqual([]);
    await info.attach("privacy-summary", { body: JSON.stringify({ requests: this.requests, keyExports: this.keys.length, violations: this.violations }), contentType: "application/json" });
  }
}

async function createReceiver(browser: Browser, serviceWorkers: "allow" | "block" = "allow") {
  const receiver = await browser.newContext({ baseURL, serviceWorkers });
  // Exercise the common browser download path. Unit tests cover the native
  // picker branch; actual OS dialogs require the Safari manual checks.
  await receiver.addInitScript(() => Object.defineProperty(window, "showSaveFilePicker", { value: undefined, configurable: true }));
  return receiver;
}

async function disposableStateDirectory() {
  const state = process.env.E2E_STATE_DIR;
  if (!state || path.dirname(await realpath(state)) !== await realpath("tmp") || !path.basename(state).startsWith("astro-hono-state.")) throw new Error("Disposable local state required");
  return state;
}

async function transferOutput(info: TestInfo, folder: "inputs" | "saved", name = "") {
  return path.join(await disposableStateDirectory(), "fixtures", info.testId.replace(/[^A-Za-z0-9_-]/g, "_"), folder, name);
}

async function fixture(info: TestInfo, name = "共有ファイル.bin", size = 64 * 1024, seed = 0): Promise<Fixture> {
  const filename = await transferOutput(info, "inputs", name);
  await createSharingFile(filename, size, seed);
  return { name, filename };
}

async function selectFiles(page: Page, files: Fixture[], protectedShare = false) {
  await page.goto("/");
  await expect(page.locator("astro-island")).not.toHaveAttribute("ssr");
  await page.locator('input[type="file"]').setInputFiles(files.map(f => f.filename));
  await page.getByRole("button", { name: "詳細設定", exact: true }).click();
  await page.getByRole("button", { name: "1日", exact: true }).click();
  if (protectedShare) {
    await page.getByRole("checkbox", { name: "パスワードを設定する" }).check();
    await page.getByPlaceholder("パスワード", { exact: true }).fill(password);
  }
}

async function upload(page: Page, files: Fixture[], protectedShare = false): Promise<string> {
  await selectFiles(page, files, protectedShare);
  await page.getByRole("button", { name: "アップロードする", exact: true }).click();
  return copyShareUrl(page, protectedShare);
}

async function copyShareUrl(page: Page, protectedShare = false): Promise<string> {
  await expect(page.getByRole("status").filter({ hasText: /^アップロード完了$/ })).toBeVisible({ timeout: transferWaitMs });
  await expect(page.getByRole("button", { name: "URLをコピー", exact: true })).toBeVisible({ timeout: transferWaitMs });
  await page.getByRole("button", { name: "URLをコピー", exact: true }).click();
  const url = await page.evaluate(() => (window as unknown as { sharingTestState: BrowserState }).sharingTestState.copied);
  const parsed = new URL(url);
  expect(parsed.origin).toBe(new URL(baseURL).origin);
  expect(parsed.pathname).toMatch(/^\/d\//);
  expect(parsed.hash.length > 0).toBe(!protectedShare);
  return url;
}

async function mutateLocalShare(url: string, operation: "expire" | "missing-object") {
  const state = await disposableStateDirectory();
  const shareId = new URL(url).pathname.split("/").at(-1)!;
  if (!/^[A-Za-z0-9_-]+$/.test(shareId)) throw new Error("Invalid synthetic share identifier");
  const sql = operation === "expire"
    ? `UPDATE shares SET expires_at = '2000-01-01T00:00:00.000Z' WHERE id = '${shareId}'`
    : `UPDATE files SET storage_key = 'synthetic-missing-object' WHERE share_id = '${shareId}'`;
  await promisify(execFile)(process.execPath, ["node_modules/wrangler/bin/wrangler.js", "d1", "execute", "DB", "--local",
    "--config", "tmp/astro-hono/wrangler.json", "--persist-to", state, "--command", sql,
  ]);
}

async function prepareSave(page: Page, info: TestInfo, forceBlob = false) {
  const capability = await page.evaluate(async () => {
    let transferable = false;
    const channel = new MessageChannel();
    try {
      const stream = new ReadableStream();
      channel.port1.postMessage(stream, [stream]); transferable = true;
    } catch { /* Real unsupported capability; do not emulate support. */ }
    finally { channel.port1.close(); channel.port2.close(); }
    const available = "serviceWorker" in navigator;
    return { transferable, available, controlled: available && !!navigator.serviceWorker.controller };
  });
  const expected = !forceBlob && capability.transferable && capability.available;
  if (expected) {
    await expect.poll(() => page.evaluate(() => !!navigator.serviceWorker.controller), { message: "download worker controls receiver", timeout: 10_000 }).toBe(true);
    capability.controlled = true;
  }
  await info.attach("save-capabilities", { body: JSON.stringify({ ...capability, expected: expected ? "service-worker" : "blob" }), contentType: "application/json" });
  return expected ? "service-worker" : "blob";
}

async function save(page: Page, info: TestInfo, files: Fixture[], expectedRoute: string, zip = false) {
  const pending = page.waitForEvent("download", { timeout: transferWaitMs });
  if (zip) await page.getByRole("button", { name: "全てダウンロード", exact: true }).click();
  else await page.getByRole("button", { name: files[0].name }).click();
  const download = await pending;
  await verifyRoute(download, expectedRoute, info);
  const filename = await transferOutput(info, "saved", zip ? "archive.zip" : "download.bin");
  await download.saveAs(filename);
  expect(await download.failure()).toBeNull();
  if (zip) {
    const entries = unzipSync(await readFile(filename));
    expect(Object.keys(entries).sort()).toEqual(files.map(f => f.name).sort());
    for (const file of files) expect(createHash("sha256").update(entries[file.name]).digest("hex"), "ZIP entry SHA-256").toBe(await sharingFileSha256(file.filename));
  } else {
    expect(download.suggestedFilename()).toBe(files[0].name);
    await assertSharingFilesEqual(filename, files[0].filename);
  }
  if (expectedRoute === "service-worker") {
    // Let the application finish the attachment navigation before closing its
    // context and collecting the trace (including the worker network events).
    await expect.poll(() => page.locator("iframe").evaluateAll(
      (frames, url) => frames.some(frame => (frame as HTMLIFrameElement).src === url), download.url()
    ), { message: "completed download navigation is cleaned up" }).toBe(false);
  }
}
async function verifyRoute(download: Download, expected: string, info: TestInfo) {
  const actual = new URL(download.url()).pathname.startsWith("/_anzdrop_download/") ? "service-worker" : download.url().startsWith("blob:") ? "blob" : "unexpected";
  expect(actual, "actual browser download path").toBe(expected);
  await info.attach("save-route", { body: actual, contentType: "text/plain" });
}

test.use({ trace: "retain-on-failure" });

// Delete only fixture/download directories owned by the current test, even on failure.
// eslint-disable-next-line no-empty-pattern -- Playwright requires fixture destructuring.
test.afterEach(async ({}, info) => {
  await Promise.all((["inputs", "saved"] as const).map(folder => transferOutput(info, folder).then(directory => rm(directory, { recursive: true, force: true }))));
});

test.describe("file sharing", () => {
  test.skip(!local, "Requires the isolated localhost Astro/Hono test environment");
  test.describe.configure({ retries: 0 });


  for (const scenario of ["basic", "password", "zip"] as const) {
    test(`${scenario} @sharing-core`, async ({ page, context, browser }, info) => {
      const files = scenario === "zip"
        ? await Promise.all([fixture(info, "日本語.bin", 64 * 1024, 1), fixture(info, "second.bin", 64 * 1024 + 7, 2), fixture(info, "third.bin", 1024, 3)])
        : [await fixture(info)];
      const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
      const url = await upload(page, files, scenario === "password");
      const receiver = await createReceiver(browser); await privacy.attach(receiver);
      try {
        const target = await receiver.newPage(); await target.goto(url);
        if (scenario === "password") {
          await target.getByPlaceholder("パスワード", { exact: true }).fill("Incorrect-synthetic-password");
          await target.getByRole("button", { name: "開く", exact: true }).click();
          await expect(target.getByText("パスワードが違います。", { exact: true })).toBeVisible();
          await expect(target.getByRole("button", { name: files[0].name })).toHaveCount(0);
          await target.getByPlaceholder("パスワード", { exact: true }).fill(password);
          await target.getByRole("button", { name: "開く", exact: true }).click();
        }
        await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
        await save(target, info, files, await prepareSave(target, info), scenario === "zip");
        await privacy.verify(info);
      } finally { await receiver.close(); }
    });
  }

  test("text image and binary @sharing-core", async ({ page, context, browser }, info) => {
    const files = await Promise.all([
      fixture(info, "日本語 の テキスト.txt", 128), fixture(info, "画像 1.png", 128),
      fixture(info, "binary.bin", MiB),
    ]);
    await writeFile(files[0].filename, `${SYNTHETIC_MARKER}\n日本語のテスト本文です。\n`);
    // A real 1x1 PNG, rather than random bytes with an image extension.
    await writeFile(files[1].filename, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jH1sAAAAASUVORK5CYII=", "base64"));
    const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
    await page.setViewportSize({ width: 375, height: 667 });
    const url = await upload(page, files);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    const receiver = await createReceiver(browser); await privacy.attach(receiver);
    try {
      const target = await receiver.newPage(); await target.setViewportSize({ width: 375, height: 667 }); await target.goto(url);
      await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
      const route = await prepareSave(target, info);
      for (const file of files) await save(target, info, [file], route);
      await privacy.verify(info);
    } finally { await receiver.close(); }
  });

  test("rejects empty and mixed selections before upload @sharing-core", async ({ page, context }, info) => {
    const empty = await fixture(info, "empty.bin", 0), normal = await fixture(info, "normal.bin", 128);
    const privacy = new PrivacyWatch([empty.name, normal.name]); await privacy.attach(context);
    let starts = 0;
    page.on("request", request => { if (new URL(request.url()).pathname === "/api/upload/start") starts++; });
    for (const files of [[empty], [normal, empty]]) {
      await page.goto("/"); await expect(page.locator("astro-island")).not.toHaveAttribute("ssr");
      await page.locator('input[type="file"]').setInputFiles(files.map(file => file.filename));
      await expect(page.getByText("empty.bin は空のファイルのため送信できません。", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "閉じる", exact: true }).click();
      await page.getByRole("button", { name: "アップロードする", exact: true }).click();
      await expect(page.getByText("ファイルを選択してください。", { exact: true })).toBeVisible();
      expect(starts).toBe(0);
    }
  });

  test.describe("resilience", () => {
    test.skip(process.env.E2E_RESILIENCE !== "1", "E2E_RESILIENCE=1 enables fault/concurrency tests");
    test.setTimeout(120_000);

    for (const fault of ["disconnect", "timeout", "server", "abort"] as const) {
      test(`upload ${fault} and retry @sharing-fault`, async ({ page, context, browser }, info) => {
        const files = [await fixture(info, "retry.bin", fault === "disconnect" ? 16 * MiB + 1 : MiB)];
        const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
        let attempts = 0, completed = 0, storedFirstParts = 0;
        page.on("request", request => { if (new URL(request.url()).pathname === "/api/upload/complete") completed++; });
        await page.route("**/api/upload/chunk", async route => {
          attempts++;
          if (fault === "disconnect" && await route.request().headerValue("Anzdrop-Part-Number") === "1") {
            const response = await route.fetch();
            expect(response.ok()).toBe(true); storedFirstParts++;
            return route.fulfill({ response });
          }
          if (fault === "server") await route.fulfill({ status: 503, json: { success: false, error: "Synthetic unavailable" } });
          else await route.abort(fault === "timeout" ? "timedout" : fault === "abort" ? "aborted" : "connectionreset");
        });
        await selectFiles(page, files);
        await page.getByRole("button", { name: "アップロードする", exact: true }).click();
        await expect(page.getByRole("button", { name: "閉じる", exact: true })).toBeVisible({ timeout: 45_000 });
        expect(attempts).toBeGreaterThan(0);
        if (fault === "disconnect") expect(storedFirstParts).toBeGreaterThan(0);
        expect(completed, "failed chunks must never finalize a share").toBe(0);
        await expect(page.getByRole("button", { name: "URLをコピー", exact: true })).toHaveCount(0);
        await page.unroute("**/api/upload/chunk");
        await page.getByRole("button", { name: "閉じる", exact: true }).click();
        await page.getByRole("button", { name: "アップロードする", exact: true }).click();
        const url = await copyShareUrl(page);
        const receiver = await createReceiver(browser); await privacy.attach(receiver);
        try {
          const target = await receiver.newPage(); await target.goto(url);
          await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
          await save(target, info, files, await prepareSave(target, info));
          await privacy.verify(info);
        } finally { await receiver.close(); }
      });
    }

    test("reload while upload is pending @sharing-fault", async ({ page, context, browser }, info) => {
      const files = [await fixture(info, "reload.bin", MiB)];
      const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
      let release!: () => void;
      const gate = new Promise<void>(resolve => { release = resolve; });
      let intercepted = false, completed = 0;
      page.on("request", request => { if (new URL(request.url()).pathname === "/api/upload/complete") completed++; });
      await page.route("**/api/upload/chunk", async route => { intercepted = true; await gate; await route.abort("aborted").catch(() => {}); });
      try {
        await selectFiles(page, files);
        await page.getByRole("button", { name: "アップロードする", exact: true }).click();
        await expect.poll(() => intercepted).toBe(true);
        await expect(page.getByRole("button", { name: /アップロード中/ })).toBeDisabled();
        await page.reload();
        await expect(page.locator("astro-island")).not.toHaveAttribute("ssr");
        await expect(page.getByRole("button", { name: "URLをコピー", exact: true })).toHaveCount(0);
        expect(await page.locator('input[type="file"]').evaluate(input => (input as HTMLInputElement).files?.length)).toBe(0);
        expect(completed).toBe(0);
      } finally { release(); await page.unrouteAll({ behavior: "wait" }); }
      // No resume is promised. A fresh selection must still complete normally.
      const url = await upload(page, files);
      const receiver = await createReceiver(browser); await privacy.attach(receiver);
      try {
        const target = await receiver.newPage(); await target.goto(url);
        await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
        await save(target, info, files, await prepareSave(target, info));
      } finally { await receiver.close(); }
    });

    test("invalid missing and expired links @sharing-fault", async ({ page, context }, info) => {
      const files = [await fixture(info)]; const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
      const url = await upload(page, files);
      const missingKey = new URL(url); missingKey.hash = "";
      await page.goto(missingKey.href);
      await expect(page.getByText("このリンクには復号鍵が含まれていません。", { exact: true })).toBeVisible();
      const wrongKey = new URL(url); wrongKey.hash = "invalid-key";
      await page.goto(wrongKey.href); await page.reload();
      await expect(page.getByText(/このリンクの復号鍵が正しくありません/)).toBeVisible();
      await page.goto("/d/synthetic-missing-share#invalid-key");
      await expect(page.getByText("このリンクは無効です。", { exact: true })).toBeVisible();
      // Expire only this test's share in the runner-owned local D1; no test API.
      await mutateLocalShare(url, "expire");
      await page.goto(url);
      await expect(page.getByText("このリンクの有効期限が切れています。", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: files[0].name })).toHaveCount(0);
    });

    test("missing R2 object is removed from the download list @sharing-fault", async ({ page, context, browser }, info) => {
      const files = [await fixture(info)]; const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
      const url = await upload(page, files);
      await mutateLocalShare(url, "missing-object");
      const receiver = await createReceiver(browser, "block"); await privacy.attach(receiver);
      try {
        const target = await receiver.newPage(); await target.goto(url);
        const button = target.getByRole("button", { name: files[0].name });
        await expect(button).toBeVisible();
        let downloads = 0; target.on("download", () => downloads++);
        await button.click();
        await expect(target.getByText("このファイルはすでにダウンロード済みか、削除されています。", { exact: true })).toBeVisible();
        await expect(button).toHaveCount(0); expect(downloads).toBe(0);
      } finally { await receiver.close(); }
    });

    test("concurrent uploads and recipients @sharing-fault", async ({ browser }, info) => {
      const files = await Promise.all([fixture(info, "concurrent-a.bin", MiB, 11), fixture(info, "concurrent-b.bin", MiB + 17, 23)]);
      const privacy = new PrivacyWatch(files.map(f => f.name));
      const senders = await Promise.all([browser.newContext({ baseURL }), browser.newContext({ baseURL })]);
      const receivers: BrowserContext[] = [];
      try {
        for (const sender of senders) await privacy.attach(sender);
        const pages = await Promise.all(senders.map(sender => sender.newPage()));
        const urls = await Promise.all(pages.map((page, index) => upload(page, [files[index]])));
        expect(new URL(urls[0]).pathname).not.toBe(new URL(urls[1]).pathname);
        receivers.push(...await Promise.all([createReceiver(browser), createReceiver(browser), createReceiver(browser)]));
        await Promise.all(receivers.map(async (receiver, index) => {
          await privacy.attach(receiver);
          const file = files[index === 2 ? 1 : 0];
          const page = await receiver.newPage(); await page.goto(urls[index === 2 ? 1 : 0]);
          await expect(page.getByRole("button", { name: file.name })).toBeVisible();
          // Unique output paths prevent concurrent saves from overwriting one another.
          const download = page.waitForEvent("download");
          await prepareSave(page, info);
          await page.getByRole("button", { name: file.name }).click();
          const result = await download;
          const filename = await transferOutput(info, "saved", `recipient-${index}.bin`);
          await result.saveAs(filename); expect(await result.failure()).toBeNull();
          await assertSharingFilesEqual(filename, file.filename);
        }));
        await privacy.verify(info);
      } finally { await Promise.all([...senders, ...receivers].map(context => context.close())); }
    });
  });

  test("Chromium sender to Firefox recipient @sharing-cross-engine", async ({ page, context, browserName }, info) => {
    test.skip(process.env.E2E_CROSS_ENGINE !== "1" || browserName !== "chromium", "Explicit cross-engine run requires both installed engines");
    const files = [await fixture(info, "cross-engine.bin", MiB)];
    const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
    const url = await upload(page, files);
    const otherBrowser = await firefox.launch();
    try {
      const receiver = await createReceiver(otherBrowser); await privacy.attach(receiver);
      const target = await receiver.newPage(); await target.goto(url);
      await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
      await save(target, info, files, await prepareSave(target, info));
      await privacy.verify(info);
    } finally { await otherBrowser.close(); }
  });

  test.describe("manual sizes", () => {
    const value = process.env.E2E_LARGE_MIB;
    const size = value === undefined ? 0 : Number(value);
    if (value !== undefined && ![1, 10, 100, 1024].includes(size)) throw new Error("E2E_LARGE_MIB must be 1, 10, 100 or 1024");
    test.skip(!size, "Set E2E_LARGE_MIB explicitly for a size-specific test");
    test.setTimeout(size === 1024 ? 900_000 : 300_000);
    test("explicit size with SHA-256 @sharing-size", async ({ page, context, browser }, info) => {
      const files = [await fixture(info, "size.bin", size * MiB)];
      const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
      const url = await upload(page, files);
      const receiver = await createReceiver(browser); await privacy.attach(receiver);
      try {
        const target = await receiver.newPage(); await target.goto(url);
        await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
        await save(target, info, files, await prepareSave(target, info));
        await privacy.verify(info);
      } finally { await receiver.close(); }
    });
  });

  test.describe("extended", () => {
    test.skip(!extended, "E2E_EXTENDED=1 enables large files and fault injection");
    test.setTimeout(180_000);
    for (const [label, size, forceBlob] of [["multipart", 16 * MiB + 1, false], ["forced-blob", 10 * MiB, true]] as const) {
      test(`${label} @sharing-extended`, async ({ page, context, browser }, info) => {
        const files = [await fixture(info, `${label}.bin`, size)];
        const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
        const url = await upload(page, files);
        const receiver = await createReceiver(browser, forceBlob ? "block" : "allow"); await privacy.attach(receiver);
        try {
          const target = await receiver.newPage(); await target.goto(url);
          await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
          await save(target, info, files, await prepareSave(target, info, forceBlob));
          await privacy.verify(info);
        } finally { await receiver.close(); }
      });
    }
    test("cancel and retry @sharing-extended", async ({ page, context, browser }, info) => {
      const files = [await fixture(info, "cancel.bin", 16 * MiB + 1)];
      const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
      const url = await upload(page, files);
      const receiver = await createReceiver(browser); await privacy.attach(receiver);
      // Gate the real transferred stream after its first chunk. This does not
      // emulate browser support or replace the encrypted file API.
      await receiver.addInitScript(() => {
        const original = ServiceWorker.prototype.postMessage;
        ServiceWorker.prototype.postMessage = function(message, transfer) {
          if (message?.type === "ANZDROP_STREAM_DOWNLOAD") {
            const state = (window as unknown as { sharingTestState: BrowserState }).sharingTestState;
            if (!state.release) {
              const reader = (message.readable as ReadableStream<Uint8Array>).getReader();
              let first = true;
              const gate = new Promise<void>(resolve => { state.release = resolve; });
              const readable = new ReadableStream<Uint8Array>({
                async pull(controller) {
                  if (!first) await gate;
                  first = false;
                  const result = await reader.read();
                  if (result.done) controller.close(); else controller.enqueue(result.value);
                },
                cancel(reason) { state.release?.(); return reader.cancel(reason); },
              });
              const originalStream = message.readable;
              message = { ...message, readable };
              if (Array.isArray(transfer)) transfer = transfer.map(item => item === originalStream ? readable : item);
            }
          }
          return original.call(this, message, Array.isArray(transfer) ? { transfer } : transfer);
        };
      });
      try {
        const target = await receiver.newPage(); await target.goto(url);
        await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
        const route = await prepareSave(target, info);
        test.skip(route !== "service-worker", "Browser cannot transfer a streaming download; native cancellation is unavailable");
        const pending = target.waitForEvent("download");
        await target.getByRole("button", { name: files[0].name }).click();
        const download = await pending; await verifyRoute(download, route, info);
        await download.cancel();
        expect(await download.failure()).toBe("canceled");
        await target.evaluate(() => (window as unknown as { sharingTestState: BrowserState }).sharingTestState.release?.());
        await save(target, info, files, route);
        await privacy.verify(info);
      } finally { await receiver.close(); }
    });
    for (const fault of ["network", "corruption", "empty"] as const) {
      test(`${fault} @sharing-extended`, async ({ page, context, browser }, info) => {
        const files = [await fixture(info, `${fault}.bin`, 10 * MiB)];
        const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
        const url = await upload(page, files);
        const receiver = await createReceiver(browser, "block"); await privacy.attach(receiver);
        try {
          const target = await receiver.newPage(); await target.goto(url);
          await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
          let firstWindows = 0, failedWindows = 0;
          await receiver.route("**/api/file/*", async route => {
            if (fault === "network") {
              if (route.request().headers().range?.startsWith("bytes=0-")) {
                const response = await route.fetch();
                expect(response.status()).toBe(206); firstWindows++;
                return route.fulfill({ response });
              }
              failedWindows++; return route.abort("failed");
            }
            if (fault === "empty") return route.fulfill({ status: 200, contentType: "application/octet-stream", body: "" });
            const response = await route.fetch(), body = await response.body();
            body[body.length - 1] ^= 255;
            await route.fulfill({ response, body });
          });
          let downloads = 0; target.on("download", () => downloads++);
          await target.getByRole("button", { name: files[0].name }).click();
          await expect(target.getByText(/ダウンロードに失敗|エラーが発生/)).toBeVisible();
          expect(downloads).toBe(0);
          if (fault === "network") { expect(firstWindows).toBeGreaterThan(0); expect(failedWindows).toBeGreaterThan(0); }
          await receiver.unrouteAll({ behavior: "wait" });
          await target.getByRole("button", { name: "閉じる", exact: true }).click();
          await save(target, info, files, "blob");
          await privacy.verify(info);
        } finally { await receiver.close(); }
      });
    }
  });
});
