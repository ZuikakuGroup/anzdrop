import { readFile } from "node:fs/promises";
import { test, expect, type Browser, type BrowserContext, type Download, type Page, type TestInfo } from "@playwright/test";
import { unzipSync } from "fflate";
import { createSharingFile, assertSharingFilesEqual, SYNTHETIC_MARKER } from "../../test/sharingFiles";

const baseURL = process.env.E2E_BASE_URL ?? "https://anzdrop.com";
const local = process.env.E2E_ASTRO_HONO === "1" && new URL(baseURL).hostname === "localhost";
const extended = process.env.E2E_EXTENDED === "1";
const MiB = 1024 * 1024;
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

async function fixture(info: TestInfo, name = "共有ファイル.bin", size = 64 * 1024, seed = 0): Promise<Fixture> {
  const filename = info.outputPath("inputs", name);
  await createSharingFile(filename, size, seed);
  return { name, filename };
}

async function upload(page: Page, files: Fixture[], protectedShare = false): Promise<string> {
  await page.goto("/");
  await expect(page.locator("astro-island")).not.toHaveAttribute("ssr");
  await page.locator('input[type="file"]').setInputFiles(files.map(f => f.filename));
  await page.getByRole("button", { name: "詳細設定", exact: true }).click();
  await page.getByRole("button", { name: "1日", exact: true }).click();
  if (protectedShare) {
    await page.getByRole("checkbox", { name: "パスワードを設定する" }).check();
    await page.getByPlaceholder("パスワード", { exact: true }).fill(password);
  }
  await page.getByRole("button", { name: "アップロードする", exact: true }).click();
  await expect(page.getByText("共有リンクを発行しました", { exact: true })).toBeVisible({ timeout: 120_000 });
  await page.getByRole("button", { name: "URLをコピー", exact: true }).click();
  const url = await page.evaluate(() => (window as unknown as { sharingTestState: BrowserState }).sharingTestState.copied);
  const parsed = new URL(url);
  expect(parsed.origin).toBe(new URL(baseURL).origin);
  expect(parsed.pathname).toMatch(/^\/d\//);
  expect(parsed.hash.length > 0).toBe(!protectedShare);
  return url;
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
  const pending = page.waitForEvent("download", { timeout: 120_000 });
  if (zip) await page.getByRole("button", { name: "全てダウンロード", exact: true }).click();
  else await page.getByRole("button", { name: files[0].name }).click();
  const download = await pending;
  await verifyRoute(download, expectedRoute, info);
  const filename = info.outputPath("saved", zip ? "archive.zip" : "download.bin");
  await download.saveAs(filename);
  expect(await download.failure()).toBeNull();
  if (zip) {
    const entries = unzipSync(await readFile(filename));
    expect(Object.keys(entries).sort()).toEqual(files.map(f => f.name).sort());
    for (const file of files) expect(Buffer.from(entries[file.name]).equals(await readFile(file.filename)), "ZIP entry bytes match").toBe(true);
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

  test.describe("extended", () => {
    test.skip(!extended, "E2E_EXTENDED=1 enables large files and fault injection");
    test.setTimeout(180_000);
    for (const [label, size, forceBlob] of [["multipart", 16 * MiB + 1, false], ["large", 200 * MiB + 1, false], ["forced-blob", 16 * MiB + 1, true]] as const) {
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
        expect(route, "cancellation requires a genuinely streaming browser download").toBe("service-worker");
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
    for (const fault of ["network", "corruption"] as const) {
      test(`${fault} @sharing-extended`, async ({ page, context, browser }, info) => {
        const files = [await fixture(info)];
        const privacy = new PrivacyWatch(files.map(f => f.name)); await privacy.attach(context);
        const url = await upload(page, files);
        const receiver = await createReceiver(browser, "block"); await privacy.attach(receiver);
        try {
          const target = await receiver.newPage(); await target.goto(url);
          await expect(target.getByRole("button", { name: files[0].name })).toBeVisible();
          await receiver.route("**/api/file/*", async route => {
            if (fault === "network") return route.abort("failed");
            const response = await route.fetch(), body = await response.body();
            body[body.length - 1] ^= 255;
            await route.fulfill({ response, body });
          });
          let downloads = 0; target.on("download", () => downloads++);
          await target.getByRole("button", { name: files[0].name }).click();
          await expect(target.getByText(/ダウンロードに失敗|エラーが発生/)).toBeVisible();
          expect(downloads).toBe(0);
          await receiver.unrouteAll({ behavior: "wait" });
          await target.getByRole("button", { name: "閉じる", exact: true }).click();
          await save(target, info, files, "blob");
          await privacy.verify(info);
        } finally { await receiver.close(); }
      });
    }
  });
});
