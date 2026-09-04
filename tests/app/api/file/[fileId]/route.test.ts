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
  resetRateLimiters,
  type TestEnv,
} from "@/test/env";

let env: TestEnv;
let dispose: () => Promise<void>;

// このルートはgetCloudflareContext()から{ env, ctx }の両方を取り出す
// (他のルートは{ env }のみ)。ctx.waitUntilに渡されたPromiseを配列に集め、
// テスト側でawaitすることで、裏で実行される一度限りファイルの削除処理を
// 確定的に待ち合わせられるようにする。
let waitUntilPromises: Promise<unknown>[];

// 特定のテストだけルートに渡す env を差し替えたいとき(R2 body の制御など)に使う。
let routeEnvOverride: TestEnv | null = null;

vi.mock("@opennextjs/cloudflare", () => ({
  getCloudflareContext: () => ({
    env: routeEnvOverride ?? env,
    ctx: {
      waitUntil: (promise: Promise<unknown>) => {
        waitUntilPromises.push(promise);
      },
    },
  }),
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
  waitUntilPromises = [];
  routeEnvOverride = null;
});

afterEach(() => {
  vi.restoreAllMocks();
});

async function flushWaitUntil(): Promise<void> {
  await Promise.all(waitUntilPromises);
}

// レスポンス本体を最後まで読み切る(= クライアントが正常に受信しきった状態)。
async function readBody(response: Response): Promise<Uint8Array> {
  if (!response.body) {
    return new Uint8Array();
  }
  return new Uint8Array(await response.arrayBuffer());
}

// FILES_BUCKET.get が返すオブジェクトの body を、テスト側で制御できる
// 「1チャンク出したあと gate が解けるまで待つ」ストリームに差し替えた env。
// 大容量ファイルのダウンロードが途中で中断されるケースを決定的に再現する。
function envWithGatedObjectBody(
  storageKey: string,
  firstChunk: Uint8Array,
  totalSize: number
): { env: TestEnv; openGate: () => void; cancelled: () => boolean } {
  let cancelled = false;
  let releaseGate: () => void = () => {};
  const gate = new Promise<void>((resolve) => {
    releaseGate = resolve;
  });

  const body = new ReadableStream<Uint8Array>({
    async start(controller) {
      controller.enqueue(firstChunk);
      await gate;
      controller.close();
    },
    cancel() {
      cancelled = true;
      releaseGate();
    },
  });

  const realGet = env.FILES_BUCKET.get.bind(env.FILES_BUCKET);
  const bucket = new Proxy(env.FILES_BUCKET, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return async (key: string) => {
          if (key !== storageKey) {
            return realGet(key);
          }
          return { body, size: totalSize };
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    env: { ...(env as object), FILES_BUCKET: bucket } as TestEnv,
    openGate: releaseGate,
    cancelled: () => cancelled,
  };
}

// 指定した storageKey に対する FILES_BUCKET.get を reject させる env
// (他のキーは素通し)。R2 の一時障害を決定的に再現する。呼び出し回数は
// getCallCount() で確認できる。
function envWithRejectingGet(
  storageKey: string,
  error: Error
): { env: TestEnv; getCallCount: () => number } {
  let calls = 0;
  const realGet = env.FILES_BUCKET.get.bind(env.FILES_BUCKET);
  const bucket = new Proxy(env.FILES_BUCKET, {
    get(target, prop, receiver) {
      if (prop === "get") {
        return async (key: string) => {
          if (key !== storageKey) {
            return realGet(key);
          }
          calls += 1;
          throw error;
        };
      }
      const value = Reflect.get(target, prop, receiver);
      return typeof value === "function" ? value.bind(target) : value;
    },
  });

  return {
    env: { ...(env as object), FILES_BUCKET: bucket } as TestEnv,
    getCallCount: () => calls,
  };
}

async function downloadCountOf(fileId: string): Promise<number | null> {
  const row = await env.DB.prepare(
    `SELECT download_count FROM files WHERE id = ?`
  )
    .bind(fileId)
    .first<{ download_count: number }>();
  return row ? row.download_count : null;
}

type ShareOverrides = {
  id?: string;
  expiresAt?: string;
  suspendedAt?: string | null;
};

async function insertShare(overrides: ShareOverrides = {}): Promise<string> {
  const id = overrides.id ?? crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO shares (id, created_at, expires_at, suspended_at)
      VALUES (?, ?, ?, ?)
    `
  )
    .bind(
      id,
      new Date().toISOString(),
      overrides.expiresAt ??
        new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      overrides.suspendedAt ?? null
    )
    .run();

  return id;
}

type FileOverrides = {
  id?: string;
  shareId?: string;
  storageKey?: string;
  encryptedFileName?: string;
  size?: number;
  maxDownloads?: number | null;
  downloadCount?: number;
};

async function insertFile(overrides: FileOverrides = {}): Promise<{
  id: string;
  storageKey: string;
}> {
  const id = overrides.id ?? crypto.randomUUID();
  const storageKey = overrides.storageKey ?? crypto.randomUUID();

  await env.DB.prepare(
    `
      INSERT INTO files (
        id, share_id, storage_key, encrypted_file_name, size, max_downloads, download_count, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `
  )
    .bind(
      id,
      overrides.shareId ?? "no-such-share",
      storageKey,
      overrides.encryptedFileName ?? "secret.enc",
      overrides.size ?? 1024,
      overrides.maxDownloads ?? null,
      overrides.downloadCount ?? 0,
      new Date().toISOString()
    )
    .run();

  return { id, storageKey };
}

async function getFile(fileId: string) {
  const { GET } = await import("@/app/api/file/[fileId]/route");

  return GET(new Request(`http://localhost/api/file/${fileId}`), {
    params: Promise.resolve({ fileId }),
  });
}

describe("GET /api/file/[fileId]", () => {
  it("returns 404 for an unknown fileId", async () => {
    const response = await getFile("no-such-file");

    expect(response.status).toBe(404);
  });

  // 「filesは存在するがshareが存在しない」ケース(ルート側に防御的な404分岐が
  // ある)は、このテスト環境では意図的に再現しない: filesはshares(id)への
  // 外部キー制約(ON DELETE CASCADE)を持ち、D1(Miniflareのエミュレーション含む)は
  // PRAGMA foreign_keys=OFFを単発でもバッチ内でも無視してFK制約を常に強制する
  // ため、親のないfile行をDB操作で作ること自体ができない。よってこの分岐は
  // 実運用のD1でも到達不能と考えられ、テスト対象から除外する。

  it("returns 410 for an expired share", async () => {
    const shareId = await insertShare({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { id: fileId } = await insertFile({ shareId });

    const response = await getFile(fileId);

    expect(response.status).toBe(410);
  });

  it("returns 403 for a suspended share", async () => {
    const shareId = await insertShare({
      suspendedAt: new Date().toISOString(),
    });
    const { id: fileId } = await insertFile({ shareId });

    const response = await getFile(fileId);

    expect(response.status).toBe(403);
  });

  it("serves the correct bytes and Content-Disposition header", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("hello anzdrop");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      encryptedFileName: "aGVsbG8-d29ybGQ_.enc",
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFile(fileId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="aGVsbG8-d29ybGQ_.enc"`
    );
    // Content-Length は本体のバイト長と一致し、クライアント側の途中切断検知に使える。
    expect(response.headers.get("Content-Length")).toBe(
      String(content.byteLength)
    );
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content);
  });

  it("sanitizes an unexpected encrypted_file_name so the response still builds", async () => {
    // encrypted_file_name は本来 base64url だが、スキーマ検証追加前の行や
    // 破損データに制御文字・改行・" が混ざっても、Content-Disposition ヘッダの
    // 構築が失敗して 500(= 恒久的にダウンロード不能)にならないことを確認する。
    const shareId = await insertShare();
    const content = new TextEncoder().encode("hello anzdrop");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      encryptedFileName: 'evil"\r\nX-Injected: 1\n name',
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFile(fileId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="evilX-Injected1name"`
    );
    expect(response.headers.has("X-Injected")).toBe(false);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content);
  });

  it("limits a sanitized encrypted_file_name to 4096 characters", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("hello anzdrop");
    const safeName = "a".repeat(4096);
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      encryptedFileName: `${safeName}\r\ntruncated`,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFile(fileId);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toBe(
      `attachment; filename="${safeName}"`
    );
  });

  it("allows exactly max_downloads fully-received downloads, then deletes the file on the final one and rejects further attempts", async () => {
    // ルートは「上限に達した最後の1回」を"最後まで受信"した時点でファイルを
    // 削除するため、maxDownloadsの値に関わらず(1回限りでなくても)最終回の
    // ダウンロード完走後にR2/D1から消える。
    const shareId = await insertShare();
    const content = new TextEncoder().encode("limited content");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 3,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const first = await getFile(fileId);
    expect(first.status).toBe(200);
    expect(await readBody(first)).toEqual(content);
    await flushWaitUntil();
    expect(await downloadCountOf(fileId)).toBe(1);
    expect(await env.FILES_BUCKET.get(storageKey)).not.toBeNull();

    const second = await getFile(fileId);
    expect(second.status).toBe(200);
    expect(await readBody(second)).toEqual(content);
    await flushWaitUntil();
    expect(await downloadCountOf(fileId)).toBe(2);
    expect(await env.FILES_BUCKET.get(storageKey)).not.toBeNull();

    const third = await getFile(fileId);
    expect(third.status).toBe(200);
    expect(await readBody(third)).toEqual(content);
    await flushWaitUntil();

    // 3回目(上限)を完走したので、DB行・R2オブジェクトとも削除されている。
    expect(await downloadCountOf(fileId)).toBeNull();
    expect(await env.FILES_BUCKET.get(storageKey)).toBeNull();

    const fourth = await getFile(fileId);
    expect(fourth.status).toBe(404);
  });

  it("deletes a one-time file (max_downloads=1) from R2 and D1 after it is fully received once", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("one time secret");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 1,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFile(fileId);
    expect(response.status).toBe(200);
    expect(await readBody(response)).toEqual(content);

    await flushWaitUntil();

    expect(await env.FILES_BUCKET.get(storageKey)).toBeNull();
    expect(await downloadCountOf(fileId)).toBeNull();

    const again = await getFile(fileId);
    expect(again.status).toBe(404);
  });

  it("does not delete a one-time file if the download is interrupted, and lets it be re-fetched", async () => {
    const shareId = await insertShare();
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 1,
      size: 5_000_000,
    });
    // R2 に実体は不要(body は gated stream で差し替えるため)だが、
    // ルートの object 取得が null にならないよう一応入れておく。
    await env.FILES_BUCKET.put(storageKey, new Uint8Array([0]));

    const gated = envWithGatedObjectBody(
      storageKey,
      new Uint8Array(64).fill(7),
      5_000_000
    );
    routeEnvOverride = gated.env;

    const response = await getFile(fileId);
    expect(response.status).toBe(200);
    // 原子的加算は先に行われている。
    expect(await downloadCountOf(fileId)).toBe(1);

    // 先頭だけ受け取って、残りを受け取らずに切断する。
    const reader = response.body!.getReader();
    await reader.read();
    await reader.cancel();

    await flushWaitUntil();
    routeEnvOverride = null;

    // ファイルは消えておらず、消費した回数も戻っている。
    expect(gated.cancelled()).toBe(true);
    expect(await downloadCountOf(fileId)).toBe(0);
    expect(await env.FILES_BUCKET.get(storageKey)).not.toBeNull();

    // もう一度取得でき、今度は完走できる。
    const retry = await getFile(fileId);
    expect(retry.status).toBe(200);
    expect((await readBody(retry)).byteLength).toBe(1);
    await flushWaitUntil();

    // 完走したので今度こそ削除される。
    expect(await downloadCountOf(fileId)).toBeNull();
    expect(await env.FILES_BUCKET.get(storageKey)).toBeNull();
  });

  it("R2 オブジェクトが取得できず 404 のとき、回数を数えるファイルは加算を戻す", async () => {
    const shareId = await insertShare();
    const { id: fileId } = await insertFile({
      shareId,
      maxDownloads: 1,
      // R2 に put しない → FILES_BUCKET.get が null を返す。
    });

    const response = await getFile(fileId);
    expect(response.status).toBe(404);

    await flushWaitUntil();

    // 加算は戻っており、再取得できる状態(まだ 404 だが download_count は 0)。
    expect(await downloadCountOf(fileId)).toBe(0);
  });

  it("FILES_BUCKET.get 自体が reject したときも、回数を数えるファイルは加算を戻す", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("one time secret");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 1,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    // R2 の一時障害を模して get を reject させる。
    const rejecting = envWithRejectingGet(
      storageKey,
      new Error("R2 unavailable")
    );
    routeEnvOverride = rejecting.env;

    // withApiHandler の共通エラー処理により 500。
    const response = await getFile(fileId);
    expect(response.status).toBe(500);

    await flushWaitUntil();
    routeEnvOverride = null;

    // 加算は戻っており、障害復旧後に再取得できる。
    expect(rejecting.getCallCount()).toBe(1);
    expect(await downloadCountOf(fileId)).toBe(0);

    const retry = await getFile(fileId);
    expect(retry.status).toBe(200);
    expect(await readBody(retry)).toEqual(content);
    await flushWaitUntil();
    expect(await downloadCountOf(fileId)).toBeNull();
  });

  it("全バイト届いた直後に接続が切れた場合は、pipeTo が reject でも完走扱いで削除する", async () => {
    const shareId = await insertShare();
    const fullContent = new Uint8Array(128).fill(9);
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 1,
      size: fullContent.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array([0]));

    // 全バイトを1チャンクで出したあと、close する前に gate で待たせる。
    const gated = envWithGatedObjectBody(
      storageKey,
      fullContent,
      fullContent.byteLength
    );
    routeEnvOverride = gated.env;

    const response = await getFile(fileId);
    const reader = response.body!.getReader();
    // 全バイトを受け取る。
    const received = await reader.read();
    expect(received.value?.byteLength).toBe(fullContent.byteLength);
    // まだ close していない状態で接続を切る(pipeTo は reject する)。
    await reader.cancel();

    await flushWaitUntil();
    routeEnvOverride = null;

    // 全バイト届いていたので、回数は戻さず削除される。
    expect(await downloadCountOf(fileId)).toBeNull();
    expect(await env.FILES_BUCKET.get(storageKey)).toBeNull();
  });

  it("rejects a concurrent second download of a one-time file while the first is still streaming", async () => {
    const shareId = await insertShare();
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 1,
      size: 1_000_000,
    });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array([0]));

    const gated = envWithGatedObjectBody(
      storageKey,
      new Uint8Array(16).fill(3),
      1_000_000
    );
    routeEnvOverride = gated.env;

    const first = await getFile(fileId);
    expect(first.status).toBe(200);

    // 1回目がまだ流れている間に来た2回目は 404(原子的加算で弾かれる)。
    const second = await getFile(fileId);
    expect(second.status).toBe(404);

    // 後片付け: 1回目を完走させる。
    gated.openGate();
    await readBody(first);
    await flushWaitUntil();
    routeEnvOverride = null;
  });
});

async function getFileWithRange(
  fileId: string,
  range: string
): Promise<Response> {
  const { GET } = await import("@/app/api/file/[fileId]/route");

  return GET(
    new Request(`http://localhost/api/file/${fileId}`, {
      headers: { Range: range },
    }),
    { params: Promise.resolve({ fileId }) }
  );
}

describe("GET /api/file/[fileId] (Range / 並列ダウンロード)", () => {
  it("returns a 206 partial slice with Content-Range for a range request on a non-counted file", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode(
      "0123456789abcdefghijklmnopqrstuvwxyz"
    );
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFileWithRange(fileId, "bytes=5-14");

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes 5-14/${content.byteLength}`
    );
    expect(response.headers.get("Content-Length")).toBe("10");
    expect(response.headers.get("Accept-Ranges")).toBe("bytes");
    expect(response.headers.get("Content-Type")).toBe(
      "application/octet-stream"
    );

    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content.slice(5, 15));
  });

  it("reassembles to the exact original bytes across several sequential range requests", async () => {
    const shareId = await insertShare();
    const content = new Uint8Array(1000).map((_, i) => i % 251);
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const windows: number[][] = [
      [0, 399],
      [400, 799],
      [800, 1099], // 末尾はオブジェクト長を超える指定でもクランプされる
    ];

    const collected: number[] = [];
    for (const [start, end] of windows) {
      const response = await getFileWithRange(fileId, `bytes=${start}-${end}`);
      expect(response.status).toBe(206);

      // 実際に返るのはオブジェクト末尾までにクランプされた分だけ。
      // Content-Length / Content-Range は必ず本体の長さと一致していること。
      const body = new Uint8Array(await response.arrayBuffer());
      const servedEnd = Math.min(end, content.byteLength - 1);

      expect(body.byteLength).toBe(servedEnd - start + 1);
      expect(response.headers.get("Content-Length")).toBe(
        String(body.byteLength)
      );
      expect(response.headers.get("Content-Range")).toBe(
        `bytes ${start}-${servedEnd}/${content.byteLength}`
      );

      collected.push(...body);
    }

    expect(new Uint8Array(collected)).toEqual(content);
  });

  it("clamps a range whose end is past the object and reports the served length", async () => {
    const shareId = await insertShare();
    const content = new Uint8Array(1000).map((_, i) => i % 251);
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFileWithRange(fileId, "bytes=800-1099");

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe("bytes 800-999/1000");
    expect(response.headers.get("Content-Length")).toBe("200");

    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content.slice(800));
  });

  it("serves a suffix range with headers matching the body", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("0123456789abcdefghij");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFileWithRange(fileId, "bytes=-8");

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes 12-19/${content.byteLength}`
    );
    expect(response.headers.get("Content-Length")).toBe("8");

    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content.slice(-8));
  });

  it("clamps a suffix range larger than the object to the whole object", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("short");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFileWithRange(fileId, "bytes=-1000");

    expect(response.status).toBe(206);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes 0-${content.byteLength - 1}/${content.byteLength}`
    );
    expect(response.headers.get("Content-Length")).toBe(
      String(content.byteLength)
    );
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(content);
  });

  it("returns 416 (not 500) for a range starting past the end of the object", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("tiny file");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFileWithRange(fileId, "bytes=1000000000-");

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes */${content.byteLength}`
    );
  });

  it("returns 416 for a range with an explicit end that also starts past the object", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("tiny file");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFileWithRange(fileId, "bytes=500-600");

    expect(response.status).toBe(416);
    expect(response.headers.get("Content-Range")).toBe(
      `bytes */${content.byteLength}`
    );
  });

  it("does not increment download_count for range requests on a non-counted file", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("no counting for plain files");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
      downloadCount: 0,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    for (let i = 0; i < 5; i++) {
      const response = await getFileWithRange(fileId, `bytes=0-3`);
      expect(response.status).toBe(206);
      await response.arrayBuffer();
    }

    expect(await downloadCountOf(fileId)).toBe(0);
  });

  it("ignores the Range header for a counted file and serves the full body with one counted download", async () => {
    const shareId = await insertShare();
    const content = new TextEncoder().encode("counted file body");
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      size: content.byteLength,
      maxDownloads: 3,
      downloadCount: 0,
    });
    await env.FILES_BUCKET.put(storageKey, content);

    const response = await getFileWithRange(fileId, "bytes=0-3");

    // 回数制限ファイルは Range を無視して全体を返す(単一 GET 経路)。
    expect(response.status).toBe(200);
    const body = new Uint8Array(await response.arrayBuffer());
    expect(body).toEqual(content);
    await flushWaitUntil();

    expect(await downloadCountOf(fileId)).toBe(1);
  });

  it("still enforces expiry/suspension for range requests", async () => {
    const shareId = await insertShare({
      expiresAt: new Date(Date.now() - 1000).toISOString(),
    });
    const { id: fileId, storageKey } = await insertFile({ shareId });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array(64));

    const response = await getFileWithRange(fileId, "bytes=0-3");

    expect(response.status).toBe(410);
  });
});

describe("GET /api/file/[fileId] (レート制限 / GitHub issue #81)", () => {
  it("fileId をキーに FILE_RATE_LIMITER を1リクエストにつき1回だけ消費する", async () => {
    const shareId = await insertShare();
    const { id: fileId, storageKey } = await insertFile({ shareId });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array(64));

    await getFile(fileId);

    expect(env.FILE_RATE_LIMITER.keys).toEqual([fileId]);
    // 共有メタデータ用の枠は消費しない(別バインディング)。
    expect(env.SHARE_RATE_LIMITER.keys).toEqual([]);
  });

  it("Range リクエスト(並列ダウンロードの1本)もリクエストごとに1回だけ消費する", async () => {
    const shareId = await insertShare();
    const { id: fileId, storageKey } = await insertFile({ shareId });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array(64));

    await getFileWithRange(fileId, "bytes=0-15");
    await getFileWithRange(fileId, "bytes=16-31");

    expect(env.FILE_RATE_LIMITER.keys).toEqual([fileId, fileId]);
  });

  it("枠を超えたら429を返し、ダウンロード回数も加算しない", async () => {
    const shareId = await insertShare();
    const { id: fileId, storageKey } = await insertFile({
      shareId,
      maxDownloads: 1,
    });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array(64));

    env.FILE_RATE_LIMITER.denyKeyFrom(fileId, 1);

    const response = await getFile(fileId);

    expect(response.status).toBe(429);
    expect(response.headers.get("Retry-After")).toBe("60");
    // 429 で弾いた分は「消費されたダウンロード」にしない。
    expect(await downloadCountOf(fileId)).toBe(0);
  });

  it("枠を超えたリクエストは R2 にも D1 にも触らない(コストを発生させない)", async () => {
    const shareId = await insertShare();
    const { id: fileId, storageKey } = await insertFile({ shareId });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array(64));

    const bucketGet = vi.spyOn(env.FILES_BUCKET, "get");
    const dbPrepare = vi.spyOn(env.DB, "prepare");

    env.FILE_RATE_LIMITER.denyKeyFrom(fileId, 1);
    const response = await getFile(fileId);

    expect(response.status).toBe(429);
    expect(bucketGet).not.toHaveBeenCalled();
    expect(dbPrepare).not.toHaveBeenCalled();
  });

  it("バインディングが落ちていてもダウンロードは止めない(フェイルオープン)", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const shareId = await insertShare();
    const { id: fileId, storageKey } = await insertFile({ shareId });
    await env.FILES_BUCKET.put(storageKey, new Uint8Array([1, 2, 3, 4]));

    env.FILE_RATE_LIMITER.failNext();

    const response = await getFile(fileId);

    expect(response.status).toBe(200);
    expect(await readBody(response)).toEqual(new Uint8Array([1, 2, 3, 4]));
    consoleError.mockRestore();
  });
});
