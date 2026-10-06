export const R2_FILES_BUCKET_NAME = "anzdrop";

export type R2S3Credentials = {
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  bucketName: string;
};

type EnvWithOptionalR2S3 = {
  R2_ACCESS_KEY_ID?: string;
  R2_SECRET_ACCESS_KEY?: string;
  CLOUDFLARE_ACCOUNT_ID?: string;
};

// 本番 Secrets が揃っているときだけ direct モードを有効にする。
// 未設定(ローカル Miniflare 等)では Worker プロキシへフォールバックする。
// Secrets は wrangler types 生成物に含まれないことがあるため object から読む。
export function getR2S3Credentials(env: object): R2S3Credentials | null {
  const secrets = env as EnvWithOptionalR2S3;
  const accessKeyId = secrets.R2_ACCESS_KEY_ID?.trim();
  const secretAccessKey = secrets.R2_SECRET_ACCESS_KEY?.trim();
  const accountId = secrets.CLOUDFLARE_ACCOUNT_ID?.trim();

  if (!accessKeyId || !secretAccessKey || !accountId) {
    return null;
  }

  return {
    accessKeyId,
    secretAccessKey,
    accountId,
    bucketName: R2_FILES_BUCKET_NAME,
  };
}

export function isR2DirectUploadEnabled(env: object): boolean {
  return getR2S3Credentials(env) !== null;
}

export type UploadMode = "direct" | "proxy";

export function resolveUploadMode(env: object): UploadMode {
  return isR2DirectUploadEnabled(env) ? "direct" : "proxy";
}
