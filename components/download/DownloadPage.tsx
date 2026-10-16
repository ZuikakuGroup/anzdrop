"use client";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import PasswordGate from "./PasswordGate";
import DownloadLoading from "./DownloadLoading";
import DownloadErrorPanel from "./DownloadErrorPanel";
import DownloadFileList from "./DownloadFileList";
import FilePreviewModal from "./FilePreviewModal";
import SendCtaModal from "./SendCtaModal";
import { useSharedFiles } from "@/lib/download/useSharedFiles";
import { useDownloadActions } from "@/lib/download/useDownloadActions";

export default function DownloadPage({ shareId }: { shareId: string }) {
  const shared = useSharedFiles(shareId);
  const { files, error, setError, isLoading, previewAllowed, passwordProtection,
    passwordInput, setPasswordInput, passwordError, isUnlocking, unlockWithPassword } = shared;
  const { downloadingId, isDownloadingAll, preview, previewLoadingId, downloadFile,
    openPreview, closePreview, downloadAll, isSendCtaOpen, setIsSendCtaOpen,
    isSendCtaDisabled, handleSendCtaClick, handleSendCtaDisabledChange } = useDownloadActions(shared);

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black tracking-normal">
              ダウンロード
            </h1>
            <p className="text-xs text-ink/50">
              ナウでヤングな暗号化ファイル共有サービス
            </p>
          </div>

          <div className="border-l-2 border-brand py-0.5 pl-3 text-[13px] leading-relaxed text-ink/60">
            どんなファイルも簡単に共有できます。<br/>プライバシーにこだわっており、いい感じに暗号化されます。
          </div>

          <div className="space-y-5">
            {isLoading ? (
              <DownloadLoading />
            ) : passwordProtection ? (
              <PasswordGate
                passwordInput={passwordInput}
                passwordError={passwordError}
                onPasswordChange={setPasswordInput}
                onSubmit={unlockWithPassword}
              />
            ) : error ? (
              <DownloadErrorPanel
                error={error}
                onDismiss={() => setError("")}
              />
            ) : (
              <DownloadFileList
                files={files}
                previewAllowed={previewAllowed}
                downloadingId={downloadingId}
                isDownloadingAll={isDownloadingAll}
                previewLoadingId={previewLoadingId}
                onDownload={downloadFile}
                onPreview={openPreview}
              />
            )}

            <button
              onClick={passwordProtection ? unlockWithPassword : downloadAll}
              disabled={
                passwordProtection
                  ? isUnlocking
                  : isLoading ||
                  !!error ||
                  files.length === 0 ||
                  isDownloadingAll ||
                  !!downloadingId
              }
              className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
            >
              {(passwordProtection ? isUnlocking : isDownloadingAll) && (
                <Spinner className="h-4 w-4 text-paper" />
              )}
              {passwordProtection
                ? isUnlocking
                  ? "確認中..."
                  : "開く"
                : isDownloadingAll
                  ? "ダウンロード中..."
                  : "全てダウンロード"}
            </button>

          </div>
        </div>
      </main>

      <SiteFooter reportShareId={shareId} />

      {preview && (
        <FilePreviewModal preview={preview} onClose={closePreview} />
      )}

      {isSendCtaOpen && (
        <SendCtaModal
          isSendCtaDisabled={isSendCtaDisabled}
          onClose={() => setIsSendCtaOpen(false)}
          onCtaClick={handleSendCtaClick}
          onDisabledChange={handleSendCtaDisabledChange}
        />
      )}
    </div>
  );
}
