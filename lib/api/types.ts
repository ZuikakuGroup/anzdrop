// app/api/**/route.tsの動的セグメント(例: [shareId]、[fileId])を持つルートで
// 7ファイルに重複定義されていたNext.jsのRouteContext型をジェネリックに一元化する。
export type RouteContext<Params extends Record<string, string>> = {
  params: Promise<Params>;
};
