// 要件書21章。Dashboard表示のたびにRaw Eventを集計しないよう、日次で
// analytics_daily_metricsへ書き出す。各カウントはUTC日付(YYYY-MM-DD)単位。
//
// 生イベントの保持期間が90日(lib/analytics/retention.ts)であるため、
// successful_transfersやrecipient_to_sender_conversionsのように「そのtransfer/
// clientの過去全期間」を参照する集計は、90日より前の関連イベントが既に
// 削除されていると正しく数えられない。要件書22章の「90日程度」という
// デフォルト値と合わせて許容している既知の制約(docs/analytics.md参照)。

export type DailyMetrics = {
  date: string;
  uniqueSenders: number;
  newSenders: number;
  uploadStarts: number;
  uploadSuccesses: number;
  downloadStarts: number;
  downloadSuccesses: number;
  successfulTransfers: number;
  recipientToSenderConversions: number;
  sessions: number;
  landingSessions: number;
};

function dayRange(dateUtc: string): { start: string; end: string } {
  return { start: `${dateUtc}T00:00:00.000Z`, end: `${dateUtc}T23:59:59.999Z` };
}

async function countScalar(
  db: D1Database,
  sql: string,
  params: unknown[]
): Promise<number> {
  const row = await db
    .prepare(sql)
    .bind(...params)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

async function countEventName(
  db: D1Database,
  eventName: string,
  start: string,
  end: string,
  distinctClient = false
): Promise<number> {
  const select = distinctClient
    ? "COUNT(DISTINCT anonymous_client_id) AS count"
    : "COUNT(*) AS count";

  return countScalar(
    db,
    `SELECT ${select} FROM analytics_events WHERE event_name = ? AND occurred_at BETWEEN ? AND ?`,
    [eventName, start, end]
  );
}

async function countNewSenders(
  db: D1Database,
  start: string,
  end: string
): Promise<number> {
  return countScalar(
    db,
    `
      SELECT COUNT(DISTINCT anonymous_client_id) AS count
      FROM analytics_events cur
      WHERE cur.event_name = 'upload_success'
        AND cur.occurred_at BETWEEN ? AND ?
        AND NOT EXISTS (
          SELECT 1 FROM analytics_events prev
          WHERE prev.event_name = 'upload_success'
            AND prev.anonymous_client_id = cur.anonymous_client_id
            AND prev.occurred_at < ?
            AND prev.occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-90 days')
        )
    `,
    [start, end, start, start]
  );
}

// 要件書4章。同一analytics_transfer_idについて、upload_successと
// 1件以上のdownload_successの両方が存在する場合を1件とし、初回の
// download_successが発生した日にその1件を計上する(期間で合算しても
// 二重計上しない)。
async function countSuccessfulTransfers(
  db: D1Database,
  start: string,
  end: string,
  limitRelatedEventsToRange: boolean
): Promise<number> {
  if (limitRelatedEventsToRange) {
    return countScalar(
      db,
      `
        SELECT COUNT(DISTINCT download.analytics_transfer_id) AS count
        FROM analytics_events download
        WHERE download.event_name = 'download_success'
          AND download.analytics_transfer_id IS NOT NULL
          AND download.occurred_at BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1 FROM analytics_events upload
            WHERE upload.event_name = 'upload_success'
              AND upload.analytics_transfer_id = download.analytics_transfer_id
              AND upload.occurred_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-90 days') AND download.occurred_at
          )
          AND NOT EXISTS (
            SELECT 1 FROM analytics_events previous_download
            WHERE previous_download.event_name = 'download_success'
              AND previous_download.analytics_transfer_id = download.analytics_transfer_id
              AND previous_download.occurred_at < download.occurred_at
              AND previous_download.occurred_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-90 days') AND download.occurred_at
          )
      `,
      [start, end, start, start]
    );
  }

  return countScalar(
    db,
    `
      WITH first_download AS (
        SELECT analytics_transfer_id, MIN(occurred_at) AS first_download_at
        FROM analytics_events
        WHERE event_name = 'download_success' AND analytics_transfer_id IS NOT NULL
        GROUP BY analytics_transfer_id
      )
      SELECT COUNT(*) AS count
      FROM first_download fd
      WHERE fd.first_download_at BETWEEN ? AND ?
        AND EXISTS (
          SELECT 1 FROM analytics_events up
          WHERE up.event_name = 'upload_success'
            AND up.analytics_transfer_id = fd.analytics_transfer_id
        )
    `,
    [start, end]
  );
}

// 要件書5.4章。「あるtransferをdownload_successした(自分がuploadした
// transferを除く)クライアントが、その後別transferをupload_startした」瞬間を
// Recipient→Sender Conversionとする。upload_startは共有作成のたびに新しい
// shareId(=新しいanalytics_transfer_id)を発行するため、「別transfer」である
// ことは自動的に満たされる。
async function countRecipientToSenderConversions(
  db: D1Database,
  start: string,
  end: string,
  limitRelatedEventsToRange: boolean
): Promise<number> {
  if (limitRelatedEventsToRange) {
    return countScalar(
      db,
      `
        SELECT COUNT(DISTINCT us.anonymous_client_id) AS count
        FROM analytics_events us
        WHERE us.event_name = 'upload_start'
          AND us.occurred_at BETWEEN ? AND ?
          AND EXISTS (
            SELECT 1
            FROM analytics_events de
            JOIN analytics_events ue
              ON ue.analytics_transfer_id = de.analytics_transfer_id
              AND ue.event_name = 'upload_success'
            WHERE de.event_name = 'download_success'
              AND de.analytics_transfer_id IS NOT NULL
              AND de.anonymous_client_id = us.anonymous_client_id
              AND ue.anonymous_client_id != de.anonymous_client_id
              AND de.occurred_at < us.occurred_at
              AND de.occurred_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-90 days') AND us.occurred_at
              AND ue.occurred_at BETWEEN strftime('%Y-%m-%dT%H:%M:%fZ', ?, '-90 days') AND de.occurred_at
          )
      `,
      [start, end, start, start]
    );
  }

  return countScalar(
    db,
    `
      WITH recipients AS (
        SELECT DISTINCT de.anonymous_client_id AS client_id, de.occurred_at AS became_recipient_at
        FROM analytics_events de
        JOIN analytics_events ue
          ON ue.analytics_transfer_id = de.analytics_transfer_id
          AND ue.event_name = 'upload_success'
        WHERE de.event_name = 'download_success'
          AND de.analytics_transfer_id IS NOT NULL
          AND ue.anonymous_client_id != de.anonymous_client_id
      ),
      first_recipient AS (
        SELECT client_id, MIN(became_recipient_at) AS became_recipient_at
        FROM recipients
        GROUP BY client_id
      ),
      conversions AS (
        SELECT us.anonymous_client_id AS client_id, MIN(us.occurred_at) AS converted_at
        FROM analytics_events us
        JOIN first_recipient fr ON fr.client_id = us.anonymous_client_id
        WHERE us.event_name = 'upload_start'
          AND us.occurred_at > fr.became_recipient_at
        GROUP BY us.anonymous_client_id
      )
      SELECT COUNT(*) AS count FROM conversions WHERE converted_at BETWEEN ? AND ?
    `,
    [start, end]
  );
}

export async function computeDailyMetrics(
  env: CloudflareEnv,
  dateUtc: string
): Promise<DailyMetrics> {
  const metrics = await collectDailyMetrics(env, dateUtc);

  await env.DB
    .prepare(
      `
        INSERT OR REPLACE INTO analytics_daily_metrics (
          date, unique_senders, new_senders, upload_starts, upload_successes,
          download_starts, download_successes, successful_transfers,
          recipient_to_sender_conversions, sessions, landing_sessions, computed_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `
    )
    .bind(
      metrics.date,
      metrics.uniqueSenders,
      metrics.newSenders,
      metrics.uploadStarts,
      metrics.uploadSuccesses,
      metrics.downloadStarts,
      metrics.downloadSuccesses,
      metrics.successfulTransfers,
      metrics.recipientToSenderConversions,
      metrics.sessions,
      metrics.landingSessions,
      new Date().toISOString()
    )
    .run();

  return metrics;
}

// Overviewの当日分など、D1への書き込みを伴わない集計に使う。
export async function collectDailyMetrics(
  env: CloudflareEnv,
  dateUtc: string,
  options: { limitRelatedEventsToRange?: boolean } = {}
): Promise<DailyMetrics> {
  const { start, end } = dayRange(dateUtc);
  const db = env.DB;

  const metrics: DailyMetrics = {
    date: dateUtc,
    uniqueSenders: await countEventName(db, "upload_success", start, end, true),
    newSenders: await countNewSenders(db, start, end),
    uploadStarts: await countEventName(db, "upload_start", start, end),
    uploadSuccesses: await countEventName(db, "upload_success", start, end),
    downloadStarts: await countEventName(db, "download_start", start, end),
    downloadSuccesses: await countEventName(db, "download_success", start, end),
    successfulTransfers: await countSuccessfulTransfers(
      db,
      start,
      end,
      options.limitRelatedEventsToRange ?? false
    ),
    recipientToSenderConversions: await countRecipientToSenderConversions(
      db,
      start,
      end,
      options.limitRelatedEventsToRange ?? false
    ),
    sessions: await countScalar(
      db,
      `SELECT COUNT(DISTINCT session_id) AS count FROM analytics_events WHERE occurred_at BETWEEN ? AND ?`,
      [start, end]
    ),
    landingSessions: await countScalar(
      db,
      `SELECT COUNT(DISTINCT session_id) AS count FROM analytics_events WHERE event_name = 'landing_view' AND occurred_at BETWEEN ? AND ?`,
      [start, end]
    ),
  };

  return metrics;
}

export function formatUtcDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

export function yesterdayUtc(now: Date = new Date()): string {
  return formatUtcDate(new Date(now.getTime() - 24 * 60 * 60 * 1000));
}

export async function recomputeRecentDailyMetrics(
  env: CloudflareEnv,
  now: Date = new Date(),
  compute: (env: CloudflareEnv, dateUtc: string) => Promise<DailyMetrics> =
    computeDailyMetrics
): Promise<void> {
  const yesterday = yesterdayUtc(now);
  const precedingDay = yesterdayUtc(new Date(now.getTime() - 24 * 60 * 60 * 1000));

  await compute(env, precedingDay);
  await compute(env, yesterday);
}
