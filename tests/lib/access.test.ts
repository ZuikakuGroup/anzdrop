import { afterEach, describe, expect, it, vi } from "vitest";

const jwtVerify = vi.fn();
const createRemoteJWKSet = vi.fn(() => "fake-jwks");

vi.mock("jose", () => ({
  jwtVerify,
  createRemoteJWKSet,
}));

const { verifyAccessJwt, verifySameOrigin } = await import("@/lib/access");

const ENV = {
  CF_ACCESS_TEAM_DOMAIN: "example-team.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
} as unknown as CloudflareEnv;

function headersWith(headers: Record<string, string>): Headers {
  return new Headers(headers);
}

describe("verifyAccessJwt", () => {
  afterEach(() => {
    jwtVerify.mockReset();
    createRemoteJWKSet.mockClear();
  });

  it("returns null without calling jose when the header/cookie is missing", async () => {
    const result = await verifyAccessJwt(headersWith({}), ENV);

    expect(result).toBeNull();
    expect(jwtVerify).not.toHaveBeenCalled();
    expect(createRemoteJWKSet).not.toHaveBeenCalled();
  });

  it("returns null without calling jose when the required env vars are missing", async () => {
    const headers = headersWith({ "Cf-Access-Jwt-Assertion": "some-token" });

    const result = await verifyAccessJwt(headers, {} as unknown as CloudflareEnv);

    expect(result).toBeNull();
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("returns the email for a valid token in the Cf-Access-Jwt-Assertion header", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: { email: "admin@example.com" },
    });

    const headers = headersWith({ "Cf-Access-Jwt-Assertion": "valid-token" });

    const result = await verifyAccessJwt(headers, ENV);

    expect(result).toEqual({ email: "admin@example.com" });
    expect(jwtVerify).toHaveBeenCalledWith(
      "valid-token",
      "fake-jwks",
      expect.objectContaining({ audience: "test-aud" })
    );
    // CF_ACCESS_TEAM_DOMAINは既にフルホスト名なので、二重にサフィックスを
    // 付け足していないことを確認する(付け足すとJWKSの取得先が存在しない
    // ホストになり、正規の管理者も含めて常に拒否されてしまう)。
    expect(createRemoteJWKSet).toHaveBeenCalledWith(
      new URL("https://example-team.cloudflareaccess.com/cdn-cgi/access/certs")
    );
  });

  it("falls back to the CF_Authorization cookie when the header is absent", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: { email: "admin@example.com" },
    });

    const headers = headersWith({
      cookie: "other=1; CF_Authorization=cookie-token; another=2",
    });

    const result = await verifyAccessJwt(headers, ENV);

    expect(result).toEqual({ email: "admin@example.com" });
    expect(jwtVerify).toHaveBeenCalledWith(
      "cookie-token",
      "fake-jwks",
      expect.anything()
    );
  });

  it("returns null when the token fails verification (invalid/expired)", async () => {
    jwtVerify.mockRejectedValueOnce(new Error("signature verification failed"));

    const headers = headersWith({ "Cf-Access-Jwt-Assertion": "bad-token" });

    const result = await verifyAccessJwt(headers, ENV);

    expect(result).toBeNull();
  });

  it("returns null when the verified payload has no email claim", async () => {
    jwtVerify.mockResolvedValueOnce({ payload: {} });

    const headers = headersWith({ "Cf-Access-Jwt-Assertion": "valid-token" });

    const result = await verifyAccessJwt(headers, ENV);

    expect(result).toBeNull();
  });
});

describe("verifySameOrigin", () => {
  it("allows a request with no Origin header (e.g. non-browser clients)", () => {
    const request = new Request("https://example.com/api/admin/reports/1/resolve", {
      method: "POST",
    });

    expect(verifySameOrigin(request)).toBe(true);
  });

  it("allows a request whose Origin header matches the request's own origin", () => {
    const request = new Request("https://example.com/api/admin/reports/1/resolve", {
      method: "POST",
      headers: { Origin: "https://example.com" },
    });

    expect(verifySameOrigin(request)).toBe(true);
  });

  it("rejects a request whose Origin header is a different site (CSRF)", () => {
    const request = new Request("https://example.com/api/admin/reports/1/resolve", {
      method: "POST",
      headers: { Origin: "https://evil.example" },
    });

    expect(verifySameOrigin(request)).toBe(false);
  });
});
