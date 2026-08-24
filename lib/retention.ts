export type Retention = "once" | "1d" | "3d" | "7d";

export const RETENTION_DAYS: Record<Retention, number> = {
  once: 7, // ダウンロード回数上限とは別の、安全弁としての期限
  "1d": 1,
  "3d": 3,
  "7d": 7,
};

export function isRetention(value: unknown): value is Retention {
  return typeof value === "string" && value in RETENTION_DAYS;
}

export function calculateExpiresAt(
  createdAt: Date,
  retention: Retention
): string {
  return new Date(
    createdAt.getTime() + RETENTION_DAYS[retention] * 24 * 60 * 60 * 1000
  ).toISOString();
}

export function maxDownloadsForRetention(
  retention: Retention
): number | null {
  return retention === "once" ? 1 : null;
}
