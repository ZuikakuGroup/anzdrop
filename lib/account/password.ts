import { encodeBase64Url, decodeBase64Url } from "@/lib/crypto/base64";
import { timingSafeEqual } from "@/lib/timingSafeEqual";

// E2EE用の鍵ラップ(lib/crypto/key.ts, 600,000回)より低い回数にしている。
// こちらはログインのたびにサーバー側(Workers)で同期的に計算するコストで、
// リクエストごとのCPU時間に直結するため。OWASPのPBKDF2-HMAC-SHA256における
// 現行の推奨最小値(210,000回)を採用する。
const PASSWORD_PBKDF2_ITERATIONS = 210_000;
const SALT_LENGTH = 16;
const DERIVED_KEY_BITS = 256;

async function derive(
  password: string,
  salt: Uint8Array,
  iterations: number
): Promise<Uint8Array> {
  const baseKey = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"]
  );

  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      salt: new Uint8Array(salt),
      iterations,
      hash: "SHA-256",
    },
    baseKey,
    DERIVED_KEY_BITS
  );

  return new Uint8Array(bits);
}

// "iterations$salt$hash" の1文字列としてDBの1カラムに保存する。
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await derive(password, salt, PASSWORD_PBKDF2_ITERATIONS);

  return [
    PASSWORD_PBKDF2_ITERATIONS,
    encodeBase64Url(salt),
    encodeBase64Url(hash),
  ].join("$");
}

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 3) {
    return false;
  }

  const [iterationsRaw, saltB64, hashB64] = parts;
  const iterations = Number(iterationsRaw);

  if (!Number.isInteger(iterations) || iterations <= 0) {
    return false;
  }

  const salt = new Uint8Array(decodeBase64Url(saltB64));
  const expected = new Uint8Array(decodeBase64Url(hashB64));
  const actual = await derive(password, salt, iterations);

  return timingSafeEqual(actual, expected);
}
