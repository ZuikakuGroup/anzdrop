import { getCloudflareContext } from "@opennextjs/cloudflare";
import { sanitizeReportText } from "@/lib/sanitize";
import { requireTurnstile } from "@/lib/turnstile";
import { isValidEmail } from "@/lib/email";
import { withApiHandler } from "@/lib/api/handler";
import { parseJsonBody } from "@/lib/api/validate";
import { ContactRequestSchema, type ContactResponse } from "@/app/api/contact/schema";

const MAX_NAME_LENGTH = 200;
const MAX_EMAIL_LENGTH = 200;
const MAX_SUBJECT_LENGTH = 200;
const MAX_MESSAGE_LENGTH = 2000;

export const POST = withApiHandler(
  "POST /api/contact",
  async (request: Request): Promise<Response> => {
    const { env } = getCloudflareContext();

    const parsed = await parseJsonBody(request, ContactRequestSchema);

    if (!parsed.ok) {
      return parsed.response;
    }

    const requestBody = parsed.data;

    const turnstile = await requireTurnstile(
      requestBody.turnstileToken,
      env.TURNSTILE_SECRET_KEY
    );

    if (!turnstile.ok) {
      return turnstile.response;
    }

    // 自由記述欄(氏名・メールアドレス・件名・本文)に、通報フォームと同様に
    // E2EE復号鍵が誤って貼り付けられてもDBに保存されないようsanitizeReportText()
    // を通す。メールアドレスも例外ではない(鍵付きURLをスペースなしでメール
    // アドレスの直前に貼り付けても、isValidEmail()の緩いチェックだけでは
    // 弾けないため)。
    const name = sanitizeReportText((requestBody.name ?? "").trim());
    const email = sanitizeReportText((requestBody.email ?? "").trim());
    const subject = sanitizeReportText((requestBody.subject ?? "").trim());
    const message = sanitizeReportText((requestBody.message ?? "").trim());

    if (!email || !subject || !message) {
      return Response.json(
        {
          success: false,
          error: "メールアドレス・件名・本文を入力してください",
        },
        { status: 400 }
      );
    }

    if (!isValidEmail(email)) {
      return Response.json(
        { success: false, error: "メールアドレスの形式が正しくありません" },
        { status: 400 }
      );
    }

    // メールアドレスは本文などの自由記述と異なり、切り詰めると別のアドレスに
    // 化けてしまう(=検証済みの値と保存される値が食い違う)ため、上限超過は
    // 黙って切り詰めず拒否する。
    if (email.length > MAX_EMAIL_LENGTH) {
      return Response.json(
        { success: false, error: "メールアドレスが長すぎます" },
        { status: 400 }
      );
    }

    await env.DB.prepare(
      `
        INSERT INTO contacts (id, name, email, subject, message, created_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `
    )
      .bind(
        crypto.randomUUID(),
        name ? name.slice(0, MAX_NAME_LENGTH) : null,
        email,
        subject.slice(0, MAX_SUBJECT_LENGTH),
        message.slice(0, MAX_MESSAGE_LENGTH),
        new Date().toISOString()
      )
      .run();

    const responseBody: ContactResponse = { success: true };

    return Response.json(responseBody);
  }
);
