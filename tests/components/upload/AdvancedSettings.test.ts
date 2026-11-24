// @vitest-environment jsdom
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import AdvancedSettings from "@/components/upload/AdvancedSettings";
import { PLAN_DEFAULT_RETENTION, type Plan } from "@/lib/plan";

describe("retention controls", () => {
  it.each([
    ["free", ["1回", "1日", "3日", "7日", "15日", "30日"], "7日"],
    ["standard", ["1回", "1日", "3日", "7日", "15日", "30日", "60日"], "15日"],
    ["premium", ["1回", "1日", "3日", "7日", "15日", "30日", "60日", "100日"], "30日"],
  ] as const)("offers only the allowed periods and preserves the %s default", (plan: Plan, labels, selected) => {
    document.body.innerHTML = renderToStaticMarkup(createElement(AdvancedSettings, {
      plan, retention: PLAN_DEFAULT_RETENTION[plan], onRetentionChange: () => {},
      usePassword: false, onUsePasswordChange: () => {}, password: "", onPasswordChange: () => {}, hasCreatedShare: false,
    }));
    try {
      const buttons = [...document.querySelectorAll("button[aria-pressed]")];
      expect(buttons.map((button) => button.textContent)).toEqual(labels);
      expect(buttons.filter((button) => button.getAttribute("aria-pressed") === "true").map((button) => button.textContent)).toEqual([selected]);
    } finally {
      document.body.innerHTML = "";
    }
  });
});

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


describe("password controls", () => {
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
