import { z } from "zod";

// 計測基盤要件定義書 v1.0 の Phase 1 + Phase 2 スコープで定義された
// イベント名のみを許可する(37章・38章)。ここに無い event_name は
// リクエストごと reject する(要件書18章)。
export const ANALYTICS_EVENT_NAMES = [
  "landing_view",
  "file_select",
  "upload_start",
  "upload_success",
  "upload_error",
  "share_link_copy",
  "share_native",
  "download_start",
  "download_success",
  "download_error",
  "recipient_send_cta_view",
  "recipient_send_cta_click",
] as const;

export type AnalyticsEventName = (typeof ANALYTICS_EVENT_NAMES)[number];

// 要件書31章の定義済みエラーコード。自由形式メッセージは送信しない。
export const UPLOAD_ERROR_CODES = [
  "UPLOAD_NETWORK_ERROR",
  "UPLOAD_STORAGE_ERROR",
  "UPLOAD_TIMEOUT",
  "UPLOAD_ENCRYPTION_ERROR",
  "UPLOAD_CANCELLED",
  "UPLOAD_UNKNOWN",
] as const;
export type UploadErrorCode = (typeof UPLOAD_ERROR_CODES)[number];

export const DOWNLOAD_ERROR_CODES = [
  "DOWNLOAD_NETWORK_ERROR",
  "DOWNLOAD_NOT_FOUND",
  "DOWNLOAD_EXPIRED",
  "DOWNLOAD_DECRYPTION_ERROR",
  "DOWNLOAD_CANCELLED",
  "DOWNLOAD_UNKNOWN",
] as const;
export type DownloadErrorCode = (typeof DOWNLOAD_ERROR_CODES)[number];

// 要件書11章。正確なバイト数ではなくbucket化された値のみ送信する。
export const SIZE_BUCKETS = [
  "<10MB",
  "10-100MB",
  "100MB-500MB",
  "500MB-1GB",
  "1GB-5GB",
  "5GB-10GB",
  "10GB+",
] as const;
export type SizeBucket = (typeof SIZE_BUCKETS)[number];

export const DEVICE_CLASSES = ["desktop", "mobile", "tablet", "unknown"] as const;
export type DeviceClass = (typeof DEVICE_CLASSES)[number];

export const MAX_EVENTS_PER_BATCH = 20;

// 要件書33章「Privacy Guard」。各イベントのproperty allowlist(下記の
// `.strict()`スキーマ)自体が未知キーを弾くため二重の防御になるが、
// 「将来誰かがこのファイルにこの名前のキーをうっかり追加してしまう」事故を
// 早期に検知できるよう、キー名そのものを名指しで禁止するチェックを独立させる。
export const FORBIDDEN_PROPERTY_KEYS = [
  "filename",
  "fileName",
  "key",
  "encryptionKey",
  "decryptionKey",
  "url",
  "fullUrl",
  "hash",
  "fragment",
  "email",
  "ip",
  "ipAddress",
] as const;

export function findForbiddenPropertyKeys(properties: unknown): string[] {
  if (!properties || typeof properties !== "object" || Array.isArray(properties)) {
    return [];
  }

  const forbidden: readonly string[] = FORBIDDEN_PROPERTY_KEYS;

  return Object.keys(properties as Record<string, unknown>).filter((key) =>
    forbidden.includes(key)
  );
}

// D1で時刻を文字列比較するため、曖昧なDate.parse()ではなく、UTCの厳密な
// ISO 8601表記だけを受け付ける。
const isoTimestamp = z.iso.datetime();

// HMAC-SHA256のhex digest(64文字)を基本としつつ、将来アルゴリズムを
// 変えても壊れないよう長さの範囲だけを検証する。
const analyticsTransferId = z
  .string()
  .regex(/^[0-9a-f]+$/i)
  .min(32)
  .max(128);

const attemptId = z.string().uuid();

// 要件書12章。utm_*のうち許可された値のみ、キーごとに個別取得する
// (Query文字列全体は保持しない)。
export const AttributionSchema = z
  .object({
    source: z.string().max(200).optional(),
    medium: z.string().max(200).optional(),
    campaign: z.string().max(200).optional(),
    content: z.string().max(200).optional(),
    term: z.string().max(200).optional(),
  })
  .strict()
  .optional();

// 要件書13章。referrerはホスト名のみ保持する。
function isPathname(value: string): boolean {
  if (!value.startsWith("/") || value.startsWith("//") || /[?#]/.test(value)) {
    return false;
  }

  return new URL(value, "https://anzdrop.invalid").pathname === value;
}

function isHostname(value: string): boolean {
  if (!value || /[/?#@:\s]/.test(value)) {
    return false;
  }

  try {
    const hostname = new URL(`https://${value}`).hostname;
    const isIpAddress = /^\d{1,3}(?:\.\d{1,3}){3}$/.test(hostname);

    return hostname === value && !isIpAddress;
  } catch {
    return false;
  }
}

export const ContextSchema = z
  .object({
    landingPath: z.string().max(500).refine(isPathname, "landingPath must be a pathname").optional(),
    referrerDomain: z.string().max(255).refine(isHostname, "referrerDomain must be a hostname").optional(),
    deviceClass: z.enum(DEVICE_CLASSES).optional(),
    browserFamily: z.string().max(100).optional(),
    locale: z.string().max(35).optional(),
  })
  .strict()
  .optional();

const CommonFields = {
  eventId: z.string().uuid(),
  anonymousClientId: z.string().min(1).max(100),
  sessionId: z.string().min(1).max(100),
  timestamp: isoTimestamp,
  attribution: AttributionSchema,
  context: ContextSchema,
};

const LandingViewEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("landing_view"),
    properties: z.object({}).strict().optional(),
  })
  .strict();

const FileSelectEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("file_select"),
    properties: z
      .object({
        fileCount: z.number().int().positive().max(10_000),
        totalSizeBucket: z.enum(SIZE_BUCKETS),
      })
      .strict(),
  })
  .strict();

const UploadStartEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("upload_start"),
    attemptId,
    analyticsTransferId,
    properties: z
      .object({
        fileCount: z.number().int().positive().max(10_000).optional(),
        totalSizeBucket: z.enum(SIZE_BUCKETS).optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const UploadSuccessEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("upload_success"),
    attemptId,
    analyticsTransferId,
    properties: z
      .object({
        durationMs: z
          .number()
          .int()
          .nonnegative()
          .max(24 * 60 * 60 * 1000),
      })
      .strict(),
  })
  .strict();

const UploadErrorEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("upload_error"),
    attemptId,
    analyticsTransferId: analyticsTransferId.optional(),
    properties: z
      .object({
        errorCode: z.enum(UPLOAD_ERROR_CODES),
        errorStage: z.string().min(1).max(100),
        retryCount: z.number().int().nonnegative().max(1000),
      })
      .strict(),
  })
  .strict();

const ShareLinkCopyEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("share_link_copy"),
    analyticsTransferId,
    properties: z.object({}).strict().optional(),
  })
  .strict();

const ShareNativeEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("share_native"),
    analyticsTransferId,
    properties: z.object({}).strict().optional(),
  })
  .strict();

const DownloadStartEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("download_start"),
    attemptId,
    analyticsTransferId,
    properties: z.object({}).strict().optional(),
  })
  .strict();

const DownloadSuccessEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("download_success"),
    attemptId,
    analyticsTransferId,
    properties: z
      .object({
        durationMs: z
          .number()
          .int()
          .nonnegative()
          .max(24 * 60 * 60 * 1000),
      })
      .strict(),
  })
  .strict();

const DownloadErrorEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("download_error"),
    attemptId,
    analyticsTransferId,
    properties: z
      .object({
        errorCode: z.enum(DOWNLOAD_ERROR_CODES),
        errorStage: z.string().min(1).max(100),
        retryCount: z.number().int().nonnegative().max(1000),
      })
      .strict(),
  })
  .strict();

const RecipientSendCtaViewEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("recipient_send_cta_view"),
    analyticsTransferId,
    properties: z.object({}).strict().optional(),
  })
  .strict();

const RecipientSendCtaClickEvent = z
  .object({
    ...CommonFields,
    eventName: z.literal("recipient_send_cta_click"),
    analyticsTransferId,
    properties: z.object({}).strict().optional(),
  })
  .strict();

export const AnalyticsEventSchema = z.discriminatedUnion("eventName", [
  LandingViewEvent,
  FileSelectEvent,
  UploadStartEvent,
  UploadSuccessEvent,
  UploadErrorEvent,
  ShareLinkCopyEvent,
  ShareNativeEvent,
  DownloadStartEvent,
  DownloadSuccessEvent,
  DownloadErrorEvent,
  RecipientSendCtaViewEvent,
  RecipientSendCtaClickEvent,
]);

export type AnalyticsEvent = z.infer<typeof AnalyticsEventSchema>;

export const AnalyticsEventsRequestSchema = z
  .object({
    events: z.array(AnalyticsEventSchema).min(1).max(MAX_EVENTS_PER_BATCH),
  })
  .strict();

export type AnalyticsEventsRequest = z.infer<typeof AnalyticsEventsRequestSchema>;

const SENSITIVE_VALUE_PATTERNS = [
  /(?:https?:\/\/|[?#])/i,
  /\b[\w.+-]+@[\w-]+(?:\.[\w-]+)+\b/,
  /(?:^|[?&])(filename|key|encryptionkey|decryptionkey|url|hash|fragment|email|ip(?:address)?)=/i,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/,
  /(?:\+?\d[\d\s().-]{7,}\d)/,
  /[A-Za-z0-9_-]{43,}/,
] as const;

function isAbsoluteOrProtocolRelativeUrl(value: string): boolean {
  if (value.startsWith("//")) {
    return true;
  }

  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

// Propertiesのキーだけでなく、直接APIへ送られる各文字列値にもPrivacy Guardを
// 適用する。値そのものはログへ出さず、D1へ書き込む前にリクエスト全体を拒否する。
export function findForbiddenAnalyticsValueFields(event: AnalyticsEvent): string[] {
  const errorStage =
    event.eventName === "upload_error" || event.eventName === "download_error"
      ? event.properties.errorStage
      : undefined;

  const values: Record<string, string | undefined> = {
    anonymousClientId: event.anonymousClientId,
    sessionId: event.sessionId,
    source: event.attribution?.source,
    medium: event.attribution?.medium,
    campaign: event.attribution?.campaign,
    content: event.attribution?.content,
    term: event.attribution?.term,
    landingPath: event.context?.landingPath,
    referrerDomain: event.context?.referrerDomain,
    browserFamily: event.context?.browserFamily,
    locale: event.context?.locale,
    errorStage,
  };

  return Object.entries(values)
    .filter(
      ([, value]) =>
        value !== undefined &&
        (isAbsoluteOrProtocolRelativeUrl(value) ||
          SENSITIVE_VALUE_PATTERNS.some((pattern) => pattern.test(value)))
    )
    .map(([field]) => field);
}
