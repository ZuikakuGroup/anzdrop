"use client";

import { useState, useSyncExternalStore } from "react";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";

type ReportFormProps = {
  initialShareId: string;
};

type ReportResponse = {
  success: boolean;
  error?: string;
};

// window.location.origin はReactの外側にある値なので、SSR中は取得できない。
// useSyncExternalStoreでサーバー描画時は空文字、クライアントでは実際のoriginを返す。
const noopSubscribe = () => () => {};
const getOriginSnapshot = () => window.location.origin;
const getOriginServerSnapshot = () => "";

export default function ReportForm({
  initialShareId,
}: ReportFormProps) {
  const [shareId, setShareId] = useState(initialShareId);
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const origin = useSyncExternalStore(
    noopSubscribe,
    getOriginSnapshot,
    getOriginServerSnapshot
  );

  const submit = async () => {
    if (isSubmitting || submitted) {
      return;
    }

    if (!shareId.trim() || !reason.trim()) {
      setError("共有URLと理由を入力してください。");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const response = await fetch("/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ shareId, reason }),
      });

      const result = (await response.json()) as ReportResponse;

      if (!response.ok || !result.success) {
        throw new Error(result.error ?? "送信に失敗しました。");
      }

      setSubmitted(true);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error
          ? unknownErr
          : new Error("Unknown error");

      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              問題を報告
            </h1>
            <p className="text-xs text-ink/50">
              不正なファイルや迷惑行為を報告できます
            </p>
          </div>

          <div className="border-l-2 border-brand py-0.5 pl-3 text-[13px] leading-relaxed text-ink/60">
            運営者は共有URLをもとに対象を確認・削除します。ファイルの中身を復号して確認することはありません。
          </div>

          <div className="grid min-h-[320px]">
            <div
              className={`col-start-1 row-start-1 space-y-4 ${
                submitted ? "invisible" : ""
              }`}
              aria-hidden={submitted}
            >
              <div className="space-y-1">
                <label
                  htmlFor="report-share-url"
                  className="text-xs font-bold text-ink/50"
                >
                  共有URL
                </label>
                <input
                  id="report-share-url"
                  type="text"
                  value={shareId}
                  onChange={(event) => setShareId(event.target.value)}
                  placeholder={`${origin || "https://..."}/d/xxxxxxxx`}
                  className="w-full rounded border-2 border-ink/20 px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="report-reason"
                  className="text-xs font-bold text-ink/50"
                >
                  理由
                </label>
                <textarea
                  id="report-reason"
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  rows={4}
                  placeholder="問題の内容を具体的にご記入ください"
                  className="w-full resize-none rounded border-2 border-ink/20 px-3 py-2 text-sm outline-none focus:border-brand"
                />
              </div>

              <button
                onClick={submit}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
              >
                {isSubmitting ? "送信中..." : "送信する"}
              </button>

              <p className="min-h-[20px] text-sm font-bold text-brand">
                {error}
              </p>
            </div>

            <div
              className={`col-start-1 row-start-1 flex flex-col items-center justify-center gap-2 rounded border-2 border-brand p-4 text-center ${
                submitted ? "" : "invisible"
              }`}
              aria-hidden={!submitted}
            >
              <p className="text-sm font-bold">
                ご報告ありがとうございます。確認いたします。
              </p>
            </div>
          </div>
        </div>
      </main>

      <SiteFooter />
    </div>
  );
}
