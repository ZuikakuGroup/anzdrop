import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sanitizeReportText } from "@/lib/sanitize";
import { requireTurnstile } from "@/lib/turnstile";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import {
  REPORT_CATEGORIES,
  RIGHT_TYPES,
  ReportRequestSchema,
  type ReportCategory,
  type ReportResponse,
  type ReportType,
  type RightType,
} from "@/app/api/report/schema";

const MAX_REASON_LENGTH = 1000;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 200;

function extractShareId(input: string): string {
  const trimmed = input.trim();
  const match = trimmed.match(/\/d\/([^/#?]+)/);

  return match ? match[1] : trimmed;
}

function parseReportType(value: string | undefined): ReportType | null {
  if (value === "general" || value === "rights_holder") {
    return value;
  }

  return null;
}

function parseRightType(value: string | undefined): RightType | null {
  return RIGHT_TYPES.includes(value as RightType) ? (value as RightType) : null;
}

function parseCategory(
  value: string | undefined
): (typeof REPORT_CATEGORIES)[number] | null {
  return REPORT_CATEGORIES.includes(value as (typeof REPORT_CATEGORIES)[number])
    ? (value as (typeof REPORT_CATEGORIES)[number])
    : null;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

export const POST = withApiHandler(
  "POST /api/report",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const parsed = await parseJsonBody(request, ReportRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const requestBody = parsed.data;

    const turnstile = await requireTurnstile(
      requestBody.turnstileToken,
      env.TURNSTILE_SECRET_KEY
    );

    if (!turnstile.ok) {
      return turnstile.response;
    }

    const reportType = parseReportType(requestBody.reportType) ?? "general";
    const shareId = extractShareId(requestBody.shareId ?? "");
    const reason = sanitizeReportText((requestBody.reason ?? "").trim());

    if (!shareId || !reason) {
      return Response.json(
        { success: false, error: "共有IDまたは理由が入力されていません" },
        { status: 400 }
      );
    }

    let claimantName: string | null = null;
    let contactEmail: string | null = null;
    let rightType: string | null = null;
    let category: ReportCategory;

    if (reportType === "rights_holder") {
      claimantName = sanitizeReportText((requestBody.claimantName ?? "").trim());
      contactEmail = sanitizeReportText((requestBody.contactEmail ?? "").trim());
      const parsedRightType = parseRightType(requestBody.rightType);

      if (!claimantName || !contactEmail || !parsedRightType) {
        return Response.json(
          {
            success: false,
            error: "氏名・団体名、連絡先メールアドレス、権利の種類のいずれかが入力されていません",
          },
          { status: 400 }
        );
      }

      if (!isValidEmail(contactEmail)) {
        return Response.json(
          {
            success: false,
            error: "連絡先メールアドレスの形式が正しくありません",
          },
          { status: 400 }
        );
      }

      claimantName = claimantName.slice(0, MAX_NAME_LENGTH);
      contactEmail = contactEmail.slice(0, MAX_EMAIL_LENGTH);
      rightType = parsedRightType;
      // 権利者申し立ては専用フォームなのでカテゴリはユーザーに選ばせず固定する。
      category = "rights_infringement";
    } else {
      const parsedCategory = parseCategory(requestBody.category);

      if (!parsedCategory) {
        return Response.json(
          {
            success: false,
            error: "通報の種類が正しく選択されていません",
          },
          { status: 400 }
        );
      }

      category = parsedCategory;
    }

    await env.DB.prepare(`
      INSERT INTO reports (
        id,
        share_id,
        reason,
        created_at,
        report_type,
        claimant_name,
        contact_email,
        right_type,
        category
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        shareId,
        reason.slice(0, MAX_REASON_LENGTH),
        new Date().toISOString(),
        reportType,
        claimantName,
        contactEmail,
        rightType,
        category
      )
      .run();

    const responseBody: ReportResponse = { success: true };

    return Response.json(responseBody);
  }
);
