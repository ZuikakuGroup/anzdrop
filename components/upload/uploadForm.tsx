"use client";

import { useEffect, useId, useState, type ReactNode } from "react";
import Script from "@/components/brand/ExternalScript";
import Spinner from "@/components/brand/Spinner";
import { ChevronIcon } from "@/components/brand/ShareIcons";
import { TURNSTILE_SITE_KEY } from "@/lib/turnstile-client";
import { useUploadSession } from "@/lib/upload/useUploadSession";
import UploadDropOverlay from "@/components/upload/UploadDropOverlay";
import UploadShareResult from "@/components/upload/UploadShareResult";
import UploadProgress from "@/components/upload/UploadProgress";
import UploadErrorPanel from "@/components/upload/UploadErrorPanel";
import UploadFilePicker from "@/components/upload/UploadFilePicker";

type AdvancedSettingsModule = typeof import("@/components/upload/AdvancedSettings");

let advancedSettingsPromise: Promise<AdvancedSettingsModule> | undefined;

function loadAdvancedSettings() {
  if (!advancedSettingsPromise) {
    const pendingImport = import("@/components/upload/AdvancedSettings");
    advancedSettingsPromise = pendingImport;
    void pendingImport.catch(() => {
      if (advancedSettingsPromise === pendingImport) {
        advancedSettingsPromise = undefined;
      }
    });
  }
  return advancedSettingsPromise;
}

function preloadAdvancedSettings() {
  void loadAdvancedSettings().catch(() => {});
}

type UploadFormProps = { header: ReactNode; footer: ReactNode };

export default function UploadForm({ header, footer }: UploadFormProps) {
  const fileInputId = useId();
  const { files, shareUrl, isUploading, error, setError, isDragging, progress,
    copyState, retention, setRetention, usePassword, setUsePassword,
    hasCreatedShare, password, setPassword, showAdvanced, setShowAdvanced,
    plan, isQrOpen, setIsQrOpen, canShareNatively, shouldLoadTurnstile,
    turnstileWidget, handleFileChange, handleDragEnter, handleDragOver,
    handleDragLeave, handleDrop, prepareTurnstile, upload, handleCopy,
    resetForm, shareNative, shareToLine } = useUploadSession();
  const [AdvancedSettings, setAdvancedSettings] = useState<AdvancedSettingsModule["default"] | null>(null);

  useEffect(() => {
    if (!showAdvanced || AdvancedSettings) {
      return;
    }

    let cancelled = false;
    loadAdvancedSettings()
      .then((module) => {
        if (!cancelled) {
          setAdvancedSettings(() => module.default);
        }
      })
      .catch(() => {});

    return () => {
      cancelled = true;
    };
  }, [showAdvanced, AdvancedSettings]);

  return (
    <div
      className="relative flex min-h-screen flex-col"
      onDragEnter={handleDragEnter}
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {isDragging && <UploadDropOverlay />}

      {header}

      {/* ヘッダー(h-16)とメインだけでちょうど1画面分の高さになるようにして、
          フッターは常にファーストビューの外(スクロールしないと見えない位置)へ
          追い出す。モバイルのブラウザUIバー表示時でも隠れるよう svh を使う。 */}
      <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              Anzdrop
            </h1>
            <p className="text-xs text-ink/50">
              ナウでヤングな暗号化ファイル共有サービス
            </p>
          </div>

          <div className="border-l-2 border-brand py-0.5 pl-3 text-[13px] leading-relaxed text-ink/60">
            どんなファイルも簡単に共有できます。<br/>プライバシーにこだわっており、いい感じに暗号化されます。
          </div>

          <div className="space-y-5">
            {shareUrl ? (
              <UploadShareResult
                shareUrl={shareUrl}
                copyState={copyState}
                canShareNatively={canShareNatively}
                isQrOpen={isQrOpen}
                onReset={resetForm}
                onCopy={handleCopy}
                onShareNative={shareNative}
                onShareToLine={shareToLine}
                onOpenQr={() => setIsQrOpen(true)}
                onCloseQr={() => setIsQrOpen(false)}
              />
            ) : isUploading ? (
              <UploadProgress progress={progress} />
            ) : error ? (
              <UploadErrorPanel error={error} onDismiss={() => setError("")} />
            ) : (
              <UploadFilePicker
                fileInputId={fileInputId}
                files={files}
                onFileChange={handleFileChange}
              />
            )}

            <div
              className={
                !shareUrl && !isUploading ? "" : "invisible"
              }
              inert={!(!shareUrl && !isUploading)}
            >
              <button
                type="button"
                onClick={() => {
                  preloadAdvancedSettings();
                  setShowAdvanced((prev) => !prev);
                }}
                onPointerEnter={preloadAdvancedSettings}
                onFocus={preloadAdvancedSettings}
                aria-expanded={showAdvanced}
                aria-controls="upload-advanced-settings"
                className="flex items-center gap-1 text-xs font-bold text-ink/50 hover:text-ink"
              >
                詳細設定
                <ChevronIcon
                  className={`h-3 w-3 shrink-0 transition-transform duration-300 ${
                    showAdvanced ? "rotate-180" : ""
                  }`}
                />
              </button>

              <div
                id="upload-advanced-settings"
                className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
                  showAdvanced ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
                }`}
              >
                <div className="overflow-hidden" inert={!showAdvanced}>
                  {AdvancedSettings && (
                    <AdvancedSettings
                      plan={plan}
                      retention={retention}
                      onRetentionChange={setRetention}
                      usePassword={usePassword}
                      onUsePasswordChange={setUsePassword}
                      password={password}
                      onPasswordChange={setPassword}
                      hasCreatedShare={hasCreatedShare}
                    />
                  )}
                </div>
              </div>
            </div>

            {turnstileWidget}

            <button
              onClick={upload}
              onPointerEnter={prepareTurnstile}
              onPointerDown={prepareTurnstile}
              onFocus={prepareTurnstile}
              disabled={isUploading || !!shareUrl}
              className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
            >
              {isUploading && <Spinner className="h-4 w-4 text-paper" />}
              {isUploading ? "アップロード中..." : "アップロードする"}
            </button>
          </div>
        </div>
      </main>

      {footer}

      {shouldLoadTurnstile && TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </div>
  );
}
