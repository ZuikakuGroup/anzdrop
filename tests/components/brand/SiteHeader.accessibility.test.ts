// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import SiteHeader from "@/components/brand/SiteHeader";

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  vi.stubGlobal(
    "fetch",
    vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          success: true,
          accountId: "account-1",
          plan: "free",
          planExpiresAt: null,
        })
      )
    )
  );
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

describe("SiteHeader のアカウントメニュー", () => {
  it("開閉状態と対象メニューを関連付ける", async () => {
    await act(async () => {
      root.render(createElement(SiteHeader));
      await Promise.resolve();
    });

    const button = [...container.querySelectorAll("button")].find(
      (element) => element.textContent?.includes("account-1")
    );
    expect(button).toBeDefined();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(button?.hasAttribute("aria-controls")).toBe(false);

    await act(async () => button!.click());

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(button?.getAttribute("aria-controls")).toBe("desktop-account-menu");
    expect(container.querySelector("#desktop-account-menu")).not.toBeNull();
  });
});
