import { timingSafeEqual } from "@/lib/timingSafeEqual";

const BASE32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function encodeBase32(bytes: Uint8Array): string {
  let bits = 0, value = 0, output = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      output += BASE32[(value >>> bits) & 31];
    }
  }
  if (bits) output += BASE32[(value << (5 - bits)) & 31];
  return output;
}

function decodeBase32(secret: string): Uint8Array<ArrayBuffer> {
  if (!/^[A-Z2-7]+$/.test(secret)) throw new Error("Invalid OTP secret");
  const bytes = new Uint8Array(Math.floor(secret.length * 5 / 8));
  let bits = 0, value = 0, index = 0;
  for (const character of secret) {
    value = (value << 5) | BASE32.indexOf(character);
    bits += 5;
    if (bits >= 8) {
      bits -= 8;
      bytes[index++] = (value >>> bits) & 255;
    }
  }
  return bytes;
}

export function generateTotpSecret(): string {
  return encodeBase32(crypto.getRandomValues(new Uint8Array(20)));
}

export function totpUri(accountId: string, secret: string): string {
  return `otpauth://totp/${encodeURIComponent(`Anzdrop:${accountId}`)}?secret=${secret}&issuer=Anzdrop&algorithm=SHA1&digits=6&period=30`;
}

export async function totpAtStep(secret: string, step: number, digits = 6): Promise<string> {
  if (!Number.isSafeInteger(step) || step < 0) throw new Error("Invalid OTP step");
  const counter = new Uint8Array(8);
  new DataView(counter.buffer).setBigUint64(0, BigInt(step));
  const key = await crypto.subtle.importKey("raw", decodeBase32(secret), { name: "HMAC", hash: "SHA-1" }, false, ["sign"]);
  const hash = new Uint8Array(await crypto.subtle.sign("HMAC", key, counter));
  const offset = hash[hash.length - 1] & 15;
  const number = ((hash[offset] & 127) << 24) | (hash[offset + 1] << 16) | (hash[offset + 2] << 8) | hash[offset + 3];
  return String(number % 10 ** digits).padStart(digits, "0");
}

export async function matchTotpStep(secret: string, code: string, now = Date.now()): Promise<number | null> {
  if (!/^\d{6}$/.test(code)) return null;
  const current = Math.floor(now / 30_000);
  const encoder = new TextEncoder();
  let matched: number | null = null;
  for (const step of [current - 1, current, current + 1]) {
    if (step < 0) continue;
    const expected = await totpAtStep(secret, step);
    if (timingSafeEqual(encoder.encode(code), encoder.encode(expected))) matched = step;
  }
  return matched;
}
