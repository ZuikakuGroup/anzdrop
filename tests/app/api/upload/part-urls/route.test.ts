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
import { UPLOAD_PART_SIZE } from "@/lib/upload/partSize";
import { MAX_PART_URLS_PER_REQUEST } from "@/lib/upload/uploadSessionAuth";

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
  delete (env as { R2_ACCESS_KEY_ID?: string }).R2_ACCESS_KEY_ID;
  delete (env as { R2_SECRET_ACCESS_KEY?: string }).R2_SECRET_ACCESS_KEY;
  delete (env as { CLOUDFLARE_ACCOUNT_ID?: string }).CLOUDFLARE_ACCOUNT_ID;
});

function enableDirectSecrets() {
  Object.assign(env, {
    R2_ACCESS_KEY_ID: "AKIAEXAMPLE",
    R2_SECRET_ACCESS_KEY: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
    CLOUDFLARE_ACCOUNT_ID: "abc123account",
  });
}

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
    uploadMode: "direct" | "proxy";
  }>;
}

async function postPartUrls(body: unknown) {
  const { POST } = await import("@/app/api/upload/part-urls/route");
  return POST(
    new Request("http://localhost/api/upload/part-urls", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    })
  );
}

describe("POST /api/upload/part-urls", () => {
  it("returns 503 when direct-upload secrets are missing", async () => {
    const started = await startUpload();
    expect(started.uploadMode).toBe("proxy");
    const response = await postPartUrls({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: [{ partNumber: 1, contentLength: 1024 }],
    });

    expect(response.status).toBe(503);
  });

  it("returns signed URLs for authorized parts and includes content-length in the signature", async () => {
    enableDirectSecrets();
    const started = await startUpload();
    expect(started.uploadMode).toBe("direct");
    const response = await postPartUrls({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: [
        { partNumber: 1, contentLength: UPLOAD_PART_SIZE },
        { partNumber: 2, contentLength: 1234 },
      ],
    });

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.success).toBe(true);
    expect(body.urls).toHaveLength(2);
    expect(body.urls[0].partNumber).toBe(1);
    expect(body.urls[0].url).toContain("partNumber=1");
    expect(body.urls[0].url).toContain("X-Amz-Signature=");
    expect(body.urls[0].url).toMatch(/[Xx]-[Aa]mz-[Ss]igned[Hh]eaders=[^&]*content-length/);
  });

  it("rejects a wrong upload token", async () => {
    enableDirectSecrets();
    const started = await startUpload();
    const response = await postPartUrls({
      uploadSessionId: started.uploadSessionId,
      uploadToken: "wrong-token",
      parts: [{ partNumber: 1, contentLength: 1024 }],
    });

    expect(response.status).toBe(403);
  });

  it("rejects part numbers beyond the declared size ceiling", async () => {
    enableDirectSecrets();
    const started = await startUpload(1024);
    const response = await postPartUrls({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: [{ partNumber: 2, contentLength: 1024 }],
    });

    expect(response.status).toBe(400);
  });

  it("rejects contentLength above UPLOAD_PART_SIZE", async () => {
    enableDirectSecrets();
    const started = await startUpload();
    const response = await postPartUrls({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: [{ partNumber: 1, contentLength: UPLOAD_PART_SIZE + 1 }],
    });

    expect(response.status).toBe(400);
  });

  it("rejects batches larger than the max", async () => {
    enableDirectSecrets();
    const started = await startUpload(1024 * 1024 * 1024);
    const response = await postPartUrls({
      uploadSessionId: started.uploadSessionId,
      uploadToken: started.uploadToken,
      parts: Array.from(
        { length: MAX_PART_URLS_PER_REQUEST + 1 },
        (_, index) => ({
          partNumber: index + 1,
          contentLength: 1024,
        })
      ),
    });

    expect(response.status).toBe(400);
  });
});
