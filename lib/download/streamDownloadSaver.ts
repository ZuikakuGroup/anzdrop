// showSaveFilePicker が使えないブラウザ(Firefox / Safari)向けに、
// Service Worker(public/download-sw.js)を使った疑似ストリーミングダウンロード
// を行う(GitHub issue #61)。ページ側で復号したバイト列の ReadableStream を
// Service Worker へ転送(transferable stream)し、Service Worker が
// `Content-Disposition: attachment` を付けた Response として返すことで、
// ファイル全体をメモリに載せずに保存できる。

const SERVICE_WORKER_URL = "/download-sw.js";
const STREAM_DOWNLOAD_MESSAGE = "ANZDROP_STREAM_DOWNLOAD";
const PING_MESSAGE = "ANZDROP_PING";
// ping の応答待ち上限。ローカルの Service Worker との往復なので短くてよい。
const PING_TIMEOUT_MS = 2_000;

// Service Worker がページを制御し始めるのを待つ上限。これを過ぎたら諦めて
// Blob フォールバックへ回す(登録が何らかの理由で成立しないと `ready` は
// 永久に pending のままになるため)。
const SERVICE_WORKER_READY_TIMEOUT_MS = 4_000;
// Service Worker からダウンロードURLが返ってくるのを待つ上限。
const DOWNLOAD_URL_TIMEOUT_MS = 5_000;
// ダウンロード完了通知が来なかった場合に隠し iframe を撤去するまでの上限。
// 大容量ファイルのダウンロードは数十分かかりうるので長めに取る。
const HIDDEN_IFRAME_FALLBACK_TTL_MS = 60 * 60 * 1000;

let registrationPromise: Promise<ServiceWorkerRegistration | null> | null = null;

function hasServiceWorker(): boolean {
  return (
    typeof navigator !== "undefined" &&
    "serviceWorker" in navigator &&
    typeof MessageChannel !== "undefined"
  );
}

function timeout(ms: number): Promise<never> {
  return new Promise((_, reject) => {
    const timer = setTimeout(
      () => reject(new Error("タイムアウトしました")),
      ms
    );
    (timer as unknown as { unref?: () => void }).unref?.();
  });
}

// ReadableStream を postMessage で転送できる(transferable stream 対応)か。
// Chrome 87+ / Firefox 103+ / Safari 16.4+。結果はメモ化する(副作用を持つ
// プローブなので毎回実行しない)。
let transferableStreamSupport: boolean | null = null;
function supportsTransferableStreams(): boolean {
  if (transferableStreamSupport !== null) {
    return transferableStreamSupport;
  }

  if (typeof ReadableStream === "undefined") {
    transferableStreamSupport = false;
    return false;
  }

  try {
    const probe = new ReadableStream();
    // 転送不可なら DataCloneError を投げる。
    new MessageChannel().port1.postMessage(probe, [
      probe as unknown as Transferable,
    ]);
    transferableStreamSupport = true;
  } catch {
    transferableStreamSupport = false;
  }

  return transferableStreamSupport;
}

// ダウンロードページのマウント時に呼ぶ。登録は一度だけ行い、失敗は無視する
// (Service Worker が使えなくても Blob フォールバックがあるため)。
export function registerDownloadServiceWorker(): void {
  if (!hasServiceWorker() || registrationPromise) {
    return;
  }

  registrationPromise = navigator.serviceWorker
    .register(SERVICE_WORKER_URL, { scope: "/" })
    .catch(() => null);
}

// この環境・この時点で Service Worker 経由のストリーミング保存が使えるか。
// 登録が成立していない・まだページを制御していない(初回訪問直後など)場合は
// false を返し、呼び出し側は Blob フォールバックを使う。
export async function canSaveViaServiceWorker(): Promise<boolean> {
  if (!hasServiceWorker() || !supportsTransferableStreams()) {
    return false;
  }

  registerDownloadServiceWorker();

  const registration = await registrationPromise;
  if (!registration) {
    return false;
  }

  try {
    // ready は登録が成立しないと永久 pending なので、必ずタイムアウトと競わせる。
    await Promise.race([
      navigator.serviceWorker.ready,
      timeout(SERVICE_WORKER_READY_TIMEOUT_MS),
    ]);
  } catch {
    return false;
  }

  const controller = navigator.serviceWorker.controller;
  if (!controller) {
    return false;
  }

  // ここまでの判定を通っても、実際に message ハンドラまで届くとは限らない
  // (制御 SW が終了寸前・別バージョンへの切り替え中など)。復号済みストリーム
  // を開く前に往復で疎通を確かめておき、開いた後に失敗して 1回限りファイルの
  // ダウンロード枠だけ消費される事故を防ぐ。
  return pingServiceWorker(controller);
}

// Service Worker の message ハンドラへ ping を送り、pong が返るか確かめる。
async function pingServiceWorker(controller: ServiceWorker): Promise<boolean> {
  const channel = new MessageChannel();

  try {
    const pong = new Promise<boolean>((resolve) => {
      channel.port1.onmessage = (event: MessageEvent) => {
        resolve((event.data as { pong?: boolean } | null)?.pong === true);
      };
    });

    controller.postMessage({ type: PING_MESSAGE }, [channel.port2]);

    return await Promise.race([
      pong,
      timeout(PING_TIMEOUT_MS).catch(() => false),
    ]);
  } catch {
    return false;
  } finally {
    channel.port1.close();
  }
}

function appendHiddenDownloadFrame(url: string): { done: () => void } {
  const iframe = document.createElement("iframe");
  iframe.hidden = true;
  iframe.src = url;
  document.body.appendChild(iframe);

  let removed = false;
  const remove = (): void => {
    if (removed) {
      return;
    }
    removed = true;
    iframe.remove();
  };

  // 完了通知が来なかった場合の保険。大容量ダウンロード中に撤去して中断させない
  // よう十分長く取る。
  const timer = setTimeout(remove, HIDDEN_IFRAME_FALLBACK_TTL_MS);
  (timer as unknown as { unref?: () => void }).unref?.();

  return {
    done: () => {
      clearTimeout(timer);
      remove();
    },
  };
}

// 復号済みバイト列の ReadableStream を Service Worker へ渡し、隠し iframe を
// 経由してブラウザにストリーミングダウンロードさせる。
// size を渡すと Content-Length が付き、ブラウザの進捗表示が正確になる。
// この関数は「ダウンロードが開始された」時点で resolve する(完走まで待たない)。
export async function saveViaServiceWorker(
  readable: ReadableStream<Uint8Array>,
  filename: string,
  size: number | null
): Promise<void> {
  const controller = navigator.serviceWorker.controller;

  if (!controller) {
    throw new Error("Service Worker がページを制御していません");
  }

  const id = crypto.randomUUID().replace(/-/g, "");
  const channel = new MessageChannel();

  let frame: { done: () => void } | null = null;

  try {
    const downloadUrl = await Promise.race([
      new Promise<string>((resolve, reject) => {
        channel.port1.onmessage = (event: MessageEvent) => {
          const data = event.data as
            | { url?: string; done?: boolean }
            | null;

          if (typeof data?.url === "string") {
            resolve(data.url);
          } else if (data?.done) {
            // ダウンロードの読み出しが完了した(または中断された)。iframe を
            // 撤去し、これ以上通知は来ないのでポートも閉じる。
            frame?.done();
            channel.port1.close();
          } else {
            reject(
              new Error("Service Worker からダウンロードURLが返りませんでした")
            );
          }
        };

        controller.postMessage(
          {
            type: STREAM_DOWNLOAD_MESSAGE,
            id,
            readable,
            filename,
            size: size ?? undefined,
          },
          [channel.port2, readable as unknown as Transferable]
        );
      }),
      timeout(DOWNLOAD_URL_TIMEOUT_MS),
    ]);

    frame = appendHiddenDownloadFrame(downloadUrl);
  } catch (err) {
    // URL が返らなかった/タイムアウトした。完了通知を待つ相手もいないので
    // ポートを閉じてからエラーを伝播する。
    channel.port1.close();
    throw err;
  }
}
