import { readFile } from "node:fs/promises";
import { expect, it } from "vitest";

it("ships the icon assets referenced by both Astro layouts", async () => {
  for (const layout of ["PublicLayout", "InteractiveLayout"]) {
    const source = await readFile(`apps/public/src/layouts/${layout}.astro`, "utf8");
    expect(source).toContain('href="/favicon.ico"');
    expect(source).toContain('href="/apple-icon.png"');
  }
  const ico = await readFile("public/favicon.ico");
  expect([...ico.subarray(0, 4)]).toEqual([0, 0, 1, 0]);
  expect(ico.readUInt16LE(4)).toBeGreaterThan(0);
  const png = await readFile("public/apple-icon.png");
  expect([...png.subarray(0, 8)]).toEqual([137, 80, 78, 71, 13, 10, 26, 10]);
  expect(png.readUInt32BE(16)).toBeGreaterThan(0);
  expect(png.readUInt32BE(20)).toBeGreaterThan(0);
});
