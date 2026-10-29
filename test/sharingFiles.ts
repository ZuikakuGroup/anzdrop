import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { mkdir, open, stat } from "node:fs/promises";
import path from "node:path";

export const SYNTHETIC_MARKER = "ANZDROP_E2E_SYNTHETIC_PRIVATE_CONTENT_238";
const blockSize = 1024 * 1024;

// Generate real upload files without keeping a 200MiB fixture in the driver heap.
export async function createSharingFile(filename: string, size: number, seed = 0): Promise<void> {
  if (!Number.isSafeInteger(size) || size < 0) throw new Error("Invalid fixture size");
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

// Stream hashes so 1GiB tests do not allocate a whole fixture in the driver.
export async function sharingFileSha256(filename: string): Promise<string> {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filename)) hash.update(chunk);
  return hash.digest("hex");
}

export async function assertSharingFilesEqual(actual: string, expected: string): Promise<void> {
  const [aStat, eStat] = await Promise.all([stat(actual), stat(expected)]);
  if (aStat.size !== eStat.size) throw new Error("Saved file length differs");
  const [aHash, eHash] = await Promise.all([sharingFileSha256(actual), sharingFileSha256(expected)]);
  if (aHash !== eHash) throw new Error("Saved file SHA-256 differs");
}
