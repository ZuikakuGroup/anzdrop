// next/font/google はNextの SWC プラグインを通じて特殊なビルド時変換が
// 行われる前提のモジュールで、Vitest(素のVite)環境ではそのまま呼び出せない
// (エクスポートされた関数がフォントを読み込むことを期待した実装になっていない)。
// テストではフォント読み込み自体を検証する必要はないため、コンポーネントが
// 参照している関数名ごとにダミーの戻り値を返すモックに差し替える。
function createMockFont() {
  return () => ({
    className: "font-mock",
    style: {},
    variable: "--font-mock",
  });
}

export const Noto_Sans_JP = createMockFont();
export const Quicksand = createMockFont();
