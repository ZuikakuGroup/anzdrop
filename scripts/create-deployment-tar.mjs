import { createReadStream } from "node:fs";
import { open, readdir, stat } from "node:fs/promises";
import path from "node:path";

const blockSize = 512;

function writeString(header, offset, length, value) {
  const bytes = Buffer.from(value);
  if (bytes.length > length) throw new Error(`Tar field is too long: ${value}`);
  bytes.copy(header, offset);
}

function writeOctal(header, offset, length, value) {
  const digits = value.toString(8);
  if (digits.length > length - 1) throw new Error(`Tar value is too large: ${value}`);
  writeString(header, offset, length, digits.padStart(length - 1, "0") + "\0");
}

function splitPath(relative) {
  if (Buffer.byteLength(relative) <= 100) return { name: relative, prefix: "" };
  for (let slash = relative.lastIndexOf("/"); slash > 0; slash = relative.lastIndexOf("/", slash - 1)) {
    const prefix = relative.slice(0, slash);
    const name = relative.slice(slash + 1);
    if (Buffer.byteLength(prefix) <= 155 && Buffer.byteLength(name) <= 100) return { name, prefix };
  }
  throw new Error(`Deployment path exceeds ustar limits: ${relative}`);
}

function headerFor(relative, size, directory) {
  const header = Buffer.alloc(blockSize);
  const { name, prefix } = splitPath(directory ? `${relative}/` : relative);
  writeString(header, 0, 100, name);
  writeOctal(header, 100, 8, directory ? 0o755 : 0o644);
  writeOctal(header, 108, 8, 0);
  writeOctal(header, 116, 8, 0);
  writeOctal(header, 124, 12, size);
  writeOctal(header, 136, 12, 0);
  header.fill(0x20, 148, 156);
  header[156] = directory ? 0x35 : 0x30;
  writeString(header, 257, 6, "ustar\0");
  writeString(header, 263, 2, "00");
  writeString(header, 345, 155, prefix);
  writeOctal(header, 148, 8, header.reduce((sum, byte) => sum + byte, 0));
  return header;
}

async function entriesIn(source, relative = "") {
  const entries = [];
  for (const entry of await readdir(path.join(source, relative), { withFileTypes: true })) {
    const child = relative ? `${relative}/${entry.name}` : entry.name;
    if (child.split("/").length === 3 && child.startsWith("compiled/") && entry.name === "README.md") continue;
    if (entry.isSymbolicLink()) throw new Error(`Symlink in deployment payload: ${child}`);
    if (!entry.isFile() && !entry.isDirectory()) throw new Error(`Unsupported deployment payload entry: ${child}`);
    entries.push({ relative: child, directory: entry.isDirectory() });
    if (entry.isDirectory()) entries.push(...await entriesIn(source, child));
  }
  return entries.sort((a, b) => a.relative < b.relative ? -1 : a.relative > b.relative ? 1 : 0);
}

async function writeAll(file, buffer) {
  let offset = 0;
  while (offset < buffer.length) {
    const { bytesWritten } = await file.write(buffer, offset, buffer.length - offset);
    if (bytesWritten === 0) throw new Error("Failed to write deployment archive");
    offset += bytesWritten;
  }
}

async function main() {
  if (process.argv.length !== 4) throw new Error("Expected source directory and output tar path");
  const source = path.resolve(process.argv[2]);
  const target = path.resolve(process.argv[3]);
  const entries = await entriesIn(source);
  const output = await open(target, "w");
  try {
    for (const entry of entries) {
      const filePath = path.join(source, entry.relative);
      const size = entry.directory ? 0 : (await stat(filePath)).size;
      await writeAll(output, headerFor(entry.relative, size, entry.directory));
      if (!entry.directory) {
        for await (const chunk of createReadStream(filePath)) await writeAll(output, chunk);
        const padding = (blockSize - size % blockSize) % blockSize;
        if (padding) await writeAll(output, Buffer.alloc(padding));
      }
    }
    await writeAll(output, Buffer.alloc(blockSize * 2));
  } finally {
    await output.close();
  }
}

await main();
