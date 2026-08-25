// タイミング攻撃対策: 長さが同じ場合、内容の一致・不一致に関わらず
// 常に全バイトを比較してから結果を返す。
export function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.byteLength !== b.byteLength) {
    return false;
  }

  let diff = 0;

  for (let i = 0; i < a.byteLength; i++) {
    diff |= a[i] ^ b[i];
  }

  return diff === 0;
}
