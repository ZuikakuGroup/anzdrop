// Cloudflare Workers本番ランタイムは、実行時の動的なWebAssembly
// コード生成(WebAssembly.compile/instantiateにバイト列を渡す形)を
// セキュリティ上の理由で禁止している("Wasm code generation disallowed
// by embedder")。一方、あらかじめコンパイル済みのWebAssembly.Moduleを
// import文で静的に取り込み、それをInstance化するだけなら新規のコード
// 生成にあたらないため許可される。
//
// argon2.wasm/blake2b.wasm はこのディレクトリ内で静的にimportされ、
// このファイルはその「Instance化して薄いJSの呼び出しインターフェースに
// する」部分だけを担う。
//
// argon2Id.tsのアルゴリズム自体の組み立て(H0の計算・初期ブロック生成・
// 最終ハッシュの導出など)は hash-wasm(https://github.com/Daninet/hash-wasm,
// MIT License, Copyright (c) Dani Biró)のlib/argon2.ts・lib/WASMInterface.ts
// の移植であり、下のargon2.wasm/blake2b.wasmもhash-wasmのsrc/argon2.c・
// src/blake2b.cを同一のビルドオプション(scripts/Makefile-clang)でコンパイル
// したもの。移植にあたっては、実際にhash-wasmの出力と全パラメータ組み合わせ
// でバイト単位一致することを確認済み(lib/account/wasm-argon2/*.test.ts)。
//
// .wasmの静的importが実際にどんな値になるかはビルドツールによって異なり、
// 統一できない:
// - wrangler/esbuild本来の静的wasmモジュール規約: コンパイル済みの
//   WebAssembly.Moduleをdefault exportとして渡してくる(呼び出しのたびに
//   新しいInstanceを作れる)。
// - next dev --webpack(experiments.asyncWebAssembly): その場で1回だけ
//   Instance化し、以後は共有された同じexportsを返す。
// - next build(Turbopack, type: "wasm"): 同じく1回だけInstance化して
//   共有exportsを返す、かつCloudflare Workers本番でもこの経路を通る
//   (Turbopackの非同期モジュールはESモジュールとしてキャッシュされ、
//   Workerのisolateが再利用される限りexportsも使い回される)。
//
// つまり本番を含め「Instanceが複数回のハッシュ計算にまたがって共有され
// うる」前提で実装する必要がある。argon2側はHash_SetMemorySizeで動的に
// メモリを伸長する実装で、同一Instanceに対して既に確保済みのサイズ以下を
// 再度要求すると内部のunsigned算術(bytes_required = total - B_size)が
// アンダーフローしてメモリ破壊につながる。そのため「まだ確保していない
// 分だけ伸長する」ようにJS側でガードしている(argon2SizedTo)。

const MAX_HEAP = 16 * 1024;

type Argon2WasmExports = {
  memory: WebAssembly.Memory;
  Hash_SetMemorySize: (totalBytes: number) => void;
  Hash_GetBuffer: () => number;
  Hash_Calculate: (length: number, memorySize: number) => void;
};

type Blake2bWasmExports = {
  memory: WebAssembly.Memory;
  Hash_GetBuffer: () => number;
  Hash_Init: (bits: number) => void;
  Hash_Update: (length: number) => void;
  Hash_Final: (padding: number) => void;
};

type WasmSource = WebAssembly.Module | string | Uint8Array;

// ビルドツールによって値の形が変わりうるため、正確な型を諦めてunknownとし、
// 実行時に形を判別する(下のresolveExports参照)。
export type WasmImport = unknown;

async function compileIfNeeded(value: WasmSource): Promise<WebAssembly.Module> {
  if (value instanceof WebAssembly.Module) {
    return value;
  }

  if (value instanceof Uint8Array) {
    return WebAssembly.compile(value.slice());
  }

  // "data:application/wasm;base64,AGFzbQ..." からbase64部分を取り出してデコードする。
  const base64 = value.slice(value.indexOf(",") + 1);
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }

  return WebAssembly.compile(bytes);
}

function isWasmSource(value: unknown): value is WasmSource {
  return (
    value instanceof WebAssembly.Module ||
    value instanceof Uint8Array ||
    typeof value === "string"
  );
}

// wasmImportを実際のexports(wasmが公開する関数群)まで解決する。
// - {default: WasmSource} 形式ならコンパイル+Instance化して新しいexportsを作る。
// - WasmSourceそのものならそれをコンパイル+Instance化する。
// - どちらでもなければ、既にInstance化済みのexportsそのものとみなす
//   (webpackのasyncWebAssembly・Turbopackのtype: "wasm"の場合)。
async function resolveExports<T extends WebAssembly.Exports>(
  wasmImport: WasmImport
): Promise<T> {
  const candidate =
    wasmImport !== null &&
    typeof wasmImport === "object" &&
    !isWasmSource(wasmImport) &&
    "default" in wasmImport
      ? (wasmImport as { default: unknown }).default
      : wasmImport;

  if (isWasmSource(candidate)) {
    const compiledModule = await compileIfNeeded(candidate);
    const instance = await WebAssembly.instantiate(compiledModule, {});
    return instance.exports as T;
  }

  return candidate as unknown as T;
}

// Instanceが複数回の呼び出しをまたいで共有される場合に備え、
// 「そのexportsに対して既にどこまでメモリを確保したか」を覚えておく。
const argon2SizedTo = new WeakMap<Argon2WasmExports, number>();

export type Argon2Wasm = {
  writeMemory: (data: Uint8Array, offset?: number) => void;
  setMemorySize: (totalSize: number) => void;
  calculate: (data: Uint8Array, memorySize: number) => Uint8Array;
};

export async function createArgon2Wasm(
  wasmImport: WasmImport
): Promise<Argon2Wasm> {
  const exports = await resolveExports<Argon2WasmExports>(wasmImport);
  let memoryView: Uint8Array | null = null;

  // Hash_GetBuffer()は、Bポインタが未初期化(フレッシュなインスタンス)の場合に
  // 限り512KB分を安全に予約しつつBを初期化する副作用を持つ。この初回呼び出しを
  // 外側からのsetMemorySize()呼び出しより前に済ませておかないと、
  // Hash_SetMemorySize内のunsigned算術が(このインスタンスにとって)
  // 最初の呼び出しであるにもかかわらずアンダーフローし、メモリ破壊につながる。
  exports.Hash_GetBuffer();

  const setMemorySize = (totalSize: number) => {
    const alreadySizedTo = argon2SizedTo.get(exports) ?? 0;

    if (totalSize > alreadySizedTo) {
      exports.Hash_SetMemorySize(totalSize);
      argon2SizedTo.set(exports, totalSize);
    }

    const arrayOffset = exports.Hash_GetBuffer();
    memoryView = new Uint8Array(exports.memory.buffer, arrayOffset, totalSize);
    // Argon2の計算アルゴリズムは、ワーキングバッファがゼロ初期化されている
    // ことを暗黙の前提にしている(フレッシュなInstanceでは常に真)。
    // Instanceが複数回の計算にまたがって共有される場合、前回の計算結果が
    // 残ったバッファを再利用すると異なる(誤った)結果になることを実測で
    // 確認したため、計算のたびに明示的にゼロクリアする。
    memoryView.fill(0);
  };

  const writeMemory = (data: Uint8Array, offset = 0) => {
    if (!memoryView) {
      throw new Error("setMemorySize() must be called first");
    }
    memoryView.set(data, offset);
  };

  const calculate = (data: Uint8Array, memorySize: number): Uint8Array => {
    if (!memoryView) {
      throw new Error("setMemorySize() must be called first");
    }
    memoryView.set(data);
    exports.Hash_Calculate(data.length, memorySize);
    // Hash_Calculateは結果をメモリ先頭1024バイトに書き戻す(argon2の1ブロック分)。
    return memoryView.slice(0, 1024);
  };

  return { writeMemory, setMemorySize, calculate };
}

export type Blake2bWasm = {
  init: (bits: number) => void;
  update: (data: Uint8Array) => void;
  digest: (hashLength: number) => Uint8Array;
};

export async function createBlake2bWasm(
  wasmImport: WasmImport
): Promise<Blake2bWasm> {
  const exports = await resolveExports<Blake2bWasmExports>(wasmImport);
  const arrayOffset = exports.Hash_GetBuffer();
  const memoryView = new Uint8Array(exports.memory.buffer, arrayOffset, MAX_HEAP);

  let initialized = false;

  const init = (bits: number) => {
    initialized = true;
    exports.Hash_Init(bits);
  };

  const update = (data: Uint8Array) => {
    if (!initialized) {
      throw new Error("update() called before init()");
    }
    let read = 0;
    while (read < data.length) {
      const chunk = data.subarray(read, read + MAX_HEAP);
      read += chunk.length;
      memoryView.set(chunk);
      exports.Hash_Update(chunk.length);
    }
  };

  const digest = (hashLength: number): Uint8Array => {
    if (!initialized) {
      throw new Error("digest() called before init()");
    }
    initialized = false;
    exports.Hash_Final(0);
    // 呼び出し元がmemoryViewを保持し続けても安全なようにコピーを返す。
    return memoryView.slice(0, hashLength);
  };

  return { init, update, digest };
}
