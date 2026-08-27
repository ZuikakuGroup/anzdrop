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
