"use client";

import { useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import CenteredFormShell from "@/components/brand/CenteredFormShell";
import Spinner from "@/components/brand/Spinner";
import { useTurnstile } from "@/lib/turnstile-client";
import { useRedirectIfLoggedIn } from "@/lib/account/useRedirectIfLoggedIn";
import PasswordInput from "@/components/brand/PasswordInput";
import type { LoginResponse } from "@/app/api/account/login/schema";
import OtpInput from "./OtpInput";
import { accountAuthRequest, isPasskeyCancellation, loginWithPasskey, passkeysSupported } from "@/lib/account/securityClient";

const subscribe = () => () => {};

export default function LoginPage() {
  const router = useRouter();
  const canRenderForm = useRedirectIfLoggedIn("/mypage");
  const [accountId, setAccountId] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [needsOtp, setNeedsOtp] = useState(false);
  const canUsePasskey = useSyncExternalStore(subscribe, passkeysSupported, () => false);
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
    if (needsOtp) {
      setIsSubmitting(true);
      setError("");
      try {
        await accountAuthRequest("/api/account/login/otp", { code: String(formData.get("code") ?? "") });
        router.replace("/mypage");
      } catch (error) {
        setError(error instanceof Error ? error.message : "認証に失敗しました。");
        setIsSubmitting(false);
      }
      return;
    }
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

      setPassword("");
      if (data.next === "otp") {
        setNeedsOtp(true);
        setIsSubmitting(false);
      } else {
        router.replace("/mypage");
      }
    } catch (unknownErr) {
      const err =
        unknownErr instanceof Error ? unknownErr : new Error("不明なエラー");

      setError(err.message);
      setIsSubmitting(false);
    }
  };

  const passkeyLogin = async () => {
    if (isSubmitting) return;
    setIsSubmitting(true);
    setError("");
    try {
      await loginWithPasskey(await getTurnstileToken());
      router.replace("/mypage");
    } catch (error) {
      if (!isPasskeyCancellation(error)) setError(error instanceof Error ? error.message : "認証に失敗しました。");
      setIsSubmitting(false);
    }
  };

  return (
    <CenteredFormShell
      title="ログイン"
      description="アカウントIDとパスワードでログインします。"
    >
      <div className="min-h-[220px]">
        {!canRenderForm ? (
          <div className="flex justify-center py-8">
            <Spinner className="h-6 w-6 text-brand" />
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4">
            {needsOtp ? <>
              <p className="text-sm text-ink/70">パスワードを確認しました。認証アプリのコードを入力してください。</p>
              <OtpInput disabled={isSubmitting} />
              <button type="button" disabled={isSubmitting} onClick={() => { setNeedsOtp(false); setError(""); }} className="text-xs text-brand hover:underline">パスワード入力に戻る</button>
            </> : <>
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

            </>}

            {turnstileWidget}

            <button
              type="submit"
              disabled={isSubmitting}
              className="flex w-full items-center justify-center gap-2 rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30"
            >
              {isSubmitting && <Spinner className="h-4 w-4 text-paper" />}
              {isSubmitting ? "ログイン中..." : "ログインする"}
            </button>

            {canUsePasskey ? <button type="button" onClick={passkeyLogin} disabled={isSubmitting}
              className="w-full rounded border-2 border-ink/20 px-4 py-3 text-sm font-bold disabled:opacity-30">パスキーでログイン</button>
              : <p className="text-xs text-ink/50">このブラウザではパスキーを利用できません。パスワードでログインしてください。</p>}

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
    </CenteredFormShell>
  );
}
