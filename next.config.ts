import os from "node:os";
import path from "node:path";
import type { NextConfig } from "next";
import { initOpenNextCloudflareForDev } from "@opennextjs/cloudflare";

// ローカルD1/R2の永続化先をプロジェクト外(OS一時ディレクトリ)に置く。
// .wrangler/state をプロジェクト内に置くと、その定期的な書き込みを
// Turbopackのファイル監視が変更として検知し続け、再コンパイルのたびに
// 既知のTurbopackパニック("Next.js package not found")を踏んで、
// クライアントへ無限にフルリロードを送り続けてしまうため。
initOpenNextCloudflareForDev({
  persist: {
    path: path.join(os.tmpdir(), "anzdrop-wrangler-state"),
  },
});

const nextConfig: NextConfig = {};

export default nextConfig;