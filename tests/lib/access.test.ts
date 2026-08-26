import { afterEach, describe, expect, it, vi } from "vitest";

const jwtVerify = vi.fn();
const createRemoteJWKSet = vi.fn(() => "fake-jwks");

vi.mock("jose", () => ({
  jwtVerify,
  createRemoteJWKSet,
}));

const { verifyAccessJwt } = await import("@/lib/access");

const ENV = {
  CF_ACCESS_TEAM_DOMAIN: "example-team.cloudflareaccess.com",
  CF_ACCESS_AUD: "test-aud",
} as unknown as CloudflareEnv;

function requestWith(headers: Record<string, string>): Request {
  return new Request("https://example.com/api/admin/reports", {
    headers,
  });
}

describe("verifyAccessJwt", () => {
  afterEach(() => {
    jwtVerify.mockReset();
    createRemoteJWKSet.mockClear();
  });

  it("returns null without calling jose when the header/cookie is missing", async () => {
    const result = await verifyAccessJwt(requestWith({}), ENV);

    expect(result).toBeNull();
    expect(jwtVerify).not.toHaveBeenCalled();
    expect(createRemoteJWKSet).not.toHaveBeenCalled();
  });

  it("returns null without calling jose when the required env vars are missing", async () => {
    const request = requestWith({ "Cf-Access-Jwt-Assertion": "some-token" });

    const result = await verifyAccessJwt(request, {} as unknown as CloudflareEnv);

    expect(result).toBeNull();
    expect(jwtVerify).not.toHaveBeenCalled();
  });

  it("returns the email for a valid token in the Cf-Access-Jwt-Assertion header", async () => {
    jwtVerify.mockResolvedValueOnce({
      payload: { email: "admin@example.com" },
    });

    const request = requestWith({ "Cf-Access-Jwt-Assertion": "valid-token" });

    const result = await verifyAccessJwt(request, ENV);

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

    const request = requestWith({
      cookie: "other=1; CF_Authorization=cookie-token; another=2",
    });

    const result = await verifyAccessJwt(request, ENV);

    expect(result).toEqual({ email: "admin@example.com" });
    expect(jwtVerify).toHaveBeenCalledWith(
      "cookie-token",
      "fake-jwks",
      expect.anything()
    );
  });

  it("returns null when the token fails verification (invalid/expired)", async () => {
    jwtVerify.mockRejectedValueOnce(new Error("signature verification failed"));

    const request = requestWith({ "Cf-Access-Jwt-Assertion": "bad-token" });

    const result = await verifyAccessJwt(request, ENV);

    expect(result).toBeNull();
  });

  it("returns null when the verified payload has no email claim", async () => {
    jwtVerify.mockResolvedValueOnce({ payload: {} });

    const request = requestWith({ "Cf-Access-Jwt-Assertion": "valid-token" });

    const result = await verifyAccessJwt(request, ENV);

    expect(result).toBeNull();
  });
});
