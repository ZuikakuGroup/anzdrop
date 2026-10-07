import { isoCBOR } from "@simplewebauthn/server/helpers";
import type { AuthenticationResponseJSON, RegistrationResponseJSON } from "@simplewebauthn/server";
import { decodeBase64Url, encodeBase64Url } from "@/lib/crypto/base64";

function concat(...parts: Uint8Array[]): Uint8Array<ArrayBuffer> {
  const output = new Uint8Array(parts.reduce((size, part) => size + part.length, 0));
  let offset = 0;
  for (const part of parts) { output.set(part, offset); offset += part.length; }
  return output;
}
const text = (value: string) => new TextEncoder().encode(value);
const sha256 = async (value: Uint8Array<ArrayBuffer>) => new Uint8Array(await crypto.subtle.digest("SHA-256", value));

// モックのverified:trueではなく、実ライブラリが検証できる署名とCBORを作る。
export async function createPasskeyFixture() {
  const pair = await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
  const jwk = await crypto.subtle.exportKey("jwk", pair.publicKey);
  const publicKey = isoCBOR.encode(new Map<number, number | Uint8Array>([
    [1, 3], [3, -257], [-1, new Uint8Array(decodeBase64Url(jwk.n!))], [-2, new Uint8Array(decodeBase64Url(jwk.e!))],
  ]));
  const idBytes = crypto.getRandomValues(new Uint8Array(32));
  const id = encodeBase64Url(idBytes);
  const userId = encodeBase64Url(crypto.getRandomValues(new Uint8Array(32)));
  const authData = async (rpID: string, flags: number, counter: number, registration = false) => {
    const count = new Uint8Array(4);
    new DataView(count.buffer).setUint32(0, counter);
    const base = concat(await sha256(text(rpID)), new Uint8Array([flags]), count);
    if (!registration) return base;
    const length = new Uint8Array(2);
    new DataView(length.buffer).setUint16(0, idBytes.length);
    return concat(base, new Uint8Array(16), length, idBytes, publicKey);
  };

  return {
    id, userId, publicKey,
    async registration(challenge: string, options: { origin?: string; rpID?: string; flags?: number } = {}): Promise<RegistrationResponseJSON> {
      const data = await authData(options.rpID ?? "localhost", options.flags ?? 0x45, 0, true);
      return { id, rawId: id, type: "public-key", clientExtensionResults: { credProps: { rk: true } }, response: {
        clientDataJSON: encodeBase64Url(text(JSON.stringify({ type: "webauthn.create", challenge, origin: options.origin ?? "http://localhost:3000", crossOrigin: false }))),
        attestationObject: encodeBase64Url(isoCBOR.encode(new Map<string, string | Map<string, never> | Uint8Array>([["fmt", "none"], ["attStmt", new Map<string, never>()], ["authData", data]]))),
        transports: ["internal"],
      } };
    },
    async authentication(challenge: string, options: { origin?: string; rpID?: string; flags?: number; counter?: number; userHandle?: string } = {}): Promise<AuthenticationResponseJSON> {
      const clientData = text(JSON.stringify({ type: "webauthn.get", challenge, origin: options.origin ?? "http://localhost:3000", crossOrigin: false }));
      const data = await authData(options.rpID ?? "localhost", options.flags ?? 0x05, options.counter ?? 1);
      const signature = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", pair.privateKey, concat(data, await sha256(clientData)));
      return { id, rawId: id, type: "public-key", clientExtensionResults: {}, response: {
        clientDataJSON: encodeBase64Url(clientData), authenticatorData: encodeBase64Url(data), signature: encodeBase64Url(signature), userHandle: options.userHandle ?? userId,
      } };
    },
  };
}
