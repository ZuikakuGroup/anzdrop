import { describe, expect, it } from "vitest";
import { normalizeHomeAssetUrl } from "@/apps/home/home-asset-routing";

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

  it("APIなどのURLを変更しない", () => {
    expect(normalizeHomeAssetUrl("https://anzdrop.com/api/upload/start")).toBe(
      "https://anzdrop.com/api/upload/start"
    );
  });
});
