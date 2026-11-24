import { describe, expect, it } from "vitest";
import { getCiphertextSizeFromPlaintextSize, getPlaintextSizeFromCiphertextSize } from "@/lib/crypto/packet";
import { getUploadPartSize, getPartUploadConcurrency, MAX_UPLOAD_PARTS, UPLOAD_PART_SIZE } from "@/lib/upload/partSize";
import { isPartNumberAllowed } from "@/lib/upload/uploadSessionAuth";

describe("large multipart uploads", () => {
  it.each([0, 1, 50 * 1024 ** 3])("keeps 8MiB parts for existing sizes (%s)", (size) => {
    expect(getUploadPartSize(size)).toBe(8 * 1024 ** 2);
  });

  it("changes part size at the encrypted-size boundary, including salt and packet overhead", () => {
    const boundary = getPlaintextSizeFromCiphertextSize(UPLOAD_PART_SIZE * MAX_UPLOAD_PARTS);
    expect(getUploadPartSize(boundary)).toBe(UPLOAD_PART_SIZE);
    expect(getUploadPartSize(boundary + 1)).toBe(2 * UPLOAD_PART_SIZE);
    expect(getUploadPartSize(UPLOAD_PART_SIZE * MAX_UPLOAD_PARTS)).toBe(2 * UPLOAD_PART_SIZE);
  });

  it.each([100, 300, 500])("fits the encrypted %sGB file in at most 10,000 parts", (gb) => {
    const size = gb * 1024 ** 3;
    const partSize = getUploadPartSize(size);
    const encryptedSize = getCiphertextSizeFromPlaintextSize(size);
    const count = Math.ceil(encryptedSize / partSize);
    expect(count).toBeLessThanOrEqual(10_000);
    expect(partSize % (8 * 1024 ** 2)).toBe(0);
    expect(encryptedSize - partSize * (count - 1)).toBeGreaterThan(0);
    expect(isPartNumberAllowed(count, size)).toBe(true);
    expect(isPartNumberAllowed(10_001, size)).toBe(false);
    expect(getPartUploadConcurrency(12, partSize) * partSize).toBeLessThanOrEqual(96 * 1024 ** 2);
  });

  it("preserves small-file concurrency and limits the large-file buffer budget", () => {
    expect(getPartUploadConcurrency(8, UPLOAD_PART_SIZE)).toBe(8);
    expect(getPartUploadConcurrency(12, UPLOAD_PART_SIZE)).toBe(12);
    expect(getPartUploadConcurrency(12, getUploadPartSize(500 * 1024 ** 3))).toBe(1);
  });

  it.each([-1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER])("rejects unsupported file sizes (%s)", (size) => {
    expect(() => getUploadPartSize(size)).toThrow();
  });
});
