import { decodeBase64Url, encodeBase64Url } from "@/lib/crypto/base64";

async function encryptionKey(encodedKey: string): Promise<CryptoKey> {
  if (!/^[A-Za-z0-9_-]{43}$/.test(encodedKey)) throw new Error("ACCOUNT_AUTH_ENCRYPTION_KEY is not configured correctly");
  const bytes = decodeBase64Url(encodedKey);
  if (bytes.byteLength !== 32) throw new Error("Invalid account auth encryption key");
  return crypto.subtle.importKey("raw", bytes, "AES-GCM", false, ["encrypt", "decrypt"]);
}

function aad(accountId: string, purpose: "totp" | "totp-setup"): Uint8Array<ArrayBuffer> {
  return new TextEncoder().encode(JSON.stringify(["anzdrop-account-auth-v1", accountId, purpose]));
}

export async function encryptAuthSecret(secret: string, accountId: string, purpose: "totp" | "totp-setup", key: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const ciphertext = await crypto.subtle.encrypt({ name: "AES-GCM", iv, additionalData: aad(accountId, purpose) }, await encryptionKey(key), new TextEncoder().encode(secret));
  return `v1.${encodeBase64Url(iv)}.${encodeBase64Url(ciphertext)}`;
}

export async function decryptAuthSecret(encoded: string, accountId: string, purpose: "totp" | "totp-setup", key: string): Promise<string> {
  const [version, iv, ciphertext, extra] = encoded.split(".");
  if (version !== "v1" || !iv || !ciphertext || extra || decodeBase64Url(iv).byteLength !== 12) throw new Error("Invalid encrypted OTP secret");
  const plaintext = await crypto.subtle.decrypt({ name: "AES-GCM", iv: decodeBase64Url(iv), additionalData: aad(accountId, purpose) }, await encryptionKey(key), decodeBase64Url(ciphertext));
  return new TextDecoder().decode(plaintext);
}
