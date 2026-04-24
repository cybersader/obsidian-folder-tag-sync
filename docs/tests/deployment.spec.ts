import { test, expect } from '@playwright/test';

/**
 * Deployment verification — runs against a live deployed URL.
 *
 *   TEST_URL=https://cybersader.github.io bun run test:deploy
 *
 * With TEST_URL set, playwright.config.ts skips the local webServer and
 * points baseURL at the live site. These tests should be cheap and catch
 * the "my deploy is broken, I can't see it yet" class of failures.
 */

const BASE = '/obsidian-folder-tag-sync';

test.describe('Deployment verification', () => {
  test('homepage is reachable (200)', async ({ page }) => {
    const res = await page.goto(`${BASE}/`);
    expect(res?.status(), `expected 200, got ${res?.status()}`).toBe(200);
  });

  test('homepage has no console errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });

    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    const critical = errors.filter((e) => !e.includes('favicon'));
    expect(critical, `Console errors on prod: ${critical.join(' | ')}`).toHaveLength(0);
  });

  test('no failed network requests', async ({ page }) => {
    const failed: string[] = [];
    page.on('requestfailed', (r) => failed.push(r.url()));

    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    expect(failed, `Failed requests on prod: ${failed.join(' | ')}`).toHaveLength(0);
  });

  test('meta description and title are set', async ({ page }) => {
    await page.goto(`${BASE}/`);
    expect(await page.locator('meta[name="description"]').getAttribute('content')).toBeTruthy();
    expect(await page.title()).toContain('Folder Tag Sync');
  });

  test('sitemap-index.xml exists', async ({ page }) => {
    const res = await page.goto(`${BASE}/sitemap-index.xml`);
    expect(res?.status()).toBe(200);
  });

  test('pagefind search index is deployed', async ({ page }) => {
    const res = await page.goto(`${BASE}/pagefind/pagefind.js`);
    expect(res?.status()).toBe(200);
  });
});
