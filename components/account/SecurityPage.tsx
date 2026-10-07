"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "@/lib/browserNavigation";
import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import QRCode from "qrcode";
import Script from "@/components/brand/ExternalScript";
import SiteHeader from "@/components/brand/SiteHeader";
import SiteFooter from "@/components/brand/SiteFooter";
import SecurityDialog from "./SecurityDialog";
import PasswordInput from "@/components/brand/PasswordInput";
import Spinner from "@/components/brand/Spinner";
import { TURNSTILE_SITE_KEY, useTurnstile } from "@/lib/turnstile-client";
import { accountAuthRequest, isPasskeyCancellation, passkeysSupported } from "@/lib/account/securityClient";
import type { SecurityAction, SecurityStatus, SecurityResponse } from "@/lib/account/securityTypes";
import OtpInput from "./OtpInput";

const subscribe = () => () => {};
const buttonStyle = "rounded border-2 border-ink/20 px-4 py-3 text-sm font-black tracking-wider text-ink/70 transition-colors hover:border-ink/40 disabled:opacity-30";
const primaryStyle = "rounded bg-brand px-4 py-3.5 text-sm font-black tracking-wider text-paper transition-colors hover:bg-brand/90 disabled:opacity-30";
const cancelStyle = "rounded px-4 py-3 text-sm font-bold text-ink/50 transition-colors hover:bg-ink/[0.03] hover:text-ink disabled:opacity-30";
type PendingAction = { action: SecurityAction; targetId?: string; name?: string };

async function fetchSecurityStatus(): Promise<SecurityStatus | null> {
  const response = await fetch("/api/account/security", { cache: "no-store" });
  if (response.status === 401) return null;
  const data = await response.json() as SecurityResponse;
  if (!response.ok || !data.success) throw new Error("設定を読み込めませんでした。");
  return data;
}

export default function SecurityPage() {
  const router = useRouter();
  const [status, setStatus] = useState<SecurityStatus | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [pending, setPending] = useState<PendingAction | null>(null);
  const [setup, setSetup] = useState<{ secret: string; uri: string } | null>(null);
  const [done, setDone] = useState(false);
  const [enterName, setEnterName] = useState(false);
  const [passwordMethod, setPasswordMethod] = useState(false);
  const dialogRef = useRef<HTMLDialogElement>(null);
  const restoreFocusRef = useRef<HTMLButtonElement>(null);
  const [password, setPassword] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const canUsePasskey = useSyncExternalStore(subscribe, passkeysSupported, () => false);
  const { widget, getToken } = useTurnstile(true, dialogRef);

  const load = useCallback(() => {
    fetchSecurityStatus().then((data) => {
      if (data === null) { router.replace("/mypage/login"); return; }
      setError("");
      setStatus(data);
    }).catch((error: unknown) => {
      setError(error instanceof Error ? error.message : "設定を読み込めませんでした。");
    });
  }, [router]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (setup && canvas.current) {
      QRCode.toCanvas(canvas.current, setup.uri, { width: 220, margin: 2 })
        .catch(() => setError("QRコードを表示できませんでした。手入力用の秘密を使ってください。"));
    }
  }, [setup]);

  const complete = () => {
    setPassword("");
    setSetup(null);
    setPending(null);
    setDone(true);
  };

  const executeAction = async (operation: PendingAction) => {
    if (operation.action === "passkey-add") {
      const { options } = await accountAuthRequest<{ options: PublicKeyCredentialCreationOptionsJSON }>("/api/account/security/passkeys/options", { name: operation.name });
      const response = await startRegistration({ optionsJSON: options });
      await accountAuthRequest("/api/account/security/passkeys/verify", { response });
      complete();
    } else if (operation.action === "passkey-delete") {
      await accountAuthRequest("/api/account/security/passkeys/delete", { id: operation.targetId });
      complete();
    } else if (operation.action === "totp-enable") {
      const data = await accountAuthRequest<{ secret: string; uri: string }>("/api/account/security/totp/setup", {});
      setSetup({ secret: data.secret, uri: data.uri });
      setPending(null);
    } else {
      await accountAuthRequest("/api/account/security/totp/disable", {});
      complete();
    }
  };

  const reauthenticate = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!pending || busy) return;
    const form = new FormData(event.currentTarget);
    setBusy(true);
    setError("");
    try {
      await accountAuthRequest("/api/account/security/reauth/password", {
        action: pending.action, targetId: pending.targetId,
        password: String(form.get("password") ?? ""), code: form.get("code") ?? undefined,
        turnstileToken: await getToken(),
      });
      setPassword("");
      await executeAction(pending);
    } catch (error) {
      if (!isPasskeyCancellation(error)) setError(error instanceof Error ? error.message : "設定変更に失敗しました。");
    } finally { setBusy(false); }
  };

  const reauthenticateWithPasskey = async () => {
    if (!pending || busy) return;
    setBusy(true);
    setError("");
    try {
      const { options } = await accountAuthRequest<{ options: PublicKeyCredentialRequestOptionsJSON }>("/api/account/security/reauth/options", { action: pending.action, targetId: pending.targetId });
      const response = await startAuthentication({ optionsJSON: options });
      await accountAuthRequest("/api/account/security/reauth/verify", { response });
      await executeAction(pending);
    } catch (error) {
      if (!isPasskeyCancellation(error)) setError(error instanceof Error ? error.message : "設定変更に失敗しました。");
    } finally { setBusy(false); }
  };

  const confirmOtp = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (busy) return;
    const code = String(new FormData(event.currentTarget).get("code") ?? "");
    setBusy(true);
    setError("");
    try {
      await accountAuthRequest("/api/account/security/totp/confirm", { code });
      complete();
    } catch (error) { setError(error instanceof Error ? error.message : "コードを確認できませんでした。"); }
    finally { setBusy(false); }
  };

  const choose = (action: PendingAction, trigger?: HTMLButtonElement) => {
    if (trigger) restoreFocusRef.current = trigger;
    setError("");
    setPassword("");
    setPasswordMethod(false);
    setPending(action);
  };

  const cancel = async () => {
    setEnterName(false);
    setSetup(null);
    setPending(null);
    setPassword("");
    setError("");
    setBusy(true);
    try { await accountAuthRequest("/api/account/security/cancel", {}); }
    catch { setError("設定の中止を確認できませんでした。ページを再読み込みしてください。"); }
    finally { setBusy(false); }
  };

  const dialogOpen = enterName || pending !== null || setup !== null || done;
  useEffect(() => {
    if (!dialogOpen && !busy) restoreFocusRef.current?.focus();
  }, [dialogOpen, busy]);

  const actionTitle = pending?.action === "passkey-delete" ? "パスキーを削除"
    : pending?.action === "totp-disable" ? "OTPを解除"
    : pending?.action === "totp-enable" || setup ? "認証アプリを設定" : "パスキーを追加";
  const hasPasskey = canUsePasskey && (status?.passkeys.length ?? 0) > 0;
  const showPassword = !hasPasskey || passwordMethod;
  const closeDialog = () => { if (done) router.replace("/mypage/login"); else void cancel(); };

  return <div className="flex min-h-screen flex-col">
    <SiteHeader />
    <main className="flex min-h-[calc(100svh-4rem)] flex-1 items-center justify-center p-4">
      <div className="w-full max-w-md space-y-6 rounded-lg border border-ink/10 bg-paper p-6 sm:p-8">
      <div className="space-y-1">
        <a href="/mypage" className="text-sm text-ink/60 hover:text-ink">← マイページ</a>
        <h1 className="text-2xl font-black leading-snug tracking-normal">ログイン・セキュリティ</h1>
        <p className="text-xs text-ink/50">パスキーと認証アプリは、必要に応じて設定できます。</p>
        {status && <p className="break-all text-sm text-ink/60">アカウントID: <span className="font-mono text-ink">{status.accountId}</span></p>}
      </div>
      {!status ? <div className="rounded border border-ink/10 p-4">
        {error ? <><p role="alert" className="mb-4 text-sm text-brand">{error}</p><button onClick={load} className={buttonStyle}>再読み込み</button></> : <Spinner className="h-6 w-6 text-brand" />}
      </div> : <>
        <section className="rounded border border-ink/15 bg-ink/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold">パスキー</h2>
            <span className="text-xs font-bold text-ink/50">{status.passkeys.length ? `登録済み ${status.passkeys.length}件` : "未登録"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink/65">指紋・顔認証・端末のPINでログインできます。</p>
          {status.passkeys.length > 0 && <ul className="mt-5 divide-y divide-ink/10 border-y border-ink/10">{status.passkeys.map((key) => <li key={key.id} className="flex items-center justify-between gap-4 py-4">
            <div className="min-w-0"><p className="break-all text-sm font-bold">{key.name}</p><p className="mt-1 text-xs text-ink/60">登録日: {new Date(key.createdAt).toLocaleDateString("ja-JP")}</p></div>
            <button disabled={busy || done} onClick={(event) => choose({ action: "passkey-delete", targetId: key.id }, event.currentTarget)} className="shrink-0 rounded px-3 py-2 text-sm text-ink/60 hover:bg-ink/5 hover:text-brand">削除</button>
          </li>)}</ul>}
          {canUsePasskey ? <div className="mt-5">
            <button disabled={busy || done || status.passkeys.length >= 10} onClick={(event) => { restoreFocusRef.current = event.currentTarget; setError(""); setEnterName(true); }} className={`${buttonStyle} w-full`}>パスキーを追加</button>
            {status.passkeys.length >= 10 && <p className="mt-2 text-sm text-ink/60">登録できるパスキーは10件までです。</p>}
          </div> : <p className="mt-4 text-sm text-ink/60">このブラウザではパスキーを利用できません。パスワードでのログインは引き続き利用できます。</p>}
        </section>
        <section className="rounded border border-ink/15 bg-ink/[0.02] p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <h2 className="text-sm font-bold">認証アプリのOTP</h2>
            <span className={`text-xs font-bold ${status.totpEnabled ? "text-brand" : "text-ink/50"}`}>{status.totpEnabled ? "有効" : "未設定"}</span>
          </div>
          <p className="mt-2 text-sm leading-relaxed text-ink/65">有効化すると、パスワードログインに認証コードが必要になります。パスキーではコードなしでログインできます。</p>
          <button disabled={busy || done} onClick={(event) => choose({ action: status.totpEnabled ? "totp-disable" : "totp-enable" }, event.currentTarget)} className={`mt-4 w-full ${buttonStyle}`}>{status.totpEnabled ? "OTPを解除" : "OTPを設定"}</button>
        </section>
        <div className="pt-2 text-right">
          <a href="/mypage/recover" className="text-xs font-bold text-brand hover:underline">パスワードを忘れた場合</a>
        </div>
        {error && !dialogOpen && <p role="alert" className="text-sm text-brand">{error}</p>}
      </>}
      </div>
    </main>
    <SiteFooter />
    <SecurityDialog open={dialogOpen} busy={busy} title={done ? "設定を変更しました" : actionTitle} dialogRef={dialogRef} restoreFocusRef={restoreFocusRef} onClose={closeDialog}>
      {done ? <div className="space-y-5">
        <p role="status" className="text-sm leading-relaxed">設定を変更し、すべての端末をログアウトしました。再度ログインしてください。</p>
        <a href="/mypage/login" className={`${primaryStyle} block text-center`}>ログインへ進む</a>
      </div> : enterName ? <form onSubmit={(event) => {
        event.preventDefault();
        const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
        if (!name) return;
        setEnterName(false);
        choose({ action: "passkey-add", name });
      }} className="space-y-5">
        <p className="text-sm leading-relaxed text-ink/60">あとで見分けられる名前を付けてください。</p>
        <div className="space-y-2 pt-2"><label htmlFor="passkey-name" className="text-xs font-bold text-ink/50">パスキーの表示名</label>
          <input id="passkey-name" name="name" required maxLength={64} placeholder="自分のスマートフォン" className="w-full rounded border-2 border-ink/20 px-3 py-2 text-base outline-none focus:border-brand" /></div>
        <div className="grid grid-cols-2 gap-3 pt-3"><button type="button" onClick={() => void cancel()} className={cancelStyle}>キャンセル</button><button className={primaryStyle}>次へ</button></div>
      </form> : setup ? <form onSubmit={confirmOtp} className="space-y-5">
        <p className="border-l-2 border-brand pl-3 text-xs font-bold text-ink/50">2 / 2　認証アプリに登録</p>
        <p className="text-sm leading-relaxed text-ink/70">認証アプリでQRコードを読み取り、表示された6桁コードを入力してください。確認するまでOTPは有効になりません。</p>
        <canvas ref={canvas} role="img" aria-label="認証アプリ登録用QRコード" className="mx-auto max-w-full" />
        <details className="rounded border border-ink/15 bg-ink/[0.02] p-3"><summary className="cursor-pointer text-sm font-bold">QRコードを読み取れない場合</summary><p className="mt-3 text-xs text-ink/60">手入力用の秘密（他の人に共有しないでください）</p><p className="mt-2 break-all font-mono text-sm">{setup.secret}</p></details>
        <OtpInput disabled={busy} />
        <p className="text-xs text-ink/60">設定は10分で期限切れになります。</p>
        <div className="grid grid-cols-1 gap-2 pt-3 sm:grid-cols-2"><button type="button" disabled={busy} onClick={() => void cancel()} className={cancelStyle}>設定を中止</button><button disabled={busy} className={primaryStyle}>{busy ? "確認中…" : "OTPを有効にする"}</button></div>
      </form> : pending ? <div className="space-y-5">
        <p className="border-l-2 border-brand pl-3 text-xs font-bold text-ink/50">{pending.action === "passkey-add" ? "2 / 3" : pending.action === "totp-enable" ? "1 / 2" : "最終確認"}　本人確認</p>
        {pending.action === "passkey-add" && <p className="break-all text-sm">登録するパスキー: <strong>{pending.name}</strong></p>}
        {pending.action === "passkey-delete" && <p className="break-all text-sm">削除するパスキー: <strong>{status?.passkeys.find((key) => key.id === pending.targetId)?.name}</strong></p>}
        {pending.action === "totp-disable" && <p className="text-sm leading-relaxed">OTPを解除すると、パスワードだけでログインできるようになります。</p>}
        <p className="rounded border border-ink/15 bg-ink/[0.02] p-3 text-sm leading-relaxed text-ink/75">変更が完了すると、すべての端末からログアウトします。</p>
        {hasPasskey && <button disabled={busy} onClick={reauthenticateWithPasskey} className={`${primaryStyle} w-full`}>{busy ? "確認中…" : "パスキーで本人確認"}</button>}
        {hasPasskey && !passwordMethod && <button disabled={busy} onClick={() => setPasswordMethod(true)} className="w-full text-sm text-ink/65 underline underline-offset-4">パスワードで確認する</button>}
        {showPassword && <form onSubmit={reauthenticate} className="space-y-4">
          <div className="space-y-2"><label htmlFor="security-password" className="text-xs font-bold text-ink/50">現在のパスワード</label>
            <PasswordInput id="security-password" name="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} className="w-full rounded border-2 border-ink/20 py-2 pl-3 pr-10 text-base outline-none focus:border-brand" /></div>
          {status?.totpEnabled && <><OtpInput id="security-otp" disabled={busy} /><p className="text-xs text-ink/60">ログイン直後は、認証アプリのコードが次に変わってから入力してください。</p></>}
          <button disabled={busy} className={`${hasPasskey ? buttonStyle : primaryStyle} w-full`}>{busy ? "確認中…" : "本人確認して続ける"}</button>
        </form>}
        <button disabled={busy} onClick={() => void cancel()} className={`${cancelStyle} w-full`}>キャンセル</button>
      </div> : null}
      {error && dialogOpen && <p role="alert" className="text-sm text-brand">{error}</p>}
      {widget}
    </SecurityDialog>
    {TURNSTILE_SITE_KEY && <Script src="https://challenges.cloudflare.com/turnstile/v0/api.js" strategy="afterInteractive" />}
  </div>;
}
