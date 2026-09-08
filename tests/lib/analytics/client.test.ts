// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let track: typeof import("@/lib/analytics/client").track;
let registeredDocumentListeners: Array<[string, EventListenerOrEventListenerObject]>;
let registeredWindowListeners: Array<[string, EventListenerOrEventListenerObject]>;

function stubSendBeacon(returnValue: boolean | undefined) {
  const sendBeacon = returnValue === undefined ? undefined : vi.fn().mockReturnValue(returnValue);

  Object.defineProperty(window.navigator, "sendBeacon", {
    value: sendBeacon,
    configurable: true,
  });

  return sendBeacon;
}

beforeEach(async () => {
  vi.resetModules();
  window.localStorage.clear();
  vi.useFakeTimers();
  registeredDocumentListeners = [];
  registeredWindowListeners = [];
  const addDocumentListener = document.addEventListener.bind(document);
  const addWindowListener = window.addEventListener.bind(window);
  vi.spyOn(document, "addEventListener").mockImplementation(
    ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      registeredDocumentListeners.push([type, listener]);
      addDocumentListener(type, listener, options);
    }) as typeof document.addEventListener
  );
  vi.spyOn(window, "addEventListener").mockImplementation(
    ((
      type: string,
      listener: EventListenerOrEventListenerObject,
      options?: boolean | AddEventListenerOptions
    ) => {
      registeredWindowListeners.push([type, listener]);
      addWindowListener(type, listener, options);
    }) as typeof window.addEventListener
  );
  ({ track } = await import("@/lib/analytics/client"));
});

afterEach(() => {
  for (const [type, listener] of registeredDocumentListeners) {
    document.removeEventListener(type, listener);
  }
  for (const [type, listener] of registeredWindowListeners) {
    window.removeEventListener(type, listener);
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  vi.useRealTimers();
});

describe("track", () => {
  it("sends the event via sendBeacon once the flush interval elapses", () => {
    const sendBeacon = stubSendBeacon(true);

    track("landing_view");
    vi.advanceTimersByTime(3000);

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(sendBeacon).toHaveBeenCalledWith(
      "/api/analytics/events",
      expect.any(Blob)
    );
  });

  it("falls back to fetch(keepalive) when sendBeacon is unavailable", async () => {
    stubSendBeacon(undefined);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    track("landing_view");
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [endpoint, init] = fetchMock.mock.calls[0] as [string, RequestInit];

    expect(endpoint).toBe("/api/analytics/events");
    expect(init.method).toBe("POST");
    expect(init.keepalive).toBe(true);
  });

  it("falls back to fetch when sendBeacon returns false (queue full)", async () => {
    stubSendBeacon(false);
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    track("landing_view");
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("never throws even when a forbidden property key is passed", () => {
    stubSendBeacon(true);

    expect(() =>
      track("upload_error", {
        attemptId: crypto.randomUUID(),
        properties: {
          errorCode: "UPLOAD_UNKNOWN",
          errorStage: "encrypt",
          retryCount: 0,
          email: "leak@example.com",
        } as unknown as Record<string, unknown>,
      })
    ).not.toThrow();
  });

  it("never throws even when sendBeacon and fetch both fail", () => {
    Object.defineProperty(window.navigator, "sendBeacon", {
      value: vi.fn(() => {
        throw new Error("beacon exploded");
      }),
      configurable: true,
    });
    vi.stubGlobal(
      "fetch",
      vi.fn(() => {
        throw new Error("fetch exploded");
      })
    );

    expect(() => {
      track("landing_view");
      vi.advanceTimersByTime(3000);
    }).not.toThrow();
  });

  it("flushes immediately once 20 events have been queued, without waiting for the interval", () => {
    const sendBeacon = stubSendBeacon(true);

    for (let i = 0; i < 19; i += 1) {
      track("landing_view");
    }

    expect(sendBeacon).not.toHaveBeenCalled();

    track("landing_view");

    expect(sendBeacon).toHaveBeenCalledTimes(1);
  });

  it("development mode rejects forbidden properties before they are queued", () => {
    const sendBeacon = stubSendBeacon(true);
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    track("landing_view", {
      properties: { fullUrl: "https://anzdrop.example/d/id#decryption-key" },
    });
    vi.advanceTimersByTime(3000);

    expect(sendBeacon).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("flushes a queued event when the page is hidden, without waiting for the interval", () => {
    const sendBeacon = stubSendBeacon(true);
    Object.defineProperty(document, "visibilityState", {
      value: "hidden",
      configurable: true,
    });

    track("landing_view");
    document.dispatchEvent(new Event("visibilitychange"));

    expect(sendBeacon).toHaveBeenCalledOnce();
  });

  it("keeps each transmission at the server batch limit and schedules the remainder", async () => {
    const sendBeacon = stubSendBeacon(true);
    const consoleLog = vi.spyOn(console, "log").mockImplementation(() => {});

    for (let index = 0; index < 21; index += 1) {
      track("landing_view");
    }

    expect(sendBeacon).toHaveBeenCalledOnce();
    vi.advanceTimersByTime(3000);
    expect(sendBeacon).toHaveBeenCalledTimes(2);

    const batches = await Promise.all(
      sendBeacon!.mock.calls.map(async ([, blob]) => {
        const body = await (blob as Blob).text();
        return JSON.parse(body) as { events: { eventId: string }[] };
      })
    );
    expect(batches.every((batch) => batch.events.length <= 20)).toBe(true);
    expect(batches.map((batch) => batch.events.length)).toEqual([20, 1]);
    expect(
      new Set(batches.flatMap((batch) => batch.events.map((event) => event.eventId))).size
    ).toBe(21);
    consoleLog.mockRestore();
  });
});
