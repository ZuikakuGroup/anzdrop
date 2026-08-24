import { AES_KEY_LENGTH } from "@/lib/crypto/types";

// 復号鍵はAES-256-GCM鍵(AES_KEY_LENGTHビット)をbase64url(パディングなし)で
// エンコードした固定長文字列になる。base64は6bitを1文字にエンコードするため、
// 文字数は ceil(鍵のビット長 / 6) で決まる(256bit鍵なら43文字)。
const ENCODED_KEY_LENGTH = Math.ceil(AES_KEY_LENGTH / 6);
const BASE64URL_CHARS = "A-Za-z0-9_-";

const URL_FRAGMENT_CHARS = "A-Za-z0-9\\-._~%!$&'()*+,;=:@\\/?";

// 共有URLは `https://.../d/{shareId}#{復号鍵}` の形式で、鍵はURLフラグメント
// (#以降)に入る。ユーザーが自由記述欄に鍵付きURLを誤って貼り付けても、鍵が
// サーバーに保存されないよう、URLらしき文字列のフラグメント部分を取り除く。
//
// フラグメント部分は `\S+`(空白以外すべて)ではなく、RFC3986でURLフラグメントに
// 許される文字集合(英数字・一部記号)だけにマッチさせる。日本語などの非ASCII文字は
// この文字集合に含まれないため、「鍵付きURLの直後にスペースなしで文章が続く」場合
// (例: `${url}が大変なことになっています`)でも、鍵だけを取り除いて後続の文章は
// 失わずに残せる。
function stripUrlFragments(text: string): string {
  const pattern = new RegExp(
    `(https?:\\/\\/\\S*?)#[${URL_FRAGMENT_CHARS}]+`,
    "gi"
  );
  return text.replace(pattern, "$1");
}

// URLの形をしていなくても、「id1234の復号鍵は XXXX です」のように鍵の文字列
// そのものが本文に書き写されるケースがある。鍵はbase64urlでENCODED_KEY_LENGTH
// 文字固定なので、その文字種が「ちょうど」その長さだけ連続する箇所を除去する…
// と考えたいところだが、それだと鍵の前後に英数字が1文字でもくっついた場合
// (例: 「鍵はXXXX…Zです」)に完全一致しなくなり、正規表現が一切マッチせず
// 鍵がまるごと残ってしまう(=安全側とは逆方向の失敗)。
// そのため「ちょうど」ではなく「ENCODED_KEY_LENGTH文字以上」連続する
// base64url文字列を、そのひと続き全体ごと除去する。こうすれば鍵の前後に
// 余計な文字がくっついていても、その連続部分ごと確実に取り除ける。
// ランダムな文章中に偶然この条件(43文字以上の英数字+`-`/`_`の連続)が
// 出現する可能性は無視できるほど低く、万一誤って本文の一部が消えたとしても
// 「情報が減る」だけで鍵の漏洩よりはるかに安全な失敗方向。
function redactStandaloneKeys(text: string): string {
  const pattern = new RegExp(`[${BASE64URL_CHARS}]{${ENCODED_KEY_LENGTH},}`, "g");
  return text.replace(pattern, "");
}

// 通報フォームの自由記述欄などから、E2EE復号鍵が誤って(あるいは意図せず)
// 平文でサーバーに送信・保存されるのを防ぐためのサニタイズ。
// URL埋め込み・単独貼り付けの両方のケースに対応する。
export function sanitizeReportText(text: string): string {
  return redactStandaloneKeys(stripUrlFragments(text));
}
