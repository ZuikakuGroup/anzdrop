type ShareRow = {
  created_at: string;
  expires_at: string;
  upload_token: string | null;
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
    return { ok: false, status: 400, error: "Missing uploadToken" };
  }

  const share = await db
    .prepare(
      `
        SELECT created_at, expires_at, upload_token FROM shares WHERE id = ?
      `
    )
    .bind(shareId)
    .first<ShareRow>();

  if (!share) {
    return { ok: false, status: 404, error: "Share not found" };
  }

  if (!share.upload_token || share.upload_token !== uploadToken) {
    return { ok: false, status: 403, error: "Invalid uploadToken" };
  }

  if (new Date(share.expires_at) <= new Date()) {
    return { ok: false, status: 410, error: "Share has expired" };
  }

  return {
    ok: true,
    share: { createdAt: share.created_at, expiresAt: share.expires_at },
  };
}
