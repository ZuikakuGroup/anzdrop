import { readFile } from 'node:fs/promises';
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
  test('uploads ciphertext through Hono and downloads identical plaintext in the React island', async ({ page, context }) => {
    await context.grantPermissions(['clipboard-read', 'clipboard-write']);
    await page.addInitScript(() => { Object.defineProperty(window, 'showSaveFilePicker', { value: undefined, configurable: true }); });
    const plaintext = Buffer.from('ASTRO_HONO_PRIVATE_CONTENT_4bf118c9\n'.repeat(128));
    const transmitted: Buffer[] = [];
    page.on('request', request => {
      if (request.url().includes('/api/upload/')) {
        const body = request.postDataBuffer();
        if (body) transmitted.push(body);
      }
    });
    await page.goto('/');
    await expect(page.locator('astro-island')).not.toHaveAttribute('ssr');
    await page.locator('input[type="file"]').setInputFiles({ name: 'migration.txt', mimeType: 'text/plain', buffer: plaintext });
    await page.getByRole('button', { name: 'アップロードする', exact: true }).click();
    await expect(page.getByText('共有リンクを発行しました')).toBeVisible();
    await page.getByRole('button', { name: 'URLをコピー', exact: true }).click();
    const url = await page.evaluate(() => navigator.clipboard.readText());
    expect(new URL(url).hash).not.toBe('');
    const fragment = new URL(url).hash.slice(1);
    expect(transmitted.length).toBeGreaterThan(0);
    for (const body of transmitted) {
      expect(body.includes(Buffer.from('ASTRO_HONO_PRIVATE_CONTENT_4bf118c9'))).toBe(false);
      expect(body.includes(Buffer.from(fragment))).toBe(false);
      expect(body.includes(Buffer.from('migration.txt'))).toBe(false);
    }
    await page.goto(url);
    const download = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /migration\.txt/ }).click();
    const result = await download;
    expect(result.suggestedFilename()).toBe('migration.txt');
    expect(await readFile((await result.path())!)).toEqual(plaintext);
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
