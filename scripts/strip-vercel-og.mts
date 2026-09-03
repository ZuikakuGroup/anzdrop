// OpenNext がビルドした Node.js middleware のバンドルから、このアプリが使って
// いない @vercel/og(OG画像の動的生成ライブラリ)を取り除く。
//
// 背景:
// Cloudflare Workers のスクリプトサイズ上限(無料プランは gzip 3MiB)に対し、
// @vercel/og は resvg.wasm(gzip 約517KiB)・yoga.wasm・ライブラリ本体を合わせて
// gzip 約730KiB を占める。このアプリは ImageResponse / next/og / opengraph-image の
// いずれも使っていないため、これは完全に無駄なバイト数である。
//
// サーバー関数側は @opennextjs/cloudflare 自身が「トレースに @vercel/og が
// 現れなければ throw するシムへ差し替える」最適化を持っており、next.config.ts の
// outputFileTracingExcludes と組み合わせて除外できる。しかし Node.js middleware
// (proxy.ts)のバンドラ(bundle-node-middleware.js)には同じ alias が無く、
// Turbopack ランタイムのパッチが「常に」@vercel/og の import を注入するため、
// 設定だけでは除外できない(このリポジトリが使う @opennextjs/cloudflare 1.20.5
// と、公開されている最新の 1.20.6 のどちらでも同じ)。
// proxy.ts が import する next/server は CommonJS で、Next.js 16 では proxy を
// エッジランタイムで動かすこともできないため、呼び出し側では回避できない。
//
// そのため、ビルド後のバンドルに対してサーバー関数側と同じ「throw するスタブへの
// 差し替え」を行う。構造が想定と違った場合は黙って素通りせず、必ず例外を投げて
// ビルドを失敗させる(気付かないうちに上限を超えて本番デプロイが落ちるのを防ぐ)。
//
// 将来 OG 画像の動的生成を使う場合、または上流で middleware 側にも alias が
// 入った場合は、このスクリプトと package.json の呼び出しを削除すること。

import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";

const MIDDLEWARE_BUNDLE = ".open-next/middleware/handler.mjs";

// esbuild がバンドル内の各モジュールの先頭に出力するコメント。
const MODULE_MARKER =
  "// node_modules/next/dist/compiled/@vercel/og/index.edge.js\n";
// モジュール本体を遅延初期化する esbuild の __esm ラッパー。モジュールの
// 出力はこのラッパーで終わる。
const INIT_MARKER = "var init_index_edge = __esm({\n";
// トップレベル(インデントなし)で __esm の呼び出しを閉じる行。
const END_MARKER = "\n});\n";
// esbuild は各モジュールを空行と `// <モジュールパス>` のコメントで区切る。
// 切り出した範囲の直後がこの区切りであることを、範囲が正しく閉じたことの
// 裏付けとして使う(下の stripVercelOg 内の説明を参照)。
const NEXT_MODULE_MARKER = "\n//";

// スタブ自身の目印。二重実行を「構造が想定と違う」ではなく二重実行として
// 報告するために使う。
const STUB_MARKER =
  "// scripts/strip-vercel-og.mts がライブラリ本体をこのスタブへ置き換えた。";

// 置き換え後のスタブ。バンドル内で参照されるのは `index_edge_exports` と
// `init_index_edge` のみ(呼び出し箇所は
// `await Promise.resolve().then(() => (init_index_edge(), index_edge_exports))`)。
// esbuild のヘルパー(__esm / __export)には依存させず、素の JavaScript で書く。
const STUB = `${MODULE_MARKER}${STUB_MARKER}
function ImageResponse() {
  throw new Error(
    "@vercel/og is not bundled: OG image generation is stripped by scripts/strip-vercel-og.mts"
  );
}
var index_edge_exports = { ImageResponse };
function init_index_edge() {}
`;

/**
 * middleware バンドルから @vercel/og を取り除く。
 *
 * 想定した構造が見つからない場合は例外を投げる。
 */
export function stripVercelOg(code: string): string {
  if (code.includes(STUB_MARKER)) {
    throw new Error(
      "このバンドルは既に @vercel/og を取り除き済みです。" +
        " ビルドをやり直さずにスクリプトを2回実行していないか確認してください。"
    );
  }

  const start = code.indexOf(MODULE_MARKER);
  if (start === -1) {
    throw new Error(
      `@vercel/og のモジュール境界 (${MODULE_MARKER.trim()}) が見つかりませんでした。` +
        " 既にバンドルへ含まれていない可能性があります。含まれていないのであれば" +
        " このスクリプトと package.json からの呼び出しは不要です。"
    );
  }
  if (code.indexOf(MODULE_MARKER, start + MODULE_MARKER.length) !== -1) {
    throw new Error(
      "@vercel/og のモジュール境界が複数見つかりました。バンドル構造が想定と異なります。"
    );
  }

  const initAt = code.indexOf(INIT_MARKER, start);
  if (initAt === -1) {
    throw new Error(
      `@vercel/og モジュールの終端 (${INIT_MARKER.trim()}) が見つかりませんでした。`
    );
  }

  const endAt = code.indexOf(END_MARKER, initAt);
  if (endAt === -1) {
    throw new Error("@vercel/og モジュールを閉じる `});` が見つかりませんでした。");
  }
  const end = endAt + END_MARKER.length;

  // 切り出した範囲の直後が、次のモジュールの区切りコメントであることを確認する。
  //
  // END_MARKER は「行頭の `});`」という弱い目印なので、__esm ラッパー内の
  // テンプレートリテラルなどに同じ並びが現れると、モジュール本体の途中で
  // 範囲が閉じてしまう。その場合ライブラリ本体の残骸がトップレベルに露出し、
  // 構文的に壊れたバンドルができあがる。wasm の import はモジュール先頭に
  // あるため、下の「切り出した範囲に resvg.wasm が含まれるか」の確認だけでは
  // この誤りを検出できない。区切りコメントの確認がその穴を塞ぐ。
  if (!code.startsWith(NEXT_MODULE_MARKER, end)) {
    throw new Error(
      "@vercel/og として切り出した範囲の直後が、次のモジュールの区切りコメントでは" +
        " ありませんでした。モジュール本体の途中で範囲が閉じた可能性があります" +
        "(バンドル構造が想定と異なります)。"
    );
  }

  const removed = code.slice(start, end);
  // 取り除きたかった本体(wasm)が実際にこの範囲へ含まれていたことを確認する。
  // 含まれていなければ範囲の切り出しを誤っているか、上流の構造が変わっている。
  if (!removed.includes("@vercel/og/resvg.wasm")) {
    throw new Error(
      "@vercel/og として切り出した範囲に resvg.wasm の import が含まれていません。" +
        " バンドル構造が想定と異なります。"
    );
  }

  const stripped = code.slice(0, start) + STUB + code.slice(end);

  // 取り残しがないこと(= サイズ削減が実際に効いていること)を確認する。
  for (const leftover of ["@vercel/og/resvg.wasm", "@vercel/og/yoga.wasm"]) {
    if (stripped.includes(leftover)) {
      throw new Error(
        `${leftover} の import がバンドルに残っています。バンドル構造が想定と異なります。`
      );
    }
  }

  return stripped;
}

async function main(): Promise<void> {
  const bundlePath = path.resolve(process.cwd(), MIDDLEWARE_BUNDLE);
  const before = await readFile(bundlePath, "utf8");
  const after = stripVercelOg(before);
  await writeFile(bundlePath, after);

  const savedKiB = Math.round((before.length - after.length) / 1024);
  console.log(
    `Stripped @vercel/og from ${MIDDLEWARE_BUNDLE} (-${savedKiB} KiB uncompressed)`
  );
}

// テストから import されたときは実行しない。
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await main();
}
