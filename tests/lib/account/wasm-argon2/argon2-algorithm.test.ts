import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, beforeAll } from "vitest";
import { argon2id as referenceArgon2id } from "hash-wasm";
import { computeArgon2id } from "@/lib/account/wasm-argon2/argon2-algorithm";

// このテストは、静的.wasm importの解決(バンドラ依存)を経由せず、
// fs経由でコンパイルしたWebAssembly.Moduleを直接computeArgon2idへ渡す。
// 静的importの解決確認は別途next dev/opennextjs-cloudflare buildの
// 実機確認で行う(vitest実行環境のバンドラ挙動に左右されるべきではないため)。
let argon2Module: WebAssembly.Module;
let blake2bModule: WebAssembly.Module;

beforeAll(async () => {
  const dir = path.join(process.cwd(), "lib/account/wasm-argon2");
  argon2Module = await WebAssembly.compile(
    readFileSync(path.join(dir, "argon2.wasm"))
  );
  blake2bModule = await WebAssembly.compile(
    readFileSync(path.join(dir, "blake2b.wasm"))
  );
});

describe("computeArgon2id", () => {
  const cases: {
    name: string;
    password: string;
    salt: Uint8Array;
    iterations: number;
    parallelism: number;
    memorySize: number;
    hashLength: number;
  }[] = [
    {
      name: "本番相当のパラメータ(19MiB, 2回, 並列度1)",
      password: "correct horse battery staple",
      salt: new Uint8Array(16).fill(1),
      iterations: 2,
      parallelism: 1,
      memorySize: 19_456,
      hashLength: 32,
    },
    {
      name: "小さいメモリコスト",
      password: "short",
      salt: new Uint8Array([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]),
      iterations: 3,
      parallelism: 1,
      memorySize: 8,
      hashLength: 32,
    },
    {
      name: "マルチバイト文字のパスワード・並列度2",
      password: "パスワード123",
      salt: new Uint8Array(16).fill(7),
      iterations: 2,
      parallelism: 2,
      memorySize: 64,
      hashLength: 32,
    },
    {
      name: "長いパスワード・並列度4・長いハッシュ長",
      password: "x".repeat(300),
      salt: new Uint8Array(24).fill(9),
      iterations: 2,
      parallelism: 4,
      memorySize: 256,
      hashLength: 64,
    },
  ];

  for (const testCase of cases) {
    it(`hash-wasm(参照実装)と完全に一致する: ${testCase.name}`, async () => {
      const passwordBytes = new TextEncoder().encode(testCase.password);

      const actual = await computeArgon2id(argon2Module, blake2bModule, {
        password: passwordBytes,
        salt: testCase.salt,
        iterations: testCase.iterations,
        parallelism: testCase.parallelism,
        memorySize: testCase.memorySize,
        hashLength: testCase.hashLength,
      });

      const expected = await referenceArgon2id({
        password: passwordBytes,
        salt: testCase.salt,
        iterations: testCase.iterations,
        parallelism: testCase.parallelism,
        memorySize: testCase.memorySize,
        hashLength: testCase.hashLength,
        outputType: "binary",
      });

      expect(Buffer.from(actual).toString("hex")).toBe(
        Buffer.from(expected).toString("hex")
      );
    });
  }

  it("同じ入力に対して常に決定的な出力を返す", async () => {
    const password = new TextEncoder().encode("determinism-check");
    const salt = new Uint8Array(16).fill(42);
    const options = {
      password,
      salt,
      iterations: 2,
      parallelism: 1,
      memorySize: 32,
      hashLength: 32,
    };

    const a = await computeArgon2id(argon2Module, blake2bModule, options);
    const b = await computeArgon2id(argon2Module, blake2bModule, options);

    expect(Buffer.from(a).toString("hex")).toBe(Buffer.from(b).toString("hex"));
  });

  it("Instance(exports)を複数回の呼び出しにまたがって使い回しても正しい結果になる", async () => {
    // next dev --webpackのexperiments.asyncWebAssembly、およびnext build
    // (Turbopack, type: "wasm")は、.wasmを1回だけInstance化して以後の
    // importで同じexportsを共有する(本番のCloudflare Workersでも、Workerの
    // isolateが複数リクエストにまたがって再利用される限りこの経路を通る)。
    // かつてこの共有Instanceに対して2回目以降のcomputeArgon2id()が誤った
    // 結果を返す回帰があった(Argon2のワーキングバッファがフレッシュな
    // Instanceでは常にゼロ初期化されている前提のアルゴリズムであるにも
    // かかわらず、共有Instanceでは前回計算の残骸が残ったバッファを
    // 再利用してしまっていたため)。ここでは実際にInstance自体を1回だけ
    // 作って使い回し、複数回呼び出した結果がすべてhash-wasm(参照実装)と
    // 一致することを検証する。
    const sharedArgon2Instance = await WebAssembly.instantiate(argon2Module, {});
    const sharedBlake2bInstance = await WebAssembly.instantiate(
      blake2bModule,
      {}
    );
    const sharedArgon2Exports =
      sharedArgon2Instance.exports as unknown as WebAssembly.Module;
    const sharedBlake2bExports =
      sharedBlake2bInstance.exports as unknown as WebAssembly.Module;

    const passwords = ["shared-instance-pw-1", "shared-instance-pw-2", "shared-instance-pw-3"];

    for (const [i, password] of passwords.entries()) {
      const salt = new Uint8Array(16).fill(i + 1);
      const passwordBytes = new TextEncoder().encode(password);
      const options = {
        password: passwordBytes,
        salt,
        iterations: 2,
        parallelism: 1,
        memorySize: 19_456,
        hashLength: 32,
      };

      const actual = await computeArgon2id(
        sharedArgon2Exports,
        sharedBlake2bExports,
        options
      );
      const expected = await referenceArgon2id({
        ...options,
        outputType: "binary",
      });

      expect(
        Buffer.from(actual).toString("hex"),
        `call #${i} on the shared Instance should match the fresh-Instance reference`
      ).toBe(Buffer.from(expected).toString("hex"));
    }
  });

  it("saltが異なれば出力も変わる", async () => {
    const password = new TextEncoder().encode("same password");
    const base = {
      password,
      iterations: 2,
      parallelism: 1,
      memorySize: 32,
      hashLength: 32,
    };

    const a = await computeArgon2id(argon2Module, blake2bModule, {
      ...base,
      salt: new Uint8Array(16).fill(1),
    });
    const b = await computeArgon2id(argon2Module, blake2bModule, {
      ...base,
      salt: new Uint8Array(16).fill(2),
    });

    expect(Buffer.from(a).toString("hex")).not.toBe(
      Buffer.from(b).toString("hex")
    );
  });
});
