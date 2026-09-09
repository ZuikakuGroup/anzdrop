import { getCloudflareContext } from "@opennextjs/cloudflare";

const TARGET_APIS = new Set(["blog-posts", "blog-categories", "blog-tags", "blog-authors"]);
const encoder = new TextEncoder();
const workerSubtleCrypto = crypto.subtle as SubtleCrypto & {
  timingSafeEqual(left: ArrayBuffer | ArrayBufferView, right: ArrayBuffer | ArrayBufferView): boolean;
};
function constantTimeEqual(left: Uint8Array, right: Uint8Array): boolean { return left.length === right.length && workerSubtleCrypto.timingSafeEqual(left, right); }
async function signature(body: string, secret: string): Promise<Uint8Array> { const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]); return new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(body))); }
function hexToBytes(value: string): Uint8Array | null { if (!/^[0-9a-f]{64}$/i.test(value)) return null; return Uint8Array.from(value.match(/.{2}/g)!.map(byte => Number.parseInt(byte, 16))); }

export async function POST(request: Request): Promise<Response> { const { env: baseEnv } = getCloudflareContext(); const env = baseEnv as CloudflareEnv & { MICROCMS_WEBHOOK_SECRET?: string }; const body = await request.text(); const received = hexToBytes(request.headers.get("x-microcms-signature") ?? ""); if (!env.MICROCMS_WEBHOOK_SECRET || !received || !constantTimeEqual(await signature(body, env.MICROCMS_WEBHOOK_SECRET), received)) return Response.json({ error: "Unauthorized" }, { status: 401 }); let payload: unknown; try { payload = JSON.parse(body); } catch { return Response.json({ error: "Invalid JSON" }, { status: 400 }); } if (!payload || typeof payload !== "object" || !("api" in payload) || typeof payload.api !== "string" || !TARGET_APIS.has(payload.api)) return Response.json({ error: "Unknown API" }, { status: 400 }); return Response.json({ accepted: true }); }
