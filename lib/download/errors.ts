// ユーザーに表示してよい文言だけを持つエラー。それ以外の技術的なエラーは
// 汎用メッセージに丸めて表示する(壊れた鍵フラグメントなどでブラウザの
// 生の例外文言がそのまま出てしまうのを防ぐため)。
export class FriendlyError extends Error {}

// ダウンロード対象のファイルがサーバー側で既に消費/削除済み(「1回」設定など)だったことを示す。
// 通常のダウンロード失敗と違い、再試行を促さず一覧からも取り除く。
export class FileGoneError extends FriendlyError {}

export const FILE_GONE_ERROR =
  "このファイルはすでにダウンロード済みか、削除されています。";

export function toFriendlyMessage(err: unknown, fallback: string): string {
  return err instanceof FriendlyError ? err.message : fallback;
}

// 共有メタデータ取得(GET /api/download/[shareId])が失敗したときに、HTTP
// ステータスから利用者向けの文言を決める。ステータスごとの文言をここに集めて
// おくことで、UI コンポーネント(components/download/DownloadPage.tsx)を
// 描画せずに対応関係をテストできる。
export const SUSPENDED_SHARE_MESSAGE =
  "この共有は運営者により一時停止されています。";
export const INVALID_LINK_MESSAGE = "このリンクは無効です。";
export const EXPIRED_LINK_MESSAGE = "このリンクの有効期限が切れています。";
// レート制限(GitHub issue #81)は一時的なもの。「URLが正しいか確認」を促す
// 汎用文言に丸めると、待てば直る状況なのにリンクが壊れていると読めてしまう。
export const RATE_LIMITED_MESSAGE =
  "アクセスが集中しています。しばらく待ってから再読み込みしてください。";

// 復旧の見込みがないエラーは、閉じても空のファイル一覧が表示されるだけで
// 意味を持たないため、UI 側で閉じるボタンを表示しない。レート制限や一時的な
// 失敗はここに含めない(待てば直るので閉じられてよい)。
export const NON_DISMISSIBLE_ERRORS = new Set([
  SUSPENDED_SHARE_MESSAGE,
  INVALID_LINK_MESSAGE,
]);

// 既知のステータスなら表示してよい文言を持つ FriendlyError を、それ以外なら
// null を返す(呼び出し側が汎用エラーへ丸める)。
export function shareLoadErrorFor(status: number): FriendlyError | null {
  switch (status) {
    case 404:
      return new FriendlyError(INVALID_LINK_MESSAGE);
    case 410:
      return new FriendlyError(EXPIRED_LINK_MESSAGE);
    case 403:
      return new FriendlyError(SUSPENDED_SHARE_MESSAGE);
    case 429:
      return new FriendlyError(RATE_LIMITED_MESSAGE);
    default:
      return null;
  }
}
