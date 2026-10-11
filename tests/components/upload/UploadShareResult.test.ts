// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";


import UploadShareResult from "@/components/upload/UploadShareResult";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

async function render(props: {
  isQrOpen?: boolean;
  onReset?: () => void;
  onCloseQr?: () => void;
}) {
  const onReset = props.onReset ?? vi.fn();
  const onCloseQr = props.onCloseQr ?? vi.fn();

  await act(async () => {
    root.render(
      createElement(UploadShareResult, {
        shareUrl: "https://anzdrop.example/d/share#key",
        copyState: "idle",
        canShareNatively: false,
        isQrOpen: props.isQrOpen ?? false,
        onReset,
        onCopy: () => {},
        onShareNative: () => {},
        onShareToLine: () => {},
        onOpenQr: () => {},
        onCloseQr,
      })
    );
  });

  return { onReset, onCloseQr };
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("UploadShareResult", () => {
  it("Escape で結果パネルを閉じる(onReset)", async () => {
    const { onReset, onCloseQr } = await render({});

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onReset).toHaveBeenCalledTimes(1);
    expect(onCloseQr).not.toHaveBeenCalled();
  });

  it("QR 表示中の Escape は QR だけ閉じ、結果パネルは閉じない", async () => {
    const { onReset, onCloseQr } = await render({ isQrOpen: true });

    await act(async () => {
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" }));
    });

    expect(onCloseQr).toHaveBeenCalledTimes(1);
    expect(onReset).not.toHaveBeenCalled();
  });
});
