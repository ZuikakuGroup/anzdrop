import { expect, test } from "@playwright/test";

// 本番(または E2E_BASE_URL)のトップページが致命的エラーなく描画されること。
test.describe("Smoke", () => {
  test("top page renders primary upload UI without page errors", async ({
    page,
  }) => {
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => {
      pageErrors.push(error.message);
    });

    const response = await page.goto("/", { waitUntil: "domcontentloaded" });
    expect(response, "top page response should exist").toBeTruthy();
    expect(
      response!.status(),
      `unexpected status ${response!.status()} for ${response!.url()}`
    ).toBeLessThan(400);

    await expect(page.getByRole("heading", { name: "Anzdrop" })).toBeVisible();
    await expect(
      page.getByRole("button", { name: "アップロードする" })
    ).toBeVisible();
    await expect(page.getByRole("contentinfo")).toBeVisible();

    expect(
      pageErrors,
      `page threw JS errors:\n${pageErrors.join("\n")}`
    ).toEqual([]);
  });
});
