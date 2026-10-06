import { describe, expect, it } from "vitest";
import { shouldDismissShareResultForAdditionalUpload } from "@/lib/upload/shareResultSession";

describe("shouldDismissShareResultForAdditionalUpload", () => {
  it("共有結果表示中に追加可能なファイルがあるときだけ閉じる", () => {
    expect(
      shouldDismissShareResultForAdditionalUpload({
        shareUrl: "https://example/d/x",
        isUploading: false,
        acceptedFileCount: 1,
      })
    ).toBe(true);
  });

  it("アップロード中・結果非表示・追加0件では閉じない", () => {
    expect(
      shouldDismissShareResultForAdditionalUpload({
        shareUrl: "https://example/d/x",
        isUploading: true,
        acceptedFileCount: 1,
      })
    ).toBe(false);
    expect(
      shouldDismissShareResultForAdditionalUpload({
        shareUrl: "",
        isUploading: false,
        acceptedFileCount: 1,
      })
    ).toBe(false);
    expect(
      shouldDismissShareResultForAdditionalUpload({
        shareUrl: "https://example/d/x",
        isUploading: false,
        acceptedFileCount: 0,
      })
    ).toBe(false);
  });
});
