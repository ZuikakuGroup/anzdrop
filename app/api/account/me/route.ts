import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifySession } from "@/lib/account/session";
import { getAccountPlanInfo, type Plan } from "@/lib/plan";

type MeResponse =
  | {
      success: true;
      accountId: string;
      plan: Plan;
      planExpiresAt: string | null;
    }
  | { success: false; error: string };

export async function GET(request: Request): Promise<Response> {
  try {
    const { env } = getCloudflareContext();
    const session = await verifySession(request, env);

    if (!session) {
      return Response.json(
        { success: false, error: "Not logged in" },
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
  } catch (error) {
    const responseBody: MeResponse = {
      success: false,
      error: String(error),
    };

    return Response.json(responseBody, { status: 500 });
  }
}
