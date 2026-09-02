import { z } from "zod";
import type { ApiResponse } from "@/lib/api/response";
import { isRetention, type Retention } from "@/lib/retention";

// クライアントが送る暗号化済みの値(ファイル名・ラップ鍵・ソルト)は、
// lib/crypto/base64.ts の encodeBase64Url が出力するパディングなし base64url
// (A-Za-z0-9_-)。これを「ヘッダに載せても安全な不透明トークン」の文字集合と
// 妥当な最大長に制限しておくことで、
// (1) files.encrypted_file_name が GET /api/file/[fileId] の Content-Disposition
// ヘッダに載る際に、制御文字・改行・" を混入させられない、
// (2) D1 に巨大な文字列を書き込むストレージ濫用を防ぐ。
// 実際のクライアントはドットを出力しないが、GET /api/file/[fileId] 側の
// safeAttachmentFilename の許可文字集合(ヘッダ生成直前の丸め)と揃え、
// ドットもクォート付き filename では無害なため許可している。
const SAFE_OPAQUE_TOKEN_PATTERN = /^[A-Za-z0-9._-]+$/;

// 平文ファイル名(相対パス含む)+ パケットのIV/GCMタグ + base64url 展開を
// 見込んでも数百文字に収まる。深いフォルダ構成でも余裕を持たせて 4096 とする。
const MAX_ENCRYPTED_FILE_NAME_LENGTH = 4096;
// ラップ鍵(AES-256 鍵 32 バイト)・ソルト(16 バイト)の base64url は
// それぞれ 80 / 24 文字程度。将来の余地を見て広めに取る。
const MAX_WRAPPED_KEY_LENGTH = 512;
const MAX_KEY_SALT_LENGTH = 128;

const opaqueTokenField = (max: number, error: string) =>
  z
    .string({ error })
    .min(1, { error })
    .max(max, { error })
    .regex(SAFE_OPAQUE_TOKEN_PATTERN, { error });

export const UploadStartRequestSchema = z.object({
  encryptedFileName: opaqueTokenField(
    MAX_ENCRYPTED_FILE_NAME_LENGTH,
    "暗号化済みファイル名が正しくありません"
  ),
  retention: z
    .string({ error: "保存期間の指定が正しくありません" })
    .refine((value): value is Retention => isRetention(value), {
      error: "保存期間の指定が正しくありません",
    }),
  fileSize: z
    .number({ error: "ファイルサイズが入力されていません" })
    .positive({ error: "ファイルサイズは正の数で指定してください" }),
  shareId: z.string().optional(),
  uploadToken: z.string().optional(),
  wrappedKey: opaqueTokenField(
    MAX_WRAPPED_KEY_LENGTH,
    "ラップ鍵が正しくありません"
  ).optional(),
  keySalt: opaqueTokenField(
    MAX_KEY_SALT_LENGTH,
    "鍵ソルトが正しくありません"
  ).optional(),
  turnstileToken: z.string().optional(),
});

export type UploadStartRequest = z.infer<typeof UploadStartRequestSchema>;

export type UploadStartResponse = ApiResponse<{
  shareId: string;
  uploadToken: string;
  uploadSessionId: string;
  expiresAt: string;
}>;
