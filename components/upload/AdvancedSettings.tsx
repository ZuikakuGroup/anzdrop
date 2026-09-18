"use client";

import PasswordInput from "@/components/brand/PasswordInput";
import { isRetentionAllowedForPlan, type Plan } from "@/lib/plan";
import type { Retention } from "@/lib/retention";

const RETENTION_OPTIONS: { value: Retention; label: string }[] = [
  { value: "once", label: "1回" },
  { value: "1d", label: "1日" },
  { value: "3d", label: "3日" },
  { value: "7d", label: "7日" },
  { value: "15d", label: "15日" },
  { value: "30d", label: "30日" },
];

type AdvancedSettingsProps = {
  plan: Plan;
  retention: Retention;
  onRetentionChange: (retention: Retention) => void;
  usePassword: boolean;
  onUsePasswordChange: (usePassword: boolean) => void;
  password: string;
  onPasswordChange: (password: string) => void;
  hasCreatedShare: boolean;
};

// 初期表示では見えない詳細設定を分離し、開く操作が行われた時だけ読み込む。
export default function AdvancedSettings({
  plan,
  retention,
  onRetentionChange,
  usePassword,
  onUsePasswordChange,
  password,
  onPasswordChange,
  hasCreatedShare,
}: AdvancedSettingsProps) {
  return (
    <div className="mt-3 space-y-3">
      <div>
        <span className="text-xs font-bold text-ink/50">保存期間</span>
        <div className="mt-1.5 flex gap-2">
          {RETENTION_OPTIONS.filter((option) =>
            isRetentionAllowedForPlan(option.value, plan)
          ).map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onRetentionChange(option.value)}
              className={`flex-1 rounded border-2 py-2 text-xs font-bold transition-colors ${
                retention === option.value
                  ? "border-brand bg-brand text-paper"
                  : "border-ink/20 text-ink/60 hover:border-ink/40"
              }`}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      <div>
        <label className="flex items-center gap-2 text-xs font-bold text-ink/50">
          <input
            type="checkbox"
            checked={usePassword}
            disabled={hasCreatedShare}
            onChange={(event) => onUsePasswordChange(event.target.checked)}
            className="h-4 w-4 accent-brand"
          />
          パスワードを設定する
        </label>
        {hasCreatedShare && (
          <p className="mt-1.5 text-xs text-ink/50">
            共有作成後はパスワード設定を変更できません。
          </p>
        )}
        <div
          className={`grid transition-[grid-template-rows] duration-300 ease-out motion-reduce:transition-none ${
            usePassword ? "grid-rows-[1fr]" : "grid-rows-[0fr]"
          }`}
        >
          <div className="overflow-hidden" inert={!usePassword}>
            <div className="mt-1.5">
              <PasswordInput
                value={password}
                onChange={onPasswordChange}
                placeholder="パスワード"
                autoComplete="new-password"
                disabled={hasCreatedShare}
                className="w-full rounded border-2 border-ink/20 py-2 pl-3 pr-10 text-base outline-none focus:border-brand disabled:opacity-50 sm:text-sm"
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
