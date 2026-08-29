"use client";

import { useState } from "react";
import Script from "next/script";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import { sanitizeReportText } from "@/lib/sanitize";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import type { ContactResponse } from "@/app/api/contact/schema";

export default function ContactForm() {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [subject, setSubject] = useState("");
  const [message, setMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [submitted, setSubmitted] = useState(false);
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile();

  const submit = async () => {
    if (isSubmitting || submitted) {
      return;
    }

    if (!email.trim() || !subject.trim() || !message.trim()) {
      setError("メールアドレス・件名・本文を入力してください。");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const turnstileToken = await getTurnstileToken();

      const response = await fetch("/api/contact", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          name: sanitizeReportText(name),
          email: sanitizeReportText(email),
          subject: sanitizeReportText(subject),
          message: sanitizeReportText(message),
          turnstileToken,
        }),
      });

      const result = (await response.json()) as ContactResponse;

      if (!response.ok || !result.success) {
        throw new Error(!result.success ? result.error : "送信に失敗しました。");
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
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              お問い合わせ
            </h1>
            <p className="text-xs text-ink/50">
              ご質問・ご要望などお気軽にご連絡ください
            </p>
          </div>

          <div className="space-y-1 border-l-2 border-brand py-0.5 pl-3 text-[13px] leading-relaxed text-ink/60">
            <p>
              不正なファイルや迷惑行為の通報は
              {" "}
              <a
                href="/report"
                className="font-bold text-brand hover:underline"
              >
                通報フォーム
              </a>
              {" "}
              をご利用ください。
            </p>
          </div>

          <div className="min-h-[480px]">
            {submitted ? (
              <div
                role="status"
                aria-live="polite"
                className="flex h-[480px] flex-col items-center justify-center gap-2 rounded border-2 border-brand p-4 text-center"
              >
                <p className="text-sm font-bold">
                  お問い合わせありがとうございます。確認いたします。
                </p>
              </div>
            ) : (
              <div className="space-y-4" suppressHydrationWarning>
                <div className="space-y-1">
                  <label
                    htmlFor="contact-name"
                    className="text-xs font-bold text-ink/50"
                  >
                    お名前(任意)
                  </label>
                  <input
                    id="contact-name"
                    type="text"
                    value={name}
                    onChange={(event) => setName(event.target.value)}
                    // app/api/contact/route.tsのMAX_NAME_LENGTHと合わせる。
                    maxLength={200}
                    className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="contact-email"
                    className="text-xs font-bold text-ink/50"
                  >
                    メールアドレス
                  </label>
                  <input
                    id="contact-email"
                    type="email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="contact-subject"
                    className="text-xs font-bold text-ink/50"
                  >
                    件名
                  </label>
                  <input
                    id="contact-subject"
                    type="text"
                    value={subject}
                    onChange={(event) => setSubject(event.target.value)}
                    // app/api/contact/route.tsのMAX_SUBJECT_LENGTHと合わせる。
                    maxLength={200}
                    className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="contact-message"
                    className="text-xs font-bold text-ink/50"
                  >
                    本文
                  </label>
                  <textarea
                    id="contact-message"
                    value={message}
                    onChange={(event) => setMessage(event.target.value)}
                    rows={5}
                    // app/api/contact/route.tsのMAX_MESSAGE_LENGTHと合わせる。
                    maxLength={2000}
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
            )}
          </div>
        </div>
      </main>

      <SiteFooter />

      {TURNSTILE_SITE_KEY && (
        <Script
          src="https://challenges.cloudflare.com/turnstile/v0/api.js"
          strategy="afterInteractive"
        />
      )}
    </div>
  );
}
