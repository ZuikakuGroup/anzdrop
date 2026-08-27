export type PendingFile = {
  file: File;
  // フォルダ選択/ドロップ時は "サブフォルダ/ファイル名" のような相対パス
  path: string;
};

export function readEntryAsFile(entry: FileSystemFileEntry): Promise<File> {
  return new Promise((resolve, reject) => entry.file(resolve, reject));
}

export function readDirectoryEntries(
  reader: FileSystemDirectoryReader
): Promise<FileSystemEntry[]> {
  return new Promise((resolve, reject) => reader.readEntries(resolve, reject));
}

export async function collectEntry(
  entry: FileSystemEntry,
  pending: PendingFile[]
): Promise<void> {
  if (entry.isFile) {
    const file = await readEntryAsFile(entry as FileSystemFileEntry);
    pending.push({ file, path: entry.fullPath.replace(/^\//, "") });
    return;
  }

  if (entry.isDirectory) {
    const reader = (entry as FileSystemDirectoryEntry).createReader();
    let batch: FileSystemEntry[];

    do {
      batch = await readDirectoryEntries(reader);

      for (const child of batch) {
        await collectEntry(child, pending);
      }
    } while (batch.length > 0);
  }
}

// ドラッグ&ドロップされたフォルダを再帰的に展開し、相対パス付きのファイル一覧にする。
// webkitGetAsEntryが使えない環境ではフラットなファイル一覧にフォールバックする。
export async function collectDataTransferFiles(
  dataTransfer: DataTransfer
): Promise<PendingFile[]> {
  const entries = Array.from(dataTransfer.items)
    .map((item) => item.webkitGetAsEntry?.())
    .filter((entry): entry is FileSystemEntry => !!entry);

  if (entries.length === 0) {
    return Array.from(dataTransfer.files).map((file) => ({
      file,
      path: file.name,
    }));
  }

  const pending: PendingFile[] = [];

  for (const entry of entries) {
    await collectEntry(entry, pending);
  }

  return pending;
}
