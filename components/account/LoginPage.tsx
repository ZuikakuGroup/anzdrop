"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Script from "next/script";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import { useRedirectIfLoggedIn } from "@/lib/account/useRedirectIfLoggedIn";
import PasswordInput from "@/components/brand/PasswordInput";
import type { LoginResponse } from "@/app/api/account/login/schema";

export default function LoginPage() {
  const router = useRouter();
  const canRenderForm = useRedirectIfLoggedIn("/mypage");
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile();

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (isSubmitting) {
      return;
    }

    // 資格情報マネージャーによる自動入力は DOM の値だけを書き換えて change
    // イベントを発火しないことがある。その場合 controlled state が空のままに
    // なるため、送信時は form の DOM 値(FormData)を正とし、state も同期する。
    const formData = new FormData(event.currentTarget);
    const submittedAccountId = String(formData.get("accountId") ?? "");
    const submittedPassword = String(formData.get("password") ?? "");
    setAccountId(submittedAccountId);
    setPassword(submittedPassword);

    const trimmedAccountId = submittedAccountId.trim();

    if (!trimmedAccountId || !submittedPassword) {
      setError("アカウントIDとパスワードを入力してください。");
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const turnstileToken = await getTurnstileToken();

      const response = await fetch("/api/account/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          accountId: trimmedAccountId,
          password: submittedPassword,
          turnstileToken,
        }),
      });

      const data = (await response.json()) as LoginResponse;

      if (!response.ok || !data.success) {
        throw new Error(!data.success ? data.error : "ログインに失敗しました。");
      }

      router.replace("/mypage");
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
      setIsSubmitting(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              ログイン
            </h1>
            <p className="text-xs text-ink/50">
              アカウントIDとパスワードでログインします。
            </p>
          </div>

          <div className="min-h-[220px]">
            {!canRenderForm ? (
              <div className="flex justify-center py-8">
                <Spinner className="h-6 w-6 text-brand" />
              </div>
            ) : (
              <form onSubmit={submit} className="space-y-4">
                <div className="space-y-1">
                  <label
                    htmlFor="login-account-id"
                    className="text-xs font-bold text-ink/50"
                  >
                    アカウントID
                  </label>
                  <input
                    id="login-account-id"
                    name="accountId"
                    type="text"
                    value={accountId}
                    onChange={(event) => setAccountId(event.target.value)}
                    placeholder="yamada-taro"
                    autoComplete="username"
                    autoCapitalize="off"
                    autoCorrect="off"
                    spellCheck={false}
                    className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand sm:text-sm"
                  />
                </div>

                <div className="space-y-1">
                  <label
                    htmlFor="login-password"
                    className="text-xs font-bold text-ink/50"
                  >
                    パスワード
                  </label>
                  <PasswordInput
                    id="login-password"
                    name="password"
                    value={password}
                    onChange={setPassword}
                    placeholder="パスワード"
                    autoComplete="current-password"
                    className="w-full rounded border-2 border-ink/20 py-2 pl-3 pr-10 text-base outline-none focus:border-brand sm:text-sm"
                  />
                </div>

                {turnstileWidget}

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
                >
                  {isSubmitting && <Spinner className="h-4 w-4 text-paper" />}
                  {isSubmitting ? "ログイン中..." : "ログインする"}
                </button>

                <p
                  role="alert"
                  className="min-h-[20px] text-sm font-bold text-brand"
                >
                  {error}
                </p>

                <div className="flex justify-between text-xs text-ink/50">
                  <a
                    href="/mypage/signup"
                    className="font-bold text-brand hover:underline"
                  >
                    アカウント作成
                  </a>
                  <a
                    href="/mypage/recover"
                    className="font-bold text-brand hover:underline"
                  >
                    パスワードを忘れた
                  </a>
                </div>
              </form>
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
