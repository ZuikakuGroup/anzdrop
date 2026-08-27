import { describe, expect, it } from "vitest";
import { unzipSync } from "fflate";
import { withDuplicateSuffix, zipFiles } from "@/lib/download/zipDownload";

describe("withDuplicateSuffix", () => {
  it("returns the name unchanged when count is 0", () => {
    expect(withDuplicateSuffix("report.pdf", 0)).toBe("report.pdf");
  });

  it("inserts the count before the extension", () => {
    expect(withDuplicateSuffix("report.pdf", 1)).toBe("report (1).pdf");
    expect(withDuplicateSuffix("report.pdf", 2)).toBe("report (2).pdf");
  });

  it("appends the count at the end when there is no extension", () => {
    expect(withDuplicateSuffix("README", 1)).toBe("README (1)");
  });

  it("treats a leading-dot hidden file as having no extension", () => {
    expect(withDuplicateSuffix(".gitignore", 1)).toBe(".gitignore (1)");
  });
});

describe("zipFiles", () => {
  it("resolves to a zip archive containing every entry with its exact content", async () => {
    const input = {
      "a.txt": new TextEncoder().encode("hello"),
      "b.txt": new TextEncoder().encode("world"),
    };

    const zipped = await zipFiles(input);
    const unzipped = unzipSync(zipped);

    expect(new TextDecoder().decode(unzipped["a.txt"])).toBe("hello");
    expect(new TextDecoder().decode(unzipped["b.txt"])).toBe("world");
  });

  it("resolves to an empty archive for empty input", async () => {
    const zipped = await zipFiles({});
    const unzipped = unzipSync(zipped);

    expect(Object.keys(unzipped)).toEqual([]);
  });
});
