import { test, expect } from '@playwright/test';

test.describe('Astro React islands with Hono API', () => {
  test.skip(process.env.E2E_ASTRO_HONO !== '1', 'Local migration preview required');
  test('login, recovery and signup hydrate under CSP; private pages require login', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => console.error(`CSP-VIOLATION:${event.violatedDirective}`)));
    page.on('console', message => { if (message.text().startsWith('CSP-VIOLATION:')) errors.push(message.text()); });
    for (const path of ['/mypage/login', '/mypage/recover', '/mypage/signup']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cache-control']).toBe('no-store');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      await expect(page.locator('form')).toBeVisible();
      await expect(page.locator('astro-island')).not.toHaveAttribute('ssr');
    }
    for (const path of ['/mypage', '/mypage/security', '/mypage/billing']) {
      await page.goto(path);
      await expect(page).toHaveURL(/\/mypage\/login$/);
      await expect(page.locator('form')).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
  test('download island reads fragments locally and displays unavailable shares', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    const requests: string[] = [];
    page.on('request', request => requests.push(request.url()));
    await page.goto('/d/missing-share#fragment-only-key');
    await expect(page.locator('astro-island')).not.toHaveAttribute('ssr');
    await expect(page.locator('body')).toContainText(/見つかりません|利用できません|無効|期限/);
    expect(requests.every(url => !url.includes('fragment-only-key'))).toBe(true);
    expect(errors).toEqual([]);
  });
});
