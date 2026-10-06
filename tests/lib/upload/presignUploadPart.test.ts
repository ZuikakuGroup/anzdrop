import { describe, expect, it } from "vitest";
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";
import { presignUploadPartUrl } from "@/lib/upload/presignUploadPart";

describe("presignUploadPartUrl", () => {
  it("returns a signed PUT URL containing partNumber, uploadId, and content-length", async () => {
    const url = await presignUploadPartUrl({
      credentials: {
        accessKeyId: "AKIAEXAMPLE",
        secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
        accountId: "abc123account",
        bucketName: "anzdrop",
      },
      storageKey: "storage-key-uuid",
      uploadId: "upload-id-value",
      partNumber: 3,
      contentLength: 4096,
      expiresInSeconds: 600,
    });

    const parsed = new URL(url);
    expect(parsed.protocol).toBe("https:");
    expect(parsed.hostname).toBe("abc123account.r2.cloudflarestorage.com");
    expect(parsed.pathname).toBe("/anzdrop/storage-key-uuid");
    expect(parsed.searchParams.get("partNumber")).toBe("3");
    expect(parsed.searchParams.get("uploadId")).toBe("upload-id-value");
    expect(parsed.searchParams.get("X-Amz-Signature")).toBeTruthy();
    expect(parsed.searchParams.get("X-Amz-Credential")).toContain("AKIAEXAMPLE");
    expect(parsed.searchParams.get("X-Amz-SignedHeaders")).toMatch(
      /content-length/i
    );
  });

  it("rejects invalid part numbers", async () => {
    await expect(
      presignUploadPartUrl({
        credentials: {
          accessKeyId: "a",
          secretAccessKey: "b",
          accountId: "c",
          bucketName: "anzdrop",
        },
        storageKey: "k",
        uploadId: "u",
        partNumber: 0,
        contentLength: 1,
      })
    ).rejects.toThrow(/partNumber/);
  });

  it("rejects contentLength above UPLOAD_PART_SIZE", async () => {
    await expect(
      presignUploadPartUrl({
        credentials: {
          accessKeyId: "a",
          secretAccessKey: "b",
          accountId: "c",
          bucketName: "anzdrop",
        },
        storageKey: "k",
        uploadId: "u",
        partNumber: 1,
        contentLength: UPLOAD_PART_SIZE + 1,
      })
    ).rejects.toThrow(/contentLength/);
  });
});
