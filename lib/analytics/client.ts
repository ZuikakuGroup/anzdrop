import { getAnonymousClientId, getSessionId } from "@/lib/analytics/ids";
import { getSessionAttribution } from "@/lib/analytics/attribution";
import { getDeviceContext } from "@/lib/analytics/device";
import {
  findForbiddenPropertyKeys,
  MAX_EVENTS_PER_BATCH,
  type AnalyticsEventName,
} from "@/lib/analytics/schema";

// 要件書19章「計測処理によるUXへの影響」。このモジュールはどんな内部エラーも
// 呼び出し元(アップロード/ダウンロード処理)へ伝播させない。失敗しても
// ファイル転送そのものは常に続行できる。

const ENDPOINT = "/api/analytics/events";
const FLUSH_INTERVAL_MS = 3000;

export type TrackPayload = {
  analyticsTransferId?: string;
  attemptId?: string;
  properties?: Record<string, unknown>;
};

type QueuedEvent = Record<string, unknown>;

const queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
let lifecycleListenersRegistered = false;

function isDev(): boolean {
  return process.env.NODE_ENV !== "production";
}

// 要件書34章。鍵・URLは出力せず、イベント概要だけをconsoleに出す。
function logForDevelopment(event: QueuedEvent): void {
  if (!isDev()) {
    return;
  }

  const properties = event.properties as Record<string, unknown> | undefined;
  const lines = [
    "[analytics]",
    `event: ${String(event.eventName)}`,
    `client: ${String(event.anonymousClientId).slice(0, 8)}...`,
    `session: ${String(event.sessionId).slice(0, 8)}...`,
  ];

  if (event.analyticsTransferId) {
    lines.push(`transfer: ${String(event.analyticsTransferId).slice(0, 8)}...`);
  }

  if (properties && typeof properties.durationMs === "number") {
    lines.push(`duration: ${properties.durationMs}ms`);
  }

  console.log(lines.join("\n"));
}

function sendBatch(events: QueuedEvent[]): void {
  const body = JSON.stringify({ events });

  try {
    if (typeof navigator.sendBeacon === "function") {
      const blob = new Blob([body], { type: "application/json" });

      if (navigator.sendBeacon(ENDPOINT, blob)) {
        return;
      }
    }
  } catch {
    // sendBeacon非対応/失敗時はfetchへフォールバックする。
  }

  try {
    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => {});
  } catch {
    // 送信自体の失敗はここで握りつぶす。
  }
}

function flush(): void {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }

  if (queue.length === 0) {
    return;
  }

  const batch = queue.splice(0, MAX_EVENTS_PER_BATCH);

  sendBatch(batch);

  if (queue.length > 0) {
    scheduleFlush();
  }
}

function scheduleFlush(): void {
  if (flushTimer) {
    return;
  }

  flushTimer = setTimeout(flush, FLUSH_INTERVAL_MS);
}

function registerLifecycleFlush(): void {
  if (lifecycleListenersRegistered) {
    return;
  }

  lifecycleListenersRegistered = true;

  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") {
      flush();
    }
  });

  window.addEventListener("pagehide", flush);
}

export function track(eventName: AnalyticsEventName, payload?: TrackPayload): void {
  try {
    if (typeof window === "undefined") {
      return;
    }

    if (isDev() && payload?.properties) {
      const forbidden = findForbiddenPropertyKeys(payload.properties);

      if (forbidden.length > 0) {
        throw new Error(
          `[analytics] "${eventName}" に許可されていないプロパティが含まれています: ${forbidden.join(", ")}`
        );
      }
    }

    const anonymousClientId = getAnonymousClientId();
    const { sessionId, isNewSession } = getSessionId();
    const { attribution, referrerDomain } = getSessionAttribution(
      sessionId,
      isNewSession
    );
    const { deviceClass, browserFamily } = getDeviceContext();

    const event: QueuedEvent = {
      eventId: crypto.randomUUID(),
      eventName,
      anonymousClientId,
      sessionId,
      timestamp: new Date().toISOString(),
      context: {
        ...(eventName === "landing_view"
          ? { landingPath: window.location.pathname }
          : {}),
        ...(referrerDomain ? { referrerDomain } : {}),
        deviceClass,
        browserFamily,
        locale: navigator.language,
      },
    };

    if (Object.keys(attribution).length > 0) {
      event.attribution = attribution;
    }

    if (payload?.analyticsTransferId) {
      event.analyticsTransferId = payload.analyticsTransferId;
    }

    if (payload?.attemptId) {
      event.attemptId = payload.attemptId;
    }

    if (payload?.properties) {
      event.properties = payload.properties;
    }

    logForDevelopment(event);

    queue.push(event);
    registerLifecycleFlush();

    if (queue.length >= MAX_EVENTS_PER_BATCH) {
      flush();
    } else {
      scheduleFlush();
    }
  } catch (error) {
    if (isDev()) {
      console.error(error);
    }
  }
}
