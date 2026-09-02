// ダウンロード用 Service Worker(GitHub issue #61)。
//
// showSaveFilePicker(File System Access API)が使えないブラウザ(Firefox /
// Safari)では、大容量ファイルの復号済み平文を Blob に集めてから保存するしか
// なく、5GB クラスのファイルでタブが落ちていた。この Service Worker は、
// ページ側で復号したバイト列の ReadableStream を受け取り、
// `Content-Disposition: attachment` を付けた Response として返すことで、
// ブラウザにストリーミングダウンロードさせる(StreamSaver.js 相当の手法)。
//
// ページ側は隠し iframe を `/_anzdrop_download/<id>` へ遷移させ、その fetch を
// ここで横取りして、事前に受け取っておいた ReadableStream を本文にする。
// レスポンスの読み出しが終わったら、渡された MessagePort 経由でページへ
// `{ done: true }` を返す(ページはこれを合図に隠し iframe を撤去する)。

const DOWNLOAD_PREFIX = "/_anzdrop_download/";

// id -> { readable, filename, size, port }
const pendingDownloads = new Map();

// 受け取ったストリームが引き取られないまま残り続けないよう、一定時間で破棄する。
const PENDING_TTL_MS = 60_000;

self.addEventListener("install", () => {
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener("message", (event) => {
  const data = event.data;

  if (!data || data.type !== "ANZDROP_STREAM_DOWNLOAD") {
    return;
  }

  const { id, readable, filename, size } = data;
  const port = event.ports && event.ports[0];

  pendingDownloads.set(id, { readable, filename, size, port });

  setTimeout(() => {
    const entry = pendingDownloads.get(id);
    if (entry) {
      pendingDownloads.delete(id);
      // 引き取られなかったストリームは読み捨てて解放する。
      entry.readable.cancel().catch(() => {});
      try {
        if (entry.port) entry.port.postMessage({ done: true });
      } catch {
        // port が既に閉じられていても無視。
      }
    }
  }, PENDING_TTL_MS);

  if (port) {
    port.postMessage({ url: DOWNLOAD_PREFIX + id });
  }
});

// RFC 5987 (filename*=) 用のエンコード。encodeURIComponent が残す
// ' ( ) * も percent-encode する。
function encodeRfc5987(value) {
  return encodeURIComponent(value).replace(
    /['()*]/g,
    (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()
  );
}

// 非ASCII・制御文字・" \ を除いた ASCII フォールバック名。
function asciiFallbackName(value) {
  const cleaned = value.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  return cleaned || "download";
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);

  if (
    url.origin !== self.location.origin ||
    !url.pathname.startsWith(DOWNLOAD_PREFIX)
  ) {
    return;
  }

  const id = url.pathname.slice(DOWNLOAD_PREFIX.length);
  const entry = pendingDownloads.get(id);

  if (!entry) {
    event.respondWith(new Response("Not found", { status: 404 }));
    return;
  }

  pendingDownloads.delete(id);

  const headers = new Headers({
    "Content-Type": "application/octet-stream",
    "Content-Disposition":
      'attachment; filename="' +
      asciiFallbackName(entry.filename) +
      "\"; filename*=UTF-8''" +
      encodeRfc5987(entry.filename),
    "Cache-Control": "no-store",
  });

  if (typeof entry.size === "number" && entry.size >= 0) {
    headers.set("Content-Length", String(entry.size));
  }

  const notifyDone = () => {
    try {
      if (entry.port) entry.port.postMessage({ done: true });
    } catch {
      // 無視。
    }
  };

  // レスポンス本体の読み出しが完了/中断したらページへ通知する。
  const monitored = entry.readable.pipeThrough(
    new TransformStream({
      transform(chunk, controller) {
        controller.enqueue(chunk);
      },
      flush() {
        notifyDone();
      },
      cancel() {
        notifyDone();
      },
    })
  );

  event.respondWith(new Response(monitored, { headers }));
});
