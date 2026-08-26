import { describe, expect, it } from "vitest";
import {
  guessPreviewMimeType,
  isPreviewableFile,
  getPreviewKind,
  canPreviewFile,
} from "@/lib/preview";

describe("guessPreviewMimeType", () => {
  it("maps each supported extension to its MIME type", () => {
    expect(guessPreviewMimeType("movie.mp4")).toBe("video/mp4");
    expect(guessPreviewMimeType("song.mp3")).toBe("audio/mpeg");
    expect(guessPreviewMimeType("photo.jpg")).toBe("image/jpeg");
    expect(guessPreviewMimeType("photo.jpeg")).toBe("image/jpeg");
    expect(guessPreviewMimeType("icon.png")).toBe("image/png");
  });

  it("is case-insensitive", () => {
    expect(guessPreviewMimeType("MOVIE.MP4")).toBe("video/mp4");
    expect(guessPreviewMimeType("Photo.Png")).toBe("image/png");
  });

  it("returns null for unsupported extensions", () => {
    expect(guessPreviewMimeType("document.pdf")).toBeNull();
    expect(guessPreviewMimeType("archive.zip")).toBeNull();
  });

  it("returns null when there is no extension", () => {
    expect(guessPreviewMimeType("README")).toBeNull();
  });

  it("returns null for a trailing dot with no extension", () => {
    expect(guessPreviewMimeType("file.")).toBeNull();
  });

  it("returns null for a leading-dot hidden file (not treated as an extension)", () => {
    expect(guessPreviewMimeType(".mp4")).toBeNull();
  });
});

describe("isPreviewableFile", () => {
  it("matches guessPreviewMimeType's supported/unsupported split", () => {
    expect(isPreviewableFile("movie.mp4")).toBe(true);
    expect(isPreviewableFile("document.pdf")).toBe(false);
  });
});

describe("getPreviewKind", () => {
  it("classifies known MIME type prefixes", () => {
    expect(getPreviewKind("video/mp4")).toBe("video");
    expect(getPreviewKind("audio/mpeg")).toBe("audio");
    expect(getPreviewKind("image/png")).toBe("image");
  });

  it("returns null for an unrecognized MIME type", () => {
    expect(getPreviewKind("application/pdf")).toBeNull();
  });
});

describe("canPreviewFile", () => {
  it("is false when the share does not allow preview, regardless of file type", () => {
    expect(
      canPreviewFile({
        shareAllowsPreview: false,
        isOneTimeFile: false,
        filename: "movie.mp4",
      })
    ).toBe(false);
  });

  it("is false when neither the share allows preview nor the file is one-time", () => {
    expect(
      canPreviewFile({
        shareAllowsPreview: false,
        isOneTimeFile: true,
        filename: "movie.mp4",
      })
    ).toBe(false);
  });

  it("is false for a one-time-download file even when the share allows preview and the extension is supported", () => {
    expect(
      canPreviewFile({
        shareAllowsPreview: true,
        isOneTimeFile: true,
        filename: "movie.mp4",
      })
    ).toBe(false);
  });

  it("is true when the share allows preview, the file is not one-time, and the extension is supported", () => {
    expect(
      canPreviewFile({
        shareAllowsPreview: true,
        isOneTimeFile: false,
        filename: "movie.mp4",
      })
    ).toBe(true);
  });

  it("is false when the share allows preview but the extension is unsupported", () => {
    expect(
      canPreviewFile({
        shareAllowsPreview: true,
        isOneTimeFile: false,
        filename: "document.pdf",
      })
    ).toBe(false);
  });
});
