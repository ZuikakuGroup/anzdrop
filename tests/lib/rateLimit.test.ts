import { afterEach, describe, expect, it, vi } from "vitest";
import { checkRateLimit } from "@/lib/rateLimit";
import { createStubRateLimiter, readJson } from "@/test/env";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("checkRateLimit", () => {
  it("枠内なら通し、キーをそのままバインディングへ渡す", async () => {
    const limiter = createStubRateLimiter();

    const result = await checkRateLimit(limiter, "file-abc", "GET /api/test");

    expect(result.ok).toBe(true);
    expect(limiter.keys).toEqual(["file-abc"]);
  });

  it("超過したら429と Retry-After を返し、本文にキーを含めない", async () => {
    const limiter = createStubRateLimiter();
    limiter.denyKeyFrom("file-abc", 1);

    const result = await checkRateLimit(limiter, "file-abc", "GET /api/test");

    expect(result.ok).toBe(false);

    if (result.ok) {
      throw new Error("超過時は ok:false のはず");
    }

    expect(result.response.status).toBe(429);
    expect(result.response.headers.get("Retry-After")).toBe("60");
    expect(result.response.headers.get("Cache-Control")).toBe("no-store");

    const body = await readJson<{ success: boolean; error: string }>(
      result.response
    );

    expect(body.success).toBe(false);
    expect(body.error).not.toContain("file-abc");
  });

  it("バインディング未設定の環境ではフェイルオープンする", async () => {
    const result = await checkRateLimit(undefined, "file-abc", "GET /api/test");

    expect(result.ok).toBe(true);
  });

  it("バインディングが例外を投げてもフェイルオープンし、キーをログに残さない", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const limiter = createStubRateLimiter();
    limiter.failNext();

    const result = await checkRateLimit(limiter, "file-abc", "GET /api/test");

    expect(result.ok).toBe(true);
    expect(consoleError).toHaveBeenCalledTimes(1);

    // fileId / shareId は共有URLの一部で、ログへ残すと「URLを知る者だけが
    // 取得できる」という前提を弱める。ログ出力にキーが混ざっていないこと。
    const logged = consoleError.mock.calls[0]
      .map((arg) => String(arg))
      .join(" ");

    expect(logged).not.toContain("file-abc");
  });

  it("枠内の呼び出しは何度でも通る(1回の呼び出しで枠を使い切らない)", async () => {
    const limiter = createStubRateLimiter();
    limiter.denyKeyFrom("k", 3);

    expect((await checkRateLimit(limiter, "k", "GET /api/test")).ok).toBe(true);
    expect((await checkRateLimit(limiter, "k", "GET /api/test")).ok).toBe(true);
    expect((await checkRateLimit(limiter, "k", "GET /api/test")).ok).toBe(false);
  });
});
