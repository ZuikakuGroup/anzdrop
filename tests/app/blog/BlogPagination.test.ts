// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import BlogPagination from "@/app/blog/BlogPagination";

const { push } = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  push.mockReset();
  document.body.innerHTML = "";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
});

function setInputValue(input: HTMLInputElement, value: string) {
  Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value);
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

describe("BlogPagination", () => {
  it("矢印で前後ページへ移動し、端では対応する矢印を無効化する", async () => {
    await act(async () => {
      root.render(createElement(BlogPagination, { page: 1, lastPage: 3 }));
    });

    const previous = container.querySelector<HTMLButtonElement>('button[aria-label="前のページ"]');
    const next = container.querySelector<HTMLButtonElement>('button[aria-label="次のページ"]');
    expect(previous?.disabled).toBe(true);
    expect(next?.disabled).toBe(false);
    expect(previous?.querySelector("svg")?.getAttribute("class")).toContain("rotate-90");
    expect(previous?.querySelector("svg")?.getAttribute("class")).not.toContain("-rotate-90");
    expect(next?.querySelector("svg")?.getAttribute("class")).toContain("-rotate-90");
    expect(previous?.className).toContain("size-8");
    expect(next?.className).toContain("size-8");
    expect(container.querySelector<HTMLInputElement>('input[name="page"]')?.className).toContain("size-8");
    expect(container.textContent).not.toContain("/ 3");

    await act(async () => next!.click());
    expect(push).toHaveBeenCalledWith("/blog?page=2");

    await act(async () => {
      root.render(createElement(BlogPagination, { page: 3, lastPage: 3 }));
    });
    expect(container.querySelector<HTMLButtonElement>('button[aria-label="次のページ"]')?.disabled).toBe(true);
  });

  it("ページ番号を入力してEnterで指定ページへ移動できる", async () => {
    await act(async () => {
      root.render(createElement(BlogPagination, { page: 1, lastPage: 3 }));
    });

    const input = container.querySelector<HTMLInputElement>('input[name="page"]');
    const form = container.querySelector("form");
    expect(input).not.toBeNull();
    expect(form).not.toBeNull();

    await act(async () => setInputValue(input!, "3"));
    await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(push).toHaveBeenCalledWith("/blog?page=3");
  });

  it("ページ番号欄にフォーカスすると現在値を選択する", async () => {
    await act(async () => {
      root.render(createElement(BlogPagination, { page: 2, lastPage: 3 }));
    });

    const input = container.querySelector<HTMLInputElement>('input[name="page"]');
    expect(input).not.toBeNull();

    await act(async () => input!.focus());
    expect(input!.selectionStart).toBe(0);
    expect(input!.selectionEnd).toBe(1);
  });

  it("範囲外のページ番号は移動せず現在ページへ戻す", async () => {
    await act(async () => {
      root.render(createElement(BlogPagination, { page: 2, lastPage: 3 }));
    });

    const input = container.querySelector<HTMLInputElement>('input[name="page"]');
    const form = container.querySelector("form");
    await act(async () => setInputValue(input!, "4"));
    await act(async () => form!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })));

    expect(push).not.toHaveBeenCalled();
    expect(input!.value).toBe("2");
  });
});
