import { afterEach, describe, expect, it, vi } from "vitest";
import {
  deleteReport,
  deleteShare,
  fetchReports,
  fetchShareInfo,
  resolveReport,
  toggleShareSuspend,
  type AdminReport,
} from "@/lib/admin/reportsApi";

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status });
}

describe("fetchReports", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("requests the given status and returns the reports on success", async () => {
    const reports: AdminReport[] = [
      {
        id: "r1",
        shareId: "s1",
        reason: "spam",
        createdAt: "2026-01-01T00:00:00.000Z",
        resolvedAt: null,
        reportType: "general",
        claimantName: null,
        contactEmail: null,
        rightType: null,
        category: "spam",
        share: { exists: true, expired: false, suspended: false, fileCount: 1 },
      },
    ];
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("/api/admin/reports?status=resolved");
      return jsonResponse({ success: true, reports });
    });
    vi.stubGlobal("fetch", fetchSpy);

    const result = await fetchReports("resolved");

    expect(result).toEqual(reports);
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws the server's error message when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false, error: "Unauthorized" }, 403))
    );

    await expect(fetchReports("open")).rejects.toThrow("Unauthorized");
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(fetchReports("open")).rejects.toThrow("読み込みに失敗しました。");
  });

  it("throws when the response is ok but reports is missing", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: true }))
    );

    await expect(fetchReports("open")).rejects.toThrow("読み込みに失敗しました。");
  });
});

describe("resolveReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the resolve endpoint and resolves on success", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/admin/reports/r1/resolve");
      expect(init.method).toBe("POST");
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(resolveReport("r1")).resolves.toBeUndefined();
  });

  it("throws the server's error message on failure", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false, error: "Report not found" }, 404))
    );

    await expect(resolveReport("missing")).rejects.toThrow("Report not found");
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(resolveReport("r1")).rejects.toThrow("更新に失敗しました。");
  });
});

describe("deleteShare", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs the share endpoint and resolves on success", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/admin/shares/s1");
      expect(init.method).toBe("DELETE");
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(deleteShare("s1")).resolves.toBeUndefined();
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(deleteShare("s1")).rejects.toThrow("削除に失敗しました。");
  });
});

describe("toggleShareSuspend", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("POSTs to the suspend endpoint when suspend is true", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/admin/shares/s1/suspend");
      expect(init.method).toBe("POST");
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await toggleShareSuspend("s1", true);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("POSTs to the unsuspend endpoint when suspend is false", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("/api/admin/shares/s1/unsuspend");
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await toggleShareSuspend("s1", false);

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(toggleShareSuspend("s1", true)).rejects.toThrow(
      "更新に失敗しました。"
    );
  });
});

describe("fetchShareInfo", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("GETs the share endpoint and returns the share info on success", async () => {
    const share = { exists: true, expired: false, suspended: false, fileCount: 3 };
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("/api/admin/shares/s1");
      return jsonResponse({ success: true, share });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(fetchShareInfo("s1")).resolves.toEqual(share);
  });

  it("URL-encodes the shareId", async () => {
    const fetchSpy = vi.fn(async (url: string) => {
      expect(url).toBe("/api/admin/shares/a%2Fb");
      return jsonResponse({
        success: true,
        share: { exists: false, expired: false, suspended: false, fileCount: 0 },
      });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await fetchShareInfo("a/b");

    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("throws the server's error message when the request fails", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false, error: "Unauthorized" }, 403))
    );

    await expect(fetchShareInfo("s1")).rejects.toThrow("Unauthorized");
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(fetchShareInfo("s1")).rejects.toThrow("読み込みに失敗しました。");
  });
});

describe("deleteReport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("DELETEs the report endpoint and resolves on success", async () => {
    const fetchSpy = vi.fn(async (url: string, init: RequestInit) => {
      expect(url).toBe("/api/admin/reports/r1");
      expect(init.method).toBe("DELETE");
      return jsonResponse({ success: true });
    });
    vi.stubGlobal("fetch", fetchSpy);

    await expect(deleteReport("r1")).resolves.toBeUndefined();
  });

  it("throws a generic fallback message when the server omits an error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => jsonResponse({ success: false }, 500))
    );

    await expect(deleteReport("r1")).rejects.toThrow("削除に失敗しました。");
  });
});
