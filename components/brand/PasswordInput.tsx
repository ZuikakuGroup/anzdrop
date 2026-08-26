"use client";

import { useState, type KeyboardEvent } from "react";
import { EyeIcon, EyeOffIcon } from "./ShareIcons";

type PasswordInputProps = {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onKeyDown?: (event: KeyboardEvent<HTMLInputElement>) => void;
  placeholder?: string;
  autoComplete?: string;
  className?: string;
};

// パスワード欄+表示/非表示切り替えボタンをまとめたコンポーネント。
// 表示状態はコンポーネント内に閉じたローカルなUI状態であり、
// 値そのもの(平文パスワード)は呼び出し元のstateのまま変わらない。
export default function PasswordInput({
  id,
  value,
  onChange,
  onKeyDown,
  placeholder,
  autoComplete,
  className = "",
}: PasswordInputProps) {
  const [isVisible, setIsVisible] = useState(false);

  return (
    <div className="relative">
      <input
        id={id}
        type={isVisible ? "text" : "password"}
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={onKeyDown}
        placeholder={placeholder}
        autoComplete={autoComplete}
        className={className}
      />
      <button
        type="button"
        onClick={() => setIsVisible((prev) => !prev)}
        aria-label={isVisible ? "パスワードを隠す" : "パスワードを表示"}
        title={isVisible ? "パスワードを隠す" : "パスワードを表示"}
        className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded text-ink/40 transition-colors hover:bg-ink/[0.06] hover:text-ink"
      >
        {isVisible ? (
          <EyeOffIcon className="h-4 w-4" />
        ) : (
          <EyeIcon className="h-4 w-4" />
        )}
      </button>
    </div>
  );
}
