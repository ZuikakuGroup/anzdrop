import { afterEach, describe, expect, it, vi } from "vitest";
import { postJson, requestJson } from "@/lib/api/client";

afterEach(() => vi.unstubAllGlobals());
const fallback = "処理に失敗しました。";

describe("JSON API client", () => {
  it("sends the exact JSON body and preserves request options", async () => {
    const fetch = vi.fn().mockResolvedValue(Response.json({ success: true, next: "otp" }));
    vi.stubGlobal("fetch", fetch);
    const result = await postJson("/api/account/login", { accountId: "alice", password: "synthetic" }, fallback, { cache: "no-store" });
    expect(result).toEqual({ success: true, next: "otp" });
    expect(fetch).toHaveBeenCalledWith("/api/account/login", {
      method: "POST", cache: "no-store", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ accountId: "alice", password: "synthetic" }),
    });
  });
  it.each([
    [200, { success: false, error: "業務エラー" }, "業務エラー"],
    [403, { success: false, error: "認証が必要です" }, "認証が必要です"],
    [500, { success: true }, fallback],
    [200, { success: false }, fallback],
    [200, null, fallback],
  ])("rejects failure responses (%s, %j)", async (status, body, message) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json(body, { status })));
    await expect(requestJson("/api/example", undefined, fallback)).rejects.toThrow(message);
  });
  it("propagates transport failures without retrying a mutation", async () => {
    const fetch = vi.fn().mockRejectedValue(new TypeError("Network error"));
    vi.stubGlobal("fetch", fetch);
    await expect(postJson("/api/example", {}, fallback)).rejects.toThrow("Network error");
    expect(fetch).toHaveBeenCalledTimes(1);
  });
  it.each([
    [200, "<html>unavailable</html>"],
    [502, "<html>unavailable</html>"],
    [503, ""],
    [200, ""],
    [204, null],
  ])("uses the fallback for a non-JSON response (%s, %j)", async (status, body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(body, { status })));
    await expect(requestJson("/api/example", undefined, fallback)).rejects.toThrow(new Error(fallback));
  });
});
