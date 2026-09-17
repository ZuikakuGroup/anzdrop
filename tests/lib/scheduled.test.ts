import { beforeEach, describe, expect, it, vi } from "vitest";

const { recomputeRecentDailyMetrics, deleteExpiredAnalyticsEvents, runScheduledCleanup } =
  vi.hoisted(() => ({
    recomputeRecentDailyMetrics: vi.fn(),
    deleteExpiredAnalyticsEvents: vi.fn(),
    runScheduledCleanup: vi.fn(),
  }));

vi.mock("@/lib/analytics/aggregate", () => ({ recomputeRecentDailyMetrics }));
vi.mock("@/lib/analytics/retention", () => ({ deleteExpiredAnalyticsEvents }));
vi.mock("@/lib/cleanup", () => ({ runScheduledCleanup }));

import { runScheduledTask } from "@/lib/scheduled";

describe("runScheduledTask", () => {
  const env = {} as CloudflareEnv;

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("runs analytics aggregation and retention for the daily cron", async () => {
    await runScheduledTask({ cron: "10 0 * * *" }, env);

    expect(recomputeRecentDailyMetrics).toHaveBeenCalledWith(env);
    expect(deleteExpiredAnalyticsEvents).toHaveBeenCalledWith(env);
    expect(runScheduledCleanup).not.toHaveBeenCalled();
  });

  it("runs cleanup for the six-hour cron", async () => {
    await runScheduledTask({ cron: "0 */6 * * *" }, env);

    expect(runScheduledCleanup).toHaveBeenCalledWith(env);
    expect(recomputeRecentDailyMetrics).not.toHaveBeenCalled();
    expect(deleteExpiredAnalyticsEvents).not.toHaveBeenCalled();
  });
});
