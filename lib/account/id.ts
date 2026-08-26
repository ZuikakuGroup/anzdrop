import { encodeBase64Url } from "@/lib/crypto/base64";

// アカウントIDはログイン時にユーザーが毎回入力するため、本人が自由に設定する
// (ランダム発行だとコピペが必須になりログインの手間が大きい)。長さと文字種
// だけを制限する。一意性の保証はサインアップ時のINSERT自体(PRIMARY KEY)に
// 任せる。
export const MIN_ACCOUNT_ID_LENGTH = 3;
export const MAX_ACCOUNT_ID_LENGTH = 32;
const ACCOUNT_ID_PATTERN = /^[a-zA-Z0-9_-]+$/;

export function isValidAccountId(accountId: string): boolean {
  return (
    accountId.length >= MIN_ACCOUNT_ID_LENGTH &&
    accountId.length <= MAX_ACCOUNT_ID_LENGTH &&
    ACCOUNT_ID_PATTERN.test(accountId)
  );
}

// パスワードを忘れた場合の再設定にのみ使う使い捨てコード。
// メールを収集しないため、これを紛失すると運営側でも復旧できない
// (ダウンロード鍵の扱いと同様、ユーザー自身の保管に委ねる)。
const RECOVERY_CODE_BYTES = 24;

export function generateRecoveryCode(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES)));
}
