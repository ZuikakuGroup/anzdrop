import { describe, expect, it } from "vitest";
import { isHomeRequest } from "@/workers/router/routing";

describe("トップページWorkerのルーティング", () => {
  it.each(["/", "/_home-next/_next/static/chunk.js"])(
    "%s をトップページWorkerへ送る",
    (pathname) => {
      expect(isHomeRequest(pathname)).toBe(true);
    }
  );

  it.each(["/api/upload/start", "/_next/static/chunk.js", "/mypage"])(
    "%s は既存アプリWorkerへ送る",
    (pathname) => {
      expect(isHomeRequest(pathname)).toBe(false);
    }
  );
});
