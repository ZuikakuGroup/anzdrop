// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getAnonymousClientId, getSessionId } from "@/lib/analytics/ids";

beforeEach(() => {
  window.localStorage.clear();
  vi.useRealTimers();
});

describe("getAnonymousClientId", () => {
  it("generates a new id and persists it in localStorage", () => {
    const id = getAnonymousClientId();

    expect(id).toMatch(/^[0-9a-f-]{36}$/);
    expect(window.localStorage.getItem("anzdrop_analytics_client_id")).toBe(id);
  });

  it("returns the same id on subsequent calls", () => {
    const first = getAnonymousClientId();
    const second = getAnonymousClientId();

    expect(second).toBe(first);
  });

  it("falls back to an in-memory id when localStorage throws", () => {
    const spy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("quota exceeded");
    });

    const first = getAnonymousClientId();
    const second = getAnonymousClientId();

    expect(first).toBe(second);

    spy.mockRestore();
  });
});

describe("getSessionId", () => {
  it("returns isNewSession=true on the first call", () => {
    const result = getSessionId();

    expect(result.isNewSession).toBe(true);
    expect(result.sessionId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it("returns the same session and isNewSession=false within the idle window", () => {
    const first = getSessionId();
    const second = getSessionId();

    expect(second.sessionId).toBe(first.sessionId);
    expect(second.isNewSession).toBe(false);
  });

  it("issues a new session after 30 minutes of inactivity", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const first = getSessionId();

    vi.setSystemTime(new Date("2026-01-01T00:31:00Z"));

    const second = getSessionId();

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.isNewSession).toBe(true);

    vi.useRealTimers();
  });

  it("issues a new session exactly at the idle timeout", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    const first = getSessionId();
    vi.setSystemTime(new Date("2026-01-01T00:30:00Z"));

    const second = getSessionId();

    expect(second.sessionId).not.toBe(first.sessionId);
    expect(second.isNewSession).toBe(true);
  });
});
