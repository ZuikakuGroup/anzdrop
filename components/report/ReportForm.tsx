"use client";

import { useState } from "react";
import CenteredFormShell from "@/components/brand/CenteredFormShell";
import { sanitizeReportText } from "@/lib/sanitize";
import { useTurnstile } from "@/lib/turnstile-client";
import { usePageOrigin } from "@/lib/browser/usePageOrigin";
import { REPORT_CATEGORIES } from "@/lib/api/schemas/report/schema";

type ReportFormProps = {
  initialShareId: string;
};

type ReportResponse = {
  success: boolean;
  error?: string;
};

type Category = (typeof REPORT_CATEGORIES)[number];

const CATEGORY_OPTIONS: { value: Category; label: string }[] = [
  { value: "csam", label: "児童ポルノ等の違法コンテンツ" },
  { value: "malware", label: "マルウェア・危険なファイル" },
  { value: "privacy", label: "個人情報の無断掲載・晒し" },
  { value: "spam", label: "スパム・迷惑行為" },
  { value: "other", label: "その他" },
];

export default function ReportForm({
  initialShareId,
}: ReportFormProps) {
  const [shareId, setShareId] = useState(initialShareId);
  const [category, setCategory] = useState<Category | "">("");
  const [reason, setReason] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const origin = usePageOrigin();
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile();

  const submit = async () => {
    if (isSubmitting || submitted) {
      return;
    }

    if (!shareId.trim() || !category || !reason.trim()) {
      setError("共有URL・通報の種類・理由を入力してください。");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const turnstileToken = await getTurnstileToken();

      const response = await fetch("/api/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          reportType: "general",
          shareId,
          category,
          reason: sanitizeReportText(reason),
          turnstileToken,
        }),
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
          : new Error("不明なエラー");

      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <CenteredFormShell
      title="問題を報告"
      description="不正なファイルや迷惑行為を報告できます"
      notice={
        <div className="space-y-1 border-l-2 border-brand py-0.5 pl-3 text-[13px] leading-relaxed text-ink/60">
          <p>
            著作権など、ご自身が権利をお持ちのコンテンツについての申し立ては
            {" "}
            <a
              href={`/report/rights${
                shareId ? `?shareId=${encodeURIComponent(shareId)}` : ""
              }`}
              className="font-bold text-brand hover:underline"
            >
              権利者の方向けフォーム
            </a>
            {" "}
            をご利用ください。
          </p>
        </div>
      }
    >
          <div className="grid min-h-[400px]">
            <div
              className={`col-start-1 row-start-1 space-y-4 ${
                submitted ? "invisible" : ""
              }`}
              aria-hidden={submitted}
              suppressHydrationWarning
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
                  className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="report-category"
                  className="text-xs font-bold text-ink/50"
                >
                  通報の種類
                </label>
                <div className="relative">
                  <select
                    id="report-category"
                    value={category}
                    onChange={(event) =>
                      setCategory(event.target.value as Category)
                    }
                    className="w-full appearance-none rounded border-2 border-ink/20 px-3 py-2 pr-9 text-base outline-none focus:border-brand sm:text-sm"
                  >
                    <option value="" disabled>
                      選択してください
                    </option>
                    {CATEGORY_OPTIONS.map((option) => (
                      <option key={option.value} value={option.value}>
                        {option.label}
                      </option>
                    ))}
                  </select>
                  <svg
                    className="pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink/40"
                    viewBox="0 0 20 20"
                    fill="none"
                    aria-hidden="true"
                  >
                    <path
                      d="M5 7.5L10 12.5L15 7.5"
                      stroke="currentColor"
                      strokeWidth="1.5"
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    />
                  </svg>
                </div>
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
                  className="w-full resize-none rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                />
              </div>

              {turnstileWidget}

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
    </CenteredFormShell>
  );
}
