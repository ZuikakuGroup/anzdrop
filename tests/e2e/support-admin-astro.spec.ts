import { test, expect } from '@playwright/test';

test.describe('support and admin Astro pages', () => {
  test.skip(process.env.E2E_ASTRO_HONO !== '1', 'Isolated local Workers only');
  test('support forms hydrate with the response nonce and retain shareId', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.addInitScript(() => document.addEventListener('securitypolicyviolation', event => console.error(`CSP-VIOLATION:${event.violatedDirective}`)));
    page.on('console', message => { if (message.text().startsWith('CSP-VIOLATION:')) errors.push(message.text()); });
    for (const path of ['/contact', '/report?shareId=share-example', '/report/rights?shareId=share-example']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      expect(response?.headers()['cache-control']).toBe('no-store');
      await expect(page.locator('astro-island')).not.toHaveAttribute('ssr');
      await expect(page.locator('meta[name="robots"]')).toHaveAttribute('content', 'noindex, nofollow');
      const nonce = await page.locator('script[nonce]').first().evaluate(script => (script as HTMLScriptElement).nonce);
      expect(nonce).not.toBe('');
      expect(response?.headers()['content-security-policy']).toContain(`'nonce-${nonce}'`);
      if (path.startsWith('/report')) await expect(page.locator('input[type="text"]').first()).toHaveValue(/share-example/);
      await expect(page.getByRole('button', { name: '送信する', exact: true })).toBeVisible();
    }
    expect(errors).toEqual([]);
  });
  test('internal paths and unknown pages return non-cacheable 404', async ({ request }) => {
    for (const path of ['/__internal/admin/access', '/missing-page-for-test']) {
      const response = await request.get(path);
      expect(response.status()).toBe(404);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.text()).not.toContain('admin@example.com');
    }
  });
  test('unauthenticated admin pages do not render management islands', async ({ request }) => {
    test.skip(process.env.E2E_LOCAL_ADMIN_BYPASS === 'true', 'Local admin preview');
    for (const path of ['/admin', '/admin/accounts', '/admin/contacts', '/admin/analytics']) {
      const response = await request.get(path);
      expect(response.status()).toBe(404);
      expect(response.headers()['cache-control']).toBe('no-store');
      expect(await response.text()).not.toContain('astro-island');
    }
  });
  test('explicit loopback admin preview hydrates and accesses authorized Hono APIs', async ({ page }) => {
    test.skip(process.env.E2E_LOCAL_ADMIN_BYPASS !== 'true', 'Requires explicit isolated local bypass');
    const errors: string[] = [];
    page.on('pageerror', error => errors.push(error.message));
    for (const path of ['/admin', '/admin/accounts', '/admin/contacts', '/admin/analytics']) {
      const response = await page.goto(path);
      expect(response?.status()).toBe(200);
      await expect(page.locator('astro-island')).not.toHaveAttribute('ssr');
      const result = await page.evaluate(async endpoint => {
        const response = await fetch(endpoint);
        return { status: response.status, cache: response.headers.get('Cache-Control') };
      }, path === '/admin' ? '/api/admin/reports' : path === '/admin/accounts' ? '/api/admin/accounts/missing-test-account' : path === '/admin/analytics' ? '/api/admin/analytics?view=overview' : `/api${path}`);
      expect(result).toEqual({ status: 200, cache: 'no-store' });
    }
    expect(errors).toEqual([]);
  });
});
