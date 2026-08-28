import { timingSafeEqual } from "@/lib/timingSafeEqual";

type ShareRow = {
  created_at: string;
  expires_at: string;
  upload_token: string | null;
  suspended_at: string | null;
};

export type ShareOwnership = {
  createdAt: string;
  expiresAt: string;
};

export type ShareOwnershipResult =
  | { ok: true; share: ShareOwnership }
  | { ok: false; status: number; error: string };

// shareIdはURLパスに含まれ第三者に露出しうる公開識別子のため、所有権の証明には
// サーバー生成のuploadToken(URLに含まれず、クライアントのメモリ上にのみ存在する)の
// 一致を必須とする。/api/upload/start(相乗り時)と/api/upload/settingsで共有するロジック。
export async function verifyShareOwnership(
  db: CloudflareEnv["DB"],
  shareId: string,
  uploadToken: string | undefined
): Promise<ShareOwnershipResult> {
  if (!uploadToken) {
    return { ok: false, status: 400, error: "アップロードトークンが入力されていません" };
  }

  const share = await db
    .prepare(
      `
        SELECT created_at, expires_at, upload_token, suspended_at FROM shares WHERE id = ?
      `
    )
    .bind(shareId)
    .first<ShareRow>();

  if (!share) {
    return { ok: false, status: 404, error: "共有が見つかりません" };
  }

  const tokenMatches =
    !!share.upload_token &&
    timingSafeEqual(
      new TextEncoder().encode(share.upload_token),
      new TextEncoder().encode(uploadToken)
    );

  if (!tokenMatches) {
    return { ok: false, status: 403, error: "アップロードトークンが正しくありません" };
  }

  if (new Date(share.expires_at) <= new Date()) {
    return { ok: false, status: 410, error: "共有の有効期限が切れています" };
  }

  if (share.suspended_at) {
    return { ok: false, status: 403, error: "共有は一時停止中です" };
  }

  return {
    ok: true,
    share: { createdAt: share.created_at, expiresAt: share.expires_at },
  };
}

export type ShareAccessResult =
  | { ok: true }
  | { ok: false; status: number; error: string };

// app/api/download/[shareId]とapp/api/file/[fileId]がそれぞれ個別実装して
// いた「共有の有効期限切れ・停止判定」を共通化する。閲覧者は所有権(uploadToken)
// を持たないため、こちらは有効期限・停止状態のみを見るverifyShareOwnershipとは
// 別の軽量なチェックとして分離している。
export function checkShareAccessible(share: {
  expiresAt: string;
  suspendedAt: string | null;
}): ShareAccessResult {
  if (new Date(share.expiresAt) <= new Date()) {
    return { ok: false, status: 410, error: "共有の有効期限が切れています" };
  }

  if (share.suspendedAt) {
    return { ok: false, status: 403, error: "共有は一時停止中です" };
  }

  return { ok: true };
}
