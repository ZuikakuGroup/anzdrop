import { afterEach, describe, expect, it, vi } from "vitest";
import {
  hasDownloadedAllFiles,
  scheduleSendCtaOpen,
  SEND_CTA_OPEN_DELAY_MS,
  shouldShowSendCta,
} from "@/lib/download/downloadProgress";
import type { DecryptedFile } from "@/lib/download/decrypt";

const files = [
  { id: "first", name: "first.txt" },
  { id: "second", name: "second.txt" },
] as DecryptedFile[];

describe("hasDownloadedAllFiles", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("一覧が空の場合は完了として扱わない", () => {
    expect(hasDownloadedAllFiles([], new Set())).toBe(false);
  });

  it("一部だけの個別ダウンロードでは完了として扱わない", () => {
    expect(hasDownloadedAllFiles(files, new Set(["first"]))).toBe(false);
  });

  it("一覧の全ファイルを個別ダウンロードしたときだけ完了として扱う", () => {
    expect(
      hasDownloadedAllFiles(files, new Set(["first", "second"]))
    ).toBe(true);
  });

  it("一覧外のIDだけでは完了として扱わない", () => {
    expect(hasDownloadedAllFiles(files, new Set(["other"]))).toBe(false);
  });

  it("404で消滅したファイルがあれば、残りを保存済みでも完了として扱わない", () => {
    expect(
      hasDownloadedAllFiles(
        [files[0]],
        new Set(["first"]),
        new Set(["second"])
      )
    ).toBe(false);
  });

  it("次から表示しない設定済みなら、完了後もCTAモーダル・表示計測を行わない", () => {
    expect(
      shouldShowSendCta(
        files,
        new Set(["first", "second"]),
        new Set(),
        true
      )
    ).toBe(false);
  });

  it("CTAを保存UIと重ならないよう少し待って表示する", () => {
    vi.useFakeTimers();
    const open = vi.fn();

    scheduleSendCtaOpen(open);
    vi.advanceTimersByTime(SEND_CTA_OPEN_DELAY_MS - 1);
    expect(open).not.toHaveBeenCalled();

    vi.advanceTimersByTime(1);
    expect(open).toHaveBeenCalledOnce();
  });

  it("待機中に画面を離れるとCTAを表示しない", () => {
    vi.useFakeTimers();
    const open = vi.fn();

    scheduleSendCtaOpen(open)();
    vi.advanceTimersByTime(SEND_CTA_OPEN_DELAY_MS);

    expect(open).not.toHaveBeenCalled();
  });
});
