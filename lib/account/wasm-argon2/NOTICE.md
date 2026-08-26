# NOTICE

`argon2.wasm` と `blake2b.wasm` は [hash-wasm](https://github.com/Daninet/hash-wasm)
(MIT License, Copyright (c) 2020 Dani Biró) の `src/argon2.c` / `src/blake2b.c`
を、同プロジェクトの `scripts/Makefile-clang` と同一のビルドオプションで
コンパイルしたものです。

```
clang -flto -O3 -nostdlib -fno-builtin -ffreestanding -mexec-model=reactor \
  --target=wasm32 -fuse-ld=lld \
  -Wl,--strip-all -Wl,--initial-memory=131072 -Wl,--max-memory=<memory> \
  -Wl,--no-entry -Wl,--allow-undefined -Wl,--compress-relocations \
  -Wl,--export-dynamic -o <output>.wasm <input>.c
```

`argon2id.ts` / `wasm-interface.ts` の呼び出しロジックは、同プロジェクトの
`lib/argon2.ts` / `lib/WASMInterface.ts` の移植です。

Cloudflare Workers本番ランタイムが実行時の動的WebAssemblyコード生成
(`WebAssembly.compile`/`instantiate`にバイト列を渡す形)を禁止しているため、
hash-wasm本体(WASMをBase64文字列として埋め込み実行時にデコード・コンパイル
する設計)をそのまま利用できず、あらかじめコンパイル済みの`.wasm`を静的
importする形にした自前の薄いラッパーとして移植している。

## License

```
MIT License

Copyright (c) 2020 Dani Biró

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
```
