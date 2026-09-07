// 要件書6・7章。anonymous_client_id / session_id はどちらもクライアント側
// でのみ生成・保存し、サーバーへ生成依頼はしない。localStorageが使えない
// 環境(プライベートモード等)では、送信自体は継続しつつ永続化はあきらめ、
// タブを開いている間だけ有効なメモリ内IDにフォールバックする。

const CLIENT_ID_STORAGE_KEY = "anzdrop_analytics_client_id";
const SESSION_STORAGE_KEY = "anzdrop_analytics_session";

// 30分操作がなければ新しいsessionとして扱う(要件書7章)。
const SESSION_IDLE_TIMEOUT_MS = 30 * 60 * 1000;

type StoredSession = {
  id: string;
  lastActivityAt: number;
};

let memoryClientId: string | null = null;
let memorySession: StoredSession | null = null;

function readLocalStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeLocalStorage(key: string, value: string): boolean {
  try {
    window.localStorage.setItem(key, value);

    return true;
  } catch {
    return false;
  }
}

export function getAnonymousClientId(): string {
  const stored = readLocalStorage(CLIENT_ID_STORAGE_KEY);

  if (stored) {
    return stored;
  }

  if (memoryClientId) {
    return memoryClientId;
  }

  const id = crypto.randomUUID();

  if (!writeLocalStorage(CLIENT_ID_STORAGE_KEY, id)) {
    memoryClientId = id;
  }

  return id;
}

function parseStoredSession(raw: string | null): StoredSession | null {
  if (!raw) {
    return null;
  }

  try {
    const parsed = JSON.parse(raw) as Partial<StoredSession>;

    if (typeof parsed.id === "string" && typeof parsed.lastActivityAt === "number") {
      return { id: parsed.id, lastActivityAt: parsed.lastActivityAt };
    }
  } catch {
    // 壊れた値は無視して新しいsessionを発行する。
  }

  return null;
}

function isSessionExpired(session: StoredSession): boolean {
  return Date.now() - session.lastActivityAt > SESSION_IDLE_TIMEOUT_MS;
}

// 呼び出すたびに「使われた」とみなしてlastActivityAtを更新する
// (アイドル30分の起点は最後の計測イベント発火時刻)。
export function getSessionId(): { sessionId: string; isNewSession: boolean } {
  const stored = parseStoredSession(readLocalStorage(SESSION_STORAGE_KEY));
  const current = stored && !isSessionExpired(stored) ? stored : memorySession;
  const isExpiredOrMissing = !current || isSessionExpired(current);

  const session: StoredSession = isExpiredOrMissing
    ? { id: crypto.randomUUID(), lastActivityAt: Date.now() }
    : { id: current.id, lastActivityAt: Date.now() };

  const serialized = JSON.stringify(session);

  if (!writeLocalStorage(SESSION_STORAGE_KEY, serialized)) {
    memorySession = session;
  }

  return { sessionId: session.id, isNewSession: isExpiredOrMissing };
}
