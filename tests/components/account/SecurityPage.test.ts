// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SecurityPage from "@/components/account/SecurityPage";

const { replace, canUsePasskey, qr } = vi.hoisted(() => ({ replace: vi.fn(), canUsePasskey: vi.fn().mockReturnValue(true), qr: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/navigation", () => {
  const router = { replace };
  return { useRouter: () => router };
});
vi.mock("@/lib/turnstile-client", () => ({ TURNSTILE_SITE_KEY: "", useTurnstile: () => ({ widget: null, getToken: async () => "turnstile" }) }));
vi.mock("@/components/brand/SiteHeader", () => ({ default: () => null }));
vi.mock("@/components/brand/SiteFooter", () => ({ default: () => null }));
vi.mock("@/lib/account/securityClient", async (original) => ({ ...await original<typeof import("@/lib/account/securityClient")>(), passkeysSupported: canUsePasskey }));
vi.mock("qrcode", () => ({ default: { toCanvas: qr } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const status = { success: true, accountId: "alice", totpEnabled: false, passkeys: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
  HTMLDialogElement.prototype.showModal = function () { this.setAttribute("open", ""); };
  HTMLDialogElement.prototype.close = function () { this.removeAttribute("open"); };
  vi.clearAllMocks(); canUsePasskey.mockReturnValue(true);
  fetchMock.mockReset(); vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });
async function render() { await act(async () => root.render(createElement(SecurityPage))); }
async function click(text: string) { await act(async () => [...container.querySelectorAll("button")].find((button) => button.textContent === text)!.click()); }
async function submit(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value;
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}

describe("security settings", () => {
  it("enables OTP only after checking the first code", async () => {
    fetchMock.mockImplementation(async (url: string) => {
      if (url === "/api/account/security") return json(status);
      if (url.endsWith("/setup")) return json({ success: true, secret: "SETUPSECRET", uri: "otpauth://totp/test" });
      return json({ success: true });
    });
    await render(); await click("OTPを設定");
    await submit({ password: "password" });
    expect(container.textContent).toContain("SETUPSECRET");
    expect(container.textContent).not.toContain("すべての端末をログアウトしました");
    expect(qr).toHaveBeenCalled();
    await submit({ code: "123456" });
    expect(container.textContent).toContain("すべての端末をログアウトしました");
    expect(container.textContent).not.toContain("SETUPSECRET");
  });
  it("removes setup secrets from the page when setup is cancelled", async () => {
    fetchMock.mockImplementation(async (url: string) => url === "/api/account/security" ? json(status)
      : url.endsWith("/setup") ? json({ success: true, secret: "SETUPSECRET", uri: "otpauth://totp/test" }) : json({ success: true }));
    await render(); await click("OTPを設定"); await submit({ password: "password" }); await click("設定を中止");
    expect(container.textContent).not.toContain("SETUPSECRET");
    expect(container.textContent).toContain("未設定");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/confirm"))).toBe(false);
  });
  it("requires the existing OTP when reauthenticating to disable it", async () => {
    fetchMock.mockImplementation(async (url: string) => url === "/api/account/security" ? json({ ...status, totpEnabled: true })
      : json({ success: false, error: "認証に失敗しました" }, 403));
    await render(); await click("OTPを解除");
    expect(container.querySelector('input[name="code"]')).not.toBeNull();
    await submit({ password: "password", code: "123456" });
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toMatchObject({ action: "totp-disable", code: "123456" });
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/disable"))).toBe(false);
  });
  it("explains unavailable passkeys and redirects only on 401", async () => {
    canUsePasskey.mockReturnValue(false); fetchMock.mockResolvedValue(json(status));
    await render(); expect(container.textContent).toContain("このブラウザではパスキーを利用できません");
    expect([...container.querySelectorAll("button")].some((button) => button.textContent === "パスキーを追加")).toBe(false); expect(replace).not.toHaveBeenCalled();
  });
  it("shows a retry button on temporary server failure", async () => {
    fetchMock.mockResolvedValue(json({ success: false }, 500)); await render();
    expect(container.textContent).toContain("再読み込み"); expect(replace).not.toHaveBeenCalled();
  });
});


describe("security operation dialogs", () => {
  it("keeps registration fields out of the overview and opens a name step", async () => {
    fetchMock.mockResolvedValue(json(status));
    await render();
    expect(container.querySelector('input[name="name"]')).toBeNull();
    const trigger = [...container.querySelectorAll("button")].find((button) => button.textContent === "パスキーを追加")!;
    await click("パスキーを追加");
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(container.querySelector('input[name="name"]')).not.toBeNull();
    await submit({ name: "My phone" });
    expect(container.querySelector("dialog[open]")!.textContent).toContain("My phone");
    expect(container.querySelector('input[name="password"]')).not.toBeNull();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await click("キャンセル");
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).not.toBe("hidden");
  });

  it("clears an OTP setup secret and cancels the server operation when Escape closes the dialog", async () => {
    fetchMock.mockImplementation(async (url: string) => url === "/api/account/security" ? json(status)
      : url.endsWith("/setup") ? json({ success: true, secret: "SETUPSECRET", uri: "otpauth://totp/test" }) : json({ success: true }));
    await render(); await click("OTPを設定"); await submit({ password: "password" });
    expect(container.querySelector("dialog[open]")!.textContent).toContain("SETUPSECRET");
    await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(container.querySelector("dialog[open]")).toBeNull();
    expect(container.textContent).not.toContain("SETUPSECRET");
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/cancel"))).toBe(true);
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/confirm"))).toBe(false);
  });

  it("prevents Escape dismissal while authentication is in flight", async () => {
    let finish: ((response: Response) => void) | undefined;
    fetchMock.mockImplementation(async (url: string) => url === "/api/account/security" ? json(status)
      : new Promise<Response>((resolve) => { finish = resolve; }));
    await render(); await click("OTPを設定");
    const input = container.querySelector<HTMLInputElement>('input[name="password"]')!;
    input.value = "password";
    await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
    await act(async () => container.querySelector("dialog")!.dispatchEvent(new Event("cancel", { cancelable: true })));
    expect(container.querySelector("dialog[open]")).not.toBeNull();
    expect(fetchMock.mock.calls.some(([url]) => String(url).endsWith("/cancel"))).toBe(false);
    await act(async () => finish!(json({ success: false, error: "認証に失敗しました" }, 403)));
    expect(container.querySelector("dialog[open]")!.textContent).toContain("認証に失敗しました");
  });
});


it("closes immediately without cancellation feedback and restores focus after cleanup", async () => {
  let finish: ((response: Response) => void) | undefined;
  fetchMock.mockImplementation(async (url: string) => {
    if (url === "/api/account/security") return json(status);
    if (url.endsWith("/setup")) return json({ success: true, secret: "SETUPSECRET", uri: "otpauth://totp/test" });
    if (url.endsWith("/cancel")) return new Promise<Response>((resolve) => { finish = resolve; });
    return json({ success: true });
  });
  await render();
  const trigger = [...container.querySelectorAll("button")].find((button) => button.textContent === "OTPを設定")!;
  await click("OTPを設定"); await submit({ password: "password" }); await click("設定を中止");
  expect(container.textContent).not.toContain("SETUPSECRET");
  expect(container.querySelector("dialog[open]")).toBeNull();
  expect(container.textContent).not.toContain("中止しています");
  expect(document.body.style.overflow).not.toBe("hidden");
  expect(trigger.disabled).toBe(true);
  await act(async () => finish!(json({ success: true })));
  expect(container.querySelector("dialog[open]")).toBeNull();
  expect(trigger.disabled).toBe(false);
  expect(document.activeElement).toBe(trigger);
});
