// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import UploadFilePicker from "@/components/upload/UploadFilePicker";
import UploadProgress from "@/components/upload/UploadProgress";
import UploadShareResult from "@/components/upload/UploadShareResult";

const noop = () => {};

describe("アップロード欄の高さ", () => {
  const panels = [
    createElement(UploadFilePicker, { fileInputId: "file", files: [], onFileChange: noop }),
    createElement(UploadFilePicker, { fileInputId: "file", files: [{ path: "test.txt", file: new File(["test"], "test.txt") }], onFileChange: noop }),
    createElement(UploadProgress, { progress: 50 }),
    ...(["idle", "copied", "failed"] as const).map(copyState => createElement(UploadShareResult, {
      shareUrl: "https://example.com/d/share#key", copyState, canShareNatively: true,
      isQrOpen: false, onReset: noop, onCopy: noop, onShareNative: noop,
      onShareToLine: noop, onOpenQr: noop, onCloseQr: noop,
    })),
  ];

  it("未選択・選択済み・進捗・コピー各状態で同じ固定高を使う", () => {
    for (const panel of panels) {
      const container = document.createElement("div");
      container.innerHTML = renderToStaticMarkup(panel);
      const element = container.firstElementChild!;
      expect(element.classList.contains("h-40")).toBe(true);
      expect(element.className).not.toMatch(/min-h-/);
      if (element.textContent?.includes("共有リンクを発行しました") || element.getAttribute("role") === "alert") {
        expect(element.classList.contains("overflow-y-auto")).toBe(true);

      }
    }
  });
});
