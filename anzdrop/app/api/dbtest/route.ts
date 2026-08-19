import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
  try {
    const { env } = getCloudflareContext();

    const result = await env.DB
      .prepare("SELECT name FROM sqlite_master WHERE type='table'")
      .all();

    return Response.json(result);
  } catch (error) {
    return Response.json({
      success: false,
      error: String(error),
    });
  }
}