import { test, expect } from '@playwright/test';

// Must match astro.config.mjs `base`
const BASE = '/obsidian-folder-tag-sync';

test.describe('Homepage', () => {
  test('loads with correct title', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await expect(page).toHaveTitle(/Folder Tag Sync/);
  });

  test('hero CTA navigates to installation', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.getByRole('link', { name: /Get started/i }).click();
    await expect(page).toHaveURL(/getting-started\/installation/);
    await expect(page.locator('h1')).toContainText('Installation');
  });

  test('top header renders with site title', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const header = page.locator('header.header, header[role="banner"], starlight-page-frame header, header').first();
    await expect(header).toBeVisible();
    // Title text should be present somewhere in the header area
    await expect(header).toContainText(/Folder Tag Sync/i);
  });

  test('search button is present', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const searchButton = page.locator('site-search button, button[data-open-modal]');
    await expect(searchButton.first()).toBeVisible();
  });
});

test.describe('Content pages — all section landings load', () => {
  const pages = [
    { path: '/getting-started/installation/', h1: 'Installation' },
    { path: '/getting-started/first-rule/', h1: /first rule/i },
    { path: '/concepts/tag-depth/', h1: /tag depth/i },
    { path: '/concepts/wildcard-matching/', h1: /wildcard/i },
    { path: '/features/overview/', h1: /overview/i },
    { path: '/reference/rule-schema/', h1: /rule schema/i },
    { path: '/reference/transformations/', h1: /transformations/i },
    { path: '/development/claude-code-workflow/', h1: /Claude Code workflow/i },
    { path: '/development/testing/', h1: /testing/i },
    { path: '/development/environment-setup/', h1: /environment setup/i },
    { path: '/development/release-checklist/', h1: /release checklist/i },
    { path: '/about/roadmap/', h1: /roadmap/i },
    { path: '/about/project-brief/', h1: /project brief/i },
    { path: '/about/contributing/', h1: /contributing/i },
    { path: '/about/ui-improvements/', h1: /ui improvements/i },
  ];

  for (const { path, h1 } of pages) {
    test(`${path} loads and renders h1`, async ({ page }) => {
      const res = await page.goto(`${BASE}${path}`);
      expect(res?.status(), `expected 200 for ${path}`).toBe(200);
      await expect(page.locator('h1').first()).toContainText(h1);
    });
  }
});

test.describe('Sidebar', () => {
  test('sidebar DOM contains all top-level sections', async ({ page }) => {
    // Wide viewport so the sidebar is definitely visible (not mobile-collapsed).
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(`${BASE}/getting-started/installation/`);
    await page.waitForLoadState('networkidle');

    // Starlight's canonical sidebar element id is #starlight__sidebar.
    const sidebar = page.locator('#starlight__sidebar');
    await expect(sidebar).toBeAttached();

    const text = (await sidebar.innerText()).toLowerCase();
    for (const label of ['getting started', 'concepts', 'features', 'reference', 'development', 'about']) {
      expect(text, `sidebar missing "${label}"`).toContain(label);
    }
  });
});
