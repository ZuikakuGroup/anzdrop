import { AwsClient } from "aws4fetch";
import type { R2S3Credentials } from "./r2DirectCredentials";
import { UPLOAD_PART_SIZE } from "./partSize";

export const PRESIGNED_UPLOAD_PART_EXPIRES_SECONDS = 3600;

// UploadPart 用の presigned PUT URL を発行する。
// ブラウザが Worker を経由せず R2 へ暗号文パートを直接送るためのもの。
// Content-Length を署名に含めて、proxy 経路の UPLOAD_PART_SIZE 上限と同等に
// 巨大ボディのPUTを署名検証で拒否する。
export async function presignUploadPartUrl(params: {
  credentials: R2S3Credentials;
  storageKey: string;
  uploadId: string;
  partNumber: number;
  contentLength: number;
  expiresInSeconds?: number;
}): Promise<string> {
  const {
    credentials,
    storageKey,
    uploadId,
    partNumber,
    contentLength,
    expiresInSeconds = PRESIGNED_UPLOAD_PART_EXPIRES_SECONDS,
  } = params;

  if (!Number.isInteger(partNumber) || partNumber < 1) {
    throw new Error("partNumber must be a positive integer");
  }

  if (
    !Number.isInteger(contentLength) ||
    contentLength < 1 ||
    contentLength > UPLOAD_PART_SIZE
  ) {
    throw new Error("contentLength must be between 1 and UPLOAD_PART_SIZE");
  }

  const client = new AwsClient({
    accessKeyId: credentials.accessKeyId,
    secretAccessKey: credentials.secretAccessKey,
    service: "s3",
    region: "auto",
  });

  // path-style: https://<ACCOUNT_ID>.r2.cloudflarestorage.com/<bucket>/<key>
  // storageKey は UUID のみ(スラッシュなし)を想定。
  const url = new URL(
    `https://${credentials.accountId}.r2.cloudflarestorage.com/${credentials.bucketName}/${storageKey}`
  );
  url.searchParams.set("partNumber", String(partNumber));
  url.searchParams.set("uploadId", uploadId);
  url.searchParams.set("X-Amz-Expires", String(expiresInSeconds));

  // Request 経由だと空ボディの Content-Length が落ちるため、string+init で渡す。
  // allHeaders: true で content-length を SignedHeaders に含める。
  const signed = await client.sign(url.toString(), {
    method: "PUT",
    headers: {
      "content-length": String(contentLength),
    },
    aws: {
      signQuery: true,
      allHeaders: true,
    },
  });

  return signed.url;
}

export async function presignUploadPartUrls(params: {
  credentials: R2S3Credentials;
  storageKey: string;
  uploadId: string;
  parts: Array<{ partNumber: number; contentLength: number }>;
  expiresInSeconds?: number;
}): Promise<Array<{ partNumber: number; url: string }>> {
  const urls: Array<{ partNumber: number; url: string }> = [];

  for (const part of params.parts) {
    urls.push({
      partNumber: part.partNumber,
      url: await presignUploadPartUrl({
        credentials: params.credentials,
        storageKey: params.storageKey,
        uploadId: params.uploadId,
        partNumber: part.partNumber,
        contentLength: part.contentLength,
        expiresInSeconds: params.expiresInSeconds,
      }),
    });
  }

  return urls;
}
