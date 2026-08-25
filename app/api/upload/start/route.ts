import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyTurnstileToken } from "@/lib/turnstile";
import {
  calculateExpiresAt,
  isRetention,
  maxDownloadsForRetention,
  type Retention,
} from "@/lib/retention";
import { verifyShareOwnership } from "@/lib/share-auth";
import { generateShareId } from "@/lib/id";
import { verifySession } from "@/lib/account/session";
import {
  getAccountPlanInfo,
  getMaxFileSizeBytes,
  isRetentionAllowedForPlan,
} from "@/lib/plan";

type UploadStartRequest = {
  encryptedFileName: string;
  shareId?: string;
  uploadToken?: string;
  fileSize?: number;
  retention?: Retention;
  wrappedKey?: string;
  keySalt?: string;
  turnstileToken?: string;
};

type UploadStartResponse =
  | {
      success: true;
      shareId: string;
      uploadToken: string;
      uploadSessionId: string;
      expiresAt: string;
    }
  | {
      success: false;
      error: string;
    };

export async function POST(
  request: Request
): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    // リクエスト取得
    const requestBody =
      (await request.json()) as UploadStartRequest;

    const { encryptedFileName, fileSize, retention } = requestBody;

    if (!encryptedFileName) {
      return Response.json(
        {
          success: false,
          error: "Missing encryptedFileName",
        },
        {
          status: 400,
        }
      );
    }

    if (!retention || !isRetention(retention)) {
      return Response.json(
        {
          success: false,
          error: "Invalid retention",
        },
        {
          status: 400,
        }
      );
    }

    if (!fileSize || fileSize <= 0) {
      return Response.json(
        {
          success: false,
          error: "Missing fileSize",
        },
        {
          status: 400,
        }
      );
    }

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
          error: "File exceeds the maximum allowed size",
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
          error: "This retention period requires a paid plan",
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
      const verification = await verifyTurnstileToken(
        requestBody.turnstileToken,
        env.TURNSTILE_SECRET_KEY
      );

      if (!verification.success) {
        return Response.json(
          {
            success: false,
            error: "Turnstile verification failed",
          },
          { status: 403 }
        );
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
          key_salt
        )
        VALUES (?, ?, ?, ?, ?, ?)
      `)
        .bind(
          shareId,
          createdAt,
          expiresAt,
          uploadToken,
          requestBody.wrappedKey ?? null,
          requestBody.keySalt ?? null
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

  } catch (error) {

    const responseBody: UploadStartResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, {
      status: 500,
    });
  }
}