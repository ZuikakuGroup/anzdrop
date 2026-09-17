// CSPの内容は既存アプリと必ず一致させる。処理本体を共有し、トップページ専用の
// 静的アセットだけはnonce生成の対象から外してエッジキャッシュを妨げない。
export { proxy } from "../../proxy";

export const config = {
  matcher: [
    {
      source: "/((?!_next/static|_next/image|_home-next/_next/static|_home-next/_next/image|favicon.ico).*)",
      missing: [
        { type: "header", key: "next-router-prefetch" },
        { type: "header", key: "purpose", value: "prefetch" },
      ],
    },
  ],
};
