import { defineConfig, type Plugin } from "vitest/config";
import path from "node:path";
import { readFile } from "node:fs/promises";

// lib/account/wasm-argon2/*.wasm は「あらかじめコンパイル済みの
// WebAssembly.Moduleをimportする」というCloudflare Workers本番の静的import
// 前提で書かれている(理由はlib/account/wasm-argon2/wasm-interface.tsの
// コメントを参照)。Vite/Vitestの既定のアセット扱い(URL文字列を返す)では
// この前提に合わないため、テスト実行時のみ「ファイルを読み込んで
// WebAssembly.compile()した結果をdefault exportする」モジュールとして
// 解決するプラグインを挟む。
function wasmAsCompiledModulePlugin(): Plugin {
  return {
    name: "wasm-as-compiled-module",
    enforce: "pre",
    async load(id) {
      if (!id.endsWith(".wasm")) {
        return null;
      }

      const bytes = await readFile(id);
      const base64 = bytes.toString("base64");

      return `
        const bytes = Buffer.from("${base64}", "base64");
        const compiledModule = await WebAssembly.compile(bytes);
        export default compiledModule;
      `;
    },
  };
}

export default defineConfig({
  plugins: [wasmAsCompiledModulePlugin()],
  test: {
    environment: "node",
    include: ["**/*.test.ts"],
    exclude: ["node_modules/**", ".next/**", ".open-next/**"],
    // Some E2EE stream tests deliberately push multi-megabyte payloads
    // (real CHUNK_SIZE boundaries) through AES-GCM; that's slow in this
    // environment's software crypto path, so the default 5s is too tight.
    testTimeout: 60_000,
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "."),
    },
  },
});
