"use client";
import { useEffect, useState } from "react";

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
  }[];
  error?: string;
};

export default function DownloadPage({
  shareId,
}: DownloadPageProps) {
  const [files, setFiles] = useState<
    DownloadResponse["files"]
  >([]);

  const [error, setError] = useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  useEffect(() => {
    const fetchFiles = async () => {
      try {
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

        setFiles(result.files);
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

    fetchFiles();
  }, [shareId]);

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

              <a
                href={`/api/file/${file.id}`}
                className="rounded bg-blue-600 px-3 py-1 text-white"
              >
                ダウンロード
              </a>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}