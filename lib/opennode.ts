import { timingSafeEqual } from "@/lib/timingSafeEqual";

const API_BASE = "https://api.opennode.com/v1";

export type CreateChargeResult =
  | { success: true; chargeId: string; hostedCheckoutUrl: string }
  | { success: false; error: string };

export async function createCharge(params: {
  amountUsd: number;
  orderId: string;
  description: string;
  callbackUrl: string;
  successUrl: string;
  apiKey: string;
}): Promise<CreateChargeResult> {
  let response: Response;

  try {
    response = await fetch(`${API_BASE}/charges`, {
      method: "POST",
      headers: {
        Authorization: params.apiKey,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: params.amountUsd,
        currency: "USD",
        order_id: params.orderId,
        description: params.description,
        callback_url: params.callbackUrl,
        success_url: params.successUrl,
      }),
    });
  } catch {
    return { success: false, error: "Failed to reach OpenNode" };
  }

  if (!response.ok) {
    return { success: false, error: `OpenNode returned HTTP ${response.status}` };
  }

  const body = (await response.json()) as {
    data?: { id?: string; hosted_checkout_url?: string };
  };

  if (!body.data?.id || !body.data.hosted_checkout_url) {
    return { success: false, error: "Unexpected OpenNode response" };
  }

  return {
    success: true,
    chargeId: body.data.id,
    hostedCheckoutUrl: body.data.hosted_checkout_url,
  };
}

async function hmacSha256Hex(key: string, message: string): Promise<string> {
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );

  const signature = await crypto.subtle.sign(
    "HMAC",
    cryptoKey,
    new TextEncoder().encode(message)
  );

  return Array.from(new Uint8Array(signature))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// OpenNodeはWebhookを検証用の別シークレットではなく、charge作成に使った
// APIキー自体をHMAC鍵として使う(hashed_order = HMAC-SHA256(apiKey, chargeId))。
export async function verifyOpenNodeSignature(
  chargeId: string,
  hashedOrder: string,
  apiKey: string
): Promise<boolean> {
  const expected = await hmacSha256Hex(apiKey, chargeId);

  return timingSafeEqual(
    new TextEncoder().encode(expected),
    new TextEncoder().encode(hashedOrder)
  );
}
