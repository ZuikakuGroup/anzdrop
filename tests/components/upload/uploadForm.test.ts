// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const encryptionMocks = vi.hoisted(() => ({
  bodyEncryptionStarted: vi.fn(),
}));

vi.mock("@/lib/analytics/client", () => ({ track: vi.fn() }));
vi.mock("@/lib/account/me-client", () => ({
  getCurrentAccount: vi.fn().mockResolvedValue({ success: false }),
}));
vi.mock("@/lib/crypto", () => ({
  generateKey: vi.fn().mockResolvedValue({}),
  getCiphertextSizeFromPlaintextSize: vi.fn((size: number) => size + 16),
  exportKey: vi.fn().mockResolvedValue(new Uint8Array([1])),
  encodeBase64Url: vi.fn().mockReturnValue("test-key"),
  iterateEncryptedChunks: vi.fn(async function* (file: File) {
    encryptionMocks.bodyEncryptionStarted(file.name);
    yield new Uint8Array([1]);
  }),
}));
vi.mock("@/lib/upload/encrypt", () => ({
  encryptFileName: vi.fn().mockResolvedValue("encrypted-name"),
  wrapKeyWithPassword: vi.fn(),
}));

import { getCurrentAccount } from "@/lib/account/me-client";
import type { MeResponse } from "@/lib/api/schemas/account/me/schema";
vi.mock("@/lib/turnstile-client", () => ({
  TURNSTILE_SITE_KEY: "",
  useTurnstile: () => ({ widget: null, getToken: async () => "test-token" }),
}));
vi.mock("@/lib/upload/uploadFile", () => ({ uploadEncryptedFile: vi.fn() }));
import { uploadEncryptedFile } from "@/lib/upload/uploadFile";
import UploadForm from "@/components/upload/uploadForm";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getCurrentAccount).mockReset().mockResolvedValue({ success: false } as MeResponse);
  vi.mocked(uploadEncryptedFile).mockReset().mockResolvedValue({ shareId: "test-share", uploadToken: "test-upload-token" });
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
    expect(button?.querySelector("svg")).not.toBeNull();
    expect(button?.textContent).not.toContain("⌄");
    expect(container.textContent).not.toContain("保存期間");

    await act(async () => button!.click());

    await vi.waitFor(() => {
      expect(container.textContent).toContain("保存期間");
    });

    expect(button?.getAttribute("aria-expanded")).toBe("true");
    expect(container.textContent).toContain("パスワードを設定する");

    await act(async () => button!.click());

    const settings = container.querySelector("#upload-advanced-settings");
    expect(button?.getAttribute("aria-expanded")).toBe("false");
    expect(settings?.className).toContain("grid-rows-[0fr]");
    // 閉じるアニメーションの完了前に子要素を外さない。
    expect(settings?.textContent).toContain("パスワードを設定する");
  });
});

describe("ファイル選択後の先行暗号化", () => {
  it("アップロードを押す前に、キュー先頭のファイルだけ暗号化を開始する", async () => {
    await act(async () => {
      root.render(
        createElement(UploadForm, {
          header: null,
          footer: null,
        })
      );
      await Promise.resolve();
    });

    const input = container.querySelector<HTMLInputElement>('input[type="file"]');
    expect(input).not.toBeNull();
    const files = [
      new File(["first"], "first.txt"),
      new File(["second"], "second.txt"),
    ];

    await act(async () => {
      Object.defineProperty(input, "files", { configurable: true, value: files });
      input!.dispatchEvent(new Event("change", { bubbles: true }));
      await vi.waitFor(() => {
        expect(encryptionMocks.bodyEncryptionStarted).toHaveBeenCalledTimes(1);
      });
    });

    expect(encryptionMocks.bodyEncryptionStarted).toHaveBeenCalledTimes(1);
    expect(encryptionMocks.bodyEncryptionStarted).toHaveBeenCalledWith("first.txt");
    expect(container.textContent).toContain("first.txt");
    expect(container.textContent).toContain("second.txt");
  });
});


describe("プランごとの保存期間の初期選択", () => {
  async function showSettings() {
    await act(async () => { root.render(createElement(UploadForm, { header: null, footer: null })); });
    const toggle = [...container.querySelectorAll("button")].find(button => button.textContent?.includes("詳細設定"));
    await act(async () => toggle!.click());
    await vi.waitFor(() => expect(container.textContent).toContain("保存期間"));
  }
  function periodButton(label: string) {
    return [...container.querySelectorAll("button")].find(button => button.textContent === label)!;
  }
  async function startUpload() {
    const input = container.querySelector<HTMLInputElement>('input[type="file"]')!;
    Object.defineProperty(input, "files", { configurable: true, value: [new File(["test"], "test.txt")] });
    await act(async () => input.dispatchEvent(new Event("change", { bubbles: true })));
    const upload = [...container.querySelectorAll("button")].find(button => button.textContent === "アップロードする")!;
    await act(async () => {
      upload.click();
      await vi.waitFor(() => expect(uploadEncryptedFile).toHaveBeenCalled());
    });
  }
  it.each([["standard", "15日"], ["premium", "30日"]] as const)("%sで新しい共有へ戻ると%sを初期選択する", async (plan, label) => {
    vi.mocked(getCurrentAccount).mockResolvedValue({ success: true, plan } as MeResponse);
    await showSettings();
    await act(async () => periodButton("1日").click());
    await startUpload();
    expect(vi.mocked(uploadEncryptedFile).mock.calls[0][0].retention).toBe("1d");
    const reset = container.querySelector<HTMLButtonElement>('button[aria-label="閉じる"]')!;
    expect(reset).not.toBeNull();
    await act(async () => reset.click());
    expect(periodButton(label).getAttribute("aria-pressed")).toBe("true");
  });
  it("送信開始後のプラン応答は開始済み共有の保存期間を上書きしない", async () => {
    let resolveAccount!: (value: MeResponse) => void;
    let resolveUpload!: (value: Awaited<ReturnType<typeof uploadEncryptedFile>>) => void;
    vi.mocked(getCurrentAccount).mockReturnValue(new Promise(resolve => { resolveAccount = resolve; }));
    vi.mocked(uploadEncryptedFile).mockReturnValue(new Promise(resolve => { resolveUpload = resolve; }));
    await showSettings();
    await startUpload();
    expect(vi.mocked(uploadEncryptedFile).mock.calls[0][0].retention).toBe("7d");
    await act(async () => resolveAccount({ success: true, plan: "premium" } as MeResponse));
    expect(periodButton("7日").getAttribute("aria-pressed")).toBe("true");
    expect(periodButton("30日").getAttribute("aria-pressed")).toBe("false");
    await act(async () => resolveUpload({ shareId: "test-share", uploadToken: "test-upload-token" }));
  });
  it.each([["free", "7日"], ["standard", "15日"], ["premium", "30日"]] as const)("%sの初期値は%s", async (plan, label) => {
    vi.mocked(getCurrentAccount).mockResolvedValue({ success: true, plan } as MeResponse);
    await showSettings();
    expect(periodButton(label).getAttribute("aria-pressed")).toBe("true");
    await act(async () => periodButton("1日").click());
    expect(periodButton("1日").getAttribute("aria-pressed")).toBe("true");
    expect(periodButton(label).getAttribute("aria-pressed")).toBe("false");
  });
  it("未ログインでは7日を初期選択する", async () => {
    await showSettings();
    expect(periodButton("7日").getAttribute("aria-pressed")).toBe("true");
  });
  it("遅いプラン応答が手動選択を上書きしない", async () => {
    let resolveAccount!: (value: MeResponse) => void;
    vi.mocked(getCurrentAccount).mockReturnValue(new Promise(resolve => { resolveAccount = resolve; }));
    await showSettings();
    await act(async () => periodButton("3日").click());
    await act(async () => resolveAccount({ success: true, plan: "premium" } as MeResponse));
    expect(periodButton("3日").getAttribute("aria-pressed")).toBe("true");
    expect(periodButton("30日").getAttribute("aria-pressed")).toBe("false");
  });
  it("プラン取得に失敗した場合は7日のままにする", async () => {
    vi.mocked(getCurrentAccount).mockRejectedValue(new Error("network unavailable"));
    await showSettings();
    expect(periodButton("7日").getAttribute("aria-pressed")).toBe("true");
  });
});
