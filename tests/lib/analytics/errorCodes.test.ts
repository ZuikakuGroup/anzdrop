import { describe, expect, it } from "vitest";
import { classifyDownloadError, classifyUploadError } from "@/lib/analytics/errorCodes";
import {
  EXPIRED_LINK_MESSAGE,
  FileGoneError,
  FriendlyError,
  INVALID_LINK_MESSAGE,
  RATE_LIMITED_MESSAGE,
} from "@/lib/download/errors";

describe("classifyDownloadError", () => {
  it("classifies FileGoneError as DOWNLOAD_NOT_FOUND", () => {
    expect(classifyDownloadError(new FileGoneError("gone"))).toBe(
      "DOWNLOAD_NOT_FOUND"
    );
  });

  it("classifies the expired-link message as DOWNLOAD_EXPIRED", () => {
    expect(
      classifyDownloadError(new FriendlyError(EXPIRED_LINK_MESSAGE))
    ).toBe("DOWNLOAD_EXPIRED");
  });

  it("classifies the invalid-link message as DOWNLOAD_NOT_FOUND", () => {
    expect(
      classifyDownloadError(new FriendlyError(INVALID_LINK_MESSAGE))
    ).toBe("DOWNLOAD_NOT_FOUND");
  });

  it("classifies the rate-limited message as DOWNLOAD_NETWORK_ERROR", () => {
    expect(
      classifyDownloadError(new FriendlyError(RATE_LIMITED_MESSAGE))
    ).toBe("DOWNLOAD_NETWORK_ERROR");
  });

  it("classifies a TypeError (typical fetch failure) as DOWNLOAD_NETWORK_ERROR", () => {
    expect(classifyDownloadError(new TypeError("Failed to fetch"))).toBe(
      "DOWNLOAD_NETWORK_ERROR"
    );
  });

  it("classifies an AbortError as DOWNLOAD_CANCELLED", () => {
    expect(
      classifyDownloadError(new DOMException("aborted", "AbortError"))
    ).toBe("DOWNLOAD_CANCELLED");
  });

  it("falls back to DOWNLOAD_UNKNOWN for an unrecognized error", () => {
    expect(classifyDownloadError(new Error("something else"))).toBe(
      "DOWNLOAD_UNKNOWN"
    );
  });
});

describe("classifyUploadError", () => {
  it("classifies a TypeError as UPLOAD_NETWORK_ERROR", () => {
    expect(classifyUploadError(new TypeError("Failed to fetch"))).toBe(
      "UPLOAD_NETWORK_ERROR"
    );
  });

  it("classifies an AbortError as UPLOAD_CANCELLED", () => {
    expect(
      classifyUploadError(new DOMException("aborted", "AbortError"))
    ).toBe("UPLOAD_CANCELLED");
  });

  it("falls back to UPLOAD_UNKNOWN for an unrecognized error", () => {
    expect(classifyUploadError(new Error("something else"))).toBe(
      "UPLOAD_UNKNOWN"
    );
  });
});
