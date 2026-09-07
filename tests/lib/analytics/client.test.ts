// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { track } from "@/lib/analytics/client";

function stubSendBeacon(returnValue: boolean | undefined) {
  const sendBeacon = returnValue === undefined ? undefined : vi.fn().mockReturnValue(returnValue);

  Object.defineProperty(window.navigator, "sendBeacon", {
    value: sendBeacon,
    configurable: true,
  });

  return sendBeacon;
}

beforeEach(() => {
  window.localStorage.clear();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.unstubAllGlobals();
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
});
