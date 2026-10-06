import { describe, expect, it } from "vitest";
import {
  isPartNumberAllowed,
  maxPartNumberForDeclaredFileSize,
  R2_MULTIPART_MIN_PART_SIZE_BYTES,
  verifyUploadSessionToken,
} from "@/lib/upload/uploadSessionAuth";

describe("uploadSessionAuth", () => {
  it("computes a conservative max part number from declared file size", () => {
    expect(maxPartNumberForDeclaredFileSize(0)).toBe(1);
    expect(maxPartNumberForDeclaredFileSize(R2_MULTIPART_MIN_PART_SIZE_BYTES)).toBe(1);
    expect(
      maxPartNumberForDeclaredFileSize(R2_MULTIPART_MIN_PART_SIZE_BYTES + 1)
    ).toBe(2);
  });

  it("validates part numbers against the declared size ceiling", () => {
    expect(isPartNumberAllowed(1, 100)).toBe(true);
    expect(isPartNumberAllowed(0, 100)).toBe(false);
    expect(isPartNumberAllowed(2, R2_MULTIPART_MIN_PART_SIZE_BYTES)).toBe(false);
  });

  it("compares upload tokens in a timing-safe way", () => {
    expect(verifyUploadSessionToken("token-a", "token-a")).toBe(true);
    expect(verifyUploadSessionToken("token-a", "token-b")).toBe(false);
    expect(verifyUploadSessionToken(null, "token-a")).toBe(false);
  });
});
