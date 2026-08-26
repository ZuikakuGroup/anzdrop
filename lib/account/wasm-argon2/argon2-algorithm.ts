// hash-wasmのlib/argon2.ts(argon2Internal, hashType="id"の場合)の移植。
// アルゴリズムの組み立て・呼び出し順序は変更していない。
// WASM側の呼び出しインターフェースはwasm-interface.tsを参照。
//
// このファイルは意図的に.wasmファイルを直接importしない
// (静的.wasm importの解決のされ方はNext.js/webpack/vitest/tsxなどツールに
// よって異なるため、コンパイル済みWebAssembly.Moduleの入手経路をこのファイル
// の外に切り出し、アルゴリズムの正しさをテストしやすくしている)。
// 実際に.wasmを静的importして呼び出す薄いラッパーはargon2id.tsを参照。
import {
  createArgon2Wasm,
  createBlake2bWasm,
  type Blake2bWasm,
  type WasmImport,
} from "./wasm-interface";

export type Argon2idOptions = {
  password: Uint8Array;
  salt: Uint8Array;
  iterations: number;
  parallelism: number;
  memorySize: number;
  hashLength: number;
};

function int32LE(x: number): Uint8Array {
  const buffer = new Uint8Array(4);
  new DataView(buffer.buffer).setInt32(0, x, true);
  return buffer;
}

// Argon2の"H'"関数(可変長Blake2b)。lenが64以下なら単純なBlake2b(len*8)、
// それ以外は32byteごとにBlake2bを繰り返してlenバイトになるまで連結する。
async function hashFunc(
  blake2bModule: WasmImport,
  blake512: Blake2bWasm,
  buf: Uint8Array,
  len: number
): Promise<Uint8Array> {
  if (len <= 64) {
    const wasm = await createBlake2bWasm(blake2bModule);
    wasm.init(len * 8);
    wasm.update(int32LE(len));
    wasm.update(buf);
    return wasm.digest(len);
  }

  const r = Math.ceil(len / 32) - 2;
  const ret = new Uint8Array(len);

  blake512.init(512);
  blake512.update(int32LE(len));
  blake512.update(buf);
  let vp = blake512.digest(64);
  ret.set(vp.subarray(0, 32), 0);

  for (let i = 1; i < r; i++) {
    blake512.init(512);
    blake512.update(vp);
    vp = blake512.digest(64);
    ret.set(vp.subarray(0, 32), i * 32);
  }

  const partialBytesNeeded = len - 32 * r;
  let blakeSmall: Blake2bWasm;
  if (partialBytesNeeded === 64) {
    blakeSmall = blake512;
    blakeSmall.init(512);
  } else {
    blakeSmall = await createBlake2bWasm(blake2bModule);
    blakeSmall.init(partialBytesNeeded * 8);
  }
  blakeSmall.update(vp);
  vp = blakeSmall.digest(partialBytesNeeded);
  ret.set(vp.subarray(0, partialBytesNeeded), r * 32);

  return ret;
}

// アルゴリズム本体。テストからは、静的importではなくfs経由でコンパイルした
// WebAssembly.Moduleを直接渡して呼び出せるようにexportしてある
// (静的.wasm importの解決のされ方はNext.js/webpack/vitestで異なりうるため、
// アルゴリズムの正しさ自体をモジュールの入手経路に依存させたくない)。
export async function computeArgon2id(
  argon2Module: WasmImport,
  blake2bModule: WasmImport,
  options: Argon2idOptions
): Promise<Uint8Array> {
  const { password, salt, iterations, parallelism, memorySize, hashLength } =
    options;
  const version = 0x13;
  const hashType = 2; // "id"
  const secret = new Uint8Array(0);

  const [argon2Interface, blake512] = await Promise.all([
    createArgon2Wasm(argon2Module),
    createBlake2bWasm(blake2bModule),
  ]);

  // 最後の1ブロックはパラメータ(initVector)の格納用。
  argon2Interface.setMemorySize(memorySize * 1024 + 1024);

  const initVector = new Uint8Array(24);
  const initVectorView = new DataView(initVector.buffer);
  initVectorView.setInt32(0, parallelism, true);
  initVectorView.setInt32(4, hashLength, true);
  initVectorView.setInt32(8, memorySize, true);
  initVectorView.setInt32(12, iterations, true);
  initVectorView.setInt32(16, version, true);
  initVectorView.setInt32(20, hashType, true);
  argon2Interface.writeMemory(initVector, memorySize * 1024);

  blake512.init(512);
  blake512.update(initVector);
  blake512.update(int32LE(password.length));
  blake512.update(password);
  blake512.update(int32LE(salt.length));
  blake512.update(salt);
  blake512.update(int32LE(secret.length));
  blake512.update(secret);
  blake512.update(int32LE(0)); // associatedData length(常に0。関連データ機能は未使用)

  const segments = Math.floor(memorySize / (parallelism * 4));
  const lanes = segments * 4;

  const param = new Uint8Array(72);
  const H0 = blake512.digest(64);
  param.set(H0);

  for (let lane = 0; lane < parallelism; lane++) {
    param.set(int32LE(0), 64);
    param.set(int32LE(lane), 68);

    let position = lane * lanes;
    let chunk = await hashFunc(blake2bModule, blake512, param, 1024);
    argon2Interface.writeMemory(chunk, position * 1024);

    position += 1;
    param.set(int32LE(1), 64);
    chunk = await hashFunc(blake2bModule, blake512, param, 1024);
    argon2Interface.writeMemory(chunk, position * 1024);
  }

  const C = argon2Interface.calculate(new Uint8Array(0), memorySize);
  return hashFunc(blake2bModule, blake512, C, hashLength);
}
