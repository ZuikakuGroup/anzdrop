import {
  afterAll,
  afterEach,
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
});

afterEach(() => {
  vi.unstubAllGlobals();
});

// 実際にapp/api/upload/startを叩き、本物のR2マルチパートアップロードIDを持つ
// アップロードセッションを用意する(R2のマルチパートIDは手書きモックでは
// 現実的に再現できないため)。
async function startUpload(): Promise<{
  uploadSessionId: string;
  shareId: string;
}> {
  stubTurnstileSuccess();
  const { POST } = await import("@/app/api/upload/start/route");
  const response = await POST(
    new Request("http://localhost/api/upload/start", {
      method: "POST",
      body: JSON.stringify({
        encryptedFileName: "file.enc",
        fileSize: 2048,
        retention: "7d",
        turnstileToken: "tok",
      }),
    })
  );

  return response.json();
}

async function postChunk(headers: Record<string, string>, body?: BodyInit) {
  const { POST } = await import("@/app/api/upload/chunk/route");

  return POST(
    new Request("http://localhost/api/upload/chunk", {
      method: "POST",
      headers,
      body,
    })
  );
}

describe("POST /api/upload/chunk", () => {
  it("returns 400 when required headers are missing", async () => {
    const response = await postChunk({}, new Uint8Array([1, 2, 3]));

    expect(response.status).toBe(400);
  });

  it.each([["0"], ["-1"], ["abc"], ["1.5"]])(
    "returns 400 for an invalid part number (%s)",
    async (partNumber) => {
      const response = await postChunk(
        {
          "Anzdrop-Upload-Session": "some-session",
          "Anzdrop-Part-Number": partNumber,
        },
        new Uint8Array([1, 2, 3])
      );

      expect(response.status).toBe(400);
    }
  );

  it("returns 400 for an empty body", async () => {
    const { uploadSessionId } = await startUpload();

    const response = await postChunk(
      {
        "Anzdrop-Upload-Session": uploadSessionId,
        "Anzdrop-Part-Number": "1",
      },
      new Uint8Array(0)
    );

    expect(response.status).toBe(400);
  });

  it("returns 404 for an unknown upload session", async () => {
    const response = await postChunk(
      {
        "Anzdrop-Upload-Session": "no-such-session",
        "Anzdrop-Part-Number": "1",
      },
      new Uint8Array([1, 2, 3])
    );

    expect(response.status).toBe(404);
  });

  it("stores the uploaded part with its part number and etag", async () => {
    const { uploadSessionId } = await startUpload();

    const response = await postChunk(
      {
        "Anzdrop-Upload-Session": uploadSessionId,
        "Anzdrop-Part-Number": "1",
      },
      new Uint8Array([1, 2, 3, 4])
    );

    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body).toEqual({ success: true, partNumber: 1 });

    const row = await env.DB.prepare(
      `SELECT part_number, etag FROM upload_parts WHERE upload_session_id = ? AND part_number = ?`
    )
      .bind(uploadSessionId, 1)
      .first<{ part_number: number; etag: string }>();

    expect(row?.part_number).toBe(1);
    expect(typeof row?.etag).toBe("string");
    expect(row?.etag.length).toBeGreaterThan(0);
  });

  it("replaces rather than duplicates the row when the same part number is uploaded twice", async () => {
    const { uploadSessionId } = await startUpload();

    await postChunk(
      {
        "Anzdrop-Upload-Session": uploadSessionId,
        "Anzdrop-Part-Number": "1",
      },
      new Uint8Array([1, 2, 3])
    );
    const first = await env.DB.prepare(
      `SELECT etag FROM upload_parts WHERE upload_session_id = ? AND part_number = 1`
    )
      .bind(uploadSessionId)
      .first<{ etag: string }>();

    const second = await postChunk(
      {
        "Anzdrop-Upload-Session": uploadSessionId,
        "Anzdrop-Part-Number": "1",
      },
      new Uint8Array([9, 9, 9, 9, 9])
    );
    expect(second.status).toBe(200);

    const { results: rows } = await env.DB.prepare(
      `SELECT etag FROM upload_parts WHERE upload_session_id = ? AND part_number = 1`
    )
      .bind(uploadSessionId)
      .all<{ etag: string }>();

    expect(rows).toHaveLength(1);
    expect(rows[0].etag).not.toBe(first?.etag);

    const countAll = await env.DB.prepare(
      `SELECT COUNT(*) as count FROM upload_parts WHERE upload_session_id = ?`
    )
      .bind(uploadSessionId)
      .first<{ count: number }>();
    expect(countAll?.count).toBe(1);
  });
});
