import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifySession } from "@/lib/account/session";
import { getAccountPlanInfo } from "@/lib/plan";
import { withApiHandler } from "@/lib/api/handler";
import type { MeResponse } from "@/app/api/account/me/schema";

export const GET = withApiHandler(
  "GET /api/account/me",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "ログインしていません" },
        { status: 401 }
      );
    }

    const { plan, planExpiresAt } = await getAccountPlanInfo(
      session.accountId,
      env
    );

    const responseBody: MeResponse = {
      success: true,
      accountId: session.accountId,
      plan,
      planExpiresAt,
    };

    return Response.json(responseBody);
  }
);
