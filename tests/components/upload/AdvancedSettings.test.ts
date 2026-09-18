import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdvancedSettings from "@/components/upload/AdvancedSettings";

function render(
  props: Partial<Parameters<typeof AdvancedSettings>[0]> = {}
): string {
  return renderToStaticMarkup(
    createElement(AdvancedSettings, {
      plan: "free",
      retention: "7d",
      onRetentionChange: () => {},
      usePassword: false,
      onUsePasswordChange: () => {},
      password: "",
      onPasswordChange: () => {},
      hasCreatedShare: false,
      ...props,
    })
  );
}

describe("AdvancedSettings", () => {
  it("freeプランでは選択できない保存期間を表示しない", () => {
    const markup = render();

    expect(markup).toContain(">7日</button>");
    expect(markup).not.toContain(">15日</button>");
    expect(markup).not.toContain(">30日</button>");
  });

  it("パスワードを有効にしたときだけ入力欄を操作可能にする", () => {
    const disabledMarkup = render();
    const enabledMarkup = render({ usePassword: true });

    expect(disabledMarkup).toContain('inert=""');
    expect(enabledMarkup).not.toContain('inert=""');
    expect(enabledMarkup).not.toContain("share-password-hint");
    expect(enabledMarkup).not.toContain("推測されにくいパスワード");
  });

  it("共有作成後はパスワード設定を変更できないことを示す", () => {
    const markup = render({ hasCreatedShare: true, usePassword: true });

    expect(markup).toContain("共有作成後はパスワード設定を変更できません。");
    expect(markup).toMatch(/<input[^>]*type="checkbox"[^>]*disabled=""/);
    expect(markup).not.toContain("share-password-hint");
  });
});
