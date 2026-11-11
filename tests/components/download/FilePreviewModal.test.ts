// @vitest-environment jsdom
import { act, createElement } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createReactHarness, disposeReactHarness } from "@/test/react";
import FilePreviewModal, { type PreviewState } from "@/components/download/FilePreviewModal";

const originalShowModal = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "showModal");
const originalClose = Object.getOwnPropertyDescriptor(HTMLDialogElement.prototype, "close");

let harness: ReturnType<typeof createReactHarness>;
let trigger: HTMLButtonElement;
const preview: PreviewState = {
  file: { id: "local-file", name: "受け取った画像.png", size: 100, isOneTime: false },
  url: "blob:local-preview",
  kind: "image",
};

beforeEach(() => {
  // jsdom has no native modal implementation; browser coverage checks focus containment.
  Object.defineProperty(HTMLDialogElement.prototype, "showModal", { configurable: true, value: function (this: HTMLDialogElement) { this.open = true; } });
  Object.defineProperty(HTMLDialogElement.prototype, "close", { configurable: true, value: function (this: HTMLDialogElement) { this.open = false; } });
  trigger = document.createElement("button");
  document.body.appendChild(trigger);
  trigger.focus();
  document.body.style.overflow = "scroll";
  harness = createReactHarness();
});

afterEach(async () => {
  await disposeReactHarness(harness.root, harness.container);
  trigger.remove();
  document.body.style.overflow = "";
  vi.restoreAllMocks();
  for (const [name, descriptor] of [["showModal", originalShowModal], ["close", originalClose]] as const) {
    if (descriptor) Object.defineProperty(HTMLDialogElement.prototype, name, descriptor);
    else Reflect.deleteProperty(HTMLDialogElement.prototype, name);
  }
});

describe("FilePreviewModal", () => {
  it("ファイル名付きモーダルを開き、閉じる操作へフォーカスして終了時に元へ戻す", async () => {
    await act(async () => harness.root.render(createElement(FilePreviewModal, { preview, onClose: vi.fn() })));
    const dialog = harness.container.querySelector("dialog")!;
    expect(dialog.open).toBe(true);
    expect(document.getElementById(dialog.getAttribute("aria-labelledby")!)?.textContent).toBe(preview.file.name);
    expect(document.activeElement).toBe(dialog.querySelector("button"));
    expect(dialog.querySelector("img")?.getAttribute("src")).toBe(preview.url);
    expect(document.body.style.overflow).toBe("hidden");
    await act(async () => harness.root.render(null));
    expect(document.activeElement).toBe(trigger);
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("読み込み中にフォーカスが外れても、保存した起動元へ戻す", async () => {
    trigger.blur();
    await act(async () => harness.root.render(createElement(FilePreviewModal, { preview: { ...preview, trigger }, onClose: vi.fn() })));
    await act(async () => harness.root.render(null));
    expect(document.activeElement).toBe(trigger);
  });

  it("Escape相当のcancelと閉じるボタンは閉じ、内容のクリックでは閉じない", async () => {
    const onClose = vi.fn();
    await act(async () => harness.root.render(createElement(FilePreviewModal, { preview, onClose })));
    const dialog = harness.container.querySelector("dialog")!;
    await act(async () => dialog.querySelector("img")!.click());
    expect(onClose).not.toHaveBeenCalled();
    const cancel = new Event("cancel", { cancelable: true });
    await act(async () => dialog.dispatchEvent(cancel));
    expect(cancel.defaultPrevented).toBe(true);
    expect(onClose).toHaveBeenCalledTimes(1);
    await act(async () => dialog.querySelector("button")!.click());
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("背景クリックだけを閉じる操作として扱う", async () => {
    const onClose = vi.fn();
    await act(async () => harness.root.render(createElement(FilePreviewModal, { preview, onClose })));
    const dialog = harness.container.querySelector("dialog")!;
    vi.spyOn(dialog, "getBoundingClientRect").mockReturnValue({ left: 10, top: 10, right: 100, bottom: 100 } as DOMRect);
    await act(async () => dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 50, clientY: 50 })));
    expect(onClose).not.toHaveBeenCalled();
    await act(async () => dialog.dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 1, clientY: 1 })));
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
