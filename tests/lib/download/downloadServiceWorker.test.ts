import { readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

// public/download-sw.js は静的アセットとしてそのまま配信されるため import できない。
// ここでは実ファイルのソースを ServiceWorkerGlobalScope 相当のフェイクスコープで
// 評価し、fetch / message ハンドラの振る舞い(特に Content-Disposition の
// インジェクション防御と、対象外リクエストの素通し)を検証する。
const SW_SOURCE = readFileSync(
  path.resolve(__dirname, "../../../public/download-sw.js"),
  "utf-8"
);

const ORIGIN = "https://anzdrop.example";

type CapturedFetchEvent = {
  request: { url: string };
  respondWith: (response: Response | Promise<Response>) => void;
};

function createServiceWorker() {
  const listeners: Record<string, ((event: unknown) => void)[]> = {};

  const self = {
    addEventListener: (type: string, fn: (event: unknown) => void) => {
      (listeners[type] ??= []).push(fn);
    },
    skipWaiting: vi.fn(),
    clients: { claim: vi.fn() },
    location: { origin: ORIGIN },
  };

  new Function("self", SW_SOURCE)(self);

  const dispatch = (type: string, event: unknown) => {
    for (const fn of listeners[type] ?? []) {
      fn(event);
    }
  };

  return {
    async fetch(url: string): Promise<Response | null> {
      let captured: Response | Promise<Response> | null = null;
      const event: CapturedFetchEvent = {
        request: { url },
        respondWith: (response) => {
          captured = response;
        },
      };
      dispatch("fetch", event);
      return captured === null ? null : await captured;
    },
    message(data: unknown, port?: { postMessage: (data: unknown) => void }) {
      dispatch("message", { data, ports: port ? [port] : undefined });
    },
  };
}

function emptyStream(): ReadableStream<Uint8Array> {
  return new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new Uint8Array([1, 2, 3]));
      controller.close();
    },
  });
}

describe("download-sw.js", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  describe("fetch ハンドラ", () => {
    it("プレフィックス外のリクエストには respondWith を呼ばない(全 fetch に介入しない)", async () => {
      const sw = createServiceWorker();

      expect(await sw.fetch(`${ORIGIN}/`)).toBeNull();
      expect(await sw.fetch(`${ORIGIN}/api/file/abc`)).toBeNull();
      expect(await sw.fetch(`${ORIGIN}/mypage`)).toBeNull();
      // 別 origin の同名パスにも介入しない。
      expect(await sw.fetch(`https://evil.example/_anzdrop_download/x`)).toBeNull();
    });

    it("未登録の id には 404 を返す", async () => {
      const sw = createServiceWorker();
      const response = await sw.fetch(`${ORIGIN}/_anzdrop_download/unknown`);
      expect(response?.status).toBe(404);
    });

    it("登録済みの id にはストリームを attachment として返す", async () => {
      const sw = createServiceWorker();
      const port = { postMessage: vi.fn() };
      sw.message(
        {
          type: "ANZDROP_STREAM_DOWNLOAD",
          id: "abc123",
          readable: emptyStream(),
          filename: "report.bin",
          size: 3,
        },
        port
      );

      const response = await sw.fetch(`${ORIGIN}/_anzdrop_download/abc123`);
      expect(response?.status).toBe(200);
      expect(response?.headers.get("Content-Type")).toBe(
        "application/octet-stream"
      );
      expect(response?.headers.get("X-Content-Type-Options")).toBe("nosniff");
      expect(response?.headers.get("Content-Length")).toBe("3");
      expect(response?.headers.get("Content-Disposition")).toBe(
        "attachment; filename=\"report.bin\"; filename*=UTF-8''report.bin"
      );
      const body = new Uint8Array(await response!.arrayBuffer());
      expect(body).toEqual(new Uint8Array([1, 2, 3]));
    });

    it("同じ id は一度しか取り出せない(2回目は 404)", async () => {
      const sw = createServiceWorker();
      sw.message(
        {
          type: "ANZDROP_STREAM_DOWNLOAD",
          id: "once",
          readable: emptyStream(),
          filename: "a.bin",
          size: 3,
        },
        { postMessage: vi.fn() }
      );

      expect((await sw.fetch(`${ORIGIN}/_anzdrop_download/once`))?.status).toBe(
        200
      );
      expect((await sw.fetch(`${ORIGIN}/_anzdrop_download/once`))?.status).toBe(
        404
      );
    });

    it("size 未指定なら Content-Length を付けない", async () => {
      const sw = createServiceWorker();
      sw.message(
        {
          type: "ANZDROP_STREAM_DOWNLOAD",
          id: "nosize",
          readable: emptyStream(),
          filename: "a.bin",
          size: undefined,
        },
        { postMessage: vi.fn() }
      );

      const response = await sw.fetch(`${ORIGIN}/_anzdrop_download/nosize`);
      expect(response?.headers.has("Content-Length")).toBe(false);
    });

    it("ファイル名の CRLF・引用符・制御文字をヘッダへ通さない(ヘッダインジェクション防御)", async () => {
      const sw = createServiceWorker();
      const evil =
        'evil"\r\nSet-Cookie: pwned=1\r\n\r\n<script>.bin';
      sw.message(
        {
          type: "ANZDROP_STREAM_DOWNLOAD",
          id: "evil",
          readable: emptyStream(),
          filename: evil,
          size: 3,
        },
        { postMessage: vi.fn() }
      );

      const response = await sw.fetch(`${ORIGIN}/_anzdrop_download/evil`);
      expect(response).not.toBeNull();

      const cd = response!.headers.get("Content-Disposition")!;
      // 改行が一切含まれない。
      expect(cd).not.toMatch(/[\r\n]/);
      expect(response!.headers.get("Set-Cookie")).toBeNull();
      // ASCII フォールバックは " と CR/LF をそれぞれ _ 化した安全な形
      // (evil" + \r + \n → evil___)。
      expect(cd).toContain('filename="evil___Set-Cookie: pwned=1');
      expect(cd).not.toContain('"evil"\r');
      // RFC5987 側は percent-encode 済み(生の " や改行は出てこない)。
      expect(cd).toContain("filename*=UTF-8''");
      expect(cd).toContain("%22"); // 引用符
      expect(cd).toContain("%0D%0A"); // CRLF
    });

    it("非 ASCII ファイル名は RFC5987 で percent-encode し、ASCII フォールバックを持つ", async () => {
      const sw = createServiceWorker();
      sw.message(
        {
          type: "ANZDROP_STREAM_DOWNLOAD",
          id: "jp",
          readable: emptyStream(),
          filename: "機密資料.zip",
          size: 3,
        },
        { postMessage: vi.fn() }
      );

      const response = await sw.fetch(`${ORIGIN}/_anzdrop_download/jp`);
      const cd = response!.headers.get("Content-Disposition")!;
      expect(cd).not.toMatch(/[\r\n]/);
      // 非 ASCII は _ 化されるが、全部消えると "download" になる。
      expect(cd).toContain('filename="____.zip"');
      expect(cd).toContain(
        "filename*=UTF-8''" + encodeURIComponent("機密資料.zip")
      );
    });
  });

  describe("message ハンドラ", () => {
    it("ANZDROP_PING には pong を返す", () => {
      const sw = createServiceWorker();
      const port = { postMessage: vi.fn() };
      sw.message({ type: "ANZDROP_PING" }, port);
      expect(port.postMessage).toHaveBeenCalledWith({ pong: true });
    });

    it("ANZDROP_STREAM_DOWNLOAD はダウンロード URL を返す", () => {
      const sw = createServiceWorker();
      const port = { postMessage: vi.fn() };
      sw.message(
        {
          type: "ANZDROP_STREAM_DOWNLOAD",
          id: "abc",
          readable: emptyStream(),
          filename: "a.bin",
          size: 3,
        },
        port
      );
      expect(port.postMessage).toHaveBeenCalledWith({
        url: "/_anzdrop_download/abc",
      });
    });

    it("未知の type は無視する", () => {
      const sw = createServiceWorker();
      const port = { postMessage: vi.fn() };
      sw.message({ type: "SOMETHING_ELSE" }, port);
      sw.message(null, port);
      expect(port.postMessage).not.toHaveBeenCalled();
    });

    it("引き取られないストリームは TTL 経過で cancel し、done を通知する", () => {
      vi.useFakeTimers();
      const sw = createServiceWorker();
      const cancel = vi.fn(() => Promise.resolve());
      const port = { postMessage: vi.fn() };
      sw.message(
        {
          type: "ANZDROP_STREAM_DOWNLOAD",
          id: "abandoned",
          readable: { cancel } as unknown as ReadableStream<Uint8Array>,
          filename: "a.bin",
          size: 3,
        },
        port
      );
      port.postMessage.mockClear();

      vi.advanceTimersByTime(60_000);

      expect(cancel).toHaveBeenCalled();
      expect(port.postMessage).toHaveBeenCalledWith({ done: true });
    });
  });
});
