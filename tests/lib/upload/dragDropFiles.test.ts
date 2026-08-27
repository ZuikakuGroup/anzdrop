import { describe, expect, it } from "vitest";
import {
  collectDataTransferFiles,
  collectEntry,
  readDirectoryEntries,
  readEntryAsFile,
  type PendingFile,
} from "@/lib/upload/dragDropFiles";

function fakeFileEntry(file: File, fullPath: string): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    fullPath,
    file: (successCallback: (file: File) => void) => successCallback(file),
  } as unknown as FileSystemFileEntry;
}

function fakeFailingFileEntry(error: Error): FileSystemFileEntry {
  return {
    isFile: true,
    isDirectory: false,
    fullPath: "/broken.bin",
    file: (
      _successCallback: (file: File) => void,
      errorCallback?: (error: Error) => void
    ) => errorCallback?.(error),
  } as unknown as FileSystemFileEntry;
}

function fakeDirectoryEntry(
  batches: FileSystemEntry[][]
): FileSystemDirectoryEntry {
  let callIndex = 0;

  return {
    isFile: false,
    isDirectory: true,
    createReader: () => ({
      readEntries: (
        successCallback: (entries: FileSystemEntry[]) => void
      ) => {
        const batch = batches[callIndex] ?? [];
        callIndex++;
        successCallback(batch);
      },
    }),
  } as unknown as FileSystemDirectoryEntry;
}

describe("readEntryAsFile", () => {
  it("resolves with the file from a FileSystemFileEntry", async () => {
    const file = new File(["hello"], "hello.txt");
    const result = await readEntryAsFile(fakeFileEntry(file, "/hello.txt"));

    expect(result).toBe(file);
  });

  it("rejects when the entry reports an error", async () => {
    await expect(
      readEntryAsFile(fakeFailingFileEntry(new Error("read failed")))
    ).rejects.toThrow("read failed");
  });
});

describe("readDirectoryEntries", () => {
  it("resolves with the batch of entries from the reader", async () => {
    const childEntry = fakeFileEntry(new File(["a"], "a.txt"), "/dir/a.txt");
    const reader = {
      readEntries: (
        successCallback: (entries: FileSystemEntry[]) => void
      ) => successCallback([childEntry as unknown as FileSystemEntry]),
    } as unknown as FileSystemDirectoryReader;

    const result = await readDirectoryEntries(reader);

    expect(result).toEqual([childEntry]);
  });
});

describe("collectEntry", () => {
  it("pushes a file entry with its path (leading slash stripped)", async () => {
    const file = new File(["hello"], "hello.txt");
    const pending: PendingFile[] = [];

    await collectEntry(fakeFileEntry(file, "/hello.txt"), pending);

    expect(pending).toEqual([{ file, path: "hello.txt" }]);
  });

  it("recursively collects nested directory entries across multiple readEntries batches", async () => {
    const fileA = new File(["a"], "a.txt");
    const fileB = new File(["b"], "b.txt");
    const fileC = new File(["c"], "c.txt");

    const nestedDir = fakeDirectoryEntry([
      [fakeFileEntry(fileC, "/parent/nested/c.txt") as unknown as FileSystemEntry],
      [],
    ]);

    const rootDir = fakeDirectoryEntry([
      [fakeFileEntry(fileA, "/parent/a.txt") as unknown as FileSystemEntry],
      [
        fakeFileEntry(fileB, "/parent/b.txt") as unknown as FileSystemEntry,
        nestedDir as unknown as FileSystemEntry,
      ],
      [],
    ]);

    const pending: PendingFile[] = [];
    await collectEntry(rootDir as unknown as FileSystemEntry, pending);

    expect(pending).toEqual([
      { file: fileA, path: "parent/a.txt" },
      { file: fileB, path: "parent/b.txt" },
      { file: fileC, path: "parent/nested/c.txt" },
    ]);
  });

  it("does nothing for an entry that is neither a file nor a directory", async () => {
    const pending: PendingFile[] = [];
    const oddEntry = {
      isFile: false,
      isDirectory: false,
    } as unknown as FileSystemEntry;

    await collectEntry(oddEntry, pending);

    expect(pending).toEqual([]);
  });
});

describe("collectDataTransferFiles", () => {
  it("expands entries (including nested directories) via webkitGetAsEntry", async () => {
    const file = new File(["a"], "a.txt");
    const entry = fakeFileEntry(file, "/a.txt");
    const dataTransfer = {
      items: [{ webkitGetAsEntry: () => entry }],
      files: [],
    } as unknown as DataTransfer;

    const result = await collectDataTransferFiles(dataTransfer);

    expect(result).toEqual([{ file, path: "a.txt" }]);
  });

  it("filters out items whose webkitGetAsEntry returns null/undefined", async () => {
    const file = new File(["a"], "a.txt");
    const entry = fakeFileEntry(file, "/a.txt");
    const dataTransfer = {
      items: [
        { webkitGetAsEntry: () => entry },
        { webkitGetAsEntry: () => null },
      ],
      files: [],
    } as unknown as DataTransfer;

    const result = await collectDataTransferFiles(dataTransfer);

    expect(result).toEqual([{ file, path: "a.txt" }]);
  });

  it("falls back to a flat file list when no entries are available (no webkitGetAsEntry support)", async () => {
    const fileA = new File(["a"], "a.txt");
    const fileB = new File(["b"], "b.txt");
    const dataTransfer = {
      items: [],
      files: [fileA, fileB],
    } as unknown as DataTransfer;

    const result = await collectDataTransferFiles(dataTransfer);

    expect(result).toEqual([
      { file: fileA, path: "a.txt" },
      { file: fileB, path: "b.txt" },
    ]);
  });
});
