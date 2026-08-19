"use client";

import { useState } from "react";
import { generateKey, iterateEncryptedChunks } from "@/lib/crypto";

type UploadStartResponse = {
  success: boolean;
  shareId?: string;
  uploadSessionId?: string;
  error?: string;
};

export default function UploadForm() {
  const [files, setFiles] = useState<File[]>([]);
  const [shareId, setShareId] = useState("");
  const [isUploading, setIsUploading] = useState(false);
  const [error, setError] = useState("");

  const shareUrl =
    typeof window !== "undefined"
      ? `${window.location.origin}/d/${shareId}`
      : "";

  const handleFileChange = (
    event: React.ChangeEvent<HTMLInputElement>
  ) => {
    if (!event.target.files) {
      return;
    }

    setFiles(Array.from(event.target.files));
  };

  const upload = async () => {
    if (files.length === 0) {
      setError("ファイルを選択してください。");
      return;
    }

    setError("");
    setIsUploading(true);

    try {
      const file = files[0];

      const response = await fetch("/api/upload/start", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          encryptedFileName: file.name,
        }),
      });

      const result =
        (await response.json()) as UploadStartResponse;

      console.log(result);

      if (!response.ok) {
        throw new Error(
          result.error ?? "Upload start failed"
        );
      }

      const uploadSessionId = result.uploadSessionId;

      if (!uploadSessionId) {
        throw new Error("uploadSessionId is missing");
      }

      const key = await generateKey();

      let partNumber = 1;

      for await (const chunk of iterateEncryptedChunks(file, key)) {
        console.log(
          `Uploading part ${partNumber}: ${chunk.byteLength} bytes`
        );

        const body = chunk.buffer.slice(
          chunk.byteOffset,
          chunk.byteOffset + chunk.byteLength
        ) as ArrayBuffer;

        const chunkResponse = await fetch("/api/upload/chunk", {
          method: "POST",
          headers: {
            "Anzdrop-Upload-Session": uploadSessionId,
            "Anzdrop-Part-Number": String(partNumber),
          },
          body,
        });

        if (!chunkResponse.ok) {
          throw new Error(`Chunk ${partNumber} upload failed`);
        }

        partNumber++;
      }

      setShareId(result.shareId ?? "");
    } catch (unknownErr) {
      const error =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("Unknown error");

      setError(error.message);
    } finally {
      setIsUploading(false);
    }
  };



  return (
    <div className="max-w-2xl mx-auto p-8">
      <h1 className="text-3xl font-bold mb-6">
        Anzdrop
      </h1>

      <input
        type="file"
        multiple
        onChange={handleFileChange}
      />

      <div className="mt-6">
        <h2 className="font-semibold mb-2">
          選択されたファイル
        </h2>

        {files.length === 0 ? (
          <p>ファイルが選択されていません。</p>
        ) : (
          <ul className="list-disc ml-6">
            {files.map((file) => (
              <li key={`${file.name}-${file.lastModified}`}>
                {file.name}
              </li>
            ))}
          </ul>
        )}
      </div>
      <button
        onClick={upload}
        disabled={isUploading}
        className="mt-6 rounded bg-blue-600 px-4 py-2 text-white disabled:bg-gray-400"
      >
        {isUploading ? "アップロード中..." : "アップロード"}
      </button>
      {error && (
        <p className="mt-4 text-red-600">
          {error}
        </p>
      )}
      {shareId && (
        <div className="mt-6">
          <h2 className="font-semibold">
            共有URL
          </h2>

          <p className="break-all">
            {shareUrl}
          </p>
        </div>
      )}
    </div>
  );
}