import { getCloudflareContext } from "@opennextjs/cloudflare";
import { checkShareAccessible } from "@/lib/share-auth";
import { withApiHandler } from "@/lib/api/handler";
import { checkRateLimit } from "@/lib/rateLimit";
import type { RouteContext } from "@/lib/api/types";

type FileRecord = {
  id: string;
  share_id: string;
  storage_key: string;
  encrypted_file_name: string;
  max_downloads: number | null;
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

const MAX_ENCRYPTED_FILE_NAME_LENGTH = 4096;

// encrypted_file_name は本来 lib/crypto/base64.ts の base64url(A-Za-z0-9_-)だが、
// AAD 保護導入前の古い行や、スキーマ検証を追加する前に作られた行に想定外の文字が
// 混ざっていても、Content-Disposition ヘッダに制御文字・改行・" が入って
// レスポンス構築が失敗(= そのファイルが恒久的にダウンロード不能)しないよう、
// ヘッダに載せる直前に安全な文字集合へ丸める。値自体は復号前の不透明な文字列で、
// クライアントは保存時に復号済みの本名で付け直すため、表示名としての意味は無い。
function safeAttachmentFilename(encryptedFileName: string): string {
  const cleaned = encryptedFileName
    .replace(/[^A-Za-z0-9_.-]/g, "")
    .slice(0, MAX_ENCRYPTED_FILE_NAME_LENGTH);

  return cleaned.length > 0 ? cleaned : "download";
}

type SingleRange = { offset: number; length?: number } | { suffix: number };

// "Range: bytes=..." を R2 の range 指定へ変換する。単一の範囲だけ対応し、
// 解釈できないもの(複数レンジ・不正な形式)は null を返して呼び出し側が
// 全体応答へフォールバックできるようにする。
//
// end がオブジェクト長を超えていても R2 が length を実際のサイズへクランプ
// するのでここでのクランプは不要だが、offset がオブジェクト長以上の場合は
// R2 が「無効な範囲」として reject する。オブジェクト長はこの時点では
// 分からないため、その判定は呼び出し側(416 応答)に委ねる。
function parseSingleRange(header: string): SingleRange | null {
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());

  if (!match) {
    return null;
  }

  const [, startText, endText] = match;

  if (startText === "" && endText === "") {
    return null;
  }

  // 末尾 N バイト: "bytes=-500"
  if (startText === "") {
    const suffix = Number(endText);
    return Number.isSafeInteger(suffix) && suffix > 0 ? { suffix } : null;
  }

  const offset = Number(startText);

  if (!Number.isSafeInteger(offset) || offset < 0) {
    return null;
  }

  if (endText === "") {
    return { offset };
  }

  const end = Number(endText);

  if (!Number.isSafeInteger(end) || end < offset) {
    return null;
  }

  return { offset, length: end - offset + 1 };
}

// その Range が「1バイトも返せない」ものか。RFC 9110 では、開始位置が
// オブジェクト長以上の範囲(0バイトのオブジェクトへの範囲指定を含む)が
// これにあたる。末尾が長さを超えているだけの範囲は満たせる(クランプされる)。
function isUnsatisfiableRange(range: SingleRange, size: number): boolean {
  if ("suffix" in range) {
    return size === 0;
  }

  return range.offset >= size;
}

// 416 応答。RFC 9110 は満たせない Range に対して、実際のオブジェクト長を
// 伝える `Content-Range: bytes */<size>` を付けることを求めている。
function unsatisfiableRangeResponse(size: number): Response {
  return new Response(null, {
    status: 416,
    headers: {
      "Content-Range": `bytes */${size}`,
      "Accept-Ranges": "bytes",
      "Cache-Control": "no-store",
    },
  });
}

// R2 が実際に返したバイト範囲を求める。`R2Range` は
// `{offset, length?}` / `{offset?, length}` / `{suffix}` の3つの形を取りうる
// ため、どの形でも `{offset, length}` へ正規化する。R2 は要求が末尾を超える
// 場合に length を実際のサイズへクランプして返すので、Content-Length /
// Content-Range が本体長とズレないようここでも同じクランプを掛け直す。
function resolveServedRange(
  range: R2Range | undefined,
  size: number
): { offset: number; length: number } | null {
  if (!range) {
    return null;
  }

  const raw = range as { offset?: number; length?: number; suffix?: number };

  // 末尾 N バイト。N がオブジェクト長を超える場合は全体になる。
  if (raw.suffix !== undefined) {
    const suffix = Math.min(Math.max(raw.suffix, 0), size);
    return { offset: size - suffix, length: suffix };
  }

  if (raw.offset === undefined && raw.length === undefined) {
    return null;
  }

  const offset = Math.min(Math.max(raw.offset ?? 0, 0), size);
  const length = Math.min(
    Math.max(raw.length ?? size - offset, 0),
    size - offset
  );

  return { offset, length };
}

// R2 が返した(範囲指定つきの可能性がある)オブジェクトを HTTP レスポンスへ
// 変換する。range が付いていれば 206 + Content-Range、無ければ(R2 が範囲を
// 解釈できず全体を返した場合)200 + 全長を返す。ボディは常に暗号文なので
// Content-Type は固定、キャッシュも無効のまま。
function buildRangeResponse(
  object: R2ObjectBody,
  encryptedFileName: string
): Response {
  const headers: Record<string, string> = {
    "Content-Type": "application/octet-stream",
    "Content-Disposition": `attachment; filename="${safeAttachmentFilename(
      encryptedFileName
    )}"`,
    "Cache-Control": "no-store",
    "Accept-Ranges": "bytes",
  };

  const served = resolveServedRange(object.range, object.size);

  if (served) {
    // 1バイトも返せない範囲を 206 で返すと Content-Range が組み立てられない
    // (末尾が offset-1 になる)。RFC 9110 どおり 416 として扱う。
    if (served.length === 0) {
      return unsatisfiableRangeResponse(object.size);
    }

    headers["Content-Length"] = String(served.length);
    headers["Content-Range"] = `bytes ${served.offset}-${
      served.offset + served.length - 1
    }/${object.size}`;

    return new Response(object.body, { status: 206, headers });
  }

  headers["Content-Length"] = String(object.size);

  return new Response(object.body, { status: 200, headers });
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

// restoreDownloadCount を ctx.waitUntil へ直接渡すと、D1 が reject したとき
// Worker 側で unhandled rejection になる。復元失敗はログに残すだけにして
// 握りつぶす(復元できなくても最悪「1回」ファイルが1回分早く消えるだけで、
// 情報漏洩やサーバー状態の破壊にはならない)。
async function safeRestoreDownloadCount(
  env: CloudflareEnv,
  fileId: string
): Promise<void> {
  try {
    await restoreDownloadCount(env, fileId);
  } catch (error) {
    console.error(
      `GET /api/file/[fileId]: failed to restore download_count for ${fileId}:`,
      error
    );
  }
}

export const GET = withApiHandler(
  "GET /api/file/[fileId]",
  async (
    request: Request,
    context: RouteContext<{ fileId: string }>
  ): Promise<Response> => {
    const { env, ctx } = getCloudflareContext();

    const { fileId } = await context.params;

    // fileId 単位のレート制限(GitHub issue #81)。D1 / R2 に触る前に弾いて、
    // 超過したリクエストがコストを発生させないようにする。
    //
    // 1回の論理的なダウンロードは lib/download/parallelFetch.ts により
    // 8MiB ウィンドウ × 並列6本の Range リクエストへ分かれるため、閾値は
    // 「実在しない速度」まで緩めてある(wrangler.jsonc の FILE_RATE_LIMITER)。
    // 正当な大容量ダウンロードを壊さないことを優先し、暴走の頭打ちだけを狙う。
    const fileLimit = await checkRateLimit(
      env.FILE_RATE_LIMITER,
      fileId,
      "GET /api/file/[fileId]"
    );

    if (!fileLimit.ok) {
      return fileLimit.response;
    }

    const file = await env.DB.prepare(
      `
      SELECT
        id,
        share_id,
        storage_key,
        encrypted_file_name,
        max_downloads
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

    // 回数制限のないファイルへの Range リクエストは、並列ダウンロード
    // (lib/download/parallelFetch.ts)の1つのサブリクエスト。1回の論理的な
    // ダウンロードが複数リクエストに分かれるだけなので download_count は
    // 加算せず、有効期限・一時停止の確認だけを済ませて部分応答(206)を返す。
    // 回数を数えるファイルはこの分岐に入れず、下の単一 GET + 原子的加算の
    // 経路をそのまま通す(クライアントも回数制限ファイルには Range を使わない)。
    const rangeHeader = request.headers.get("Range");
    const parsedRange = rangeHeader ? parseSingleRange(rangeHeader) : null;

    if (parsedRange && file.max_downloads === null) {
      let ranged: R2ObjectBody | null;

      try {
        ranged = await env.FILES_BUCKET.get(file.storage_key, {
          range: parsedRange,
        });
      } catch (error) {
        // R2 はオブジェクト長以上の offset を「無効な範囲」として reject する。
        // そのまま投げると 500 になってしまうので、本当に範囲外なのかを確かめて
        // RFC 9110 どおり 416 を返す。head を呼ぶのはこのエラー経路だけなので、
        // 正常時の R2 操作は 1 リクエストあたり get 1 回のまま。
        const meta = await env.FILES_BUCKET.head(file.storage_key);

        if (meta && isUnsatisfiableRange(parsedRange, meta.size)) {
          return unsatisfiableRangeResponse(meta.size);
        }

        // 範囲外ではない = R2 の一時障害など。共通エラー処理(500)へ委ねる
        // (回数を数えないファイルなので戻すべきカウントもない)。
        throw error;
      }

      if (!ranged) {
        return Response.json(
          {
            success: false,
            error: "ファイルデータが見つかりません",
          },
          { status: 404 }
        );
      }

      return buildRangeResponse(ranged, file.encrypted_file_name);
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

    // 回数は既に原子的に加算済み。ここから先で本文を返せずに終わる経路
    // (R2 が null を返す/get 自体が reject する)では、回数を数えるファイルは
    // 加算を戻して再取得できるようにする(GitHub issue #62)。
    let object: R2ObjectBody | null;

    try {
      object = await env.FILES_BUCKET.get(file.storage_key);
    } catch (error) {
      if (isCountedDownload) {
        ctx.waitUntil(safeRestoreDownloadCount(env, fileId));
      }

      // withApiHandler 側の共通エラー処理(500)に委ねる。
      throw error;
    }

    if (!object) {
      if (isCountedDownload) {
        ctx.waitUntil(safeRestoreDownloadCount(env, fileId));
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
      // encrypted_file_name に想定外の文字が混ざっていてもヘッダ構築が
      // 失敗しないよう、安全な文字集合へ丸めてから載せる(GitHub issue #75)。
      "Content-Disposition": `attachment; filename="${safeAttachmentFilename(
        file.encrypted_file_name
      )}"`,
      "Cache-Control": "no-store",
    };

    // 回数上限のないファイルは、R2のボディをそのまま素通しする。並列
    // ダウンロード(Range)に対応していることをクライアント/ブラウザへ知らせる。
    if (!isCountedDownload) {
      return new Response(object.body, {
        headers: { ...headers, "Accept-Ranges": "bytes" },
      });
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
        await safeRestoreDownloadCount(env, fileId);
        console.error(
          `GET /api/file/[fileId]: streaming aborted for ${fileId} at ${deliveredBytes}/${object.size} bytes:`,
          error
        );
      })
    );

    return new Response(counter.readable, { headers });
  }
);
