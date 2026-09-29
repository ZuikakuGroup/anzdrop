// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));

import SecureFileSharingLandingPage from "@/components/landing/SecureFileSharingLandingPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SecureFileSharingLandingPage", () => {
  it("安全性・無料プラン・利用手順とアップロード導線を表示する", async () => {
    await act(async () => {
      root.render(createElement(SecureFileSharingLandingPage));
      await Promise.resolve();
    });

    expect(container.textContent).toContain("大切なファイルを、");
    expect(container.textContent).toContain("安全に");
    expect(container.textContent).toContain("サーバーへ送られません");
    expect(container.textContent).toContain("無料プランは1ファイル最大5GB");
    expect(container.textContent).toContain("ファイルを選ぶ");
    expect(container.textContent).toContain("#復号鍵");
    expect(container.textContent).toContain("よくある質問");

    const uploadLinks = [...container.querySelectorAll("a")].filter(
      (link) => link.textContent?.includes("すぐファイルを送る")
    );
    expect(uploadLinks.length).toBeGreaterThan(0);
    expect(uploadLinks.every((link) => link.getAttribute("href") === "/")).toBe(true);

    const illustrations = [...container.querySelectorAll("img")];
    const illustrationSources = illustrations.map((image) =>
      decodeURIComponent(image.getAttribute("src") ?? "")
    );
    expect(illustrationSources.some((src) => src.includes("/images/loosedrawing/file-sharing.png"))).toBe(true);
    expect(illustrationSources.some((src) => src.includes("/images/loosedrawing/network-cloud.png"))).toBe(true);
    expect(illustrationSources.some((src) => src.includes("/images/loosedrawing/file-transfer.png"))).toBe(true);
    expect(illustrationSources.some((src) => src.includes("/images/loosedrawing/lock.png"))).toBe(true);
    expect(illustrationSources.some((src) => src.includes("/images/loosedrawing/documents.png"))).toBe(true);
  });

  it("料金・紹介・法的情報へのリンクを用意する", async () => {
    await act(async () => {
      root.render(createElement(SecureFileSharingLandingPage));
      await Promise.resolve();
    });

    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/pricing");
    expect(hrefs).toContain("/about");
    expect(hrefs).toContain("/legal/terms");
    expect(hrefs).toContain("/legal/privacy");
  });
});
