import { afterEach, describe, expect, it, vi } from "vitest";
import { fetchAnalytics } from "@/lib/admin/analyticsApi";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("fetchAnalytics", () => {
  it("returns data from a valid JSON response", async () => {
    const data = { steps: [] };
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({ success: true, data })
      )
    );

    await expect(fetchAnalytics("funnel")).resolves.toEqual(data);
  });

  it("uses a user-facing HTTP error when an error response is not JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("gateway unavailable", { status: 502 })
      )
    );

    await expect(fetchAnalytics("overview")).rejects.toThrow(
      "読み込みに失敗しました。(HTTP 502)"
    );
  });

  it("does not expose a JSON parsing error for a malformed success response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response("not json", { status: 200 })
      )
    );

    await expect(fetchAnalytics("overview")).rejects.toThrow(
      "サーバーから正しい応答を受信できませんでした。"
    );
  });

  it("does not expose a TypeError for a JSON null response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(Response.json(null))
    );

    await expect(fetchAnalytics("overview")).rejects.toThrow(
      "サーバーから正しい応答を受信できませんでした。"
    );
  });
});
