// 要件書12・13章。Query文字列全体やReferrerのURL全体は保持せず、
// 許可されたutm_*パラメータの値とReferrerのホスト名だけをセッション単位で
// 一度だけ取得し、そのセッション内の全イベントへ使い回す(Phase 3で扱う
// First Touch/Last Touchの永続化は対象外)。

const ATTRIBUTION_STORAGE_KEY = "anzdrop_analytics_attribution";

export type Attribution = {
  source?: string;
  medium?: string;
  campaign?: string;
  content?: string;
  term?: string;
};

type StoredAttribution = Attribution & { sessionId: string };

const UTM_PARAM_MAP: Record<keyof Attribution, string> = {
  source: "utm_source",
  medium: "utm_medium",
  campaign: "utm_campaign",
  content: "utm_content",
  term: "utm_term",
};

function extractUtmFromLocation(): Attribution {
  const params = new URL(window.location.href).searchParams;
  const attribution: Attribution = {};

  for (const [field, param] of Object.entries(UTM_PARAM_MAP) as [
    keyof Attribution,
    string,
  ][]) {
    const value = params.get(param);

    if (value) {
      attribution[field] = value.slice(0, 200);
    }
  }

  return attribution;
}

function readReferrerDomain(): string | undefined {
  if (!document.referrer) {
    return undefined;
  }

  try {
    return new URL(document.referrer).hostname;
  } catch {
    return undefined;
  }
}

function readStored(): StoredAttribution | null {
  try {
    const raw = window.localStorage.getItem(ATTRIBUTION_STORAGE_KEY);

    return raw ? (JSON.parse(raw) as StoredAttribution) : null;
  } catch {
    return null;
  }
}

function writeStored(value: StoredAttribution): void {
  try {
    window.localStorage.setItem(ATTRIBUTION_STORAGE_KEY, JSON.stringify(value));
  } catch {
    // 保存できなくても計測自体は継続する(このセッション中は再取得し続ける)。
  }
}

let memoryAttribution: StoredAttribution | null = null;

// 新しいsessionが始まったタイミングでのみ呼ぶ。既存sessionの間は
// 最初に取得した値を使い回す(=シンプルなセッション単位の帰属)。
export function getSessionAttribution(
  sessionId: string,
  isNewSession: boolean
): { attribution: Attribution; referrerDomain?: string } {
  const referrerDomain = isNewSession ? readReferrerDomain() : undefined;

  if (!isNewSession) {
    const stored = readStored() ?? memoryAttribution;

    if (stored && stored.sessionId === sessionId) {
      // eslint-disable-next-line @typescript-eslint/no-unused-vars -- restで残りのフィールドだけ取り出すためsessionIdは意図的に捨てる
      const { sessionId: _sessionId, ...attribution } = stored;

      return { attribution };
    }
  }

  const attribution = extractUtmFromLocation();
  const record: StoredAttribution = { sessionId, ...attribution };

  writeStored(record);
  memoryAttribution = record;

  return { attribution, referrerDomain };
}
