import { afterEach, describe, expect, it, vi } from "vitest";
import { requireAuthOrigin, webauthnSite } from "@/lib/account/authHttp";

afterEach(() => vi.unstubAllEnvs());

describe("fixed WebAuthn relying party configuration", () => {
  it("fixes production RP and Origin even if a local override is present", () => {
    vi.stubEnv("DEPLOYMENT_ENV", "production");
    vi.stubEnv("ACCOUNT_AUTH_LOCAL_ORIGIN", "http://localhost:8787");
    expect(webauthnSite()).toEqual({ rpID: "anzdrop.com", origin: "https://anzdrop.com" });
    expect(() => requireAuthOrigin(new Request("https://hostile.example", { headers: { Origin: "http://localhost:8787" } }))).toThrow();
    expect(() => requireAuthOrigin(new Request("https://hostile.example", { headers: { Origin: "https://anzdrop.com" } }))).not.toThrow();
  });

  it.each(["http://127.0.0.1:3000", "https://evil.example", "http://localhost:3000/path", "http://localhost:3000/"])("rejects an invalid local allowlist: %s", (origin) => {
    vi.stubEnv("DEPLOYMENT_ENV", "");
    vi.stubEnv("ACCOUNT_AUTH_LOCAL_ORIGIN", origin);
    expect(() => webauthnSite()).toThrow();
  });

  it("accepts only the explicit localhost Origin without deriving it from Host", () => {
    vi.stubEnv("DEPLOYMENT_ENV", "");
    vi.stubEnv("ACCOUNT_AUTH_LOCAL_ORIGIN", "http://localhost:8787");
    expect(webauthnSite()).toEqual({ rpID: "localhost", origin: "http://localhost:8787" });
    expect(() => requireAuthOrigin(new Request("http://localhost:3000", { headers: { Origin: "http://localhost:3000" } }))).toThrow();
  });
});
