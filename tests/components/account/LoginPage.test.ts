// @vitest-environment jsdom
import { act, createElement, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import LoginPage from "@/components/account/LoginPage";

const { replace, passkeyLogin, getToken } = vi.hoisted(() => ({ replace: vi.fn(), passkeyLogin: vi.fn(), getToken: vi.fn().mockResolvedValue("turnstile") }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
vi.mock("@/lib/account/useRedirectIfLoggedIn", () => ({ useRedirectIfLoggedIn: () => true }));
vi.mock("@/lib/turnstile-client", () => ({ useTurnstile: () => ({ widget: null, getToken }) }));
vi.mock("@/components/brand/CenteredFormShell", () => ({ default: ({ children }: { children: ReactNode }) => children }));
vi.mock("@/lib/account/securityClient", async (original) => ({ ...await original<typeof import("@/lib/account/securityClient")>(), passkeysSupported: () => true, loginWithPasskey: passkeyLogin }));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  vi.clearAllMocks();
  fetchMock.mockReset();
  vi.stubGlobal("fetch", fetchMock);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function render() { await act(async () => root.render(createElement(LoginPage))); }
async function submit(values: Record<string, string>) {
  for (const [name, value] of Object.entries(values)) container.querySelector<HTMLInputElement>(`input[name="${name}"]`)!.value = value;
  await act(async () => container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));
}
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

describe("account login", () => {
  it("finishes an ordinary password login", async () => {
    fetchMock.mockResolvedValue(json({ success: true }));
    await render();
    await submit({ accountId: "alice", password: "password" });
    expect(replace).toHaveBeenCalledWith("/mypage");
  });
  it("waits for OTP and sends only its code at the second stage", async () => {
    fetchMock.mockResolvedValueOnce(json({ success: true, next: "otp" }))
      .mockResolvedValueOnce(json({ success: false, error: "コードが正しくありません" }, 403))
      .mockResolvedValueOnce(json({ success: true }));
    await render();
    await submit({ accountId: "alice", password: "password" });
    expect(replace).not.toHaveBeenCalled();
    expect(container.querySelector('input[name="password"]')).toBeNull();
    await submit({ code: "123456" });
    expect(replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain("コードが正しくありません");
    expect(JSON.parse(fetchMock.mock.calls[1][1].body)).toEqual({ code: "123456" });
    await submit({ code: "654321" });
    expect(replace).toHaveBeenCalledWith("/mypage");
  });
  it("keeps failed password logins on the form", async () => {
    fetchMock.mockResolvedValue(json({ success: false, error: "認証に失敗しました" }, 403));
    await render();
    await submit({ accountId: "alice", password: "wrong" });
    expect(replace).not.toHaveBeenCalled();
    expect(container.textContent).toContain("認証に失敗しました");
  });
  it("allows passkey cancellation without reporting a login failure", async () => {
    passkeyLogin.mockRejectedValue(new DOMException("Cancelled", "NotAllowedError"));
    await render();
    const button = [...container.querySelectorAll("button")].find((button) => button.textContent === "パスキーでログイン")!;
    await act(async () => button.click());
    expect(passkeyLogin).toHaveBeenCalledWith("turnstile");
    expect(replace).not.toHaveBeenCalled();
    expect(container.querySelector('[role="alert"]')?.textContent).toBe("");
    expect(button.disabled).toBe(false);
  });
});
