import { afterAll, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createTestEnv, clearAllTables, type TestEnv } from "@/test/env";
import { bindRouteHandlers } from "@/test/runtime";
import { verifyAccessJwt } from "@/lib/access";
vi.mock("@/lib/access", () => ({ verifyAccessJwt: vi.fn() }));
let env: TestEnv, dispose: () => Promise<void>;
beforeAll(async () => { const handle = await createTestEnv(); env = handle.env; dispose = handle.dispose; });
afterAll(async () => dispose());
beforeEach(async () => { await clearAllTables(env); vi.mocked(verifyAccessJwt).mockReset(); });
async function get(query = "") {
  const { GET } = bindRouteHandlers(await import("@/server/routes/admin/storage/route"), () => ({ env }));
  return GET(new Request(`http://localhost/api/admin/storage?${query}`));
}
it("denies unauthenticated diagnostics", async () => {
  expect((await get()).status).toBe(403);
});
it.each(["limit=0", "limit=41", "limit=101", "limit=1.1", "limit=NaN", "limit=1&limit=2", "apply=true", "dryRun=false", "summary=yes", "scan=all", `afterFileId=${"a".repeat(129)}`, `objectCursor=${"a".repeat(4097)}`])("rejects invalid or mutating parameters: %s", async query => {
  vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "admin@example.com" });
  expect((await get(query)).status).toBe(400);
});
it("returns an authorized read-only report without a CSRF requirement", async () => {
  vi.mocked(verifyAccessJwt).mockResolvedValue({ email: "admin@example.com" });
  const response = await get("limit=1");
  expect(response.status).toBe(200);
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  const body = await response.json() as { success: boolean; data: { dryRun: boolean; summary: { registeredFiles: number } } };
  expect(body.success).toBe(true); expect(body.data.dryRun).toBe(true);
  expect(body.data.summary.registeredFiles).toBe(0);
});
