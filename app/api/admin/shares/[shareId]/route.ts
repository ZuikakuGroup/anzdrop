import { getCloudflareContext } from "@opennextjs/cloudflare";
import { verifyAccessJwt } from "@/lib/access";
import { deleteShare } from "@/lib/cleanup";

type RouteContext = {
  params: Promise<{
    shareId: string;
  }>;
};

export async function DELETE(
  request: Request,
  context: RouteContext
): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const identity = await verifyAccessJwt(request, env);

    if (!identity) {
      return Response.json(
        { success: false, error: "Unauthorized" },
        { status: 403 }
      );
    }

    const { shareId } = await context.params;

    // 既に(期限切れcronや二重クリックで)削除済みの共有に対しても、
    // 冪等に成功として扱う。
    await deleteShare(env, shareId);

    return Response.json({ success: true });
  } catch (error) {
    return Response.json(
      { success: false, error: String(error) },
      { status: 500 }
    );
  }
}
