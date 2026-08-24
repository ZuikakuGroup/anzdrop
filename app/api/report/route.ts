import { getCloudflareContext } from "@opennextjs/cloudflare";
import { stripUrlFragments } from "@/lib/sanitize";

const MAX_REASON_LENGTH = 1000;
const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 200;

const RIGHT_TYPES = [
  "copyright",
  "trademark",
  "portrait",
  "other",
] as const;

type RightType = (typeof RIGHT_TYPES)[number];

// "rights_infringement" はUIから選択させず、reportType === "rights_holder" の
// 場合にサーバー側で自動的に割り当てるカテゴリ。
const REPORT_CATEGORIES = [
  "csam",
  "malware",
  "privacy",
  "spam",
  "other",
] as const;

type ReportCategory = (typeof REPORT_CATEGORIES)[number] | "rights_infringement";

type ReportType = "general" | "rights_holder";

type ReportRequest = {
  reportType?: string;
  shareId: string;
  reason: string;
  category?: string;
  claimantName?: string;
  contactEmail?: string;
  rightType?: string;
};

type ReportResponse =
  | {
      success: true;
    }
  | {
      success: false;
      error: string;
    };

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

export async function POST(
  request: Request
): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const requestBody = (await request.json()) as ReportRequest;

    const reportType = parseReportType(requestBody.reportType) ?? "general";
    const shareId = extractShareId(requestBody.shareId ?? "");
    const reason = stripUrlFragments((requestBody.reason ?? "").trim());

    if (!shareId || !reason) {
      return Response.json(
        {
          success: false,
          error: "Missing shareId or reason",
        },
        { status: 400 }
      );
    }

    let claimantName: string | null = null;
    let contactEmail: string | null = null;
    let rightType: string | null = null;
    let category: ReportCategory;

    if (reportType === "rights_holder") {
      claimantName = (requestBody.claimantName ?? "").trim();
      contactEmail = (requestBody.contactEmail ?? "").trim();
      const parsedRightType = parseRightType(requestBody.rightType);

      if (!claimantName || !contactEmail || !parsedRightType) {
        return Response.json(
          {
            success: false,
            error: "Missing claimantName, contactEmail, or rightType",
          },
          { status: 400 }
        );
      }

      if (!isValidEmail(contactEmail)) {
        return Response.json(
          {
            success: false,
            error: "Invalid contactEmail",
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
            error: "Missing or invalid category",
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
  } catch (error) {
    const responseBody: ReportResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, { status: 500 });
  }
}
