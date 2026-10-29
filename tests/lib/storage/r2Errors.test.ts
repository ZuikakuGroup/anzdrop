import { expect, it } from "vitest";
import { isMissingMultipartUpload } from "@/lib/storage/r2Errors";
it.each([
  [new Error("abortMultipartUpload: missing (10024)"), true],
  [new Error("synthetic internal (10001)"), false],
  [new Error("synthetic unavailable (10043)"), false],
  [new Error("404 Not Found"), false],
  [new Error("10024 mentioned but not a code"), false],
  [{ message: "fake (10024)" }, false],
  [null, false],
])("recognizes only the documented missing-multipart error %#", (error, expected) => {
  expect(isMissingMultipartUpload(error)).toBe(expected);
});
