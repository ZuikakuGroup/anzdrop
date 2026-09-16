// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

let getCurrentAccount: typeof import("@/lib/account/me-client").getCurrentAccount;

beforeEach(async () => {
  vi.resetModules();
  ({ getCurrentAccount } = await import("@/lib/account/me-client"));
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("getCurrentAccount", () => {
  it("同じ画面内の同時呼び出しを1回の認証確認へまとめ、応答は保持しない", async () => {
    const fetchMock = vi.fn().mockImplementation(() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            success: true,
            accountId: "account-1",
            plan: "free",
            planExpiresAt: null,
          })
        )
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const [header, uploadForm] = await Promise.all([
      getCurrentAccount(),
      getCurrentAccount(),
    ]);

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/account/me");
    expect(header).toEqual(uploadForm);

    await getCurrentAccount();
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("失敗した確認はキャッシュせず、次回に再試行する", async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new Error("network"))
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            success: true,
            accountId: "account-1",
            plan: "free",
            planExpiresAt: null,
          })
        )
      );
    vi.stubGlobal("fetch", fetchMock);

    await expect(getCurrentAccount()).rejects.toThrow("network");
    await expect(getCurrentAccount()).resolves.toMatchObject({
      success: true,
      accountId: "account-1",
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
