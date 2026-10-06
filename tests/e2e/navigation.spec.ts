import { expect, test, type Page } from "@playwright/test";

// 認証不要で到達できる主要ページへの遷移が 404 にならないこと。
const PUBLIC_PAGES: Array<{ path: string; expectText: RegExp | string }> = [
  { path: "/about", expectText: "Anzdropとは" },
  { path: "/pricing", expectText: "料金プラン" },
  { path: "/blog", expectText: /ブログ|記事|Blog/i },
  { path: "/contact", expectText: "お問い合わせ" },
  { path: "/report", expectText: /通報|報告/ },
  { path: "/legal/terms", expectText: "利用規約" },
  { path: "/legal/privacy", expectText: /プライバシー/ },
  { path: "/legal/tokushoho", expectText: /特定商取引/ },
  { path: "/mypage/login", expectText: /ログイン/ },
  { path: "/lp/secure-file-sharing", expectText: /ファイル共有|暗号化|Anzdrop/ },
];

async function assertPageOk(
  page: Page,
  path: string,
  expectText: RegExp | string
): Promise<void> {
  const response = await page.goto(path, { waitUntil: "domcontentloaded" });
  expect(response, `${path} should return a response`).toBeTruthy();
  expect(
    response!.status(),
    `${path} returned ${response!.status()}`
  ).toBeLessThan(400);
  await expect(page.locator("body")).toContainText(expectText);
}

test.describe("Navigation", () => {
  for (const { path, expectText } of PUBLIC_PAGES) {
    test(`opens ${path}`, async ({ page }) => {
      await assertPageOk(page, path, expectText);
    });
  }

  test("footer legal links reach real pages", async ({ page }) => {
    await page.goto("/", { waitUntil: "domcontentloaded" });
    const footer = page.getByRole("contentinfo");
    await expect(footer).toBeVisible();

    await footer.getByRole("link", { name: "利用規約" }).click();
    await expect(page).toHaveURL(/\/legal\/terms$/);
    await expect(page.locator("body")).toContainText("利用規約");

    await page.goto("/", { waitUntil: "domcontentloaded" });
    await page
      .getByRole("contentinfo")
      .getByRole("link", { name: "お問い合わせ" })
      .click();
    await expect(page).toHaveURL(/\/contact$/);
    await expect(page.locator("body")).toContainText(/お問い合わせ|送信/);
  });
});
