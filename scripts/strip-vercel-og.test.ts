import { describe, expect, it } from "vitest";
import { stripVercelOg } from "./strip-vercel-og.mjs";

// @opennextjs/cloudflare がビルドする .open-next/middleware/handler.mjs の、
// @vercel/og モジュール周辺の構造を再現した最小のバンドル。
// 実物と同じく「モジュール境界コメント → exports 定義 → wasm の static import →
// トップレベルへ巻き上げられた関数群 → __esm ラッパー」の順に並ぶ。
function buildFakeBundle(options?: {
  ogBody?: string;
  initWrapperBody?: string;
  omitInitWrapper?: boolean;
}): string {
  const ogBody =
    options?.ogBody ??
    `function parseAlpha(alpha) {
  return alpha;
}
var ImageResponse;
`;
  const initWrapperBody =
    options?.initWrapperBody ??
    `    ImageResponse = class extends Response {
    };
`;
  const initWrapper = options?.omitInitWrapper
    ? ""
    : `var init_index_edge = __esm({
  "node_modules/next/dist/compiled/@vercel/og/index.edge.js"() {
${initWrapperBody}  }
});
`;

  return `// node-builtins:node:worker_threads
import * as mod from "node:worker_threads";

// node_modules/next/dist/compiled/@vercel/og/index.edge.js
var index_edge_exports = {};
__export(index_edge_exports, {
  ImageResponse: () => ImageResponse
});
import yoga_wasm from "/abs/path/node_modules/next/dist/compiled/@vercel/og/yoga.wasm?module";
import resvg_wasm from "/abs/path/node_modules/next/dist/compiled/@vercel/og/resvg.wasm?module";
${ogBody}${initWrapper}
// node-builtins:node:path
import * as mod2 from "node:path";
var tail = 1;
`;
}

describe("stripVercelOg", () => {
  it("wasm の import とライブラリ本体をバンドルから取り除く", () => {
    const stripped = stripVercelOg(buildFakeBundle());

    expect(stripped).not.toContain("@vercel/og/resvg.wasm");
    expect(stripped).not.toContain("@vercel/og/yoga.wasm");
    expect(stripped).not.toContain("parseAlpha");
    expect(stripped).not.toContain("class extends Response");
  });

  it("呼び出し側が参照する識別子を残す", () => {
    const stripped = stripVercelOg(buildFakeBundle());

    // バンドル内の呼び出しは
    // `(init_index_edge(), index_edge_exports)` の形なので、この2つが
    // 定義されたままでなければ実行時に ReferenceError になる。
    expect(stripped).toContain("var index_edge_exports = { ImageResponse }");
    expect(stripped).toContain("function init_index_edge()");
  });

  it("残したスタブは評価でき、ImageResponse の呼び出しだけが失敗する", async () => {
    const stripped = stripVercelOg(buildFakeBundle());
    // スタブだけを切り出して、実際に評価できることを確かめる
    // (esbuild のヘルパー __esm / __export に依存していないことの確認も兼ねる)。
    const stubStart = stripped.indexOf(
      "// node_modules/next/dist/compiled/@vercel/og/index.edge.js"
    );
    const stubEnd = stripped.indexOf("// node-builtins:node:path");
    const stub = stripped.slice(stubStart, stubEnd);

    const evaluate = new Function(
      `${stub}
      return { init_index_edge, index_edge_exports };`
    ) as () => {
      init_index_edge: () => void;
      index_edge_exports: { ImageResponse: () => unknown };
    };
    const { init_index_edge, index_edge_exports } = evaluate();

    // 初期化は副作用なく成功する(呼び出し側は必ずこれを通る)。
    expect(() => init_index_edge()).not.toThrow();
    // 実際に OG 画像を生成しようとしたときだけ、理由の分かる例外になる。
    expect(() => index_edge_exports.ImageResponse()).toThrowError(
      /@vercel\/og is not bundled/
    );
  });

  it("バンドルの他の部分には手を触れない", () => {
    const stripped = stripVercelOg(buildFakeBundle());

    expect(stripped).toContain('import * as mod from "node:worker_threads";');
    expect(stripped).toContain('import * as mod2 from "node:path";');
    expect(stripped).toContain("var tail = 1;");
  });

  it("@vercel/og が含まれないバンドルでは例外を投げる", () => {
    // 上流が middleware 側にも alias を入れた場合など。黙って素通りすると
    // 「効いていないのに効いているつもり」になるため、必ず失敗させる。
    expect(() => stripVercelOg("var tail = 1;\n")).toThrowError(
      /モジュール境界.*見つかりませんでした/
    );
  });

  it("__esm ラッパーが見つからない場合は例外を投げる", () => {
    expect(() =>
      stripVercelOg(buildFakeBundle({ omitInitWrapper: true }))
    ).toThrowError(/終端.*見つかりませんでした/);
  });

  it("切り出した範囲に wasm の import が無い場合は例外を投げる", () => {
    const bundle = buildFakeBundle().replace(
      'import yoga_wasm from "/abs/path/node_modules/next/dist/compiled/@vercel/og/yoga.wasm?module";\nimport resvg_wasm from "/abs/path/node_modules/next/dist/compiled/@vercel/og/resvg.wasm?module";',
      "var yoga_wasm = null;"
    );

    expect(() => stripVercelOg(bundle)).toThrowError(/resvg\.wasm/);
  });

  // 範囲の終端は「行頭の `});`」という弱い目印で探しているため、__esm
  // ラッパー内のテンプレートリテラルなどに同じ並びが現れると、モジュール
  // 本体の途中で範囲が閉じてしまう。wasm の import はモジュール先頭にあるので、
  // 「切り出した範囲に resvg.wasm が含まれるか」の確認では素通りしてしまう
  // ケース。黙って壊れたバンドルを吐くのが最悪なので、必ず失敗させる。
  it("モジュール本体の途中で範囲が閉じる場合は例外を投げる", () => {
    const bundle = buildFakeBundle({
      initWrapperBody: `    var svg = \`<svg>
});
</svg>\`;
    ImageResponse = class extends Response {
    };
`,
    });

    // 前提の確認: この構造では resvg.wasm ガードは通ってしまう
    // (= このテストが検出しているのは本当に終端判定の誤りである)。
    const prematureEnd = bundle.indexOf("\n});\n", bundle.indexOf("__esm({"));
    expect(
      bundle.slice(bundle.indexOf("// node_modules"), prematureEnd)
    ).toContain("@vercel/og/resvg.wasm");

    expect(() => stripVercelOg(bundle)).toThrowError(/区切りコメント/);
  });

  it("2回実行した場合は二重実行と分かる例外を投げる", () => {
    const stripped = stripVercelOg(buildFakeBundle());

    expect(() => stripVercelOg(stripped)).toThrowError(/既に/);
  });

  it("出力が構文的に妥当な JavaScript である", () => {
    const stripped = stripVercelOg(buildFakeBundle());

    // new Function はパースのみ行い実行はしない。壊れた切り出しでライブラリ
    // 本体の残骸がトップレベルへ露出すると、ここで SyntaxError になる。
    // import 文は関数本体としては書けないため取り除いてから渡す。
    const withoutImports = stripped
      .split("\n")
      .filter((line) => !line.startsWith("import "))
      .join("\n");
    expect(() => new Function(withoutImports)).not.toThrow();
  });

  it("モジュール境界が複数ある場合は例外を投げる", () => {
    const bundle =
      buildFakeBundle() +
      "// node_modules/next/dist/compiled/@vercel/og/index.edge.js\n";

    expect(() => stripVercelOg(bundle)).toThrowError(/複数/);
  });
});
