import { nanoid } from "nanoid";

// shareIdは秘密情報ではない(所有権の証明はuploadTokenが担う)ので、
// UUIDより短いランダムIDでURLを短縮する。10文字(nanoidの既定アルファベット、
// 64種類)で約60bitのエントロピーがあり、このアプリの想定規模では衝突は
// 事実上発生しない。
const SHARE_ID_LENGTH = 10;

export function generateShareId(): string {
  return nanoid(SHARE_ID_LENGTH);
}
