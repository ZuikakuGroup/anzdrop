import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyAccessJwt, verifySameOrigin } from "@/lib/access";
import { requireAdmin } from "@/lib/api/adminAuth";

vi.mock("@/lib/access", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/access")>();

  return {
    ...actual,
    verifyAccessJwt: vi.fn(),
    verifySameOrigin: vi.fn(),
  };
});

const ENV = {} as unknown as CloudflareEnv;

function requestWith(headers: Record<string, string> = {}): Request {
  return new Request("https://example.com/api/admin/reports", { headers });
}

describe("requireAdmin", () => {
  afterEach(() => {
    vi.mocked(verifyAccessJwt).mockReset();
    vi.mocked(verifySameOrigin).mockReset();
  });

  it("returns a 403 Unauthorized response without checking Origin when verifyAccessJwt fails", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue(null);

    const result = await requireAdmin(requestWith(), ENV);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected ok:false");
    }
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body).toEqual({ success: false, error: "Unauthorized" });
    expect(verifySameOrigin).not.toHaveBeenCalled();
  });

  it("returns a 403 Invalid origin response when the identity is valid but the Origin check fails (default verifyOrigin:true)", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "admin@example.com" });
    vi.mocked(verifySameOrigin).mockReturnValue(false);

    const result = await requireAdmin(requestWith(), ENV);

    expect(result.ok).toBe(false);
    if (result.ok) {
      throw new Error("expected ok:false");
    }
    expect(result.response.status).toBe(403);
    const body = await result.response.json();
    expect(body).toEqual({ success: false, error: "Invalid origin" });
  });

  it("skips the Origin check when verifyOrigin:false is passed (read-only GET routes)", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "admin@example.com" });
    vi.mocked(verifySameOrigin).mockReturnValue(false);

    const result = await requireAdmin(requestWith(), ENV, { verifyOrigin: false });

    expect(result.ok).toBe(true);
    expect(verifySameOrigin).not.toHaveBeenCalled();
  });

  it("returns ok:true with the identity when both checks pass", async () => {
    vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "admin@example.com" });
    vi.mocked(verifySameOrigin).mockReturnValue(true);

    const result = await requireAdmin(requestWith(), ENV);

    expect(result).toEqual({ ok: true, identity: { email: "admin@example.com" } });
  });
});
