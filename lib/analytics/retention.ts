// 要件書22章。生イベントは1年で削除し、日次集計(analytics_daily_metrics)
// は削除しない。

export const RAW_EVENT_RETENTION_DAYS = 365;

export async function deleteExpiredAnalyticsEvents(
  env: CloudflareEnv,
  retentionDays: number = RAW_EVENT_RETENTION_DAYS
): Promise<number> {
  const cutoff = new Date(
    Date.now() - retentionDays * 24 * 60 * 60 * 1000
  ).toISOString();

  const result = await env.DB.prepare(
    `DELETE FROM analytics_events WHERE occurred_at < ?`
  )
    .bind(cutoff)
    .run();

  return result.meta.changes ?? 0;
}
