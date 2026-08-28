"use client";

import { useState } from "react";
import Script from "next/script";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import Spinner from "@/components/brand/Spinner";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import { useRedirectIfLoggedIn } from "@/lib/account/useRedirectIfLoggedIn";
import PasswordInput from "@/components/brand/PasswordInput";
import {
  isValidAccountId,
  MIN_ACCOUNT_ID_LENGTH,
  MAX_ACCOUNT_ID_LENGTH,
} from "@/lib/account/id";
import type { SignupResponse } from "@/app/api/account/signup/schema";

const MIN_PASSWORD_LENGTH = 8;

export default function SignupPage() {
  const canRenderForm = useRedirectIfLoggedIn("/mypage/billing");
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<
    { accountId: string; recoveryCode: string } | null
  >(null);
  const [copyState, setCopyState] = useState<"idle" | "copied">("idle");
  const { widget: turnstileWidget, getToken: getTurnstileToken } =
    useTurnstile();

  const submit = async () => {
    if (isSubmitting || result) {
      return;
    }

    if (!isValidAccountId(accountId)) {
      setError(
        `アカウントIDは${MIN_ACCOUNT_ID_LENGTH}〜${MAX_ACCOUNT_ID_LENGTH}文字の半角英数字・ハイフン・アンダースコアで入力してください。`
      );
      return;
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      setError(`パスワードは${MIN_PASSWORD_LENGTH}文字以上にしてください。`);
      return;
    }

    setError("");
    setIsSubmitting(true);

    try {
      const turnstileToken = await getTurnstileToken();

      const response = await fetch("/api/account/signup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ accountId, password, turnstileToken }),
      });

      const data = (await response.json()) as SignupResponse;

      if (!response.ok || !data.success) {
        throw new Error(
          !data.success ? data.error : "アカウント作成に失敗しました。"
        );
      }

      setResult({ accountId: data.accountId, recoveryCode: data.recoveryCode });
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("Unknown error");

      setError(err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCopy = async () => {
    if (!result) {
      return;
    }

    try {
      await navigator.clipboard.writeText(
        `アカウントID: ${result.accountId}\nリカバリーコード: ${result.recoveryCode}`
      );
      setCopyState("copied");
    } catch {
      // クリップボード失敗時も画面上の文字列は見えているので致命的ではない
    } finally {
      setTimeout(() => setCopyState("idle"), 1500);
    }
  };

  return (
    <div className="flex min-h-screen flex-col">
      <SiteHeader />

      <main className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-8">
          <div className="space-y-1">
            <h1 className="text-2xl font-black leading-snug tracking-normal">
              アカウント作成
            </h1>
            <p className="text-xs text-ink/50">
              アカウントIDとパスワードだけで利用できます。
            </p>
          </div>

          {!canRenderForm ? (
            <div className="flex justify-center py-8">
              <Spinner className="h-6 w-6 text-brand" />
            </div>
          ) : result ? (
            <div className="space-y-4">
              <div className="rounded border-2 border-brand p-4 text-sm">
                <p className="mb-3 font-bold text-brand">
                  この画面だけでしか表示されません。必ず保存してください。
                </p>
                <dl className="space-y-2 text-[13px]">
                  <div>
                    <dt className="font-bold text-ink/50">アカウントID</dt>
                    <dd className="break-all font-mono">{result.accountId}</dd>
                  </div>
                  <div>
                    <dt className="font-bold text-ink/50">リカバリーコード</dt>
                    <dd className="break-all font-mono">
                      {result.recoveryCode}
                    </dd>
                  </div>
                </dl>
                <p className="mt-3 text-xs leading-relaxed text-ink/60">
                  リカバリーコードはパスワードを忘れた際の再設定にのみ使います。紛失すると運営側でも復旧できません。
                </p>
              </div>

              <button
                onClick={handleCopy}
                className="w-full rounded border-2 border-ink/20 px-4 py-2.5 text-sm font-bold transition-colors hover:border-ink/40"
              >
                {copyState === "copied" ? "コピーしました" : "両方コピー"}
              </button>

              <a
                href="/mypage/login"
                className="block w-full rounded bg-brand px-4 py-3.5 text-center text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90"
              >
                ログインへ進む
              </a>
            </div>
          ) : (
            <div className="space-y-4">
              <div className="space-y-1">
                <label
                  htmlFor="signup-account-id"
                  className="text-xs font-bold text-ink/50"
                >
                  アカウントID
                </label>
                <input
                  id="signup-account-id"
                  type="text"
                  value={accountId}
                  onChange={(event) => setAccountId(event.target.value)}
                  placeholder="yamada-taro"
                  autoCapitalize="off"
                  autoCorrect="off"
                  spellCheck={false}
                  className="w-full rounded border-2 border-ink/20 px-3 py-2 font-mono text-base outline-none focus:border-brand sm:text-sm"
                />
                <p className="text-[11px] text-ink/40">
                  半角英数字・ハイフン・アンダースコアで
                  {MIN_ACCOUNT_ID_LENGTH}〜{MAX_ACCOUNT_ID_LENGTH}
                  文字
                </p>
              </div>

              <div className="space-y-1">
                <label
                  htmlFor="signup-password"
                  className="text-xs font-bold text-ink/50"
                >
                  パスワード
                </label>
                <PasswordInput
                  id="signup-password"
                  value={password}
                  onChange={setPassword}
                  placeholder="8文字以上のパスワード"
                  autoComplete="new-password"
                  className="w-full rounded border-2 border-ink/20 py-2 pl-3 pr-10 text-base outline-none focus:border-brand sm:text-sm"
                />
                <p className="text-[11px] text-ink/40">
                  {MIN_PASSWORD_LENGTH}文字以上
                </p>
              </div>

              {turnstileWidget}

              <button
                onClick={submit}
                disabled={isSubmitting}
                className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
              >
                {isSubmitting ? "作成中..." : "アカウントを作成する"}
              </button>

              <p className="min-h-[20px] text-sm font-bold text-brand">
                {error}
              </p>

              <p className="text-center text-xs text-ink/50">
                すでにアカウントをお持ちの場合は{" "}
                <a href="/mypage/login" className="font-bold text-brand hover:underline">
                  ログイン
                </a>
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
