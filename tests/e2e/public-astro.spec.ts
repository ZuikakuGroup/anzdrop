import { test, expect } from '@playwright/test';

test.describe('Astro公開ページ（ローカルWorkers）', () => {
  test.skip(process.env.PUBLIC_ASTRO_TEST !== 'true', 'Astro seed preview専用');
  test.beforeEach(async ({ page }) => {
    // Seed images use a dimensionless SVG. Supply a deterministic image like the production CMS.
    await page.route('**/file.svg', route => route.fulfill({ contentType: 'image/svg+xml', body: '<svg xmlns="http://www.w3.org/2000/svg" width="640" height="360"><rect width="640" height="360" fill="#f15a22"/></svg>' }));
    await page.route('**/api/account/me', route => route.fulfill({ json: { success: false } }));
  });
  test('SSR・FAQ・ヘッダーのハイドレーションがCSP下で動作する', async ({ page }) => {
    const violations: string[] = [];
    await page.addInitScript(() => {
      document.addEventListener('securitypolicyviolation', event => console.error(`CSP-VIOLATION:${event.violatedDirective}`));
    });
    page.on('console', message => { if (message.text().includes('CSP-VIOLATION:')) violations.push(message.text()); });
    const response = await page.goto('/about');
    expect(response?.status()).toBe(200);
    expect(response?.headers()['cache-control']).toBe('no-store');
    const csp = response?.headers()['content-security-policy'] ?? '';
    const nonce = /'nonce-([^']+)'/.exec(csp)?.[1];
    expect(nonce).toBeTruthy();
    expect(csp).toContain("'strict-dynamic'");
    await expect(page.locator('script').first()).toHaveJSProperty('nonce', nonce);
    await expect(page.locator('h1')).toBeVisible();
    await expect(page.locator('body')).toHaveCSS('background-color', 'rgb(255, 255, 255)');
    await expect(page.getByRole('link', { name: 'ログイン', exact: true })).toBeVisible();
    const faq = page.locator('details').first();
    await faq.locator('summary').click();
    await expect(faq).toHaveAttribute('open', '');
    await expect(page.locator('link[rel="canonical"]')).toHaveAttribute('href', 'https://anzdrop.com/about');
    expect(violations).toEqual([]);
  });
  test('Standardの料金と購入導線を公開する', async ({ page }) => {
    await page.goto('/pricing');
    const card = page.getByRole('heading', { name: 'Standard', exact: true }).locator('..');
    await expect(card).toContainText('¥250');
    await expect(card).toContainText('20GB');
    await expect(card).toContainText('15日');
    await expect(card).not.toContainText('準備中');
    await expect(card.getByRole('link', { name: '始める' })).toHaveAttribute('href', '/mypage/billing');
  });
  test('ブログのページ送り・記事・画像拡大・404', async ({ page, request }) => {
    await page.goto('/blog');
    await page.getByRole('link', { name: '次のページ' }).click();
    await expect(page).toHaveURL(/page=2/);
    await expect(page.locator('#blog-page')).toHaveValue('2');
    await page.locator('#blog-page').fill('1');
    await page.locator('#blog-page').press('Enter');
    await expect(page).toHaveURL(/\/blog\?page=1$/);
    await expect(page.locator('a[href="/blog/local-seed-post-1"]')).toBeVisible();
    await expect(page.locator('#blog-page')).toHaveValue('1');
    await page.goto('/blog/local-seed-post-1');
    await expect(page.locator('article h1')).toBeVisible();
    await expect(page.locator('astro-island[component-url*="ArticleImageLightbox"]')).not.toHaveAttribute('ssr');
    await page.getByRole('button', { name: 'アイキャッチ画像を拡大表示' }).click();
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).not.toBeVisible();
    const missing = await request.get('/blog/does-not-exist');
    expect(missing.status()).toBe(404);
    expect(await missing.text()).toContain('noindex');
    const sitemap = await request.get('/sitemap.xml');
    expect(sitemap.status()).toBe(200);
    expect(await sitemap.text()).toContain('https://anzdrop.com/blog/local-seed-post-1');
    expect(await (await request.get('/robots.txt')).text()).toContain('Disallow: /api\n');
  });
});

test('公開ページの本文とメタデータをSSRし、セッションを発行しない', async ({ request }) => {
  test.skip(process.env.PUBLIC_ASTRO_TEST !== 'true', 'Astro seed preview専用');
  for (const path of ['/about', '/pricing', '/legal/terms', '/legal/privacy', '/legal/tokushoho', '/lp/secure-file-sharing', '/blog/categories/local-seed-category', '/blog/tags/local-seed-tag', '/blog/authors/local-seed-author']) {
    const response = await request.get(path);
    expect(response.status(), path).toBe(200);
    expect(response.headers()['set-cookie'], path).toBeUndefined();
    expect(response.headers()['cache-control'], path).toBe('no-store');
    const html = await response.text();
    expect(html, path).toContain('<h1');
    expect(html, path).toContain(`https://anzdrop.com${path}`);
    expect(html, path).toContain('name="description"');
  }
});
