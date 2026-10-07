import { test, expect } from "@playwright/test";
import { createHmac, randomUUID } from "node:crypto";

const baseURL = process.env.E2E_BASE_URL;
const localEnabled = process.env.E2E_ACCOUNT_AUTH_LOCAL === "1"
  && !!baseURL && new URL(baseURL).hostname === "localhost";
const testToken = "XXXX.DUMMY.TOKEN.XXXX";

function otp(secret: string, stepOffset = 0): string {
  const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
  let bits = "";
  for (const char of secret) bits += alphabet.indexOf(char).toString(2).padStart(5, "0");
  const bytes = Buffer.from(bits.match(/.{8}/g)!.map((part) => parseInt(part, 2)));
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(Math.floor(Date.now() / 30_000) + stepOffset));
  const digest = createHmac("sha1", bytes).update(counter).digest();
  const offset = digest[19] & 15;
  return String((digest.readUInt32BE(offset) & 0x7fffffff) % 1_000_000).padStart(6, "0");
}

test("optional passkey and OTP registration, login, removal and recovery on local workerd", async ({ page }) => {
  test.skip(!localEnabled, "Explicit localhost authentication test environment required");
  test.setTimeout(150_000);
  const accountId = `auth-${randomUUID().slice(0, 12)}`;
  const password = "Local-auth-check-2026!";
  const post = (path: string, data: unknown) => page.request.post(path, {
    data, headers: { Origin: baseURL! },
  });
  const signup = await post("/api/account/signup", { accountId, password, turnstileToken: testToken });
  expect(signup.status()).toBe(200);
  const { recoveryCode } = await signup.json();
  expect((await post("/api/account/login", { accountId, password, turnstileToken: testToken })).status()).toBe(200);

  const cdp = await page.context().newCDPSession(page);
  await cdp.send("WebAuthn.enable");
  await cdp.send("WebAuthn.addVirtualAuthenticator", { options: {
    protocol: "ctap2", transport: "internal", hasResidentKey: true,
    hasUserVerification: true, isUserVerified: true, automaticPresenceSimulation: true,
  } });

  await page.goto("/mypage/security");
  await expect(page.getByLabel("パスキーの表示名")).toHaveCount(0);
  await page.getByRole("button", { name: "パスキーを追加", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "パスキーを追加", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "パスキーを追加", exact: true }).click();
  await page.getByLabel("パスキーの表示名").fill("検証端末");
  await page.getByRole("button", { name: "次へ", exact: true }).click();
  await page.getByLabel("現在のパスワード").fill(password);
  await page.getByRole("button", { name: "本人確認して続ける" }).click();
  await expect(page.getByRole("status")).toContainText("すべての端末");
  expect((await page.request.get("/api/account/me")).status()).toBe(401);

  await page.goto("/mypage/login");
  await page.getByRole("button", { name: "パスキーでログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/mypage$/);
  await page.goto("/mypage/security");
  await expect(page.getByText("検証端末", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "OTPを設定", exact: true }).click();
  await page.getByRole("button", { name: "パスキーで本人確認" }).click();
  await expect(page.getByRole("img", { name: "認証アプリ登録用QRコード" })).toBeVisible();
  await page.getByRole("button", { name: "設定を中止" }).click();
  await expect(page.getByRole("button", { name: "OTPを設定", exact: true })).toBeVisible();
  expect((await (await page.request.get("/api/account/security")).json()).totpEnabled).toBe(false);

  await page.getByRole("button", { name: "OTPを設定", exact: true }).click();
  await page.getByRole("button", { name: "パスキーで本人確認" }).click();
  await page.getByText("QRコードを読み取れない場合", { exact: true }).click();
  const secret = await page.locator("p").filter({ hasText: /^[A-Z2-7]{32}$/ }).textContent();
  expect(secret).toMatch(/^[A-Z2-7]{32}$/);
  await page.getByLabel("認証アプリの6桁コード").fill(otp(secret!));
  await page.getByRole("button", { name: "OTPを有効にする", exact: true }).click();
  await expect(page.getByRole("status")).toContainText("すべての端末");
  const start = await post("/api/account/login", { accountId, password, turnstileToken: testToken });
  expect(await start.json()).toEqual({ success: true, next: "otp" });
  expect((await page.request.get("/api/account/me")).status()).toBe(401);
  // 設定確認に使ったステップの再利用を避け、許容範囲内の次のコードで完了する。
  expect((await post("/api/account/login/otp", { code: otp(secret!, 1) })).status()).toBe(200);
  expect((await page.request.get("/api/account/me")).status()).toBe(200);
  expect((await post("/api/account/logout", {})).status()).toBe(200);

  await page.goto("/mypage/login");
  await page.getByRole("button", { name: "パスキーでログイン", exact: true }).click();
  await expect(page).toHaveURL(/\/mypage$/);
  await page.goto("/mypage/security");
  await page.getByRole("button", { name: "OTPを解除", exact: true }).click();
  await page.getByRole("button", { name: "パスキーで本人確認" }).click();
  await expect(page.getByRole("status")).toContainText("すべての端末");

  expect((await post("/api/account/login", { accountId, password, turnstileToken: testToken })).status()).toBe(200);
  await page.goto("/mypage/security");
  await page.getByRole("button", { name: "削除", exact: true }).click();
  await page.getByRole("button", { name: "パスキーで本人確認" }).click();
  await expect(page.getByRole("status")).toContainText("すべての端末");
  expect((await post("/api/account/login", { accountId, password, turnstileToken: testToken })).status()).toBe(200);
  const restored = await post("/api/account/recover", { accountId, recoveryCode, newPassword: `${password}new`, turnstileToken: testToken });
  expect(restored.status()).toBe(200);
  expect((await restored.json()).recoveryCode).not.toBe(recoveryCode);
  expect((await page.request.get("/api/account/me")).status()).toBe(401);
  expect((await post("/api/account/login", { accountId, password: `${password}new`, turnstileToken: testToken })).status()).toBe(200);
  expect(await (await page.request.get("/api/account/security")).json()).toMatchObject({ totpEnabled: false, passkeys: [] });
  await cdp.detach();
});

test("security dialog keeps interactive Turnstile reachable and preserves its widget when reopened", async ({ page }) => {
  test.skip(!localEnabled, "Explicit localhost authentication test environment required");
  await page.route("**/api/account/me", (route) => route.fulfill({ json: { success: true, accountId: "dialog-preview", plan: "free", planExpiresAt: null } }));
  await page.route("**/api/account/security", (route) => route.fulfill({ json: { success: true, accountId: "dialog-preview", totpEnabled: false, passkeys: [] } }));
  await page.route("**/api/account/security/reauth/password", (route) => route.fulfill({ status: 403, json: { success: false, error: "確認用の認証エラー" } }));
  await page.route("**/api/account/security/cancel", (route) => route.fulfill({ json: { success: true } }));
  // チャレンジの対話コールバックを再現し、native dialog内で実際に操作できることを確認する。
  await page.route("https://challenges.cloudflare.com/turnstile/v0/api.js*", (route) => route.fulfill({ contentType: "application/javascript", body: `
    (() => {
      let options, frame, count = 0;
      window.turnstile = {
        render(container, supplied) {
          count++; options = supplied;
          frame = document.createElement('iframe'); frame.title = '対話チャレンジ';
          container.appendChild(frame);
          const button = frame.contentDocument.createElement('button');
          button.textContent = 'チャレンジを確認';
          button.onclick = () => { options['after-interactive-callback'](); options.callback('XXXX.DUMMY.TOKEN.XXXX'); };
          frame.contentDocument.body.appendChild(button);
          return 'dialog-widget';
        },
        execute() { options['before-interactive-callback'](); },
        reset() {},
      };
      window.getDialogWidget = () => ({ count, frame });
    })();` }));
  await page.goto("/mypage/security");
  await page.getByRole("button", { name: "OTPを設定", exact: true }).click();
  const dialog = page.getByRole("dialog");
  await page.getByLabel("現在のパスワード").fill("test-password");
  await page.getByRole("button", { name: "本人確認して続ける" }).click();
  await expect(dialog.locator('iframe[title="対話チャレンジ"]')).toBeVisible();
  await dialog.frameLocator('iframe[title="対話チャレンジ"]').getByRole("button", { name: "チャレンジを確認" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("確認用の認証エラー");
  await page.getByRole("button", { name: "キャンセル", exact: true }).click();
  await expect(dialog).not.toBeVisible();
  await expect(page.getByRole("button", { name: "OTPを設定", exact: true })).toBeFocused();
  await page.getByRole("button", { name: "OTPを設定", exact: true }).click();
  await page.getByLabel("現在のパスワード").fill("test-password");
  await page.getByRole("button", { name: "本人確認して続ける" }).click();
  await dialog.frameLocator('iframe[title="対話チャレンジ"]').getByRole("button", { name: "チャレンジを確認" }).click();
  await expect(dialog.getByRole("alert")).toHaveText("確認用の認証エラー");
  expect(await page.evaluate(() => (window as unknown as { getDialogWidget: () => { count: number; frame: HTMLIFrameElement } }).getDialogWidget().count)).toBe(1);
});
