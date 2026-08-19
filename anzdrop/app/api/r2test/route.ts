import { getCloudflareContext } from "@opennextjs/cloudflare";

export async function GET() {
  try {
    const { env } = getCloudflareContext();

    await env.FILES_BUCKET.put(
      "test.txt",
      "Hello Anzdrop"
    );

    const object = await env.FILES_BUCKET.get("test.txt");

    const text = await object?.text();

    return Response.json({
      success: true,
      text,
    });
  } catch (error) {
    return Response.json({
      success: false,
      error: String(error),
    });
  }
}