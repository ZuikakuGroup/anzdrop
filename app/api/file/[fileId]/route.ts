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

// 転送が最後まで届かなかったダウンロードは「消費されなかった」とみなし、
// 先に原子的に加算しておいた download_count を1つ戻す。これにより保存期間
// 「1回」のファイルでも、通信断・タブクローズで転送が中断された場合は
// もう一度取得し直せる(GitHub issue #62)。
async function restoreDownloadCount(
  env: CloudflareEnv,
  fileId: string
): Promise<void> {
  await env.DB.prepare(
    `UPDATE files SET download_count = download_count - 1 WHERE id = ? AND download_count > 0`
  )
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

    const isCountedDownload = downloadCount.max_downloads !== null;

    const object = await env.FILES_BUCKET.get(file.storage_key);

    if (!object) {
      // 回数は既に原子的に加算済み。R2 側の一時的な不整合で本文を返せなかった
      // だけかもしれないので、回数を数えるファイルは加算を戻して再取得できる
      // ようにする(GitHub issue #62)。
      if (isCountedDownload) {
        ctx.waitUntil(restoreDownloadCount(env, fileId));
      }

      return Response.json(
        {
          success: false,
          error: "ファイルデータが見つかりません",
        },
        { status: 404 }
      );
    }

    const headers = {
      // 利用者がアップロードしたバイト列をそのまま返すため、Content-Type は
      // 常に固定値にして Content-Type 推測(sniffing)の余地をなくす。
      "Content-Type": "application/octet-stream",
      // レスポンス本体はR2オブジェクトのバイト列をそのまま流すため、object.sizeが
      // そのままバイト長になる。クライアント/ブラウザ側が途中切断を検知でき、
      // ダウンロードの進捗表示にも使える。
      "Content-Length": String(object.size),
      "Content-Disposition": `attachment; filename="${file.encrypted_file_name}"`,
      "Cache-Control": "no-store",
    };

    // 回数上限のないファイルは、R2のボディをそのまま素通しする。
    if (!isCountedDownload) {
      return new Response(object.body, { headers });
    }

    const isFinalDownload =
      downloadCount.download_count >= (downloadCount.max_downloads ?? 0);

    // 回数を数えるファイル(保存期間「1回」など)は、R2のボディを
    // TransformStream 経由でクライアントへ流し、クライアントへ実際に届いた
    // バイト数で後処理を分ける(GitHub issue #62)。
    //
    // - 全バイト届いた: 最後の1回だったならファイルを削除。
    // - 全バイト届く前に中断(通信断・タブクローズで readable が cancel された /
    //   R2 読み取りエラー): このダウンロードは「消費されなかった」とみなし、
    //   原子的に加算しておいた download_count を戻して再取得できるようにする。
    //
    // pipeTo は「最後のバイト送出直後にクライアントが接続を閉じる」ケースでも
    // reject しうる(実際には全部届いている)。届いたバイト数を数えておき、
    // object.size に達していれば reject でも完走扱いにする。
    let deliveredBytes = 0;
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        deliveredBytes += chunk.byteLength;
        controller.enqueue(chunk);
      },
    });

    const onFullyDelivered = async (): Promise<void> => {
      if (isFinalDownload) {
        await deleteOneTimeFile(env, fileId, file.storage_key);
      }
    };

    ctx.waitUntil(
      object.body.pipeTo(counter.writable).then(onFullyDelivered, async (error: unknown) => {
        if (deliveredBytes >= object.size) {
          await onFullyDelivered();
          return;
        }
        try {
          await restoreDownloadCount(env, fileId);
        } catch (restoreError) {
          console.error(
            `GET /api/file/[fileId]: failed to restore download_count for ${fileId}:`,
            restoreError
          );
        }
        console.error(
          `GET /api/file/[fileId]: streaming aborted for ${fileId} at ${deliveredBytes}/${object.size} bytes:`,
          error
        );
      })
    );

    return new Response(counter.readable, { headers });
  }
);
