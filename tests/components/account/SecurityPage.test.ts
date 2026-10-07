// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SecurityPage from "@/components/account/SecurityPage";

const { replace, canUsePasskey, qr } = vi.hoisted(() => ({ replace: vi.fn(), canUsePasskey: vi.fn().mockReturnValue(true), qr: vi.fn().mockResolvedValue(undefined) }));
vi.mock("next/navigation", () => {
  const router = { replace };
  return { useRouter: () => router };
});
vi.mock("@/lib/turnstile-client", () => ({ useTurnstile: () => ({ widget: null, getToken: async () => "turnstile" }) }));
vi.mock("@/components/brand/CenteredFormShell", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/account/securityClient", async (original) => ({ ...await original<typeof import("@/lib/account/securityClient")>(), passkeysSupported: canUsePasskey }));
vi.mock("qrcode", () => ({ default: { toCanvas: qr } }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
const status = { success: true, accountId: "alice", totpEnabled: false, passkeys: [] };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
beforeEach(() => {
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
    expect(container.textContent).not.toContain("パスキーを追加"); expect(replace).not.toHaveBeenCalled();
  });
  it("shows a retry button on temporary server failure", async () => {
    fetchMock.mockResolvedValue(json({ success: false }, 500)); await render();
    expect(container.textContent).toContain("再読み込み"); expect(replace).not.toHaveBeenCalled();
  });
});
