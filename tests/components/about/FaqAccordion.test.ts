// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import FaqAccordion from "@/components/about/FaqAccordion";

(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

describe("FaqAccordion のアクセシビリティ", () => {
  it("複数のFAQでも各パネルを一意の質問ボタンでラベル付けする", async () => {
    const items = [
      { question: "登録は必要ですか？", answer: "登録なしで利用できます。" },
      { question: "保存期間は？", answer: "最大7日間です。" },
    ];
    await act(async () => {
      root.render(
        createElement("div", null,
          createElement(FaqAccordion, { items }),
          createElement(FaqAccordion, { items, marker: "plus" }),
        ),
      );
    });

    const buttons = [...container.querySelectorAll("button")];
    const panels = [...container.querySelectorAll('[role="region"]')];
    expect(buttons).toHaveLength(4);
    expect(panels).toHaveLength(4);
    const ids = [...container.querySelectorAll("[id]")].map((element) => element.id);
    expect(ids).toHaveLength(8);
    expect(new Set(ids).size).toBe(ids.length);

    for (const [index, button] of buttons.entries()) {
      expect(button.id).not.toBe("");
      const panel = document.getElementById(button.getAttribute("aria-controls")!);
      expect(panel).toBe(panels[index]);
      expect(panel?.getAttribute("aria-labelledby")).toBe(button.id);
      expect(document.getElementById(panel!.getAttribute("aria-labelledby")!)).toBe(button);
    }

    await act(async () => buttons[0].click());
    expect(buttons[0].getAttribute("aria-expanded")).toBe("true");
    expect(panels[0].getAttribute("aria-labelledby")).toBe(buttons[0].id);
    expect(buttons[0].getAttribute("aria-controls")).toBe(panels[0].id);
  });
});
