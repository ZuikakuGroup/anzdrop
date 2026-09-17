// 定期処理はHTTPリクエストでは使わない。静的importにするとトップページを含む
// 全リクエストでバッチ処理の依存グラフまで評価対象になるため、cron実行時だけ読む。
const ANALYTICS_DAILY_CRON = "10 0 * * *";

export type ScheduledEventLike = Pick<ScheduledEvent, "cron">;

export async function runScheduledTask(
  event: ScheduledEventLike,
  env: CloudflareEnv,
): Promise<void> {
  if (event.cron === ANALYTICS_DAILY_CRON) {
    const [{ recomputeRecentDailyMetrics }, { deleteExpiredAnalyticsEvents }] =
      await Promise.all([
        import("./analytics/aggregate"),
        import("./analytics/retention"),
      ]);

    await recomputeRecentDailyMetrics(env);
    await deleteExpiredAnalyticsEvents(env);

    return;
  }

  const { runScheduledCleanup } = await import("./cleanup");
  await runScheduledCleanup(env);
}
