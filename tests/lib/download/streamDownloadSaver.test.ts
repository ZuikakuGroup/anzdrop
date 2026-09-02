import { afterEach, describe, expect, it, vi } from "vitest";

// このモジュールは登録状態をモジュールスコープに持つため、テストごとに読み直す。
afterEach(() => {
  vi.unstubAllGlobals();
  vi.resetModules();
});

async function loadModule() {
  return import("@/lib/download/streamDownloadSaver");
}

describe("registerDownloadServiceWorker", () => {
  it("navigator.serviceWorker が無ければ何もしない", async () => {
    vi.stubGlobal("navigator", {});
    const { registerDownloadServiceWorker } = await loadModule();
    expect(() => registerDownloadServiceWorker()).not.toThrow();
  });

  it("/download-sw.js をスコープ / で1度だけ登録する", async () => {
    const register = vi.fn(async () => ({}));
    vi.stubGlobal("navigator", { serviceWorker: { register } });
    vi.stubGlobal("MessageChannel", class {});

    const { registerDownloadServiceWorker } = await loadModule();
    registerDownloadServiceWorker();
    registerDownloadServiceWorker();

    expect(register).toHaveBeenCalledTimes(1);
    expect(register).toHaveBeenCalledWith("/download-sw.js", { scope: "/" });
  });
});

describe("canSaveViaServiceWorker", () => {
  it("Service Worker 非対応なら false", async () => {
    vi.stubGlobal("navigator", {});
    const { canSaveViaServiceWorker } = await loadModule();
    expect(await canSaveViaServiceWorker()).toBe(false);
  });

  // transferable stream 対応チェックを通す最小限のスタブ。
  function stubTransferableStreamSupport() {
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = { postMessage() {} };
        port2 = {};
      }
    );
  }

  it("Service Worker の登録が成立しなければ(register が失敗)false", async () => {
    stubTransferableStreamSupport();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => {
          throw new Error("registration failed");
        }),
        ready: new Promise(() => {}), // 永久 pending
        controller: null,
      },
    });

    const { canSaveViaServiceWorker } = await loadModule();
    expect(await canSaveViaServiceWorker()).toBe(false);
  });

  it("Service Worker がページを制御していなければ false", async () => {
    stubTransferableStreamSupport();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => ({})),
        ready: Promise.resolve({}),
        controller: null,
      },
    });

    const { canSaveViaServiceWorker } = await loadModule();
    expect(await canSaveViaServiceWorker()).toBe(false);
  });

  it("ready が返ってこなくても(登録は成立)タイムアウトして false", async () => {
    vi.useFakeTimers();
    stubTransferableStreamSupport();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => ({})),
        ready: new Promise(() => {}), // 永久 pending
        controller: { postMessage() {} },
      },
    });

    const { canSaveViaServiceWorker } = await loadModule();
    const promise = canSaveViaServiceWorker();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(await promise).toBe(false);
    vi.useRealTimers();
  });

  it("すべて揃っていれば true", async () => {
    stubTransferableStreamSupport();
    vi.stubGlobal("navigator", {
      serviceWorker: {
        register: vi.fn(async () => ({})),
        ready: Promise.resolve({}),
        controller: { postMessage() {} },
      },
    });

    const { canSaveViaServiceWorker } = await loadModule();
    expect(await canSaveViaServiceWorker()).toBe(true);
  });
});

describe("saveViaServiceWorker", () => {
  function fakeMessageChannel() {
    const port1: {
      onmessage: ((event: MessageEvent) => void) | null;
    } = { onmessage: null };
    const port2 = { __isPort2: true };
    return { port1, port2 };
  }

  it("ストリームとポートを SW コントローラへ post し、返ってきた URL へ隠し iframe を遷移させる", async () => {
    const posted: { message: unknown; transfer: unknown[] }[] = [];
    const controller = {
      postMessage: (message: unknown, transfer: unknown[]) => {
        posted.push({ message, transfer });
      },
    };
    vi.stubGlobal("navigator", { serviceWorker: { controller } });

    const channel = fakeMessageChannel();
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = channel.port1;
        port2 = channel.port2;
      }
    );
    vi.stubGlobal("crypto", {
      randomUUID: () => "11111111-1111-1111-1111-111111111111",
    });

    const appended: { src: string; hidden: boolean }[] = [];
    vi.stubGlobal("document", {
      createElement: () => {
        const el = { src: "", hidden: false, remove: vi.fn() };
        return el;
      },
      body: {
        appendChild: (el: { src: string; hidden: boolean }) => {
          appended.push(el);
        },
      },
    });

    const { saveViaServiceWorker } = await loadModule();
    const readable = { __fakeStream: true } as unknown as ReadableStream<Uint8Array>;

    const savePromise = saveViaServiceWorker(readable, "レポート.bin", 4096);

    // SW から返信が来るのを模す。
    expect(channel.port1.onmessage).toBeTypeOf("function");
    channel.port1.onmessage!({
      data: { url: "/_anzdrop_download/abc" },
    } as MessageEvent);

    await savePromise;

    expect(posted).toHaveLength(1);
    const { message, transfer } = posted[0];
    expect((message as { type: string }).type).toBe("ANZDROP_STREAM_DOWNLOAD");
    expect((message as { filename: string }).filename).toBe("レポート.bin");
    expect((message as { size: number }).size).toBe(4096);
    expect((message as { readable: unknown }).readable).toBe(readable);
    // ポートとストリームが transfer リストに含まれる。
    expect(transfer).toContain(readable);
    expect(transfer).toContain(channel.port2);

    expect(appended).toHaveLength(1);
    expect(appended[0].src).toBe("/_anzdrop_download/abc");
    expect(appended[0].hidden).toBe(true);
  });

  it("SW が URL を返さなければ reject する", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: { controller: { postMessage: vi.fn() } },
    });
    const channel = fakeMessageChannel();
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = channel.port1;
        port2 = channel.port2;
      }
    );
    vi.stubGlobal("crypto", { randomUUID: () => "x" });
    vi.stubGlobal("document", {
      createElement: () => ({ src: "", hidden: false }),
      body: { appendChild: vi.fn() },
    });

    const { saveViaServiceWorker } = await loadModule();
    const p = saveViaServiceWorker(
      {} as ReadableStream<Uint8Array>,
      "f.bin",
      null
    );
    channel.port1.onmessage!({ data: {} } as MessageEvent);

    await expect(p).rejects.toThrow(/ダウンロードURL/);
  });

  it("SW がページを制御していなければ即座に throw する", async () => {
    vi.stubGlobal("navigator", { serviceWorker: { controller: null } });
    const { saveViaServiceWorker } = await loadModule();

    await expect(
      saveViaServiceWorker({} as ReadableStream<Uint8Array>, "f.bin", null)
    ).rejects.toThrow(/制御/);
  });

  it("SW から何の応答も来なければタイムアウトして reject する", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("navigator", {
      serviceWorker: { controller: { postMessage: vi.fn() } },
    });
    const channel = fakeMessageChannel();
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = channel.port1;
        port2 = channel.port2;
      }
    );
    vi.stubGlobal("crypto", { randomUUID: () => "x" });
    vi.stubGlobal("document", {
      createElement: () => ({ src: "", hidden: false }),
      body: { appendChild: vi.fn() },
    });

    const { saveViaServiceWorker } = await loadModule();
    const p = saveViaServiceWorker(
      {} as ReadableStream<Uint8Array>,
      "f.bin",
      null
    );
    const assertion = expect(p).rejects.toThrow(/タイムアウト/);
    await vi.advanceTimersByTimeAsync(5_000);
    await assertion;
    vi.useRealTimers();
  });

  it("SW から done 通知が来たら隠し iframe を撤去する", async () => {
    vi.stubGlobal("navigator", {
      serviceWorker: { controller: { postMessage: vi.fn() } },
    });
    const channel = fakeMessageChannel();
    vi.stubGlobal(
      "MessageChannel",
      class {
        port1 = channel.port1;
        port2 = channel.port2;
      }
    );
    vi.stubGlobal("crypto", { randomUUID: () => "x" });

    const removed = vi.fn();
    vi.stubGlobal("document", {
      createElement: () => ({ src: "", hidden: false, remove: removed }),
      body: { appendChild: vi.fn() },
    });

    const { saveViaServiceWorker } = await loadModule();
    const p = saveViaServiceWorker(
      {} as ReadableStream<Uint8Array>,
      "f.bin",
      null
    );
    channel.port1.onmessage!({
      data: { url: "/_anzdrop_download/x" },
    } as MessageEvent);
    await p;

    expect(removed).not.toHaveBeenCalled();
    channel.port1.onmessage!({ data: { done: true } } as MessageEvent);
    expect(removed).toHaveBeenCalled();
  });
});
