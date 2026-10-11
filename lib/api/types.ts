// server/routes/**/route.tsの動的セグメント(例: [shareId]、[fileId])を持つルートで
// 動的パラメータの型を共通化する。
export type RouteContext<Params extends Record<string, string>> = {
  params: Promise<Params>;
};
