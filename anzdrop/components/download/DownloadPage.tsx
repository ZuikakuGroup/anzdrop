"use client";
import { useEffect, useState } from "react";
import {
  importKey,
  decodeBase64Url,
  unpackChunk,
  decryptChunk,
  iterateDecryptedChunks,
} from "@/lib/crypto";

type DownloadPageProps = {
  shareId: string;
};

type DownloadResponse = {
  success: boolean;
  share: {
    id: string;
    expires_at: string;
  };
  files: {
    id: string;
    name: string;
    size: number;
  }[];
  error?: string;
};

type DecryptedFile = {
  id: string;
  name: string;
  size: number;
};

async function decryptFileName(
  encryptedName: string,
  key: CryptoKey
): Promise<string> {
  const packed = new Uint8Array(decodeBase64Url(encryptedName));
  const { iv, ciphertext } = unpackChunk(packed);
  const decrypted = await decryptChunk(ciphertext, iv, key);

  return new TextDecoder().decode(decrypted);
}

export default function DownloadPage({
  shareId,
}: DownloadPageProps) {
  const [files, setFiles] = useState<DecryptedFile[]>([]);

  const [error, setError] = useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  const [key, setKey] = useState<CryptoKey | null>(null);

  const [downloadingId, setDownloadingId] = useState("");

  useEffect(() => {
    const load = async () => {
      try {
        const fragment = window.location.hash.slice(1);

        if (!fragment) {
          throw new Error(
            "このリンクには復号鍵が含まれていません。"
          );
        }

        const decryptionKey = await importKey(
          decodeBase64Url(fragment)
        );

        setKey(decryptionKey);

        const response = await fetch(
          `/api/download/${shareId}`
        );

        const result: DownloadResponse =
          await response.json();

        if (!response.ok) {
          throw new Error(
            result.error ?? "Download failed"
          );
        }

        const decryptedFiles = await Promise.all(
          result.files.map(async (file) => ({
            id: file.id,
            name: await decryptFileName(
              file.name,
              decryptionKey
            ),
            size: file.size,
          }))
        );

        setFiles(decryptedFiles);
      } catch (err) {
        setError(
          err instanceof Error
            ? err.message
            : "Unknown error"
        );
      } finally {
        setIsLoading(false);
      }
    };

    load();
  }, [shareId]);

  const downloadFile = async (file: DecryptedFile) => {
    if (!key || downloadingId) {
      return;
    }

    setDownloadingId(file.id);
    setError("");

    try {
      const response = await fetch(`/api/file/${file.id}`);

      if (!response.ok || !response.body) {
        throw new Error("ダウンロードに失敗しました。");
      }

      const chunks: Uint8Array[] = [];

      for await (const decrypted of iterateDecryptedChunks(
        response.body,
        key
      )) {
        chunks.push(decrypted);
      }

      const blob = new Blob(chunks as BlobPart[]);
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      a.href = url;
      a.download = file.name;
      a.click();

      URL.revokeObjectURL(url);
    } catch (err) {
      setError(
        err instanceof Error
          ? err.message
          : "Unknown error"
      );
    } finally {
      setDownloadingId("");
    }
  };

  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold">
        Download
      </h1>

      {isLoading ? (
        <p className="mt-6">
          読み込み中...
        </p>
      ) : error ? (
        <p className="mt-6 text-red-600">
          {error}
        </p>
      ) : (
        <ul className="mt-6 list-disc ml-6">
          {files.map((file) => (
            <li
              key={file.id}
              className="flex items-center justify-between"
            >
              <span>{file.name}</span>

              <button
                onClick={() => downloadFile(file)}
                disabled={downloadingId === file.id}
                className="rounded bg-blue-600 px-3 py-1 text-white disabled:bg-gray-400"
              >
                {downloadingId === file.id
                  ? "ダウンロード中..."
                  : "ダウンロード"}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
