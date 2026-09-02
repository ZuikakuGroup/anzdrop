// 共有のパスワード保護(components/upload/uploadForm.tsx)で使うパスワードの
// 長さポリシー。
//
// 共有パスワードは E2EE の設計上サーバーへ一切送られない(ブラウザ内で KEK 導出に
// 使われるだけ)ため、サーバー側での強制はできず、チェックはクライアントで行う。
// それでも最小長を設けるのは、GET /api/download/[shareId] が誰でも取得できる
// wrappedKey / keySalt に対して、弱いパスワードだと PBKDF2 のオフライン総当たりが
// 現実的になり、「パスワード保護したから URL を公開しても安全」という前提が
// 崩れるため(GitHub issue #80)。値はアカウントのパスワード
// (app/api/account/signup/schema.ts)と揃えている。
export const MIN_SHARE_PASSWORD_LENGTH = 8;
export const MAX_SHARE_PASSWORD_LENGTH = 200;

export const SHARE_PASSWORD_LENGTH_ERROR = `パスワードは${MIN_SHARE_PASSWORD_LENGTH}文字以上${MAX_SHARE_PASSWORD_LENGTH}文字以内で入力してください`;

export type SharePasswordValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// パスワードが長さポリシーを満たすか判定する。前後の空白は落とさず、入力された
// 文字列そのものの長さで見る(アカウント側のスキーマと同じ扱い)。
export function validateSharePassword(
  password: string
): SharePasswordValidationResult {
  const passwordLength = Array.from(password).length;

  if (
    passwordLength < MIN_SHARE_PASSWORD_LENGTH ||
    passwordLength > MAX_SHARE_PASSWORD_LENGTH
  ) {
    return { ok: false, error: SHARE_PASSWORD_LENGTH_ERROR };
  }

  return { ok: true };
}
