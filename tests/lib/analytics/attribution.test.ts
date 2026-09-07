// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { getSessionAttribution } from "@/lib/analytics/attribution";

function setUrl(url: string): void {
  window.history.pushState({}, "", url);
}

beforeEach(() => {
  window.localStorage.clear();
  setUrl("http://localhost/");
});

describe("getSessionAttribution", () => {
  it("extracts only the allowlisted utm_* params on a new session", () => {
    setUrl(
      "http://localhost/?utm_source=google&utm_medium=cpc&utm_campaign=launch&secret=leak"
    );

    const { attribution } = getSessionAttribution("session-1", true);

    expect(attribution).toEqual({
      source: "google",
      medium: "cpc",
      campaign: "launch",
    });
  });

  it("stores only the hostname of the referrer, not the full URL", () => {
    Object.defineProperty(document, "referrer", {
      value: "https://example.com/some/article?id=123",
      configurable: true,
    });

    const { referrerDomain } = getSessionAttribution("session-1", true);

    expect(referrerDomain).toBe("example.com");
  });

  it("reuses the attribution captured at session start for later events in the same session", () => {
    setUrl("http://localhost/?utm_source=google");
    const first = getSessionAttribution("session-1", true);

    setUrl("http://localhost/?utm_source=should-be-ignored");
    const second = getSessionAttribution("session-1", false);

    expect(second.attribution).toEqual(first.attribution);
  });

  it("captures fresh attribution when a new session starts, even without utm params", () => {
    setUrl("http://localhost/?utm_source=google");
    getSessionAttribution("session-1", true);

    setUrl("http://localhost/");
    const nextSession = getSessionAttribution("session-2", true);

    expect(nextSession.attribution).toEqual({});
  });
});
