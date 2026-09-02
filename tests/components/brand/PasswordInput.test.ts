import { describe, it, expect } from "vitest";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import PasswordInput from "@/components/brand/PasswordInput";

function render(
  props: Partial<Parameters<typeof PasswordInput>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(PasswordInput, {
      value: "",
      onChange: () => {},
      ...props,
    })
  );
}

function inputTag(markup: string): string {
  const match = markup.match(/<input\b[^>]*>/);

  if (!match) {
    throw new Error(`input 要素が見つかりません: ${markup}`);
  }

  return match[0];
}

describe("PasswordInput", () => {
  it("既定では入力欄を編集可能なままにする", () => {
    expect(inputTag(render())).not.toContain("disabled");
  });

  it("disabled を渡すと入力欄を編集不可にする", () => {
    // 共有作成後のアップロードフォームは、鍵が最初のパスワードで既にラップ
    // 済みで後から変更できないため、入力欄自体を編集不可にしている
    // (components/upload/uploadForm.tsx)。「変更できません」と案内しながら
    // 入力できてしまう状態に戻らないよう固定する。
    expect(inputTag(render({ disabled: true }))).toContain("disabled");
  });

  it("disabled を入力欄だけに適用し、表示切替ボタンへは波及させない", () => {
    // 入力欄が編集不可でも、設定済みのパスワードを目視確認する導線は残したい。
    // クリックで type が実際に切り替わるところまでは、このリポジトリの
    // テスト環境が node(DOM なし)なので検証できない。ここで固定するのは
    // 「disabled を足したときにボタンまで無効化しない」という配線のみ。
    const markup = render({ disabled: true });
    const button = markup.match(/<button\b[^>]*>/);

    expect(button?.[0]).toBeDefined();
    expect(button?.[0]).not.toContain("disabled");
  });

  it("パスワードを既定で伏字にする", () => {
    expect(inputTag(render({ value: "secret-password" }))).toContain(
      'type="password"'
    );
  });

  it("パスワードの値を伏字以外の属性へ漏らさない", () => {
    // placeholder や aria-label などに値が混ざると、伏字にしている意味がなくなる。
    const markup = render({
      value: "secret-password",
      placeholder: "パスワード",
      describedBy: "hint",
    });
    const tag = inputTag(markup);

    // value 属性以外に平文が現れないこと。
    expect(tag.replace(/value="[^"]*"/, "")).not.toContain("secret-password");
  });

  it("describedBy を aria-describedby として入力欄に紐付ける", () => {
    expect(inputTag(render({ describedBy: "hint-id" }))).toContain(
      'aria-describedby="hint-id"'
    );
  });

  it("describedBy を渡さなければ aria-describedby を出さない", () => {
    expect(inputTag(render())).not.toContain("aria-describedby");
  });
});
