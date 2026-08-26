declare module "*.wasm" {
  // 環境(next dev --webpack / next build+Turbopack / vitest)によって
  // 実体が異なるため、正確な型は諦めている。
  // 詳細・実際の解決方法はlib/account/wasm-argon2/wasm-interface.tsを参照。
  const value: unknown;
  export default value;
}
