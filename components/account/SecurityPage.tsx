"use client";

import { useCallback, useEffect, useRef, useState, useSyncExternalStore, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { startAuthentication, startRegistration, type PublicKeyCredentialCreationOptionsJSON, type PublicKeyCredentialRequestOptionsJSON } from "@simplewebauthn/browser";
import QRCode from "qrcode";
import CenteredFormShell from "@/components/brand/CenteredFormShell";
import PasswordInput from "@/components/brand/PasswordInput";
import Spinner from "@/components/brand/Spinner";
import { useTurnstile } from "@/lib/turnstile-client";
import { accountAuthRequest, isPasskeyCancellation, passkeysSupported } from "@/lib/account/securityClient";
import type { SecurityAction, SecurityStatus, SecurityResponse } from "@/lib/account/securityTypes";
import OtpInput from "./OtpInput";

const subscribe = () => () => {};
const buttonStyle = "rounded border-2 border-ink/20 px-4 py-2 text-sm font-bold disabled:opacity-30";
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
  const [password, setPassword] = useState("");
  const canvas = useRef<HTMLCanvasElement>(null);
  const canUsePasskey = useSyncExternalStore(subscribe, passkeysSupported, () => false);
  const { widget, getToken } = useTurnstile();

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

  const choose = (action: PendingAction) => {
    setError("");
    setPassword("");
    setPending(action);
  };

  const cancel = async () => {
    setSetup(null);
    setPending(null);
    setPassword("");
    setError("");
    setBusy(true);
    try { await accountAuthRequest("/api/account/security/cancel", {}); }
    catch { setError("設定の中止を確認できませんでした。ページを再読み込みしてください。"); }
    finally { setBusy(false); }
  };

  return <CenteredFormShell title="ログイン・セキュリティ" description="パスキーと認証アプリの設定は任意です。">
    <a href="/mypage" className="text-xs text-brand hover:underline">← マイページ</a>
    {done ? <div className="space-y-3">
      <p role="status">設定を変更し、すべての端末をログアウトしました。再度ログインしてください。</p>
      <a href="/mypage/login" className="font-bold text-brand hover:underline">ログインへ進む</a>
    </div> : !status ? <div>
      {error ? <button onClick={() => void load()} className={buttonStyle}>再読み込み</button> : <Spinner className="h-6 w-6 text-brand" />}
    </div> : <div className="space-y-6">
      <p className="break-all font-mono text-sm">{status.accountId}</p>
      {setup ? <form onSubmit={confirmOtp} className="space-y-4">
        <h2 className="font-bold">認証アプリに登録</h2>
        <p className="text-sm">QRコードを読み取るか、秘密を手入力してください。コードを確認するまでOTPは有効になりません。設定は10分で期限切れになります。</p>
        <canvas ref={canvas} role="img" aria-label="認証アプリ登録用QRコード" />
        <p className="text-xs text-ink/60">手入力用の秘密（他の人に共有しないでください）</p>
        <p className="break-all font-mono text-sm">{setup.secret}</p>
        <OtpInput disabled={busy} />
        <button disabled={busy} className={buttonStyle}>OTPを有効にする</button>
        <button type="button" disabled={busy} onClick={() => void cancel()} className="ml-3 text-sm text-brand">設定を中止</button>
      </form> : pending ? <div className="space-y-4">
        <h2 className="font-bold">設定変更の本人確認</h2>
        <p className="text-sm">変更を完了すると、すべての端末からログアウトします。</p>
        {pending.action === "totp-disable" && <p className="text-sm">OTPを解除すると、パスワードだけでログインできるようになります。</p>}
        {pending.action === "passkey-delete" && <p className="text-sm">選択したパスキーを削除します。</p>}
        <form onSubmit={reauthenticate} className="space-y-4">
          <label htmlFor="security-password" className="text-xs font-bold">現在のパスワード</label>
          <PasswordInput id="security-password" name="password" value={password} onChange={setPassword} autoComplete="current-password" disabled={busy} className="w-full rounded border-2 border-ink/20 py-2 pl-3 pr-10" />
          {status.totpEnabled && <><OtpInput id="security-otp" disabled={busy} /><p className="text-xs text-ink/60">ログイン直後は、認証アプリのコードが次に変わってから入力してください。</p></>}
          <button disabled={busy} className={buttonStyle}>本人確認して続ける</button>
        </form>
        {canUsePasskey && status.passkeys.length > 0 && <button disabled={busy} onClick={reauthenticateWithPasskey} className={buttonStyle}>パスキーで本人確認</button>}
        <button disabled={busy} onClick={() => void cancel()} className="block text-sm text-brand">キャンセル</button>
      </div> : <>
        <section className="space-y-3">
          <h2 className="font-bold">パスキー</h2>
          <p className="text-xs text-ink/60">パスワードの代わりに、指紋・顔認証・端末のPINでログインできます。登録後もパスワードでログインできます。</p>
          {status.passkeys.length === 0 ? <p className="text-sm">未登録</p> : <ul className="space-y-3">{status.passkeys.map((key) => <li key={key.id} className="rounded border border-ink/15 p-3">
            <p className="break-all text-sm font-bold">{key.name}</p>
            <p className="text-xs text-ink/60">登録日: {new Date(key.createdAt).toLocaleDateString("ja-JP")}</p>
            <button disabled={busy} onClick={() => choose({ action: "passkey-delete", targetId: key.id })} className="mt-2 text-xs text-brand">削除</button>
          </li>)}</ul>}
          {canUsePasskey ? <form onSubmit={(event) => {
            event.preventDefault();
            const name = String(new FormData(event.currentTarget).get("name") ?? "").trim();
            if (name) choose({ action: "passkey-add", name });
          }} className="space-y-2">
            <label htmlFor="passkey-name" className="text-xs font-bold">パスキーの表示名</label>
            <input id="passkey-name" name="name" required maxLength={64} placeholder="自分のスマートフォン" className="w-full rounded border-2 border-ink/20 px-3 py-2 text-sm" />
            <button disabled={busy || status.passkeys.length >= 10} className={buttonStyle}>パスキーを追加</button>
            {status.passkeys.length >= 10 && <p className="text-xs">登録できるパスキーは10件までです。</p>}
          </form> : <p className="text-xs text-ink/60">このブラウザではパスキーを利用できません。パスワードでのログインは引き続き利用できます。</p>}
        </section>
        <section className="space-y-3 border-t border-ink/10 pt-4">
          <h2 className="font-bold">認証アプリのOTP</h2>
          <p className="text-sm">{status.totpEnabled ? "有効" : "未設定"}</p>
          <p className="text-xs text-ink/60">有効化すると、パスワードログインに認証コードが必要になります。パスキーではコードなしでログインできます。</p>
          <button disabled={busy} onClick={() => choose({ action: status.totpEnabled ? "totp-disable" : "totp-enable" })} className={buttonStyle}>{status.totpEnabled ? "OTPを解除" : "OTPを設定"}</button>
        </section>
        <p className="text-xs leading-relaxed text-ink/60">端末を紛失した場合は、リカバリーコードでパスワードを再設定し、パスキー・OTPもすべて解除できます。リカバリーコードは安全な場所に保管してください。紛失すると運営でも復旧できません。</p>
      </>}
    </div>}
    {widget}
    <p role="alert" className="text-sm font-bold text-brand">{error}</p>
  </CenteredFormShell>;
}
