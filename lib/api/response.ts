// app/api/**/route.tsで共通して使う「成功時はsuccess:trueに固有フィールドを
// 加えたもの、失敗時はsuccess:falseとerrorメッセージ」という応答形をまとめる
// ジェネリック基底型。各ルートはこれをベースに固有のレスポンス型を定義する。
export type ApiResponse<
  T extends Record<string, unknown> = Record<string, unknown>
> = ({ success: true } & T) | { success: false; error: string };
