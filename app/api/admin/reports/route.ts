import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessJwt } from "@/lib/access";

type ReportRow = {
  id: string;
  share_id: string;
  reason: string;
  created_at: string;
  resolved_at: string | null;
  report_type: string;
  claimant_name: string | null;
  contact_email: string | null;
  right_type: string | null;
  category: string;
};

type ShareInfoRow = {
  id: string;
  expires_at: string;
  suspended_at: string | null;
  file_count: number;
};

type ReportShareInfo = {
  exists: boolean;
  expired: boolean;
  suspended: boolean;
  fileCount: number;
};

type AdminReport = {
  id: string;
  shareId: string;
  reason: string;
  createdAt: string;
  resolvedAt: string | null;
  reportType: string;
  claimantName: string | null;
  contactEmail: string | null;
  rightType: string | null;
  category: string;
  share: ReportShareInfo;
};

type StatusFilter = "open" | "resolved" | "all";

function parseStatus(value: string | null): StatusFilter {
  if (value === "resolved" || value === "all") {
    return value;
  }

  return "open";
}

function whereClauseFor(status: StatusFilter): string {
  if (status === "resolved") {
    return "WHERE resolved_at IS NOT NULL";
  }

  if (status === "all") {
    return "";
  }

  return "WHERE resolved_at IS NULL";
}

async function fetchShareInfoByIds(
  env: CloudflareEnv,
  shareIds: string[]
): Promise<Map<string, ShareInfoRow>> {
  const map = new Map<string, ShareInfoRow>();

  if (shareIds.length === 0) {
    return map;
  }

  const placeholders = shareIds.map(() => "?").join(", ");

  const { results } = await env.DB.prepare(
    `
      SELECT s.id AS id, s.expires_at AS expires_at, s.suspended_at AS suspended_at,
             COUNT(f.id) AS file_count
      FROM shares s
      LEFT JOIN files f ON f.share_id = s.id
      WHERE s.id IN (${placeholders})
      GROUP BY s.id
    `
  )
    .bind(...shareIds)
    .all<ShareInfoRow>();

  for (const row of results ?? []) {
    map.set(row.id, row);
  }

  return map;
}

export async function GET(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const identity = await verifyAccessJwt(request, env);

    if (!identity) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    const url = new URL(request.url);
    const status = parseStatus(url.searchParams.get("status"));

    const { results: reports } = await env.DB.prepare(
      `
        SELECT id, share_id, reason, created_at, resolved_at,
               report_type, claimant_name, contact_email, right_type, category
        FROM reports
        ${whereClauseFor(status)}
        ORDER BY (category = 'csam') DESC, created_at DESC
      `
    ).all<ReportRow>();

    const shareIds = [
      ...new Set((reports ?? []).map((report) => report.share_id)),
    ];
    const shareInfoById = await fetchShareInfoByIds(env, shareIds);
    const now = new Date();

    const responseReports: AdminReport[] = (reports ?? []).map((report) => {
      const shareInfo = shareInfoById.get(report.share_id);

      return {
        id: report.id,
        shareId: report.share_id,
        reason: report.reason,
        createdAt: report.created_at,
        resolvedAt: report.resolved_at,
        reportType: report.report_type,
        claimantName: report.claimant_name,
        contactEmail: report.contact_email,
        rightType: report.right_type,
        category: report.category,
        share: shareInfo
          ? {
              exists: true,
              expired: new Date(shareInfo.expires_at) <= now,
              suspended: shareInfo.suspended_at !== null,
              fileCount: shareInfo.file_count,
            }
          : { exists: false, expired: false, suspended: false, fileCount: 0 },
      };
    });

    return Response.json(
      { success: true, reports: responseReports },
      { headers: { "Cache-Control": "no-store" } }
    );
  } catch (error) {
    return Response.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
