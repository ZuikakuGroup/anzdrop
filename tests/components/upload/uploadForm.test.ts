// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/account/me-client", () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({ success: false }),
}));

import UploadForm from "@/components/upload/uploadForm";

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

describe("UploadForm の詳細設定", () => {
  it("初期表示では詳細設定を描画せず、操作後に開く", async () => {
    await act(async () => {
      root.render(
        createElement(UploadForm, {
          header: null,
          footer: null,
        })
      );
      await Promise.resolve();
    });

    const button = [...container.querySelectorAll("button")].find(
      (element) => element.textContent?.includes("詳細設定")
    );
    expect(button).toBeDefined();
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(container.textContent).not.toContain("保存期間");

    await act(async () => button!.click());

    await vi.waitFor(() => {
      expect(container.textContent).toContain("保存期間");
    });

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("パスワードを設定する");
  });
});
