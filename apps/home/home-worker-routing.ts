import {
  isHomeStaticAssetUrl,
  normalizeHomeAssetUrl,
} from "./home-asset-routing";

type HomeHandler<Env> = {
  fetch(request: Request, env: Env, ctx: ExecutionContext): Response | Promise<Response>;
};

type HomeAssetsEnv = {
  ASSETS: Pick<Fetcher, "fetch">;
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

/** 静的アセットはAssets Binding、それ以外はOpenNextへストリーミングで委譲する。 */
export function dispatchHomeRequest<Env extends HomeAssetsEnv>(
  request: Request,
  env: Env,
  ctx: ExecutionContext,
  handler: HomeHandler<Env>
): Response | Promise<Response> {
  const normalizedRequest = normalizeHomeAssetRequest(request);

  // Cloudflareのassets照合は受信URLに対して行われるため、assetPrefixを外した
  // 静的アセットはBindingから明示的に取得する。画像最適化などはOpenNextに任せる。
  if (isHomeStaticAssetUrl(request.url)) {
    return env.ASSETS.fetch(normalizedRequest);
  }

  return handler.fetch(normalizedRequest, env, ctx);
}
