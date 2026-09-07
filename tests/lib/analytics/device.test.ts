// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { classifyBrowserFamily, classifyDevice } from "@/lib/analytics/device";

describe("classifyDevice", () => {
  it("classifies an iPhone user agent as mobile", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
      )
    ).toBe("mobile");
  });

  it("classifies an iPad user agent as tablet", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (iPad; CPU OS 18_0 like Mac OS X) AppleWebKit/605.1.15"
      )
    ).toBe("tablet");
  });

  it("classifies an Android user agent without mobi as tablet", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (Linux; Android 14; SM-X910) AppleWebKit/537.36 Chrome/120.0 Safari/537.36"
      )
    ).toBe("tablet");
  });

  it("keeps mobile Android user agents classified as mobile", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/120.0 Mobile Safari/537.36"
      )
    ).toBe("mobile");
  });

  it("classifies a desktop Chrome user agent as desktop", () => {
    expect(
      classifyDevice(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
      )
    ).toBe("desktop");
  });

  it("returns unknown for an empty user agent", () => {
    expect(classifyDevice("")).toBe("unknown");
  });
});

describe("classifyBrowserFamily", () => {
  it("recognizes Chrome", () => {
    expect(
      classifyBrowserFamily(
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/120.0.0.0 Safari/537.36"
      )
    ).toBe("Chrome");
  });

  it("recognizes Firefox", () => {
    expect(
      classifyBrowserFamily("Mozilla/5.0 (X11; Linux x86_64; rv:120.0) Gecko/20100101 Firefox/120.0")
    ).toBe("Firefox");
  });

  it("returns unknown for an unrecognized user agent", () => {
    expect(classifyBrowserFamily("SomeCustomBot/1.0")).toBe("unknown");
  });
});
