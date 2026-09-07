import { describe, expect, it } from "vitest";
import { getSizeBucket } from "@/lib/analytics/sizeBucket";

const MB = 1024 * 1024;
const GB = 1024 * MB;

describe("getSizeBucket", () => {
  it.each([
    [5 * MB, "<10MB"],
    [50 * MB, "10-100MB"],
    [200 * MB, "100MB-500MB"],
    [800 * MB, "500MB-1GB"],
    [3 * GB, "1GB-5GB"],
    [7 * GB, "5GB-10GB"],
    [20 * GB, "10GB+"],
  ])("buckets %i bytes as %s", (bytes, expected) => {
    expect(getSizeBucket(bytes)).toBe(expected);
  });

  it("treats a boundary value as belonging to the next bucket up", () => {
    expect(getSizeBucket(10 * MB)).toBe("10-100MB");
    expect(getSizeBucket(1 * GB)).toBe("1GB-5GB");
  });
});
