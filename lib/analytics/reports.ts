// 管理ダッシュボード(要件定義書25〜29章)向けの集計クエリ群。
//
// Overviewは分析用に前計算済みのanalytics_daily_metrics(24ヶ月以上保持)を
// 読む。Funnel/Reliability/Acquisition/Retention/Recipient Growthは、
// daily_metricsに含まれない粒度(event_name別・properties別・属性別)の
// 内訳が必要なため、90日保持のanalytics_eventsを直接集計する
// (要件書22章の90日という保持期間とRetentionダッシュボードの最大観測
// 期間=90日が一致しているのはこのため)。

import { collectDailyMetrics } from "@/lib/analytics/aggregate";

export type OverviewReport = {
  today: {
    successfulTransfers: number;
    uniqueSenders: number;
    uploadSuccessRate: number | null;
    downloadSuccessRate: number | null;
  };
  last30Days: {
    uniqueSenders: number;
    successfulTransfers: number;
    newSenders: number;
    repeatSenderRate: number | null;
    recipientToSenderConversions: number;
  };
};

function toUtcDateString(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function daysAgo(date: Date, days: number): Date {
  return new Date(date.getTime() - days * 24 * 60 * 60 * 1000);
}

async function sumDailyMetrics(
  db: D1Database,
  fromDate: string,
  toDate: string
): Promise<{
  uniqueSenders: number;
  newSenders: number;
  uploadStarts: number;
  uploadSuccesses: number;
  downloadStarts: number;
  downloadSuccesses: number;
  successfulTransfers: number;
  recipientToSenderConversions: number;
}> {
  const row = await db
    .prepare(
      `
        SELECT
          COALESCE(SUM(unique_senders), 0) AS unique_senders,
          COALESCE(SUM(new_senders), 0) AS new_senders,
          COALESCE(SUM(upload_starts), 0) AS upload_starts,
          COALESCE(SUM(upload_successes), 0) AS upload_successes,
          COALESCE(SUM(download_starts), 0) AS download_starts,
          COALESCE(SUM(download_successes), 0) AS download_successes,
          COALESCE(SUM(successful_transfers), 0) AS successful_transfers,
          COALESCE(SUM(recipient_to_sender_conversions), 0) AS recipient_to_sender_conversions
        FROM analytics_daily_metrics
        WHERE date BETWEEN ? AND ?
      `
    )
    .bind(fromDate, toDate)
    .first<{
      unique_senders: number;
      new_senders: number;
      upload_starts: number;
      upload_successes: number;
      download_starts: number;
      download_successes: number;
      successful_transfers: number;
      recipient_to_sender_conversions: number;
    }>();

  return {
    uniqueSenders: row?.unique_senders ?? 0,
    newSenders: row?.new_senders ?? 0,
    uploadStarts: row?.upload_starts ?? 0,
    uploadSuccesses: row?.upload_successes ?? 0,
    downloadStarts: row?.download_starts ?? 0,
    downloadSuccesses: row?.download_successes ?? 0,
    successfulTransfers: row?.successful_transfers ?? 0,
    recipientToSenderConversions: row?.recipient_to_sender_conversions ?? 0,
  };
}

function rate(numerator: number, denominator: number): number | null {
  return denominator > 0 ? numerator / denominator : null;
}

// 要件書5.3章。「初回upload_successから30日以内に2回目のupload_successを
// 行ったクライアント数」÷「30日間の観測が終了した新規senderの数」。
// daily_metricsだけでは計算できない(クライアント単位の追跡が必要)ため、
// analytics_eventsを直接見る。
async function computeRepeatSenderRate(
  db: D1Database,
  now: Date
): Promise<number | null> {
  const observationEnd = daysAgo(now, 30).toISOString();
  const lookbackStart = daysAgo(now, 90).toISOString();

  const row = await db
    .prepare(
      `
        WITH first_upload AS (
          SELECT anonymous_client_id, MIN(occurred_at) AS first_at
          FROM analytics_events
          WHERE event_name = 'upload_success' AND occurred_at BETWEEN ? AND ?
          GROUP BY anonymous_client_id
        ),
        eligible AS (
          SELECT anonymous_client_id, first_at
          FROM first_upload
          WHERE first_at <= ?
        ),
        repeaters AS (
          SELECT e.anonymous_client_id
          FROM eligible e
          WHERE EXISTS (
            SELECT 1 FROM analytics_events u
            WHERE u.event_name = 'upload_success'
              AND u.anonymous_client_id = e.anonymous_client_id
              AND u.occurred_at > e.first_at
              AND u.occurred_at <= strftime('%Y-%m-%dT%H:%M:%fZ', e.first_at, '+30 days')
              AND u.occurred_at BETWEEN ? AND ?
          )
        )
        SELECT
          (SELECT COUNT(*) FROM eligible) AS eligible_count,
          (SELECT COUNT(*) FROM repeaters) AS repeat_count
      `
    )
    .bind(lookbackStart, observationEnd, lookbackStart, observationEnd, observationEnd)
    .first<{ eligible_count: number; repeat_count: number }>();

  return rate(row?.repeat_count ?? 0, row?.eligible_count ?? 0);
}

export async function getOverviewReport(
  env: CloudflareEnv,
  now: Date = new Date()
): Promise<OverviewReport> {
  const db = env.DB;
  const today = toUtcDateString(now);
  const last30Start = toUtcDateString(daysAgo(now, 29));
  const yesterday = toUtcDateString(daysAgo(now, 1));

  const todayMetrics = await collectDailyMetrics(env, today, {
    limitRelatedEventsToRange: true,
  });
  const [last30, repeatSenderRate] = await Promise.all([
    sumDailyMetrics(db, last30Start, yesterday),
    computeRepeatSenderRate(db, now),
  ]);

  return {
    today: {
      successfulTransfers: todayMetrics.successfulTransfers,
      uniqueSenders: todayMetrics.uniqueSenders,
      uploadSuccessRate: rate(todayMetrics.uploadSuccesses, todayMetrics.uploadStarts),
      downloadSuccessRate: rate(
        todayMetrics.downloadSuccesses,
        todayMetrics.downloadStarts
      ),
    },
    last30Days: {
      uniqueSenders: last30.uniqueSenders + todayMetrics.uniqueSenders,
      successfulTransfers: last30.successfulTransfers + todayMetrics.successfulTransfers,
      newSenders: last30.newSenders + todayMetrics.newSenders,
      repeatSenderRate,
      recipientToSenderConversions:
        last30.recipientToSenderConversions + todayMetrics.recipientToSenderConversions,
    },
  };
}

// 要件書26章。landing_view → file_select → upload_start → upload_success →
// share(link_copy/native) → download_success の各段階の件数とConversion/Drop率。
export type FunnelStep = {
  name: string;
  count: number;
  conversionRateFromPrevious: number | null;
};

export type FunnelReport = { steps: FunnelStep[] };

const FUNNEL_STEP_NAMES = [
  "landing_view",
  "file_select",
  "upload_start",
  "upload_success",
  "share",
  "download_success",
] as const;

export async function getFunnelReport(
  env: CloudflareEnv,
  fromDate: string,
  toDate: string
): Promise<FunnelReport> {
  const from = `${fromDate}T00:00:00.000Z`;
  const to = `${toDate}T23:59:59.999Z`;
  const db = env.DB;

  const counts = await Promise.all([
    countEvents(db, ["landing_view"], from, to),
    countEvents(db, ["file_select"], from, to),
    countEvents(db, ["upload_start"], from, to),
    countEvents(db, ["upload_success"], from, to),
    countEvents(db, ["share_link_copy", "share_native"], from, to),
    countEvents(db, ["download_success"], from, to),
  ]);

  const steps: FunnelStep[] = FUNNEL_STEP_NAMES.map((name, index) => ({
    name,
    count: counts[index],
    conversionRateFromPrevious:
      index === 0 ? null : rate(counts[index], counts[index - 1]),
  }));

  return { steps };
}

async function countEvents(
  db: D1Database,
  eventNames: string[],
  from: string,
  to: string,
  distinctClient = false
): Promise<number> {
  const placeholders = eventNames.map(() => "?").join(", ");
  const select = distinctClient
    ? "COUNT(DISTINCT anonymous_client_id) AS count"
    : "COUNT(*) AS count";
  const row = await db
    .prepare(
      `SELECT ${select} FROM analytics_events WHERE event_name IN (${placeholders}) AND occurred_at BETWEEN ? AND ?`
    )
    .bind(...eventNames, from, to)
    .first<{ count: number }>();

  return row?.count ?? 0;
}

// 要件書30章。エラーコード別発生数・size bucket別/device_class別の成功率。
export type ReliabilityReport = {
  uploadSuccessRate: number | null;
  downloadSuccessRate: number | null;
  uploadErrorsByCode: { code: string; count: number }[];
  downloadErrorsByCode: { code: string; count: number }[];
  successRateBySizeBucket: { bucket: string; successRate: number | null }[];
  successRateByDeviceClass: { deviceClass: string; successRate: number | null }[];
};

export async function getReliabilityReport(
  env: CloudflareEnv,
  fromDate: string,
  toDate: string
): Promise<ReliabilityReport> {
  const from = `${fromDate}T00:00:00.000Z`;
  const to = `${toDate}T23:59:59.999Z`;
  const db = env.DB;

  const [uploadStarts, uploadSuccesses, downloadStarts, downloadSuccesses] =
    await Promise.all([
      countEvents(db, ["upload_start"], from, to),
      countEvents(db, ["upload_success"], from, to),
      countEvents(db, ["download_start"], from, to),
      countEvents(db, ["download_success"], from, to),
    ]);

  const [uploadErrorsByCode, downloadErrorsByCode] = await Promise.all([
    errorsByCode(db, "upload_error", from, to),
    errorsByCode(db, "download_error", from, to),
  ]);

  const [successRateBySizeBucket, successRateByDeviceClass] = await Promise.all([
    successRateBySizeBucketViaAttempt(db, from, to),
    successRateGroupedBy(
      db,
      "device_class",
      "upload_start",
      "upload_success",
      from,
      to
    ),
  ]);

  return {
    uploadSuccessRate: rate(uploadSuccesses, uploadStarts),
    downloadSuccessRate: rate(downloadSuccesses, downloadStarts),
    uploadErrorsByCode,
    downloadErrorsByCode,
    successRateBySizeBucket: successRateBySizeBucket.map(({ key, rate: r }) => ({
      bucket: key,
      successRate: r,
    })),
    successRateByDeviceClass: successRateByDeviceClass.map(({ key, rate: r }) => ({
      deviceClass: key,
      successRate: r,
    })),
  };
}

async function errorsByCode(
  db: D1Database,
  eventName: string,
  from: string,
  to: string
): Promise<{ code: string; count: number }[]> {
  const { results } = await db
    .prepare(
      `
        SELECT json_extract(properties, '$.errorCode') AS code, COUNT(*) AS count
        FROM analytics_events
        WHERE event_name = ? AND occurred_at BETWEEN ? AND ?
        GROUP BY code
        ORDER BY count DESC
      `
    )
    .bind(eventName, from, to)
    .all<{ code: string | null; count: number }>();

  return (results ?? [])
    .filter((row): row is { code: string; count: number } => row.code !== null)
    .map((row) => ({ code: row.code, count: row.count }));
}

// totalSizeBucketはupload_startのpropertiesにしか含まれず(upload_success
// 側には無い)、単純にproperties由来の値でGROUP BYすると開始と成功が別々の
// グループに分かれてしまう。upload_start/upload_successは同じattempt_idを
// 共有するため、attempt_id越しに「そのattemptが成功したか」を判定する。
async function successRateBySizeBucketViaAttempt(
  db: D1Database,
  from: string,
  to: string
): Promise<{ key: string; rate: number | null }[]> {
  const { results } = await db
    .prepare(
      `
        WITH starts AS (
          SELECT attempt_id, json_extract(properties, '$.totalSizeBucket') AS bucket
          FROM analytics_events
          WHERE event_name = 'upload_start' AND occurred_at BETWEEN ? AND ?
        ),
        successes AS (
          SELECT DISTINCT attempt_id FROM analytics_events
          WHERE event_name = 'upload_success' AND occurred_at BETWEEN ? AND ?
        )
        SELECT
          st.bucket AS key,
          COUNT(*) AS starts,
          SUM(CASE WHEN s.attempt_id IS NOT NULL THEN 1 ELSE 0 END) AS successes
        FROM starts st
        LEFT JOIN successes s ON s.attempt_id = st.attempt_id
        GROUP BY st.bucket
      `
    )
    .bind(from, to, from, to)
    .all<{ key: string | null; starts: number; successes: number }>();

  return (results ?? [])
    .filter((row): row is { key: string; starts: number; successes: number } => row.key !== null)
    .map((row) => ({ key: row.key, rate: rate(row.successes, row.starts) }));
}

async function successRateGroupedBy(
  db: D1Database,
  groupExpression: string,
  startEvent: string,
  successEvent: string,
  from: string,
  to: string
): Promise<{ key: string; rate: number | null }[]> {
  const { results } = await db
    .prepare(
      `
        SELECT
          ${groupExpression} AS key,
          SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) AS starts,
          SUM(CASE WHEN event_name = ? THEN 1 ELSE 0 END) AS successes
        FROM analytics_events
        WHERE event_name IN (?, ?) AND occurred_at BETWEEN ? AND ?
        GROUP BY key
      `
    )
    .bind(startEvent, successEvent, startEvent, successEvent, from, to)
    .all<{ key: string | null; starts: number; successes: number }>();

  return (results ?? [])
    .filter((row): row is { key: string; starts: number; successes: number } => row.key !== null)
    .map((row) => ({ key: row.key, rate: rate(row.successes, row.starts) }));
}

// 要件書27章。source/medium/campaign/landing_path別の流入分析。
export type AcquisitionRow = {
  source: string | null;
  medium: string | null;
  campaign: string | null;
  landingPath: string | null;
  sessions: number;
  newSenders: number;
  uploadSuccesses: number;
};

export async function getAcquisitionReport(
  env: CloudflareEnv,
  fromDate: string,
  toDate: string
): Promise<{ rows: AcquisitionRow[] }> {
  const from = `${fromDate}T00:00:00.000Z`;
  const to = `${toDate}T23:59:59.999Z`;

  // newSendersは要件書5.2章の定義(=そのクライアントにとって初めての
  // upload_success)を満たす必要があるため、セッション単位のjoinの中で評価する。
  const { results } = await env.DB.prepare(
    `
      WITH landing AS (
        SELECT session_id, source, medium, campaign, landing_path
        FROM (
          SELECT
            session_id, source, medium, campaign, landing_path,
            ROW_NUMBER() OVER (
              PARTITION BY session_id ORDER BY occurred_at, event_id
            ) AS session_landing_number
          FROM analytics_events
          WHERE event_name = 'landing_view' AND occurred_at BETWEEN ? AND ?
        )
        WHERE session_landing_number = 1
      ),
      session_uploads AS (
        SELECT l.session_id, l.source, l.medium, l.campaign, l.landing_path,
               u.anonymous_client_id, u.occurred_at
        FROM landing l
        JOIN analytics_events u
          ON u.session_id = l.session_id AND u.event_name = 'upload_success'
      ),
      tagged AS (
        SELECT
          su.*,
          NOT EXISTS (
            SELECT 1 FROM analytics_events prev
            WHERE prev.event_name = 'upload_success'
              AND prev.anonymous_client_id = su.anonymous_client_id
              AND prev.occurred_at < su.occurred_at
          ) AS is_new_sender
        FROM session_uploads su
      )
      SELECT
        l.source AS source,
        l.medium AS medium,
        l.campaign AS campaign,
        l.landing_path AS landing_path,
        COUNT(DISTINCT l.session_id) AS sessions,
        COUNT(t.anonymous_client_id) AS upload_successes,
        COUNT(DISTINCT CASE WHEN t.is_new_sender THEN t.anonymous_client_id END) AS new_senders
      FROM landing l
      LEFT JOIN tagged t ON t.session_id = l.session_id
      GROUP BY l.source, l.medium, l.campaign, l.landing_path
      ORDER BY sessions DESC
    `
  )
    .bind(from, to)
    .all<{
      source: string | null;
      medium: string | null;
      campaign: string | null;
      landing_path: string | null;
      sessions: number;
      upload_successes: number;
      new_senders: number;
    }>();

  const rows: AcquisitionRow[] = (results ?? []).map((row) => ({
    source: row.source,
    medium: row.medium,
    campaign: row.campaign,
    landingPath: row.landing_path,
    sessions: row.sessions,
    newSenders: row.new_senders,
    uploadSuccesses: row.upload_successes,
  }));

  return { rows };
}

// 要件書28章。指定期間内に初めてupload_successしたクライアントをコホートとし、
// Day1/7/14/30/60/90時点で再度upload_successしたクライアントの割合を返す。
export type RetentionReport = {
  cohortSize: number;
  dayRates: Record<"1" | "7" | "14" | "30" | "60" | "90", number | null>;
};

const RETENTION_DAY_OFFSETS = [1, 7, 14, 30, 60, 90] as const;

export async function getRetentionReport(
  env: CloudflareEnv,
  fromDate: string,
  toDate: string
): Promise<RetentionReport> {
  const from = `${fromDate}T00:00:00.000Z`;
  const to = `${toDate}T23:59:59.999Z`;
  const db = env.DB;

  const cohortSizeRow = await db
    .prepare(
      `
        WITH first_upload AS (
          SELECT anonymous_client_id, MIN(occurred_at) AS first_at
          FROM analytics_events
          WHERE event_name = 'upload_success'
          GROUP BY anonymous_client_id
        )
        SELECT COUNT(*) AS count
        FROM first_upload
        WHERE first_at BETWEEN ? AND ?
      `
    )
    .bind(from, to)
    .first<{ count: number }>();

  const cohortSize = cohortSizeRow?.count ?? 0;

  const dayRates: RetentionReport["dayRates"] = {
    "1": null,
    "7": null,
    "14": null,
    "30": null,
    "60": null,
    "90": null,
  };

  if (cohortSize === 0) {
    return { cohortSize, dayRates };
  }

  // メンバーごと・オフセットごとにクエリを発行する(N+1)と、コホートが
  // 数百〜数千人規模になった際にD1へのラウンドトリップが線形に増えてしまう。
  // コホートの各メンバーが「初回upload_successからN日後の24時間以内に、
  // 再度upload_successしたか」を、メンバー内の相関サブクエリとして1回の
  // クエリにまとめ、6つのオフセット分の判定列を一度に集計する。
  const selectColumns = RETENTION_DAY_OFFSETS.map(
    (offset) => `
      SUM(CASE WHEN cohort.first_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${offset} days')
        THEN 1 ELSE 0 END) AS eligible_${offset},
      SUM(CASE WHEN EXISTS (
        SELECT 1 FROM analytics_events later
        WHERE later.event_name = 'upload_success'
          AND later.anonymous_client_id = cohort.anonymous_client_id
          AND later.occurred_at >= strftime('%Y-%m-%dT%H:%M:%fZ', cohort.first_at, '+${offset} days')
          AND later.occurred_at < strftime('%Y-%m-%dT%H:%M:%fZ', cohort.first_at, '+${offset + 1} days')
      ) AND cohort.first_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now', '-${offset} days')
        THEN 1 ELSE 0 END) AS day_${offset}
    `
  ).join(",\n");

  const row = await db
    .prepare(
      `
        WITH first_upload AS (
          SELECT anonymous_client_id, MIN(occurred_at) AS first_at
          FROM analytics_events
          WHERE event_name = 'upload_success'
          GROUP BY anonymous_client_id
        ),
        cohort AS (
          SELECT anonymous_client_id, first_at
          FROM first_upload
          WHERE first_at BETWEEN ? AND ?
        )
        SELECT ${selectColumns}
        FROM cohort
      `
    )
    .bind(from, to)
    .first<
      Record<
        `day_${(typeof RETENTION_DAY_OFFSETS)[number]}` |
          `eligible_${(typeof RETENTION_DAY_OFFSETS)[number]}`,
        number
      >
    >();

  for (const offset of RETENTION_DAY_OFFSETS) {
    const retainedCount = row?.[`day_${offset}`] ?? 0;
    const eligibleCount = row?.[`eligible_${offset}`] ?? 0;

    dayRates[String(offset) as keyof RetentionReport["dayRates"]] =
      rate(retainedCount, eligibleCount);
  }

  return { cohortSize, dayRates };
}

// 要件書29章。Recipient→Sender Growth Loopの状況。
export type RecipientGrowthReport = {
  uniqueRecipients: number;
  ctaViews: number;
  ctaClicks: number;
  conversions: number;
  averageDaysToConversion: number | null;
};

export async function getRecipientGrowthReport(
  env: CloudflareEnv,
  fromDate: string,
  toDate: string
): Promise<RecipientGrowthReport> {
  const from = `${fromDate}T00:00:00.000Z`;
  const to = `${toDate}T23:59:59.999Z`;
  const db = env.DB;

  const [uniqueRecipients, ctaViews, ctaClicks] = await Promise.all([
    countRecipients(db, from, to),
    countEvents(db, ["recipient_send_cta_view"], from, to),
    countEvents(db, ["recipient_send_cta_click"], from, to),
  ]);

  const conversionRow = await db
    .prepare(
      `
        WITH recipients AS (
          SELECT DISTINCT de.anonymous_client_id AS client_id, MIN(de.occurred_at) AS became_recipient_at
          FROM analytics_events de
          JOIN analytics_events ue
            ON ue.analytics_transfer_id = de.analytics_transfer_id
            AND ue.event_name = 'upload_success'
          WHERE de.event_name = 'download_success'
            AND de.analytics_transfer_id IS NOT NULL
            AND ue.anonymous_client_id != de.anonymous_client_id
          GROUP BY de.anonymous_client_id
        ),
        conversions AS (
          SELECT us.anonymous_client_id AS client_id, MIN(us.occurred_at) AS converted_at, r.became_recipient_at
          FROM analytics_events us
          JOIN recipients r ON r.client_id = us.anonymous_client_id
          WHERE us.event_name = 'upload_start' AND us.occurred_at > r.became_recipient_at
          GROUP BY us.anonymous_client_id
        )
        SELECT
          COUNT(*) AS count,
          AVG(
            (julianday(converted_at) - julianday(became_recipient_at))
          ) AS avg_days
        FROM conversions
        WHERE converted_at BETWEEN ? AND ?
      `
    )
    .bind(from, to)
    .first<{ count: number; avg_days: number | null }>();

  return {
    uniqueRecipients,
    ctaViews,
    ctaClicks,
    conversions: conversionRow?.count ?? 0,
    averageDaysToConversion: conversionRow?.avg_days ?? null,
  };
}

async function countRecipients(db: D1Database, from: string, to: string): Promise<number> {
  const row = await db
    .prepare(
      `
        SELECT COUNT(DISTINCT de.anonymous_client_id) AS count
        FROM analytics_events de
        JOIN analytics_events ue
          ON ue.analytics_transfer_id = de.analytics_transfer_id
          AND ue.event_name = 'upload_success'
        WHERE de.event_name = 'download_success'
          AND de.analytics_transfer_id IS NOT NULL
          AND de.occurred_at BETWEEN ? AND ?
          AND ue.anonymous_client_id != de.anonymous_client_id
      `
    )
    .bind(from, to)
    .first<{ count: number }>();

  return row?.count ?? 0;
}
