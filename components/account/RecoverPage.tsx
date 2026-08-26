"use client";

import { useState } from "react";
import Script from "next/script";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import PasswordInput from "@/components/brand/PasswordInput";
import type { RecoverResponse } from "@/app/api/account/recover/schema";

const MIN_PASSWORD_LENGTH = 8;

export default function RecoverPage() {
  const [accountId, setAccountId] = useState("");
  const [recoveryCode, setRecoveryCode] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [newRecoveryCode, setNewRecoveryCode] = useState<string | null>(null);
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile();

  const submit = async () => {
    if (isSubmitting || newRecoveryCode) {
      return;
    }

    if (!accountId.trim() || !recoveryCode.trim()) {
      setError("アカウントIDとリカバリーコードを入力してください。");
      return;
    }

    if (newPassword.length < MIN_PASSWORD_LENGTH) {
      setError(`新しいパスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`);
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const turnstileToken = await getTurnstileToken();

      const response = await fetch("/api/account/recover", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: accountId.trim(),
          recoveryCode: recoveryCode.trim(),
          newPassword,
          turnstileToken,
        }),
      });

      const data = (await response.json()) as RecoverResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "再設定に失敗しました。");
      }

      setNewRecoveryCode(data.recoveryCode);
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("Unknown error");

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
              パスワードの再設定
            </h1>
            <p className="text-xs text-ink/50">
              メールでの再設定は行っていません。アカウントID・リカバリーコードが必要です。
            </p>
          </div>

          {newRecoveryCode ? (
            <div className="space-y-4">
              <div className="rounded border-2 border-brand p-4 text-sm">
                <p className="mb-3 font-bold text-brand">
                  パスワードを再設定しました。新しいリカバリーコードは今だけ表示されます。
                </p>
                <p className="break-all font-mono text-[13px]">
                  {newRecoveryCode}
                </p>
              </div>
              <a
                href="/login"
                className="block w-full rounded bg-brand px-4 py-3.5 text-center text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90"
              >
                ログインへ進む
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <label
                  htmlFor="recover-account-id"
                  className="text-xs font-bold text-ink/50"
                >
                  アカウントID
                </label>
                <input
                  id="recover-account-id"
                  type="text"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="recover-code"
                  className="text-xs font-bold text-ink/50"
                >
                  リカバリーコード
                </label>
                <input
                  id="recover-code"
                  type="text"
                  value={recoveryCode}
                  onChange={(event) => setRecoveryCode(event.target.value)}
                  className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                />
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="recover-new-password"
                  className="text-xs font-bold text-ink/50"
                >
                  新しいパスワード
                </label>
                <PasswordInput
                  id="recover-new-password"
                  value={newPassword}
                  onChange={setNewPassword}
                  autoComplete="new-password"
                  className="w-full rounded border-2 border-ink/20 py-2 pl-3 pr-10 text-base outline-none focus:border-brand sm:text-sm"
                />
              </div>

              {turnstileWidget}

              <button
                onClick={submit}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
              >
                {isSubmitting ? "再設定中..." : "パスワードを再設定する"}
              </button>

              <p className="min-h-[20px] text-sm font-bold text-brand">
                {error}
              </p>
            </div>
          )}
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
