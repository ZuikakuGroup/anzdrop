import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  createTestEnv,
  clearAllTables,
  resetRateLimiters,
  stubTurnstileSuccess,
  type TestEnv,
} from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({ env }),
}));

beforeAll(async () => {
  const handle = await createTestEnv();
  env = handle.env;
  dispose = handle.dispose;
});

afterAll(async () => {
  await dispose();
});

beforeEach(async () => {
  await clearAllTables(env);
  resetRateLimiters(env);
});

async function startUpload(fileSize = 20 * 1024 * 1024) {
  stubTurnstileSuccess();
  const { POST } = await import("@/app/api/upload/start/route");
  const response = await POST(
    new Request("http://localhost/api/upload/start", {
      method: "POST",
      body: JSON.stringify({
        encryptedFileName: "file.enc",
        fileSize,
        retention: "7d",
        turnstileToken: "tok",
      }),
    })
  );
  return response.json() as Promise<{
    uploadSessionId: string;
    uploadToken: string;
  }>;
}

async function postPartAck(body: unknown) {
  const { POST } = await import("@/app/api/upload/part-ack/route");
  return POST(
    new Request("http://localhost/api/upload/part-ack", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/upload/part-ack", () => {
  it("stores etags for authorized parts and replaces on retry", async () => {
    const started = await startUpload();
    const first = await postPartAck({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: [
        { partNumber: 1, etag: "etag-1" },
        { partNumber: 2, etag: "etag-2" },
      ],
    });

    expect(first.status).toBe(200);
    expect(await first.json()).toMatchObject({ success: true, accepted: 2 });

    const retry = await postPartAck({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: [{ partNumber: 1, etag: "etag-1-retry" }],
    });
    expect(retry.status).toBe(200);

    const row = await env.DB.prepare(
      `SELECT etag FROM upload_parts WHERE upload_session_id = ? AND part_number = 1`
    )
      .bind(started.uploadSessionId)
      .first<{ etag: string }>();

    expect(row?.etag).toBe("etag-1-retry");
  });

  it("rejects a wrong upload token", async () => {
    const started = await startUpload();
    const response = await postPartAck({
      uploadSessionId: started.uploadSessionId,
      uploadToken: "wrong",
      parts: [{ partNumber: 1, etag: "etag" }],
    });

    expect(response.status).toBe(403);
  });

  it("rejects part numbers beyond the declared size ceiling", async () => {
    const started = await startUpload(1024);
    const response = await postPartAck({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: [{ partNumber: 2, etag: "etag" }],
    });

    expect(response.status).toBe(400);
  });
});
