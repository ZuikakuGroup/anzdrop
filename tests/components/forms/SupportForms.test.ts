// @vitest-environment jsdom
import { act, createElement } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import ContactForm from "@/components/contact/ContactForm";
import ReportForm from "@/components/report/ReportForm";
import RightsHolderReportForm from "@/components/report/RightsHolderReportForm";

vi.mock("@/components/brand/SiteHeader", () => ({ default: () => null }));
const { getToken } = vi.hoisted(() => ({ getToken: vi.fn() }));
vi.mock("@/lib/turnstile-client", () => ({ TURNSTILE_SITE_KEY: "test-site-key", useTurnstile: () => ({ getToken, widget: null }) }));
(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const fetchMock = vi.fn();
beforeEach(() => {
  container = document.createElement("div"); document.body.appendChild(container); root = createRoot(container);
  getToken.mockReset().mockResolvedValue("turnstile-token");
  fetchMock.mockReset().mockResolvedValue(Response.json({ success: true }));
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.unstubAllGlobals(); });

async function input(selector: string, value: string) {
  const element = container.querySelector(selector) as HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement;
  const proto = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : element instanceof HTMLSelectElement ? HTMLSelectElement.prototype : HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(proto, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event(element instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
  });
}
async function submit() {
  await act(async () => {
    const form = container.querySelector("form");
    if (form) form.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }));
    else Array.from(container.querySelectorAll("button")).find(button => button.textContent === "送信する" || button.textContent === "送信中...")!.click();
  });
}
const cases = [
  { name: "contact", render: () => createElement(ContactForm), endpoint: "/api/contact", fields: { "#contact-email": "person@example.com", "#contact-subject": "質問", "#contact-message": "問い合わせ本文" }, body: { email: "person@example.com", subject: "質問", message: "問い合わせ本文" } },
  { name: "general report", render: () => createElement(ReportForm, { initialShareId: "share-example" }), endpoint: "/api/report", fields: { "#report-category": "other", "#report-reason": "通報の理由" }, body: { reportType: "general", shareId: "share-example", category: "other", reason: "通報の理由" } },
  { name: "rights report", render: () => createElement(RightsHolderReportForm, { initialShareId: "share-example" }), endpoint: "/api/report", fields: { "#rh-report-claimant-name": "権利者", "#rh-report-contact-email": "owner@example.com", "#rh-report-reason": "権利侵害の理由" }, body: { reportType: "rights_holder", shareId: "share-example", claimantName: "権利者", contactEmail: "owner@example.com", rightType: "copyright", reason: "権利侵害の理由" } },
];
for (const scenario of cases) describe(scenario.name, () => {
  beforeEach(async () => { await act(async () => root.render(scenario.render())); });
  async function fill() {
    for (const [selector, value] of Object.entries(scenario.fields)) await input(selector, value);
    const checkbox = container.querySelector<HTMLInputElement>('input[type="checkbox"]');
    if (checkbox) await act(async () => checkbox.click());
  }
  it("validates missing input without obtaining a token or sending data", async () => {
    await submit();
    const message = scenario.name === "contact" ? "メールアドレス・件名・本文を入力してください。" : scenario.name === "general report" ? "共有URL・通報の種類・理由を入力してください。" : "必須項目をすべて入力してください。";
    const notification = Array.from(container.querySelectorAll("p")).find(element => element.textContent?.trim() === message);
    expect(notification).toBeDefined();
    expect(notification!.closest('[aria-hidden="true"]')).toBeNull();
    expect(getToken).not.toHaveBeenCalled(); expect(fetchMock).not.toHaveBeenCalled();
  });
  it("submits the existing API shape once and shows confirmation on success", async () => {
    await fill(); await submit();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, options] = fetchMock.mock.calls[0];
    expect(url).toBe(scenario.endpoint); expect(options.method).toBe("POST");
    expect(JSON.parse(options.body)).toMatchObject({ ...scenario.body, turnstileToken: "turnstile-token" });
    const message = scenario.name === "contact" ? "お問い合わせありがとうございます。確認いたします。" : scenario.name === "general report" ? "ご報告ありがとうございます。確認いたします。" : "ご申し立てありがとうございます。確認いたします。";
    const confirmation = Array.from(container.querySelectorAll("p")).find(element => element.textContent?.trim() === message);
    expect(confirmation).toBeDefined();
    expect(confirmation!.closest('[aria-hidden="true"]')).toBeNull();
    expect(container.querySelector('button[type="submit"]')).toBeNull();
    const hiddenForm = container.querySelector('[aria-hidden="true"]');
    if (scenario.name !== "contact") expect(hiddenForm).not.toBeNull();
    const before = fetchMock.mock.calls.length;
    if (scenario.name !== "contact") await submit();
    expect(fetchMock).toHaveBeenCalledTimes(before);
  });
  it("preserves inputs and permits retry after a Turnstile failure", async () => {
    await fill(); getToken.mockRejectedValueOnce(new Error("検証失敗")); await submit();
    expect(container.textContent).toContain("検証失敗"); expect(fetchMock).not.toHaveBeenCalled();
    for (const [selector, value] of Object.entries(scenario.fields)) expect(container.querySelector<HTMLInputElement>(selector)?.value).toBe(value);
    await submit(); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  it("displays an API failure and permits retry", async () => {
    await fill(); fetchMock.mockResolvedValueOnce(Response.json({ success: false, error: "受付失敗" }, { status: 503 })); await submit();
    expect(container.textContent).toContain("受付失敗"); await submit(); expect(fetchMock).toHaveBeenCalledTimes(2);
  });
  it("blocks repeated submissions while waiting for Turnstile", async () => {
    let resolveToken!: (value: string) => void;
    getToken.mockImplementationOnce(() => new Promise<string>(resolve => { resolveToken = resolve; }));
    await fill(); await submit(); await submit();
    expect(getToken).toHaveBeenCalledTimes(1); expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => resolveToken("turnstile-token")); expect(fetchMock).toHaveBeenCalledTimes(1);
  });
  if (scenario.name !== "contact") it("uses the supplied share ID as the initial input", () => {
    expect(container.querySelector<HTMLInputElement>('input[type="text"]')?.value).toContain("share-example");
  });
});
