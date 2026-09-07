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

    const data = await (async () => {
      switch (view) {
        case "overview":
          return getOverviewReport(env);
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
