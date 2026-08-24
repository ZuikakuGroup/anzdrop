import { describe, expect, it } from "vitest";
import { formatBytes } from "./format";

describe("formatBytes", () => {
  it("formats sub-1024 byte counts with a 'B' suffix and no decimals", () => {
    expect(formatBytes(0)).toBe("0 B");
    expect(formatBytes(1)).toBe("1 B");
    expect(formatBytes(1023)).toBe("1023 B");
  });

  it("formats exactly 1024 bytes as 1 KB", () => {
    expect(formatBytes(1024)).toBe("1.0 KB");
  });

  it("uses one decimal place below 10 units, zero decimals at 10 and above", () => {
    expect(formatBytes(1024 * 9.5)).toBe("9.5 KB");
    expect(formatBytes(1024 * 10)).toBe("10 KB");
    expect(formatBytes(1024 * 999)).toBe("999 KB");
  });

  it("rolls over to MB at 1024 KB", () => {
    expect(formatBytes(1024 * 1024)).toBe("1.0 MB");
  });

  it("rolls over to GB at 1024 MB", () => {
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1.0 GB");
  });

  it("does not roll over past GB (the largest supported unit)", () => {
    const fiveGb = 5 * 1024 * 1024 * 1024;
    expect(formatBytes(fiveGb)).toBe("5.0 GB");
  });
});
