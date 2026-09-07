// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` does not exist before build, so @ts-expect-error would itself error out post-build
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { runScheduledCleanup } from "./lib/cleanup";
import { recomputeRecentDailyMetrics } from "./lib/analytics/aggregate";
import { deleteExpiredAnalyticsEvents } from "./lib/analytics/retention";

// wrangler.jsonc の triggers.crons で登録した式ごとに処理を振り分ける。
// "10 0 * * *"(毎日UTC 00:10)は計測基盤の日次集計・保持期限切れ削除、
// それ以外(6時間ごと)は既存の期限切れ共有・放置アップロードの掃除。
const ANALYTICS_DAILY_CRON = "10 0 * * *";

export default {
  fetch: handler.fetch,

  async scheduled(event, env) {
    if (event.cron === ANALYTICS_DAILY_CRON) {
      await recomputeRecentDailyMetrics(env);
      await deleteExpiredAnalyticsEvents(env);

      return;
    }

    await runScheduledCleanup(env);
  },
} satisfies ExportedHandler<CloudflareEnv>;
