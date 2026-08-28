import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireTurnstile } from "@/lib/turnstile";
import {
  calculateExpiresAt,
  maxDownloadsForRetention,
} from "@/lib/retention";
import { verifyShareOwnership } from "@/lib/share-auth";
import { generateShareId } from "@/lib/id";
import { verifySession } from "@/lib/account/session";
import {
  getAccountPlanInfo,
  getMaxFileSizeBytes,
  isPreviewAllowedForPlan,
  isRetentionAllowedForPlan,
  isTurnstileRequiredForPlan,
} from "@/lib/plan";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  UploadStartRequestSchema,
  type UploadStartResponse,
} from "@/app/api/upload/start/schema";

export const POST = withApiHandler(
  "POST /api/upload/start",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const parsed = await parseJsonBody(request, UploadStartRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const requestBody = parsed.data;
    const { encryptedFileName, fileSize, retention } = requestBody;

    // 未ログインの場合は常にfreeプラン扱い(既存の匿名アップロードの挙動を維持)。
    const session = await verifySession(request, env);
    const { plan } = await getAccountPlanInfo(
      session?.accountId ?? null,
      env
    );

    if (fileSize > getMaxFileSizeBytes(plan)) {
      return Response.json(
        {
          success: false,
          error: "ファイルサイズが上限を超えています",
        },
        {
          status: 400,
        }
      );
    }

    if (!isRetentionAllowedForPlan(retention, plan)) {
      return Response.json(
        {
          success: false,
          error: "この保存期間は有料プラン限定です",
        },
        {
          status: 403,
        }
      );
    }

    const uploadSessionId = crypto.randomUUID();
    const storageKey = crypto.randomUUID();

    const createdAt = new Date().toISOString();

    let shareId = requestBody.shareId;
    let uploadToken: string;
    let expiresAt: string;

    if (shareId) {
      // 既存の共有に相乗り(複数ファイル対応)。
      const ownership = await verifyShareOwnership(
        env.DB,
        shareId,
        requestBody.uploadToken
      );

      if (!ownership.ok) {
        return Response.json(
          {
            success: false,
            error: ownership.error,
          },
          { status: ownership.status }
        );
      }

      uploadToken = requestBody.uploadToken as string;
      expiresAt = ownership.share.expiresAt;
    } else {
      // 新規共有の作成(=Bot悪用の主な標的)のみTurnstile検証を要求する。
      // 同一共有への追加ファイルは、この最初の検証を突破した際に発行された
      // uploadTokenの所持自体が既に正当性の証明になっているため再検証しない。
      // Standard/Premiumはログイン済みアカウントであることが分かっているため、
      // Turnstile検証自体をスキップする。
      if (isTurnstileRequiredForPlan(plan)) {
        const turnstile = await requireTurnstile(
          requestBody.turnstileToken,
          env.TURNSTILE_SECRET_KEY
        );

        if (!turnstile.ok) {
          return turnstile.response;
        }
      }

      shareId = generateShareId();
      uploadToken = crypto.randomUUID();
      expiresAt = calculateExpiresAt(new Date(createdAt), retention);

      // Share作成
      await env.DB.prepare(`
        INSERT INTO shares (
          id,
          created_at,
          expires_at,
          upload_token,
          wrapped_key,
          key_salt,
          preview_allowed
        )
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
        .bind(
          shareId,
          createdAt,
          expiresAt,
          uploadToken,
          requestBody.wrappedKey ?? null,
          requestBody.keySalt ?? null,
          isPreviewAllowedForPlan(plan) ? 1 : 0
        )
        .run();
    }

    const maxDownloads = maxDownloadsForRetention(retention);

    // Multipart Upload開始
    const multipart =
      await env.FILES_BUCKET.createMultipartUpload(
        storageKey
      );

    // Upload Session保存
    await env.DB.prepare(`
      INSERT INTO uploads (
        id,
        share_id,
        storage_key,
        upload_id,
        encrypted_file_name,
        file_size,
        max_downloads,
        created_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        uploadSessionId,
        shareId,
        storageKey,
        multipart.uploadId,
        encryptedFileName,
        fileSize ?? null,
        maxDownloads,
        createdAt
      )
      .run();

    const responseBody: UploadStartResponse = {
      success: true,
      shareId,
      uploadToken,
      uploadSessionId,
      expiresAt,
    };

    return Response.json(responseBody);
  }
);
