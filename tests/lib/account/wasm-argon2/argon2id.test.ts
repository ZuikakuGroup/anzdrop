import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { argon2id as referenceArgon2id } from "hash-wasm";

// argon2id.tsの`import * as argon2WasmImport from "./argon2.wasm"`を、
// 「1回だけInstance化されたexportsを全呼び出しで共有する」形にモックする。
// これはnext dev --webpack(experiments.asyncWebAssembly)やnext build
// (Turbopack, type: "wasm")の実際の挙動、ひいては本番のCloudflare Workersで
// Workerのisolateが複数リクエストにまたがって再利用される場合の挙動そのもの。
// vitest.config.tsの既定の.wasmプラグインは呼び出しのたびに新しいModuleを
// compileする(=毎回フレッシュなInstance)ため、それだけではこの「共有
// Instanceに対する並行アクセス」という実際の本番の危険な経路を再現できない。
// argon2id.tsのwithLock()がこの経路で本当に安全かどうかを検証するには、
// ここで明示的に共有Instanceを注入する必要がある。
//
// vi.mock()にはargon2id.ts(lib/account/wasm-argon2/)からの相対パスではなく
// このテストファイル自身の場所から見た絶対パス(@/...)を渡す必要がある点に
// 注意(vi.mockの第一引数はこのテストファイルからの相対/絶対解決になるが、
// 解決後の実ファイルパスが一致してさえいれば、argon2id.ts側の相対import
// "./argon2.wasm" もこのモックで正しく差し替えられる)。
const wasmDir = path.join(process.cwd(), "lib/account/wasm-argon2");

async function loadSharedExports(fileName: string) {
  const bytes = readFileSync(path.join(wasmDir, fileName));
  const compiled = await WebAssembly.compile(bytes);
  const instance = await WebAssembly.instantiate(compiled, {});
  return instance.exports;
}

vi.mock("@/lib/account/wasm-argon2/argon2.wasm", async () => ({
  default: await loadSharedExports("argon2.wasm"),
}));
vi.mock("@/lib/account/wasm-argon2/blake2b.wasm", async () => ({
  default: await loadSharedExports("blake2b.wasm"),
}));

describe("argon2id (静的import経由の公開エントリポイント、共有Instanceを模した状態)", () => {
  it("共有Instanceに対して並行に呼び出しても、それぞれ正しい結果を返す", async () => {
    // アカウント再設定(recover)がnewPassword用・newRecoveryCode用の2回の
    // hashPassword()をPromise.allで並行実行している。共有Instanceに対して
    // argon2id()の呼び出し自体を直列化していないと、並行実行時に共有された
    // 線形メモリを取り合って誤ったハッシュが生成される回帰が実機
    // (wrangler dev + 実際のビルド成果物)で確認された
    // (argon2id.tsのwithLockを参照)。このテストはモックにより実際に
    // Instanceを共有した状態でその回帰を再現・検証する。
    const { argon2id } = await import("@/lib/account/wasm-argon2/argon2id");

    const cases = [
      { password: "concurrent-pw-1", salt: new Uint8Array(16).fill(1) },
      { password: "concurrent-pw-2", salt: new Uint8Array(16).fill(2) },
      { password: "concurrent-pw-3", salt: new Uint8Array(16).fill(3) },
    ];

    const options = cases.map((c) => ({
      password: new TextEncoder().encode(c.password),
      salt: c.salt,
      iterations: 2,
      parallelism: 1,
      memorySize: 64,
      hashLength: 32,
    }));

    const [actualResults, expectedResults] = await Promise.all([
      Promise.all(options.map((o) => argon2id(o))),
      Promise.all(
        options.map((o) => referenceArgon2id({ ...o, outputType: "binary" }))
      ),
    ]);

    for (let i = 0; i < cases.length; i++) {
      expect(
        Buffer.from(actualResults[i]).toString("hex"),
        `case #${i} should match the reference implementation`
      ).toBe(Buffer.from(expectedResults[i]).toString("hex"));
    }
  });
});
