import { describe, expect, it } from "vitest";
import { hasDownloadedAllFiles } from "@/lib/download/downloadProgress";
import type { DecryptedFile } from "@/lib/download/decrypt";

const files = [
  { id: "first", name: "first.txt" },
  { id: "second", name: "second.txt" },
] as DecryptedFile[];

describe("hasDownloadedAllFiles", () => {
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
});
