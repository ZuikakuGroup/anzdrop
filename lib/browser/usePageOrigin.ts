import { useSyncExternalStore } from "react";

// window.location.origin は SSR 中に取れないため、サーバー描画時は空文字、
// クライアントでは実際の origin を返す。
const noopSubscribe = () => () => {};
const getOriginSnapshot = () => window.location.origin;
const getOriginServerSnapshot = () => "";

export function usePageOrigin(): string {
  return useSyncExternalStore(
    noopSubscribe,
    getOriginSnapshot,
    getOriginServerSnapshot
  );
}
