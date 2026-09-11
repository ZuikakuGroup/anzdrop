// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ArticleImageLightbox from "@/app/blog/[slug]/ArticleImageLightbox";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.useFakeTimers();
  document.body.innerHTML = "";
  document.body.style.overflow = "scroll";
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.useRealTimers();
});

describe("ArticleImageLightbox", () => {
  it("本文画像のクリックで拡大表示を開き、Escで閉じる", async () => {
    await act(async () => {
      root.render(createElement(
        ArticleImageLightbox,
        null,
        createElement("img", {
          src: "https://images.microcms-assets.io/assets/example/image.png",
          alt: "本文の画像",
          "data-zoomable-image": "",
          tabIndex: 0,
        })
      ));
    });

    const sourceImage = container.querySelector("img");
    expect(sourceImage).not.toBeNull();

    await act(async () => sourceImage!.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog).not.toBeNull();
    expect(dialog!.querySelector('img[alt="本文の画像"]')).not.toBeNull();
    expect(document.body.style.overflow).toBe("hidden");
    const closeButton = dialog!.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]');
    expect(document.activeElement).toBe(closeButton);

    await act(async () => closeButton!.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab", bubbles: true })));
    expect(document.activeElement).toBe(closeButton);

    await act(async () => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })));

    await act(async () => vi.advanceTimersByTime(160));

    expect(document.body.querySelector('[role="dialog"]')).toBeNull();
    expect(document.body.style.overflow).toBe("scroll");
    expect(document.activeElement).toBe(sourceImage);
  });

  it("本文画像をキーボード操作で拡大表示できる", async () => {
    await act(async () => {
      root.render(createElement(
        ArticleImageLightbox,
        null,
        createElement("img", {
          src: "https://images.microcms-assets.io/assets/example/image.png",
          alt: "本文の画像",
          "data-zoomable-image": "",
          tabIndex: 0,
        })
      ));
    });

    const sourceImage = container.querySelector("img");
    sourceImage!.focus();
    await act(async () => sourceImage!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });

  it("アイキャッチのボタンをキーボード操作で拡大表示できる", async () => {
    await act(async () => {
      root.render(createElement(
        ArticleImageLightbox,
        null,
        createElement(
          "button",
          { type: "button", "data-zoomable-trigger": "", "aria-label": "アイキャッチ画像を拡大表示" },
          createElement("img", {
            src: "https://images.microcms-assets.io/assets/example/image.png",
            alt: "アイキャッチ",
            "data-zoomable-image": "",
          })
        )
      ));
    });

    const trigger = container.querySelector<HTMLButtonElement>('button[aria-label="アイキャッチ画像を拡大表示"]');
    trigger!.focus();
    await act(async () => trigger!.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })));

    expect(document.body.querySelector('[role="dialog"]')).not.toBeNull();
  });
});
