import { getCloudflareContext } from "@opennextjs/cloudflare";
import { requireAdmin } from "@/lib/api/adminAuth";
import { withApiHandler } from "@/lib/api/handler";
import {
  getAcquisitionReport,
  getFunnelReport,
  getOverviewReport,
  getRecipientGrowthReport,
  getReliabilityReport,
  getRetentionReport,
} from "@/lib/analytics/reports";

const VIEWS = [
  "overview",
  "funnel",
  "reliability",
  "acquisition",
  "retention",
  "recipient-growth",
] as const;
type View = (typeof VIEWS)[number];

function parseView(value: string | null): View | null {
  return VIEWS.includes(value as View) ? (value as View) : null;
}

function defaultDateRange(): { from: string; to: string } {
  const to = new Date();
  const from = new Date(to.getTime() - 29 * 24 * 60 * 60 * 1000);

  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

function isValidDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }

  const date = new Date(`${value}T00:00:00.000Z`);

  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

export const GET = withApiHandler(
  "GET /api/admin/analytics",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const auth = await requireAdmin(request, env, { verifyOrigin: false });

    if (!auth.ok) {
      return auth.response;
    }

    const url = new URL(request.url);
    const view = parseView(url.searchParams.get("view"));

    if (!view) {
      return Response.json(
        { success: false, error: "viewの指定が正しくありません" },
        { status: 400 }
      );
    }

    const defaults = defaultDateRange();
    const from = url.searchParams.get("from") ?? defaults.from;
    const to = url.searchParams.get("to") ?? defaults.to;

    if (!isValidDate(from) || !isValidDate(to) || from > to) {
      return Response.json(
        { success: false, error: "from/toは有効なYYYY-MM-DD形式で指定してください" },
        { status: 400 }
      );
    }

    const latest = new Date().toISOString().slice(0, 10);
    const earliest = new Date(Date.now() - 364 * 24 * 60 * 60 * 1000)
      .toISOString()
      .slice(0, 10);
    if (from < earliest || to > latest) {
      return Response.json(
        { success: false, error: "指定できる期間は直近1年以内です" },
        { status: 400 }
      );
    }

    const data = await (async () => {
      switch (view) {
        case "overview":
          return getOverviewReport(env, new Date(`${to}T12:00:00.000Z`), from, to);
        case "funnel":
          return getFunnelReport(env, from, to);
        case "reliability":
          return getReliabilityReport(env, from, to);
        case "acquisition":
          return getAcquisitionReport(env, from, to);
        case "retention":
          return getRetentionReport(env, from, to);
        case "recipient-growth":
          return getRecipientGrowthReport(env, from, to);
      }
    })();

    return Response.json(
      { success: true, view, from, to, data },
      { headers: { "Cache-Control": "no-store" } }
    );
  }
);
