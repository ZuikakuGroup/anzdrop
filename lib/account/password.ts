import { argon2id } from "hash-wasm";
import { encodeBase64Url, decodeBase64Url } from "@/lib/crypto/base64";
import { timingSafeEqual } from "@/lib/timingSafeEqual";

// PBKDF2(210,000回)はCloudflare Workersランタイムの上限(反復回数10万回まで)を
// 超えるため本番で常に失敗していた。メモリハードで反復回数の制約を受けない
// Argon2idに切り替える。パラメータはOWASPの最小推奨相当(19MiB, 2回, 並列度1)。
const ARGON2ID_MEMORY_KIB = 19_456;
const ARGON2ID_ITERATIONS = 2;
const ARGON2ID_PARALLELISM = 1;
const ARGON2ID_HASH_LENGTH = 32;
const SALT_LENGTH = 16;

async function derive(
  password: string,
  salt: Uint8Array,
  memorySize: number,
  iterations: number,
  parallelism: number
): Promise<Uint8Array> {
  return argon2id({
    password,
    salt,
    memorySize,
    iterations,
    parallelism,
    hashLength: ARGON2ID_HASH_LENGTH,
    outputType: "binary",
  });
}

// "memorySize:iterations:parallelism$salt$hash" の1文字列としてDBの1カラムに保存する。
// パラメータを都度保存しておくことで、将来コストを引き上げても既存ハッシュを
// 検証できる(PBKDF2版と同じ考え方)。
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_LENGTH));
  const hash = await derive(
    password,
    salt,
    ARGON2ID_MEMORY_KIB,
    ARGON2ID_ITERATIONS,
    ARGON2ID_PARALLELISM
  );

  return [
    `${ARGON2ID_MEMORY_KIB}:${ARGON2ID_ITERATIONS}:${ARGON2ID_PARALLELISM}`,
    encodeBase64Url(salt),
    encodeBase64Url(hash),
  ].join("$");
}

// アカウント/リカバリーコードが存在しない場合でも、実在する場合と同じだけ
// Argon2idの計算コストをverifyPasswordに払わせるためのダミーハッシュ
// (応答時間の差からアカウントの存在を推測できないようにする)。
// salt/hashの中身自体は常に検証が失敗する適当な値でよく、
// パラメータ部分だけ本物のhashPassword()と一致していれば十分。
export const DUMMY_PASSWORD_HASH = [
  `${ARGON2ID_MEMORY_KIB}:${ARGON2ID_ITERATIONS}:${ARGON2ID_PARALLELISM}`,
  encodeBase64Url(new Uint8Array(SALT_LENGTH)),
  encodeBase64Url(new Uint8Array(ARGON2ID_HASH_LENGTH)),
].join("$");

export async function verifyPassword(
  password: string,
  stored: string
): Promise<boolean> {
  const parts = stored.split("$");

  if (parts.length !== 3) {
    return false;
  }

  const [paramsRaw, saltB64, hashB64] = parts;
  const paramParts = paramsRaw.split(":");

  if (paramParts.length !== 3) {
    return false;
  }

  const [memorySize, iterations, parallelism] = paramParts.map(Number);

  if (
    ![memorySize, iterations, parallelism].every(
      (value) => Number.isInteger(value) && value > 0
    )
  ) {
    return false;
  }

  const salt = new Uint8Array(decodeBase64Url(saltB64));
  const expected = new Uint8Array(decodeBase64Url(hashB64));
  const actual = await derive(
    password,
    salt,
    memorySize,
    iterations,
    parallelism
  );

  return timingSafeEqual(actual, expected);
}
