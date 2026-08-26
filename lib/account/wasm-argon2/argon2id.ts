// argon2-algorithm.tsのcomputeArgon2id()に、静的importした.wasmを渡すだけの
// 薄いラッパー。呼び出し側(lib/account/password.ts)はこのファイルをimportする。
//
// namespace importにしているのは、ビルドツールによって.wasm importの形が
// 異なるため(wasm-interface.tsのコメント・WasmImport型を参照)。
// wrangler/esbuild(本番)は{ default: WebAssembly.Module }相当、
// next dev --webpack(asset/inline)は{ default: "data:...;base64,..." }になる。
// namespace importならどちらの形でも取りこぼしなく受け取れる。
import * as argon2WasmImport from "./argon2.wasm";
import * as blake2bWasmImport from "./blake2b.wasm";
import {
  computeArgon2id,
  type Argon2idOptions,
} from "./argon2-algorithm";

export type { Argon2idOptions };

// next dev --webpack(asyncWebAssembly)・Turbopack(type: "wasm")のどちらも、
// .wasmを1回だけInstance化し、以後のimportは同じInstance(=同じ線形メモリ)を
// 共有する。本番のCloudflare Workersでも、Workerのisolateが複数リクエスト
// にまたがって再利用される限り同じ経路を通る。
//
// argon2/blake2bの計算はこの共有された線形メモリを直接読み書きするため、
// 2つのargon2id()呼び出しが同時に(例えばPromise.allや、同じisolateへの
// 並行リクエストで)進行すると互いのメモリを破壊しあう。実際にパスワード
// 再設定(recover)がnewPassword用とnewRecoveryCode用の2回のhashPassword()を
// Promise.allで並行実行しており、この競合で誤ったハッシュが生成される
// 回帰が実機(wrangler dev + 実際のビルド成果物)で確認された。
// そのため呼び出し全体を直列化する。
let queue: Promise<unknown> = Promise.resolve();

function withLock<T>(fn: () => Promise<T>): Promise<T> {
  const result = queue.then(fn, fn);
  queue = result.then(
    () => undefined,
    () => undefined
  );
  return result;
}

export async function argon2id(options: Argon2idOptions): Promise<Uint8Array> {
  return withLock(() =>
    computeArgon2id(argon2WasmImport, blake2bWasmImport, options)
  );
}
