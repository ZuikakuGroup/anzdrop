import { describe, expect, it, vi } from "vitest";
import {
  isHomeStaticAssetUrl,
  normalizeHomeAssetUrl,
} from "@/apps/home/home-asset-routing";
import { dispatchHomeRequest } from "@/apps/home/home-worker-routing";

describe("トップページのアセットURL", () => {
  it("専用の公開URLをOpenNextの内部アセットURLへ変換する", () => {
    expect(
      normalizeHomeAssetUrl(
        "https://anzdrop.com/_home-next/_next/static/chunks/app.js?cache=1"
      )
    ).toBe("https://anzdrop.com/_next/static/chunks/app.js?cache=1");
  });

  it("画像最適化のURLも同じように変換する", () => {
    expect(
      normalizeHomeAssetUrl(
        "https://anzdrop.com/_home-next/_next/image?url=%2Flogo.svg&w=64&q=75"
      )
    ).toBe(
      "https://anzdrop.com/_next/image?url=%2Flogo.svg&w=64&q=75"
    );
  });

  it("専用プレフィックス付きの静的アセットだけをBindingで取得する", () => {
    expect(
      isHomeStaticAssetUrl(
        "https://anzdrop.com/_home-next/_next/static/chunks/app.css"
      )
    ).toBe(true);
    expect(
      isHomeStaticAssetUrl(
        "https://anzdrop.com/_home-next/_next/image?url=%2Flogo.svg"
      )
    ).toBe(false);
  });

  it("APIなどのURLを変更しない", () => {
    expect(normalizeHomeAssetUrl("https://anzdrop.com/api/upload/start")).toBe(
      "https://anzdrop.com/api/upload/start"
    );
  });

  it("静的アセットを正規化してAssets Bindingへ渡す", async () => {
    const assetsFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("css"));
    const handlerFetch = vi.fn<
      (request: Request, ...args: unknown[]) => Promise<Response>
    >(async () => new Response("handler"));
    const env = { ASSETS: { fetch: assetsFetch } };
    const request = new Request(
      "https://anzdrop.com/_home-next/_next/static/chunks/app.css"
    );

    await dispatchHomeRequest(request, env, {} as ExecutionContext, {
      fetch: handlerFetch,
    });

    expect(assetsFetch).toHaveBeenCalledOnce();
    expect(assetsFetch.mock.calls[0]?.[0]?.url).toBe(
      "https://anzdrop.com/_next/static/chunks/app.css"
    );
    expect(handlerFetch).not.toHaveBeenCalled();
  });

  it("画像最適化を正規化してOpenNextへ渡す", async () => {
    const assetsFetch = vi.fn<(request: Request) => Promise<Response>>(async () => new Response("assets"));
    const handlerFetch = vi.fn<
      (request: Request, ...args: unknown[]) => Promise<Response>
    >(async () => new Response("image"));
    const env = { ASSETS: { fetch: assetsFetch } };
    const request = new Request(
      "https://anzdrop.com/_home-next/_next/image?url=%2Flogo.svg"
    );

    await dispatchHomeRequest(request, env, {} as ExecutionContext, {
      fetch: handlerFetch,
    });

    expect(handlerFetch).toHaveBeenCalledOnce();
    expect(handlerFetch.mock.calls[0]?.[0]?.url).toBe(
      "https://anzdrop.com/_next/image?url=%2Flogo.svg"
    );
    expect(assetsFetch).not.toHaveBeenCalled();
  });
});
