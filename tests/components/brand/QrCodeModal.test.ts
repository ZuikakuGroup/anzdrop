// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { toString } = vi.hoisted(() => ({ toString: vi.fn() }));

vi.mock("qrcode", () => ({
  default: { toString },
}));

import QrCodeModal from "@/components/brand/QrCodeModal";

let container: HTMLDivElement;
let root: Root;

async function render(props: {
  url?: string;
  isOpen: boolean;
  onClose?: () => void;
}): Promise<void> {
  await act(async () => {
    root.render(createElement(QrCodeModal, {
      url: props.url ?? "https://anzdrop.example/d/share#secret",
      isOpen: props.isOpen,
      onClose: props.onClose ?? (() => {}),
    }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  toString.mockResolvedValue('<svg data-testid="qr-code" />');
  document.body.innerHTML = "";
  document.body.style.overflow = "scroll";
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  vi.restoreAllMocks();
});

describe("QrCodeModal", () => {
  it("閉じている間は QR を生成せず、ページのスクロール設定も変えない", async () => {
    await render({ isOpen: false });

    expect(toString).not.toHaveBeenCalled();
    expect(document.querySelector('[data-testid="qr-code"]')).toBeNull();
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("開いたときだけ指定 URL から QR を生成し、ページのスクロールを止める", async () => {
    const url = "https://anzdrop.example/d/share#secret";
    await render({ isOpen: true, url });

    expect(toString).toHaveBeenCalledWith(url, { type: "svg", margin: 1 });
    expect(document.body.style.overflow).toBe("hidden");
    expect(document.querySelector('[data-testid="qr-code"]')).not.toBeNull();
  });

  it("背景クリックでは閉じるが、QR 本体のクリックは閉じない", async () => {
    const onClose = vi.fn();
    await render({ isOpen: true, onClose });

    const overlay = document.body.querySelector(".fixed.inset-0");
    const content = document.body.querySelector(".relative.rounded-lg");
    expect(overlay).not.toBeNull();
    expect(content).not.toBeNull();

    await act(async () => content!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).not.toHaveBeenCalled();

    await act(async () => overlay!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).toHaveBeenCalledOnce();

    const closeButton = document.body.querySelector('button[aria-label="閉じる"]');
    await act(async () => closeButton!.dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("閉じる・アンマウント時に、元のスクロール設定を復元する", async () => {
    await render({ isOpen: true });
    await render({ isOpen: false });
    expect(document.body.style.overflow).toBe("scroll");

    await render({ isOpen: true });
    await act(async () => root.unmount());
    expect(document.body.style.overflow).toBe("scroll");
  });

  it("閉じた後に完了した古い QR を、次に開いたモーダルへ表示しない", async () => {
    let resolveFirstQr: ((markup: string) => void) | undefined;
    let resolveSecondQr: ((markup: string) => void) | undefined;
    toString.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveFirstQr = resolve;
    }));
    toString.mockReturnValueOnce(new Promise<string>((resolve) => {
      resolveSecondQr = resolve;
    }));

    await render({ isOpen: true, url: "https://anzdrop.example/d/first#secret" });
    await render({ isOpen: false });
    await act(async () => resolveFirstQr!('<svg data-testid="stale-qr" />'));
    await render({ isOpen: true, url: "https://anzdrop.example/d/second#secret" });

    // 2回目の生成は未完了のため、最初のURL向けのSVGが表示されたら stale state。
    expect(document.querySelector('[data-testid="stale-qr"]')).toBeNull();
    await act(async () => resolveSecondQr!('<svg data-testid="current-qr" />'));
    expect(document.querySelector('[data-testid="current-qr"]')).not.toBeNull();
  });
});
