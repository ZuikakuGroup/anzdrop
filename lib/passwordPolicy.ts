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
//
// なおこれは「自分の共有を弱く作ってしまわないための UI 上のガードレール」で
// あって、強制的な境界ではない。サーバーはパスワードを知らないので検証しようが
// なく、その気になればブラウザの開発者ツールから迂回できる。迂回して困るのは
// 自分の共有だけなので、この線引きで足りる。
//
// 値そのものはここに直接書く(アカウント側のスキーマを import すると、
// クライアントバンドルに zod と API の型定義まで引き込んでしまうため)。
// 両者がずれていないことは tests/lib/passwordPolicy.test.ts で突き合わせる。
export const MIN_SHARE_PASSWORD_LENGTH = 8;
export const MAX_SHARE_PASSWORD_LENGTH = 200;

export const SHARE_PASSWORD_LENGTH_ERROR = `パスワードは${MIN_SHARE_PASSWORD_LENGTH}文字以上${MAX_SHARE_PASSWORD_LENGTH}文字以内で入力してください。`;

export const SHARE_PASSWORD_EMPTY_ERROR = "パスワードを入力してください。";

export type SharePasswordValidationResult =
  | { ok: true }
  | { ok: false; error: string };

// パスワードが長さポリシーを満たすか判定する。前後の空白は落とさず、入力された
// 文字列そのものの長さで見る(アカウント側のスキーマと同じ扱い)。
//
// 長さは String.length(UTF-16 コードユニット数)ではなく Array.from() による
// コードポイント数で数える。絵文字やサロゲートペアを含む文字は 1 文字で 2
// コードユニットを占めるため、String.length だと "𝟙𝟚𝟛𝟜" のような 4 文字が
// 8 文字として最小長を通過してしまい、狙った総当たり耐性が得られない。
// アカウント側の zod スキーマはコードユニット数で数えるため、非BMP文字を含む
// パスワードでのみ判定が食い違う。共有パスワードはサーバーへ送らず、両者が同じ
// 値を検証することもないので、この差による不整合は起きない。
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

// アップロード実行前(components/upload/uploadForm.tsx の upload())のパスワード
// チェック。
//
// 検証するのは共有を新規作成するときだけ。共有作成後の追加アップロードや失敗後の
// 再試行では、鍵は最初のパスワードで既にラップ済みで wrapKeyWithPassword は
// 呼ばれない。それでも入力欄の値を検証してしまうと、既に成立している共有への
// 再試行が無関係な検証エラーで止まる。
//
// 空白だけのパスワードは長さを満たしていても「未入力」として扱う(長さ判定自体は
// トリムしないが、空白のみを実質的なパスワードとして通すのは意図ではない)。
export function checkSharePasswordBeforeUpload(params: {
  isNewShare: boolean;
  usePassword: boolean;
  password: string;
}): SharePasswordValidationResult {
  const { isNewShare, usePassword, password } = params;

  if (!isNewShare || !usePassword) {
    return { ok: true };
  }

  if (!password.trim()) {
    return { ok: false, error: SHARE_PASSWORD_EMPTY_ERROR };
  }

  return validateSharePassword(password);
}
