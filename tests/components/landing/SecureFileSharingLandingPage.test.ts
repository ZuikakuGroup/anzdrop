// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/account/me-client", () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({ success: false }),
}));

import SecureFileSharingLandingPage from "@/components/landing/SecureFileSharingLandingPage";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(async () => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(SecureFileSharingLandingPage));
  });
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("SecureFileSharingLandingPage", () => {
  it("利用開始の導線と無料プランの条件を示す", () => {
    expect(container.querySelector("h1")?.textContent).toBe("ファイルは、送る前に暗号化。");

    const uploadLinks = [...container.querySelectorAll("a")].filter(
      (link) => link.textContent?.includes("無料でファイルを送る"),
    );
    expect(uploadLinks).toHaveLength(2);
    expect(uploadLinks.every((link) => link.getAttribute("href") === "/")).toBe(true);
    expect(uploadLinks.every((link) => link.querySelector('svg[aria-hidden="true"]'))).toBe(true);
    expect(container.querySelector("header nav a[href='/blog']")).not.toBeNull();
    expect(container.querySelector("header nav a[href='/contact']")).not.toBeNull();
    expect(container.textContent).toContain("登録不要の暗号化ファイル共有");
    expect(container.textContent).toContain("1ファイル最大5GB");

    const planSection = container.querySelector("#plan-heading")?.closest("section");
    const planTerms = [...(planSection?.querySelectorAll("dl > div") ?? [])].map((row) => [
      row.querySelector("dt")?.textContent,
      row.querySelector("dd")?.textContent,
    ]);
    expect(planTerms).toEqual([
      ["1ファイルの最大容量", "5GB"],
      ["保存期間", "1回・1日・3日・7日"],
      ["アップロード数", "無制限"],
    ]);
  });

  it("利用手順と通常の共有に限定した鍵の説明を示す", () => {
    const stepsSection = container.querySelector("#steps-heading")?.closest("section");
    expect(stepsSection?.textContent).not.toContain("アップロード画面を開く");
    expect(stepsSection?.textContent).not.toContain("ドラッグ&ドロップ");
    const steps = [...(stepsSection?.querySelectorAll("ol li h3") ?? [])].map(
      (heading) => heading.textContent,
    );
    expect(steps).toEqual([
      "ファイルを選ぶ",
      "ブラウザで暗号化して送る",
      "リンクを相手に渡す",
    ]);

    const privacySection = container.querySelector("#privacy-heading")?.closest("section");
    expect(privacySection?.textContent).toContain("通常の共有の場合");
    expect(privacySection?.textContent).toContain("#復号鍵");
    expect(privacySection?.textContent).toContain("サーバーへ送られません");
    expect(privacySection?.textContent).toContain("URLをなくすと運営者も復元できません");
  });

  it("FAQと詳細・料金・法的情報へのリンクを用意する", () => {
    const faqSection = container.querySelector("#faq-heading")?.closest("section");
    const questions = [...(faqSection?.querySelectorAll('button[aria-expanded]') ?? [])].map(
      (button) => button.textContent,
    );
    expect(questions).toHaveLength(5);
    expect(questions.some((question) => question?.includes("運営者がファイルを見る"))).toBe(true);
    expect(questions.some((question) => question?.includes("共有URLをなくした"))).toBe(true);
    expect(
      [...(faqSection?.querySelectorAll('button[aria-expanded]') ?? [])].every((button) =>
        button.querySelector('svg[aria-hidden="true"]'),
      ),
    ).toBe(true);

    const hrefs = [...container.querySelectorAll("a")].map((link) => link.getAttribute("href"));
    expect(hrefs).toContain("/pricing");
    expect(hrefs).toContain("/about");
    expect(hrefs).toContain("/legal/terms");
    expect(hrefs).toContain("/legal/privacy");
  });

  it("FAQはクリックで1件ずつ開閉できる", async () => {
    const faqSection = container.querySelector("#faq-heading")?.closest("section");
    const buttons = [...(faqSection?.querySelectorAll('button[aria-expanded]') ?? [])];
    const panels = [...(faqSection?.querySelectorAll('[role="region"]') ?? [])];

    expect(buttons).toHaveLength(5);
    expect(panels).toHaveLength(5);
    expect(buttons.every((button) => button.getAttribute("aria-expanded") === "false")).toBe(true);
    expect(panels.every((panel) => panel.getAttribute("aria-hidden") === "true")).toBe(true);

    await act(async () => {
      buttons[0]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("true");
    expect(panels[0]?.getAttribute("aria-hidden")).toBe("false");
    expect(buttons.slice(1).every((button) => button.getAttribute("aria-expanded") === "false")).toBe(
      true,
    );

    await act(async () => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(buttons[0]?.getAttribute("aria-expanded")).toBe("false");
    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("true");
    expect(panels[1]?.getAttribute("aria-hidden")).toBe("false");

    await act(async () => {
      buttons[1]?.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });

    expect(buttons[1]?.getAttribute("aria-expanded")).toBe("false");
    expect(panels[1]?.getAttribute("aria-hidden")).toBe("true");
  });
});
