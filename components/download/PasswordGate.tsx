import PasswordInput from "@/components/brand/PasswordInput";

type PasswordGateProps = {
  passwordInput: string;
  passwordError: string;
  onPasswordChange: (value: string) => void;
  onSubmit: () => void;
};

// パスワード保護された共有の解除フォーム。unlock 処理自体は親が担う。
export default function PasswordGate({
  passwordInput,
  passwordError,
  onPasswordChange,
  onSubmit,
}: PasswordGateProps) {
  return (
    <div className="anz-scroll flex h-40 flex-col justify-center gap-2 overflow-y-auto rounded border-2 border-ink p-6">
      <span className="text-sm font-bold text-ink/50">
        パスワードで保護されています
      </span>
      <PasswordInput
        value={passwordInput}
        onChange={onPasswordChange}
        onKeyDown={(event) => {
          if (event.key === "Enter") {
            onSubmit();
          }
        }}
        placeholder="パスワード"
        autoComplete="current-password"
        className="w-full rounded border-2 border-ink/20 py-3.5 pl-4 pr-10 text-base outline-none focus:border-brand sm:text-sm"
      />
      <p className="min-h-[17px] text-sm font-bold text-brand">
        {passwordError}
      </p>
    </div>
  );
}
