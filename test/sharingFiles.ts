import { mkdir, open, stat } from "node:fs/promises";
import path from "node:path";

export const SYNTHETIC_MARKER = "ANZDROP_E2E_SYNTHETIC_PRIVATE_CONTENT_238";
const blockSize = 1024 * 1024;

// Generate real upload files without keeping a 200MiB fixture in the driver heap.
export async function createSharingFile(filename: string, size: number, seed = 0): Promise<void> {
  if (!Number.isSafeInteger(size) || size < SYNTHETIC_MARKER.length) throw new Error("Invalid fixture size");
  await mkdir(path.dirname(filename), { recursive: true });
  const file = await open(filename, "w");
  try {
    for (let offset = 0; offset < size; offset += blockSize) {
      const bytes = Buffer.alloc(Math.min(blockSize, size - offset));
      for (let i = 0; i < bytes.length; i++) bytes[i] = ((offset + i) * 13 + seed) % 251;
      if (offset === 0) bytes.write(SYNTHETIC_MARKER);
      await file.writeFile(bytes);
    }
  } finally { await file.close(); }
}

// Fixed-size reads compare every byte, including tails and chunk boundaries.
// Failure messages deliberately omit file content.
export async function assertSharingFilesEqual(actual: string, expected: string): Promise<void> {
  const [aStat, eStat] = await Promise.all([stat(actual), stat(expected)]);
  if (aStat.size !== eStat.size) throw new Error("Saved file length differs");
  const a = await open(actual, "r");
  let e: Awaited<ReturnType<typeof open>> | undefined;
  try {
    e = await open(expected, "r");
    const left = Buffer.alloc(64 * 1024), right = Buffer.alloc(64 * 1024);
    for (let offset = 0; offset < eStat.size; offset += left.length) {
      const length = Math.min(left.length, eStat.size - offset);
      const [ar, er] = await Promise.all([a.read(left, 0, length, offset), e.read(right, 0, length, offset)]);
      if (ar.bytesRead !== length || er.bytesRead !== length || !left.subarray(0, length).equals(right.subarray(0, length))) {
        throw new Error(`Saved file bytes differ at block ${Math.floor(offset / left.length)}`);
      }
    }
  } finally { await Promise.all([a.close(), e?.close()]); }
}
