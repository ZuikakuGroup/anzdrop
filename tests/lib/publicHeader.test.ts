// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { getCurrentAccount } from "@/lib/account/me-client";
import { initPublicHeader } from "@/lib/publicHeader";

vi.mock("@/lib/account/me-client", () => ({ getCurrentAccount: vi.fn() }));

afterEach(() => {
  document.body.replaceChildren();
  vi.resetAllMocks();
});

function createHeader() {
  const root = document.createElement("div");
  root.innerHTML = `
    <div data-desktop-auth></div><div data-mobile-auth></div>
    <button data-action="mobile-menu" aria-expanded="false"></button>
    <div id="mobile-menu-panel" inert></div><div data-mobile-content></div>
    <span data-menu-open-icon></span><span data-menu-close-icon hidden></span>
    <template data-desktop-guest><a href="/mypage/login">ログイン</a></template>
    <template data-mobile-guest><a href="/mypage/login">ログイン</a></template>
    <template data-desktop-account><span data-account-id></span></template>
    <template data-mobile-account><span data-account-id></span></template>`;
  document.body.appendChild(root);
  return root;
}

describe("public header lifecycle", () => {
  it("does not render a late account response or handle clicks after disposal", async () => {
    let resolve!: (account: Awaited<ReturnType<typeof getCurrentAccount>>) => void;
    vi.mocked(getCurrentAccount).mockReturnValue(new Promise(done => { resolve = done; }));
    const root = createHeader();
    const dispose = initPublicHeader(root);
    const button = root.querySelector<HTMLButtonElement>("button")!;
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
    dispose();
    resolve({ success: true, accountId: "account-1", plan: "free", planExpiresAt: null });
    await new Promise(done => setTimeout(done, 0));
    expect(root.querySelector("[data-desktop-auth]")!.childNodes).toHaveLength(0);
    button.click();
    expect(button.getAttribute("aria-expanded")).toBe("true");
  });

  it("renders account IDs as text rather than interpreting markup", async () => {
    const accountId = '<img src=x onerror="alert(1)">';
    vi.mocked(getCurrentAccount).mockResolvedValue({ success: true, accountId, plan: "free", planExpiresAt: null });
    const root = createHeader();
    const dispose = initPublicHeader(root);
    try {
      await vi.waitFor(() => expect(root.querySelector("[data-desktop-auth]")?.textContent).toBe(accountId));
      expect(root.querySelectorAll("[data-account-id]")).toHaveLength(2);
      expect(root.querySelector("img")).toBeNull();
    } finally { dispose(); }
  });
});
