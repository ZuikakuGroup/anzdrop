import { AES_KEY_LENGTH, IV_LENGTH } from "./types";

// AES-256-GCM鍵を生成する
export async function generateKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey(
    {
      name: "AES-GCM",
      length: AES_KEY_LENGTH,
    },
    true,
    ["encrypt", "decrypt"]
  );
}

// CryptoKeyをraw形式でエクスポートする
export async function exportKey(key: CryptoKey): Promise<Uint8Array> {
  const raw = await crypto.subtle.exportKey("raw", key);

  return new Uint8Array(raw);
}

// raw鍵をCryptoKeyへ戻す
export async function importKey(raw: ArrayBuffer): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    raw,
    {
      name: "AES-GCM",
    },
    true,
    ["encrypt", "decrypt"]
  );
}

// AES-GCM用IVを生成する
export function generateIV(): Uint8Array<ArrayBuffer> {
  const iv = new Uint8Array(IV_LENGTH);
  crypto.getRandomValues(iv);

  return iv;
}