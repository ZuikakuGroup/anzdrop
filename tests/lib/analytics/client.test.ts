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
  window.sessionStorage.clear();
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
  vi.unstubAllEnvs();
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

  it("records only the first landing path once per analytics session", async () => {
    const sendBeacon = stubSendBeacon(true);
    window.history.pushState(
      {},
      "",
      "/lp/secure-file-sharing?utm_source=google&utm_medium=cpc"
    );

    track("landing_view");
    window.history.pushState({}, "", "/");
    track("landing_view");
    vi.advanceTimersByTime(3000);

    expect(sendBeacon).toHaveBeenCalledOnce();
    const blob = sendBeacon!.mock.calls[0]![1] as Blob;
    const body = JSON.parse(await blob.text()) as {
      events: {
        context: { landingPath: string };
        attribution: { source: string; medium: string };
      }[];
    };
    expect(body.events).toHaveLength(1);
    expect(body.events[0]?.context.landingPath).toBe("/lp/secure-file-sharing");
    expect(body.events[0]?.attribution).toEqual({ source: "google", medium: "cpc" });
  });

  it("records a new landing after the analytics session expires", async () => {
    const sendBeacon = stubSendBeacon(true);
    window.history.pushState({}, "", "/lp/secure-file-sharing");
    track("landing_view");
    vi.advanceTimersByTime(30 * 60 * 1000 + 1);
    window.history.pushState({}, "", "/about");
    track("landing_view");
    vi.advanceTimersByTime(3000);

    expect(sendBeacon).toHaveBeenCalledTimes(2);
    const eventBatches = await Promise.all(
      sendBeacon!.mock.calls.map(async ([, blob]) => {
        const body = JSON.parse(await (blob as Blob).text()) as {
          events: { context: { landingPath: string } }[];
        };
        return body.events;
      })
    );
    expect(eventBatches.flat().map((event) => event.context.landingPath)).toEqual([
      "/lp/secure-file-sharing",
      "/about",
    ]);
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

  describe.each(["unavailable", "false", "throws"])("when sendBeacon %s", (beaconFailure) => {
    it.each(["rejects", "non-OK", "throws"])("retries the same landing event when fetch %s", async (fetchFailure) => {
      const beacon = stubSendBeacon(beaconFailure === "unavailable" ? undefined : false);
      if (beaconFailure === "throws") {
        beacon!.mockImplementation(() => { throw new Error("beacon failed"); });
      }
      const fetchMock = vi.fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 200 }));
      if (fetchFailure === "rejects") {
        fetchMock.mockRejectedValueOnce(new Error("offline"));
      } else if (fetchFailure === "non-OK") {
        fetchMock.mockResolvedValueOnce(new Response(null, { status: 503 }));
      } else {
        fetchMock.mockImplementationOnce(() => { throw new Error("fetch failed"); });
      }
      vi.stubGlobal("fetch", fetchMock);

      track("landing_view");
      await vi.advanceTimersByTimeAsync(3000);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      const originalBody = fetchMock.mock.calls[0]![1]!.body;

      // The session guard must not prevent delivery of the original queued event.
      track("landing_view");
      await vi.advanceTimersByTimeAsync(2999);
      expect(fetchMock).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);
      expect(fetchMock).toHaveBeenCalledTimes(2);
      expect(fetchMock.mock.calls[1]![1]!.body).toBe(originalBody);

      await vi.advanceTimersByTimeAsync(6000);
      expect(fetchMock).toHaveBeenCalledTimes(2);
    });
  });

  it("returns a rejected batch ahead of events queued while fetch was pending", async () => {
    stubSendBeacon(false);
    let rejectDelivery!: (reason: Error) => void;
    const delivery = new Promise<Response>((_, reject) => { rejectDelivery = reject; });
    const fetchMock = vi.fn<typeof fetch>()
      .mockResolvedValue(new Response(null, { status: 200 }))
      .mockReturnValueOnce(delivery);
    vi.stubGlobal("fetch", fetchMock);

    track("landing_view");
    track("file_select");
    await vi.advanceTimersByTimeAsync(3000);
    const original = JSON.parse(fetchMock.mock.calls[0]![1]!.body as string);
    track("upload_start");
    rejectDelivery(new Error("offline"));
    await vi.advanceTimersByTimeAsync(3000);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const retried = JSON.parse(fetchMock.mock.calls[1]![1]!.body as string);
    expect(retried.events.slice(0, 2)).toEqual(original.events);
    expect(retried.events).toHaveLength(3);
    expect(retried.events[2].eventName).toBe("upload_start");
    await vi.advanceTimersByTimeAsync(6000);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("preserves the landing event when serialization throws synchronously", async () => {
    const beacon = stubSendBeacon(true);
    track("landing_view");
    const stringify = vi.spyOn(JSON, "stringify").mockImplementationOnce(() => {
      throw new Error("serialization failed");
    });
    try {
      expect(() => vi.advanceTimersByTime(3000)).not.toThrow();
      expect(beacon).not.toHaveBeenCalled();
    } finally {
      stringify.mockRestore();
    }

    track("landing_view");
    await vi.advanceTimersByTimeAsync(3000);
    expect(beacon).toHaveBeenCalledOnce();
    const body = JSON.parse(await (beacon!.mock.calls[0]![1] as Blob).text());
    expect(body.events).toHaveLength(1);
    expect(body.events[0].eventName).toBe("landing_view");
    await vi.advanceTimersByTimeAsync(6000);
    expect(beacon).toHaveBeenCalledOnce();
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

  it("does not send forbidden properties in production", () => {
    vi.stubEnv("NODE_ENV", "production");
    const sendBeacon = stubSendBeacon(true);

    track("upload_error", {
      attemptId: crypto.randomUUID(),
      properties: {
        errorCode: "UPLOAD_UNKNOWN",
        errorStage: "encrypt",
        retryCount: 0,
        fullUrl: "https://anzdrop.example/d/share#decryption-key",
      } as unknown as Record<string, unknown>,
    });
    vi.advanceTimersByTime(3000);

    expect(sendBeacon).not.toHaveBeenCalled();
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
      track("file_select", { properties: { fileCount: 1, totalSizeBucket: "<10MB" } });
    }

    expect(sendBeacon).not.toHaveBeenCalled();

    track("file_select", { properties: { fileCount: 1, totalSizeBucket: "<10MB" } });

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
      track("file_select", { properties: { fileCount: 1, totalSizeBucket: "<10MB" } });
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
