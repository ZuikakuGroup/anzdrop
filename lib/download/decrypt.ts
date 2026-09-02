import {
  importKey,
  decodeBase64Url,
  unpackChunk,
  decryptChunk,
  iterateDecryptedChunks,
  deriveKeyFromPassword,
} from "@/lib/crypto";
import { FileGoneError, FriendlyError, FILE_GONE_ERROR } from "./errors";
import { createParallelCiphertextStream } from "./parallelFetch";

export type RawFile = {
  id: string;
  name: string;
  size: number;
  isOneTime: boolean;
};

export type DecryptedFile = {
  id: string;
  name: string;
  size: number;
  isOneTime: boolean;
};

export async function decryptFileName(
  encryptedName: string,
  key: CryptoKey
): Promise<string> {
  const packed = new Uint8Array(decodeBase64Url(encryptedName));
  const { iv, ciphertext } = unpackChunk(packed);
  const decrypted = await decryptChunk(ciphertext, iv, key);

  return new TextDecoder().decode(decrypted);
}

export async function decryptFileList(
  rawFiles: RawFile[],
  key: CryptoKey
): Promise<DecryptedFile[]> {
  return Promise.all(
    rawFiles.map(async (file) => ({
      id: file.id,
      name: await decryptFileName(file.name, key),
      size: file.size,
      isOneTime: file.isOneTime,
    }))
  );
}

export async function unwrapKeyWithPassword(
  wrappedKey: string,
  keySalt: string,
  password: string
): Promise<CryptoKey> {
  const salt = new Uint8Array(decodeBase64Url(keySalt));
  const kek = await deriveKeyFromPassword(password, salt);
  const packed = new Uint8Array(decodeBase64Url(wrappedKey));
  const { iv, ciphertext } = unpackChunk(packed);
  const rawKey = await decryptChunk(ciphertext, iv, kek);

  return importKey(rawKey);
}

// 暗号化済みファイル本体のバイト列ストリームを取得する。
//
// 回数制限のあるファイル(保存期間「1回」など)は、サーバー側のダウンロード数
// カウントを1回に保つため、単一の GET のまま取得する。それ以外のファイルは
// 複数の Range リクエストで並列取得して実効速度を上げる(lib/download/parallelFetch.ts)。
// どちらの経路でもバイト列は「salt + 全パケットの連結」で同一なので、後段の
// iterateDecryptedChunks は変更なしで動く。
async function fetchCiphertextStream(
  file: DecryptedFile
): Promise<ReadableStream<Uint8Array>> {
  if (file.isOneTime) {
    const response = await fetch(`/api/file/${file.id}`);

    if (response.status === 404) {
      throw new FileGoneError(FILE_GONE_ERROR);
    }

    if (!response.ok || !response.body) {
      throw new FriendlyError("ダウンロードに失敗しました。");
    }

    return response.body;
  }

  return createParallelCiphertextStream(`/api/file/${file.id}`);
}

// ファイル本体を取得し、受信しながらチャンクごとに復号した平文を順番に
// 流すReadableStreamを返す。呼び出し側はこれをディスクへ直接書き出す
// (showSaveFilePicker)ことで、ファイル全体をメモリに保持せずに保存できる。
// 途中切断・改ざんは iterateDecryptedChunks 側で検知され、streamのエラーと
// して伝播する。
export async function fetchDecryptedStream(
  file: DecryptedFile,
  key: CryptoKey
): Promise<ReadableStream<Uint8Array>> {
  const ciphertext = await fetchCiphertextStream(file);
  const chunks = iterateDecryptedChunks(ciphertext, key, file.size);

  // 消費側(ディスク書き込みなど)が現在のチャンクを処理している間に、次の
  // チャンクの復号を先行させておく(1段の先読みパイプライン)。復号は
  // WebCrypto がワーカースレッドで行うため、これで受信・復号・書き込みが
  // 重なって進む。キャンセルは従来どおり chunks.return() に集約する。
  //
  // pending は「次の pull で必ず await される」前提だが、消費側が cancel も
  // pull もせずにストリームを放棄した場合(暗号文が壊れていて chunks.next() が
  // reject するケースなど)に unhandled rejection にならないよう、生成のたびに
  // 無害なハンドラを1つ付けておく(元の pending は変わらず、後続の await でも
  // 同じ理由で reject する)。
  const startNextChunk = (): Promise<IteratorResult<Uint8Array>> => {
    const next = chunks.next();
    next.catch(() => {});
    return next;
  };

  let pending = startNextChunk();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { value, done } = await pending;

        if (done) {
          controller.close();
          return;
        }

        pending = startNextChunk();
        controller.enqueue(value);
      } catch (err) {
        controller.error(err);
      }
    },
    async cancel() {
      await chunks.return(undefined);
      await pending.catch(() => {});
    },
  });
}

export async function fetchAndDecrypt(
  file: DecryptedFile,
  key: CryptoKey
): Promise<Uint8Array> {
  const stream = await fetchDecryptedStream(file, key);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let totalLength = 0;

  for (;;) {
    const { value, done } = await reader.read();

    if (done) {
      break;
    }

    chunks.push(value);
    totalLength += value.byteLength;
  }

  const combined = new Uint8Array(totalLength);
  let offset = 0;

  for (const chunk of chunks) {
    combined.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return combined;
}
