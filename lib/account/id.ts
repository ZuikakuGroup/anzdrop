import { nanoid } from "nanoid";
import { encodeBase64Url } from "@/lib/crypto/base64";

// shareId(lib/id.ts)より長くする。ログインの総当たり攻撃はアカウントIDの
// 予測不可能性にも依存するため、10文字よりエントロピーを上げておく。
const ACCOUNT_ID_LENGTH = 16;

export function generateAccountId(): string {
  return nanoid(ACCOUNT_ID_LENGTH);
}

// パスワードを忘れた場合の再設定にのみ使う使い捨てコード。
// メールを収集しないため、これを紛失すると運営側でも復旧できない
// (ダウンロード鍵の扱いと同様、ユーザー自身の保管に委ねる)。
const RECOVERY_CODE_BYTES = 24;

export function generateRecoveryCode(): string {
  return encodeBase64Url(crypto.getRandomValues(new Uint8Array(RECOVERY_CODE_BYTES)));
}
