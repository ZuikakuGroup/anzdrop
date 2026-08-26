// next dev --webpack専用のwebpackローダー。
// .wasmファイルを「data: URI文字列をdefault exportするだけのJSモジュール」に
// 変換する(webpackのAsset Modules機能は使わない。Next.jsの既定のasset
// ルールと生成オプションが競合するため)。
// 実際の使い方はlib/account/wasm-argon2/wasm-interface.tsを参照。
/**
 * @param {Buffer} source
 * @returns {string}
 */
module.exports = function wasmBase64Loader(source) {
  const base64 = source.toString("base64");
  return `export default "data:application/wasm;base64,${base64}";`;
};

module.exports.raw = true;
