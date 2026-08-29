import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import {
  createArgon2Wasm,
  createBlake2bWasm,
} from "@/lib/account/wasm-argon2/wasm-interface";

// wasm-interface.tsは、argon2-algorithm.test.ts/argon2id.test.ts経由でも
// アルゴリズムの正しさとしては間接的に使われているが、以下はそれらの
// テストが実際には踏まない、このファイル自身が持つ防御的なガード条件
// (呼び出し順序の誤りの検出、Instance共有時のメモリ縮小防止)と、
// WasmImportとして渡ってきうる値の形の違い(resolveExports)を直接検証する。
const wasmDir = path.join(process.cwd(), "lib/account/wasm-argon2");

let argon2Module: WebAssembly.Module;
let blake2bModule: WebAssembly.Module;
let blake2bBytes: ReturnType<typeof readFileSync>;

beforeAll(async () => {
  blake2bBytes = readFileSync(path.join(wasmDir, "blake2b.wasm"));
  argon2Module = await WebAssembly.compile(
    readFileSync(path.join(wasmDir, "argon2.wasm"))
  );
  blake2bModule = await WebAssembly.compile(blake2bBytes);
});

describe("createArgon2Wasm 呼び出し順序ガード", () => {
  it("setMemorySize()より前にwriteMemory()を呼ぶとエラーになる", async () => {
    const wasm = await createArgon2Wasm(argon2Module);
    expect(() => wasm.writeMemory(new Uint8Array(4))).toThrow(
      "setMemorySize() must be called first"
    );
  });

  it("setMemorySize()より前にcalculate()を呼ぶとエラーになる", async () => {
    const wasm = await createArgon2Wasm(argon2Module);
    expect(() => wasm.calculate(new Uint8Array(0), 8)).toThrow(
      "setMemorySize() must be called first"
    );
  });
});

describe("createArgon2Wasm のInstance共有時のメモリ縮小防止", () => {
  it("既に確保済みより小さいtotalSizeでsetMemorySize()しても、Hash_SetMemorySizeを再度呼ばない(呼ぶと内部でアンダーフローしメモリ破壊につながるため)", async () => {
    // wasm-interface.tsのコメントの通り、本番(Cloudflare Workers)や
    // next dev --webpack/next buildでは.wasmのInstanceが複数回の呼び出しに
    // またがって共有されうる。ここでは実際にInstance化したexportsを
    // ラップし、Hash_SetMemorySizeの実呼び出し回数を記録することで、
    // argon2SizedToによる「縮小時はスキップする」ガードを直接検証する。
    const sharedInstance = await WebAssembly.instantiate(argon2Module, {});
    const realExports = sharedInstance.exports as unknown as {
      memory: WebAssembly.Memory;
      Hash_SetMemorySize: (totalBytes: number) => void;
      Hash_GetBuffer: () => number;
      Hash_Calculate: (length: number, memorySize: number) => void;
    };

    const setMemorySizeCalls: number[] = [];
    const spyExports = {
      ...realExports,
      Hash_SetMemorySize: (totalBytes: number) => {
        setMemorySizeCalls.push(totalBytes);
        realExports.Hash_SetMemorySize(totalBytes);
      },
    };

    // spyExportsは(Module/Uint8Array/文字列いずれでもない)既にInstance化
    // 済みのexports相当として、resolveExportsによりそのまま使われる。
    const large = await createArgon2Wasm(spyExports);
    large.setMemorySize(64 * 1024 + 1024);
    expect(setMemorySizeCalls).toEqual([64 * 1024 + 1024]);

    // argon2SizedToはexportsオブジェクト自体をキーにしているため、
    // 同じspyExportsを渡して作った別ハンドルでも「既にどこまで確保したか」
    // が共有される(=production同様、共有Instanceに対する2回目以降の呼び出し)。
    const small = await createArgon2Wasm(spyExports);
    expect(() => small.setMemorySize(8 * 1024 + 1024)).not.toThrow();

    // 縮小方向のリクエストではHash_SetMemorySizeを再度呼んではいけない。
    expect(setMemorySizeCalls).toEqual([64 * 1024 + 1024]);

    // 縮小要求後もwriteMemory()自体は(既に確保済みの範囲内である限り)使える。
    expect(() =>
      small.writeMemory(new Uint8Array(24), 8 * 1024)
    ).not.toThrow();
  });

  it("より大きいtotalSizeでのsetMemorySize()は、その都度Hash_SetMemorySizeを呼ぶ", async () => {
    const sharedInstance = await WebAssembly.instantiate(argon2Module, {});
    const realExports = sharedInstance.exports as unknown as {
      memory: WebAssembly.Memory;
      Hash_SetMemorySize: (totalBytes: number) => void;
      Hash_GetBuffer: () => number;
      Hash_Calculate: (length: number, memorySize: number) => void;
    };

    const setMemorySizeCalls: number[] = [];
    const spyExports = {
      ...realExports,
      Hash_SetMemorySize: (totalBytes: number) => {
        setMemorySizeCalls.push(totalBytes);
        realExports.Hash_SetMemorySize(totalBytes);
      },
    };

    const first = await createArgon2Wasm(spyExports);
    first.setMemorySize(8 * 1024 + 1024);

    const second = await createArgon2Wasm(spyExports);
    second.setMemorySize(16 * 1024 + 1024);

    expect(setMemorySizeCalls).toEqual([8 * 1024 + 1024, 16 * 1024 + 1024]);

    // 実装は`totalSize > alreadySizedTo`(厳密に大きい場合)のみ呼ぶため、
    // 直前と同じtotalSizeを再指定してもHash_SetMemorySizeは呼ばれない。
    const third = await createArgon2Wasm(spyExports);
    expect(() => third.setMemorySize(16 * 1024 + 1024)).not.toThrow();
    expect(setMemorySizeCalls).toEqual([8 * 1024 + 1024, 16 * 1024 + 1024]);
  });
});

describe("createBlake2bWasm 呼び出し順序ガード", () => {
  it("init()より前にupdate()を呼ぶとエラーになる", async () => {
    const wasm = await createBlake2bWasm(blake2bModule);
    expect(() => wasm.update(new Uint8Array(4))).toThrow(
      "update() called before init()"
    );
  });

  it("init()より前にdigest()を呼ぶとエラーになる", async () => {
    const wasm = await createBlake2bWasm(blake2bModule);
    expect(() => wasm.digest(32)).toThrow("digest() called before init()");
  });

  it("digest()の後は再度init()するまでupdate()できない", async () => {
    const wasm = await createBlake2bWasm(blake2bModule);
    wasm.init(256);
    wasm.update(new TextEncoder().encode("hello"));
    wasm.digest(32);

    expect(() => wasm.update(new TextEncoder().encode("again"))).toThrow(
      "update() called before init()"
    );
  });
});

describe("resolveExports (WasmImportとして渡りうる形の違いの解決)", () => {
  const input = new TextEncoder().encode("resolveExports shape check");

  async function digestWith(wasmImport: unknown): Promise<Uint8Array> {
    const wasm = await createBlake2bWasm(wasmImport);
    wasm.init(256);
    wasm.update(input);
    return wasm.digest(32);
  }

  it("コンパイル済みWebAssembly.Moduleをそのまま受け取れる(wrangler/esbuild本番相当)", async () => {
    const digest = await digestWith(blake2bModule);
    expect(digest.length).toBe(32);
  });

  it("生のUint8Array(wasmバイト列)を受け取れる", async () => {
    const digest = await digestWith(blake2bBytes);
    expect(digest.length).toBe(32);
  });

  it("base64のdata URL文字列を受け取れる(next dev --webpackのasset/inline相当)", async () => {
    const base64 = Buffer.from(blake2bBytes).toString("base64");
    const digest = await digestWith(`data:application/wasm;base64,${base64}`);
    expect(digest.length).toBe(32);
  });

  it("{default: WasmSource}形式でラップされていても受け取れる(名前空間import相当)", async () => {
    const digest = await digestWith({ default: blake2bModule });
    expect(digest.length).toBe(32);
  });

  it("既にInstance化済みのexportsをそのまま受け取れる(webpack asyncWebAssembly/Turbopack共有Instance相当)", async () => {
    const instance = await WebAssembly.instantiate(blake2bModule, {});
    const digest = await digestWith(instance.exports);
    expect(digest.length).toBe(32);
  });

  it("どの形で渡しても同じ入力から同じダイジェストになる", async () => {
    const base64 = Buffer.from(blake2bBytes).toString("base64");
    const instance = await WebAssembly.instantiate(blake2bModule, {});

    const fromModule = await digestWith(blake2bModule);
    const fromBytes = await digestWith(blake2bBytes);
    const fromDataUrl = await digestWith(
      `data:application/wasm;base64,${base64}`
    );
    const fromWrapped = await digestWith({ default: blake2bModule });
    const fromInstantiated = await digestWith(instance.exports);

    const expected = Buffer.from(fromModule).toString("hex");
    expect(Buffer.from(fromBytes).toString("hex")).toBe(expected);
    expect(Buffer.from(fromDataUrl).toString("hex")).toBe(expected);
    expect(Buffer.from(fromWrapped).toString("hex")).toBe(expected);
    expect(Buffer.from(fromInstantiated).toString("hex")).toBe(expected);
  });
});
