import { afterEach, expect, it } from "vitest";
import { mkdtemp, rm, copyFile, open, truncate } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createSharingFile, assertSharingFilesEqual } from "@/test/sharingFiles";

const directories: string[] = [];
afterEach(async () => { await Promise.all(directories.splice(0).map(d => rm(d, { recursive: true, force: true }))); });
async function files() {
  const dir = await mkdtemp(path.join(tmpdir(), "sharing-file-test-")); directories.push(dir);
  const expected = path.join(dir, "expected"), actual = path.join(dir, "actual");
  await createSharingFile(expected, 1024 * 1024 + 17);
  await copyFile(expected, actual);
  return { expected, actual };
}
it("compares an exact file including the final partial block", async () => {
  const f = await files(); await expect(assertSharingFilesEqual(f.actual, f.expected)).resolves.toBeUndefined();
});
it.each([0, 65535, 65536, 1024 * 1024 + 16])("rejects corruption at byte %i without dumping contents", async offset => {
  const f = await files(), handle = await open(f.actual, "r+");
  try {
    const byte = Buffer.alloc(1); await handle.read(byte, 0, 1, offset); byte[0] ^= 255;
    await handle.write(byte, 0, 1, offset);
  } finally { await handle.close(); }
  await expect(assertSharingFilesEqual(f.actual, f.expected)).rejects.toThrow(/bytes differ at block/);
});
it("rejects truncation rather than accepting a matching prefix", async () => {
  const f = await files(); await truncate(f.actual, 65536);
  await expect(assertSharingFilesEqual(f.actual, f.expected)).rejects.toThrow("length differs");
});
