import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyTurnstileToken } from "./turnstile";

const SECRET = "test-secret-key";

describe("verifyTurnstileToken", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects without calling the network when the token is missing", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyTurnstileToken(undefined, SECRET);

    expect(result).toEqual({
      success: false,
      errorCodes: ["missing-input-response"],
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects without calling the network when the token is null", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyTurnstileToken(null, SECRET);

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("rejects without calling the network when the token is an empty string", async () => {
    const fetchSpy = vi.fn();
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyTurnstileToken("", SECRET);

    expect(result.success).toBe(false);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("returns success on a valid token, POSTing secret and response to Cloudflare's siteverify endpoint", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe(
        "https://challenges.cloudflare.com/turnstile/v0/siteverify"
      );
      expect(init.method).toBe("POST");

      const body = init.body as URLSearchParams;
      expect(body.get("secret")).toBe(SECRET);
      expect(body.get("response")).toBe("valid-token");
      expect(body.get("remoteip")).toBeNull();

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyTurnstileToken("valid-token", SECRET);

    expect(result).toEqual({ success: true });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("includes remoteip in the request body when provided", async () => {
    const fetchSpy = vi.fn(async (_url: string, init: RequestInit) => {
      const body = init.body as URLSearchParams;
      expect(body.get("remoteip")).toBe("203.0.113.5");

      return new Response(JSON.stringify({ success: true }), {
        status: 200,
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await verifyTurnstileToken("valid-token", SECRET, "203.0.113.5");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("propagates Cloudflare's error-codes when the token is rejected", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(
            JSON.stringify({
              success: false,
              "error-codes": ["invalid-input-response", "timeout-or-duplicate"],
            }),
            { status: 200 }
          )
      )
    );

    const result = await verifyTurnstileToken("replayed-token", SECRET);

    expect(result).toEqual({
      success: false,
      errorCodes: ["invalid-input-response", "timeout-or-duplicate"],
    });
  });

  it("returns an empty errorCodes array when Cloudflare omits error-codes on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response(JSON.stringify({ success: false }), { status: 200 }))
    );

    const result = await verifyTurnstileToken("some-token", SECRET);

    expect(result).toEqual({ success: false, errorCodes: [] });
  });

  it("does not treat a truthy-but-non-boolean success field as success (guards against loose equality bugs)", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(
        async () =>
          new Response(JSON.stringify({ success: "true" }), { status: 200 })
      )
    );

    const result = await verifyTurnstileToken("some-token", SECRET);

    expect(result.success).toBe(false);
  });

  it("fails closed on a non-2xx HTTP response instead of reading the body as success", async () => {
    const fetchSpy = vi.fn(
      async () =>
        new Response(JSON.stringify({ success: true }), { status: 500 })
    );
    vi.stubGlobal("fetch", fetchSpy);

    const result = await verifyTurnstileToken("some-token", SECRET);

    expect(result).toEqual({ success: false, errorCodes: ["http-500"] });
  });

  it("fails closed instead of throwing when the network request itself fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        throw new TypeError("fetch failed");
      })
    );

    const result = await verifyTurnstileToken("some-token", SECRET);

    expect(result).toEqual({ success: false, errorCodes: ["network-error"] });
  });

  it("fails closed instead of throwing when the response body is not valid JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => new Response("<html>not json</html>", { status: 200 }))
    );

    const result = await verifyTurnstileToken("some-token", SECRET);

    expect(result).toEqual({
      success: false,
      errorCodes: ["invalid-json-response"],
    });
  });
});
