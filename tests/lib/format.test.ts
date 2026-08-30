import { describe, expect, it } from "vitest";
import { formatBytes } from "@/lib/format";

describe("formatBytes", () => {
  it("formats sub-1024 byte counts with a 'B' suffix and no decimals", () => {
    expect(formatBytes(0)).toBe("0B");
    expect(formatBytes(1)).toBe("1B");
    expect(formatBytes(1023)).toBe("1023B");
  });

  it("formats exactly 1024 bytes as 1 KB (trailing .0 dropped)", () => {
    expect(formatBytes(1024)).toBe("1KB");
  });

  it("keeps one decimal place for non-integer values below 10 units", () => {
    expect(formatBytes(1024 * 9.5)).toBe("9.5KB");
  });

  it("drops the decimal for integer values and for values at 10 units and above", () => {
    expect(formatBytes(1024 * 4)).toBe("4KB");
    expect(formatBytes(1024 * 10)).toBe("10KB");
    expect(formatBytes(1024 * 999)).toBe("999KB");
  });

  it("rolls over to MB at 1024 KB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1MB");
    expect(formatBytes(1024 * 1024 * 1.5)).toBe("1.5MB");
  });

  it("rolls over to GB at 1024 MB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1GB");
  });

  it("does not roll over past GB (the largest supported unit)", () => {
    const fiveGb = 5 * 1024 * 1024 * 1024;
    expect(formatBytes(fiveGb)).toBe("5GB");
  });
});
