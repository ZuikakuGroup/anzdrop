export default function OtpInput({ id = "otp-code", disabled = false }: { id?: string; disabled?: boolean }) {
  return (
    <div className="space-y-1">
      <label htmlFor={id} className="text-xs font-bold text-ink/50">認証アプリの6桁コード</label>
      <input id={id} name="code" type="text" inputMode="numeric" autoComplete="one-time-code"
        pattern="[0-9]{6}" minLength={6} maxLength={6} required disabled={disabled}
        className="w-full rounded border-2 border-ink/20 px-3 py-2 font-mono text-base outline-none focus:border-brand" />
    </div>
  );
}
