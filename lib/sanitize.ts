// 共有URLは `https://.../d/{shareId}#{復号鍵}` の形式で、鍵はURLフラグメント
// (#以降)に入る。ユーザーが自由記述欄に鍵付きURLを誤って貼り付けても、鍵が
// サーバーに保存されないよう、URLらしき文字列のフラグメント部分を取り除く。
export function stripUrlFragments(text: string): string {
  return text.replace(/(https?:\/\/\S*?)#\S+/gi, "$1");
}
