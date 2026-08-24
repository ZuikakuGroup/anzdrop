import {
  AES_KEY_LENGTH,
  IV_LENGTH,
  PBKDF2_ITERATIONS,
  PBKDF2_SALT_LENGTH,
} from "./types";

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

// PBKDF2用ソルトを生成する
export function generateSalt(): Uint8Array<ArrayBuffer> {
  const salt = new Uint8Array(PBKDF2_SALT_LENGTH);
  crypto.getRandomValues(salt);

  return salt;
}

// パスワードとソルトから、暗号化キーをラップ/アンラップするための鍵(KEK)を導出する。
// サーバーはパスワードもこの鍵導出結果も一度も見ない。
export async function deriveKeyFromPassword(
  password: string,
  salt: Uint8Array
): Promise<CryptoKey> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveKey"]
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    baseKey,
    {
      name: "AES-GCM",
      length: AES_KEY_LENGTH,
    },
    false,
    ["encrypt", "decrypt"]
  );
}