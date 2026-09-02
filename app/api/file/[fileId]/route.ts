import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkShareAccessible } from "@/lib/share-auth";
import { withApiHandler } from "@/lib/api/handler";
import type { RouteContext } from "@/lib/api/types";

type FileRecord = {
  id: string;
  share_id: string;
  storage_key: string;
  encrypted_file_name: string;
};

type DownloadCountResult = {
  download_count: number;
  max_downloads: number | null;
};

type Share = {
  id: string;
  created_at: string;
  expires_at: string;
  suspended_at: string | null;
};

// encrypted_file_name は本来 lib/crypto/base64.ts の base64url(A-Za-z0-9_-)だが、
// AAD 保護導入前の古い行や、スキーマ検証を追加する前に作られた行に想定外の文字が
// 混ざっていても、Content-Disposition ヘッダに制御文字・改行・" が入って
// レスポンス構築が失敗(= そのファイルが恒久的にダウンロード不能)しないよう、
// ヘッダに載せる直前に安全な文字集合へ丸める。値自体は復号前の不透明な文字列で、
// クライアントは保存時に復号済みの本名で付け直すため、表示名としての意味は無い。
function safeAttachmentFilename(encryptedFileName: string): string {
  const cleaned = encryptedFileName.replace(/[^A-Za-z0-9_.-]/g, "");

  return cleaned.length > 0 ? cleaned : "download";
}

async function deleteOneTimeFile(
  env: CloudflareEnv,
  fileId: string,
  storageKey: string
): Promise<void> {
  await env.FILES_BUCKET.delete(storageKey);
  await env.DB.prepare(`DELETE FROM files WHERE id = ?`)
    .bind(fileId)
    .run();
}

export const GET = withApiHandler(
  "GET /api/file/[fileId]",
  async (
    request: Request,
    context: RouteContext<{ fileId: string }>
  ): Promise<Response> => {
    const { env, ctx } = getCloudflareContext();

    const { fileId } = await context.params;

    const file = await env.DB.prepare(
      `
      SELECT
        id,
        share_id,
        storage_key,
        encrypted_file_name
      FROM files
      WHERE id = ?
      `
    )
      .bind(fileId)
      .first<FileRecord>();

    if (!file) {
      return Response.json(
        {
          success: false,
          error: "ファイルが見つかりません",
        },
        { status: 404 }
      );
    }

    const share = await env.DB.prepare(
      `
    SELECT id, created_at, expires_at, suspended_at
    FROM shares
    WHERE id = ?
  `
    )
      .bind(file.share_id)
      .first<Share>();

    if (!share) {
      return Response.json(
        {
          success: false,
          error: "共有が見つかりません",
        },
        { status: 404 }
      );
    }

    const access = checkShareAccessible({
      expiresAt: share.expires_at,
      suspendedAt: share.suspended_at,
    });

    if (!access.ok) {
      return Response.json(
        { success: false, error: access.error },
        { status: access.status }
      );
    }

    // ダウンロード回数の上限チェックと加算を1つのUPDATEで原子的に行う。
    // 条件を満たさない(上限に達している)場合は行が返らない。
    const downloadCount = await env.DB.prepare(
      `
      UPDATE files
      SET download_count = download_count + 1
      WHERE id = ?
        AND (max_downloads IS NULL OR download_count < max_downloads)
      RETURNING download_count, max_downloads
      `
    )
      .bind(fileId)
      .first<DownloadCountResult>();

    if (!downloadCount) {
      return Response.json(
        {
          success: false,
          error: "ファイルが見つかりません",
        },
        { status: 404 }
      );
    }

    const object = await env.FILES_BUCKET.get(file.storage_key);

    if (!object) {
      return Response.json(
        {
          success: false,
          error: "ファイルデータが見つかりません",
        },
        { status: 404 }
      );
    }

    if (
      downloadCount.max_downloads !== null &&
      downloadCount.download_count >= downloadCount.max_downloads
    ) {
      // 許可された最後の1回のダウンロードだったので、レスポンスは遅延させずに
      // 裏でR2オブジェクトとDBレコードを削除する。
      ctx.waitUntil(deleteOneTimeFile(env, fileId, file.storage_key));
    }

    return new Response(object.body, {
      headers: {
        "Content-Type":
          object.httpMetadata?.contentType ?? "application/octet-stream",
        // レスポンス本体はR2オブジェクトをそのまま素通しするため、object.sizeが
        // そのままバイト長になる。クライアント/ブラウザ側が途中切断を検知でき、
        // ダウンロードの進捗表示にも使える。
        "Content-Length": String(object.size),
        "Content-Disposition": `attachment; filename="${safeAttachmentFilename(
          file.encrypted_file_name
        )}"`,
        "Cache-Control": "no-store",
      },
    });
  }
);
