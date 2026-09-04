import { describe, expect, it } from "vitest";
import {
  FileGoneError,
  FriendlyError,
  FILE_GONE_ERROR,
  EXPIRED_LINK_MESSAGE,
  INVALID_LINK_MESSAGE,
  NON_DISMISSIBLE_ERRORS,
  RATE_LIMITED_MESSAGE,
  shareLoadErrorFor,
  SUSPENDED_SHARE_MESSAGE,
  toFriendlyMessage,
} from "@/lib/download/errors";

describe("FileGoneError", () => {
  it("is a FriendlyError", () => {
    const err = new FileGoneError(FILE_GONE_ERROR);

    expect(err).toBeInstanceOf(FriendlyError);
    expect(err).toBeInstanceOf(Error);
  });
});

describe("toFriendlyMessage", () => {
  it("returns the FriendlyError's own message", () => {
    const err = new FriendlyError("表示してよいメッセージ");

    expect(toFriendlyMessage(err, "fallback")).toBe("表示してよいメッセージ");
  });

  it("returns the FileGoneError's own message (subclass of FriendlyError)", () => {
    const err = new FileGoneError(FILE_GONE_ERROR);

    expect(toFriendlyMessage(err, "fallback")).toBe(FILE_GONE_ERROR);
  });

  it("returns the fallback for a generic Error (does not leak technical details)", () => {
    const err = new Error("TypeError: fetch failed at internal/...");

    expect(toFriendlyMessage(err, "fallback")).toBe("fallback");
  });

  it("returns the fallback for a non-Error thrown value", () => {
    expect(toFriendlyMessage("some string", "fallback")).toBe("fallback");
    expect(toFriendlyMessage(undefined, "fallback")).toBe("fallback");
  });
});

describe("shareLoadErrorFor", () => {
  it.each([
    [404, INVALID_LINK_MESSAGE],
    [410, EXPIRED_LINK_MESSAGE],
    [403, SUSPENDED_SHARE_MESSAGE],
    [429, RATE_LIMITED_MESSAGE],
  ])("maps %i to its own message", (status, message) => {
    const err = shareLoadErrorFor(status);

    expect(err).toBeInstanceOf(FriendlyError);
    expect(err?.message).toBe(message);
  });

  it("レート制限(429)の文言はリンクを疑わせない", () => {
    // 汎用文言(「URLが正しいかご確認のうえ」)へ丸められると、待てば直る
    // 一時的な混雑なのに「リンクが壊れている」と読めてしまう(GitHub issue #81)。
    const message = shareLoadErrorFor(429)?.message ?? "";

    expect(message).not.toContain("URL");
    expect(message).toContain("しばらく待って");
  });

  it("returns null for statuses that should fall back to the generic message", () => {
    for (const status of [400, 401, 500, 502, 503]) {
      expect(shareLoadErrorFor(status)).toBeNull();
    }
  });

  it("FriendlyError なので toFriendlyMessage が文言をそのまま通す", () => {
    // ここが FriendlyError でないと、toFriendlyMessage が fallback に丸めてしまう。
    const err = shareLoadErrorFor(429);

    expect(toFriendlyMessage(err, "fallback")).toBe(RATE_LIMITED_MESSAGE);
  });
});

describe("NON_DISMISSIBLE_ERRORS", () => {
  // 閉じても空のファイル一覧が出るだけで意味がない2つ(無効なリンク・一時停止)
  // だけを含む。それ以外は、再試行の余地があるか、少なくとも閉じて画面を
  // 確認する意味があるので含めない。
  it("無効なリンクと一時停止だけを含む", () => {
    expect(NON_DISMISSIBLE_ERRORS.has(SUSPENDED_SHARE_MESSAGE)).toBe(true);
    expect(NON_DISMISSIBLE_ERRORS.has(INVALID_LINK_MESSAGE)).toBe(true);
    expect(NON_DISMISSIBLE_ERRORS.size).toBe(2);
  });

  it("待てば直るレート制限は含まない(閉じられるべき)", () => {
    expect(NON_DISMISSIBLE_ERRORS.has(RATE_LIMITED_MESSAGE)).toBe(false);
  });

  it("期限切れも含まない(従来の挙動どおり)", () => {
    expect(NON_DISMISSIBLE_ERRORS.has(EXPIRED_LINK_MESSAGE)).toBe(false);
  });
});
