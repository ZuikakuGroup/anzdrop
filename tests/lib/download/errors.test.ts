import { describe, expect, it } from "vitest";
import {
  FileGoneError,
  FriendlyError,
  FILE_GONE_ERROR,
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
