import { useEffect, useRef, useState } from "react";
import { importKey, decodeBase64Url } from "@/lib/crypto";
import { FriendlyError, shareLoadErrorFor, toFriendlyMessage } from "./errors";
import { decryptFileList, unwrapKeyWithPassword, type DecryptedFile, type RawFile } from "./decrypt";
import type { DownloadResponse } from "@/lib/api/schemas/download/[shareId]/schema";

const GENERIC_LOAD_ERROR = "ファイルの取得に失敗しました。URLが正しいかご確認のうえ、もう一度お試しください。";

export function useSharedFiles(shareId: string) {
  const [files, setFiles] = useState<DecryptedFile[]>([]);

  const [error, setError] = useState("");

  const [isLoading, setIsLoading] =
    useState(true);

  const [key, setKey] = useState<CryptoKey | null>(null);

  const [previewAllowed, setPreviewAllowed] = useState(false);

  const [passwordProtection, setPasswordProtection] = useState<{
    wrappedKey: string;
    keySalt: string;
    rawFiles: RawFile[];
  } | null>(null);

  const [passwordInput, setPasswordInput] = useState("");
  const [passwordError, setPasswordError] = useState("");
  const [isUnlocking, setIsUnlocking] = useState(false);

  const generation = useRef(0);
  const unlocking = useRef(false);
  const analyticsTransferIdRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    generation.current++;
    unlocking.current = false;
    setIsLoading(true);
    setFiles([]);
    setKey(null);
    setError("");
    setPreviewAllowed(false);
    setPasswordProtection(null);
    setPasswordInput("");
    setPasswordError("");
    setIsUnlocking(false);
    analyticsTransferIdRef.current = undefined;
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch(
          `/api/download/${shareId}`
        );

        const result: DownloadResponse =
          await response.json();

        if (!response.ok) {
          // ステータスごとの文言は lib/download/errors.ts に集約している
          // (UIを描画せずに対応関係をテストできるようにするため)。
          const friendly = shareLoadErrorFor(response.status);

          if (friendly) {
            throw friendly;
          }

          throw new Error(!result.success ? result.error : "ダウンロードに失敗しました");
        }

        if (cancelled) return;
        if (!result.success) throw new Error(result.error);
        setPreviewAllowed(result.share.previewAllowed);
        analyticsTransferIdRef.current = result.analyticsTransferId;

        if (result.share.wrappedKey && result.share.keySalt) {
          setPasswordProtection({
            wrappedKey: result.share.wrappedKey,
            keySalt: result.share.keySalt,
            rawFiles: result.files,
          });
          return;
        }

        const fragment = window.location.hash.slice(1);

        if (!fragment) {
          throw new FriendlyError(
            "このリンクには復号鍵が含まれていません。"
          );
        }

        let decryptionKey: CryptoKey;

        try {
          decryptionKey = await importKey(decodeBase64Url(fragment));
        } catch {
          throw new FriendlyError(
            "このリンクの復号鍵が正しくありません。URLが省略されていないかご確認ください。"
          );
        }

        try {
          const decryptedFiles = await decryptFileList(result.files, decryptionKey);
          if (cancelled) return;
          setFiles(decryptedFiles);
        } catch {
          throw new FriendlyError(
            "このリンクの復号鍵が正しくありません。URLが省略されていないかご確認ください。"
          );
        }

        setKey(decryptionKey);
      } catch (err) {
        if (!cancelled) setError(toFriendlyMessage(err, GENERIC_LOAD_ERROR));
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => { cancelled = true; generation.current++; };
  }, [shareId]);

  const unlockWithPassword = async () => {
    if (!passwordProtection || unlocking.current) {
      return;
    }

    if (!passwordInput) {
      setPasswordError("パスワードを入力してください。");
      return;
    }

    setPasswordError("");
    unlocking.current = true;
    setIsUnlocking(true);
    const currentGeneration = generation.current;

    try {
      const decryptionKey = await unwrapKeyWithPassword(
        passwordProtection.wrappedKey,
        passwordProtection.keySalt,
        passwordInput
      );

      if (currentGeneration !== generation.current) return;
      const decryptedFiles = await decryptFileList(
        passwordProtection.rawFiles,
        decryptionKey
      );

      if (currentGeneration !== generation.current) return;
      setKey(decryptionKey);
      setFiles(decryptedFiles);
      setPasswordProtection(null);
    } catch {
      if (currentGeneration === generation.current) setPasswordError("パスワードが違います。");
    } finally {
      if (currentGeneration === generation.current) {
        unlocking.current = false;
        setIsUnlocking(false);
      }
    }
  };

  return { files, setFiles, error, setError, isLoading, key, previewAllowed,
    passwordProtection, passwordInput, setPasswordInput, passwordError, isUnlocking,
    unlockWithPassword, analyticsTransferIdRef };
}
