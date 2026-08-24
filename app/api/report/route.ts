import { getCloudflareContext } from "@opennextjs/cloudflare";

const MAX_REASON_LENGTH = 1000;

type ReportRequest = {
  shareId: string;
  reason: string;
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

export async function POST(
  request: Request
): Promise<Response> {
  try {
    const { env } = getCloudflareContext();

    const requestBody = (await request.json()) as ReportRequest;

    const shareId = extractShareId(requestBody.shareId ?? "");
    const reason = (requestBody.reason ?? "").trim();

    if (!shareId || !reason) {
      return Response.json(
        {
          success: false,
          error: "Missing shareId or reason",
        },
        { status: 400 }
      );
    }

    await env.DB.prepare(`
      INSERT INTO reports (
        id,
        share_id,
        reason,
        created_at
      )
      VALUES (?, ?, ?, ?)
    `)
      .bind(
        crypto.randomUUID(),
        shareId,
        reason.slice(0, MAX_REASON_LENGTH),
        new Date().toISOString()
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
