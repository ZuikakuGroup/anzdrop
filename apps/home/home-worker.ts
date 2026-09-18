// eslint-disable-next-line @typescript-eslint/ban-ts-comment -- `.open-next/worker.js` はビルド時に生成される。
// @ts-ignore `.open-next/worker.js` is generated at build time
import { default as handler } from "./.open-next/worker.js";
import {
  isHomeStaticAssetUrl,
  normalizeHomeAssetUrl,
} from "./home-asset-routing";

type HomeWorkerEnv = CloudflareEnv & {
  ASSETS: Fetcher;
};

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
  fetch(request: Request, env: HomeWorkerEnv, ctx: ExecutionContext) {
    const normalizedRequest = normalizeHomeAssetRequest(request);

    // Cloudflareのassets照合は受信URLに対して行われるため、assetPrefixを外した
    // 静的アセットはBindingから明示的に取得する。画像最適化などはOpenNextに任せる。
    if (isHomeStaticAssetUrl(request.url)) {
      return env.ASSETS.fetch(normalizedRequest);
    }

    return handler.fetch(normalizedRequest, env, ctx);
  },
} satisfies ExportedHandler<HomeWorkerEnv>;
