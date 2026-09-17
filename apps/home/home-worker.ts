// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` はビルド時に生成される。
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import { normalizeHomeAssetUrl } from "./home-asset-routing";

function normalizeHomeAssetRequest(request: Request): Request {
  const normalizedUrl = normalizeHomeAssetUrl(request.url);
  if (normalizedUrl === request.url) {
    return request;
  }

  // Next.jsが出力するURLだけをOpenNext標準のアセットURLへ戻す。本文を読まずに
  // Requestをそのまま引き渡すため、大きなアップロードをバッファリングしない。
  return new Request(normalizedUrl, request);
}

export default {
  fetch(request: Request, env: CloudflareEnv, ctx: ExecutionContext) {
    return handler.fetch(normalizeHomeAssetRequest(request), env, ctx);
  },
} satisfies ExportedHandler<CloudflareEnv>;
