import { test, expect } from '@playwright/test';

/**
 * UX regression tests — these guard against the specific problems that
 * bit crosswalker docs in the past:
 *   - Nova overflow bug (content clipped silently)
 *   - Content too narrow on wide screens
 *   - Sidebar too wide on wide screens
 *   - Base font too small at 1400px+
 *   - lastUpdated footer missing
 *   - Console errors leaking into prod
 *   - Failed resource requests (busted base path, missing assets)
 *
 * If any of these fail on a fresh install, check brand.css wasn't lost
 * and astro.config.mjs still loads it.
 */

const BASE = '/obsidian-folder-tag-sync';
const SAMPLE = `${BASE}/getting-started/installation/`;

test.describe('Content width — clamp() on wide screens', () => {
  // Browsers return the raw clamp() string when reading a CSS custom property
  // off :root. To check the resolved value we measure the width of an element
  // that actually consumes the variable.
  async function measureContentPx(page) {
    return await page.evaluate(() => {
      const el =
        document.querySelector('.main-pane .sl-container') ||
        document.querySelector('main .sl-container') ||
        document.querySelector('.sl-markdown-content')?.parentElement;
      return el ? el.getBoundingClientRect().width : 0;
    });
  }

  test('1920px viewport: content area is wider than the 50rem floor', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const px = await measureContentPx(page);
    // 50rem baseline at 118% scale ~ 944px. At 1920 we expect clamp to push
    // beyond the floor. Allow wide tolerance — we care it grew, not the exact px.
    expect(px, `content width at 1920 was ${px}px`).toBeGreaterThan(900);
  });

  test('custom property is declared on :root (brand.css loaded)', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const raw = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sl-content-width').trim()
    );
    // Raw value should be our clamp expression — proves brand.css applied
    // its @media override (if it hadn't, this would be Nova's default).
    expect(raw).toMatch(/clamp|85rem|68vw/);
  });
});

test.describe('Sidebar width — tuned down from Nova default', () => {
  test('wide viewport sets --sl-sidebar-width to 15rem', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const sidebarWidth = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue('--sl-sidebar-width').trim()
    );

    const n = parseFloat(sidebarWidth);
    if (sidebarWidth.endsWith('px')) {
      // 15rem @ 112% = 15 * 16 * 1.12 = 268.8px. Accept 220-290.
      expect(n, `expected sidebar 220-290px at 1920, got ${sidebarWidth}`).toBeGreaterThanOrEqual(220);
      expect(n).toBeLessThanOrEqual(290);
    } else if (sidebarWidth.endsWith('rem')) {
      expect(n).toBe(15);
    }
  });
});

test.describe('Base font scale on big monitors', () => {
  test('1400px+ uses 112% root font-size', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const rootSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    // 16 * 1.12 = 17.92
    expect(rootSize).toBeGreaterThanOrEqual(17);
  });

  test('1700px+ uses 118% root font-size', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const rootSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    // 16 * 1.18 = 18.88
    expect(rootSize).toBeGreaterThanOrEqual(18);
  });

  test('<1400px stays at default 16px', async ({ page }) => {
    await page.setViewportSize({ width: 1300, height: 900 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const rootSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(rootSize).toBeGreaterThanOrEqual(15);
    expect(rootSize).toBeLessThanOrEqual(17);
  });
});

test.describe('Nova overflow bug — div box-sizing fix', () => {
  test('divs inside markdown content use border-box', async ({ page }) => {
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const boxSizing = await page.evaluate(() => {
      const div = document.querySelector('.sl-markdown-content div');
      return div ? getComputedStyle(div).boxSizing : null;
    });
    expect(boxSizing).toBe('border-box');
  });

  test('page body has no horizontal scroll at 1024px (Nova overflow check)', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `horizontal overflow: scroll=${scrollWidth}, client=${clientWidth}`).toBeLessThanOrEqual(clientWidth + 2);
  });
});

test.describe('lastUpdated footer', () => {
  // Starlight's `lastUpdated: true` reads git history. These tests require
  // the docs files to be committed. They skip gracefully when no git history
  // is available (e.g. before first commit) but will catch regressions
  // where `lastUpdated: true` was turned off after commit.
  test('content page shows Last updated line (git-dependent)', async ({ page }) => {
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const count = await page.locator('text=/Last updated/i').count();
    test.skip(count === 0, 'No "Last updated" rendered — expected before first git commit.');
    await expect(page.locator('text=/Last updated/i').first()).toBeVisible();
  });

  test('Last updated has a real <time datetime="..."> (git-dependent)', async ({ page }) => {
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const timeCount = await page.locator('time').count();
    test.skip(timeCount === 0, 'No <time> rendered — expected before first git commit.');
    const timeEl = page.locator('time').last();
    await expect(timeEl).toBeVisible();
    expect(await timeEl.getAttribute('datetime')).toBeTruthy();
  });
});

test.describe('No console errors and no failed requests', () => {
  test('homepage is clean', async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r) => { failed.push(r.url()); });

    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    const critical = errors.filter((e) =>
      !e.includes('favicon') &&
      !e.toLowerCase().includes('third-party cookie')
    );
    expect(critical, `Console errors: ${critical.join(' | ')}`).toHaveLength(0);
    expect(failed, `Failed requests: ${failed.join(' | ')}`).toHaveLength(0);
  });

  test('sample content page is clean', async ({ page }) => {
    const errors: string[] = [];
    const failed: string[] = [];
    page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    page.on('requestfailed', (r) => { failed.push(r.url()); });

    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const critical = errors.filter((e) =>
      !e.includes('favicon') &&
      !e.toLowerCase().includes('third-party cookie')
    );
    expect(critical, `Console errors: ${critical.join(' | ')}`).toHaveLength(0);
    expect(failed, `Failed requests: ${failed.join(' | ')}`).toHaveLength(0);
  });
});

test.describe('Meta tags', () => {
  test('homepage has description meta', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const desc = await page.locator('meta[name="description"]').getAttribute('content');
    expect(desc).toBeTruthy();
  });

  test('pages have proper title tags', async ({ page }) => {
    await page.goto(SAMPLE);
    expect(await page.title()).toContain('Folder Tag Sync');
  });
});

test.describe('Tailwind @source includes Nova — catches silent sidebar bleed', () => {
  // Root cause of a past regression: global.css missed
  //   @source '../../node_modules/starlight-theme-nova/src';
  //   @source '../../node_modules/starlight-theme-nova/components';
  // Without those, Tailwind strips Nova's utility classes (invisible, md:visible,
  // fixed, etc.) and the mobile sidebar renders visible and overlaps the content.
  // This test catches that by verifying the sidebar is actually hidden at mobile.
  test('mobile: inner sidebar computes visibility:hidden', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/getting-started/installation/`);
    await page.waitForLoadState('networkidle');

    const vis = await page.evaluate(() => {
      const el = document.getElementById('starlight__sidebar');
      return el ? getComputedStyle(el).visibility : null;
    });
    expect(vis, `mobile sidebar visibility — if this is "visible", @source directives are missing from global.css`).toBe('hidden');
  });

  test('desktop: inner sidebar computes visibility:visible', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.goto(`${BASE}/getting-started/installation/`);
    await page.waitForLoadState('networkidle');

    const vis = await page.evaluate(() => {
      const el = document.getElementById('starlight__sidebar');
      return el ? getComputedStyle(el).visibility : null;
    });
    expect(vis).toBe('visible');
  });

  test('mobile: sidebar does not overlap main content at top of page', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto(`${BASE}/getting-started/installation/`);
    await page.waitForLoadState('networkidle');

    // If the sidebar is visibly rendering at mobile, its text would appear
    // at the top of the main content area. Measure the h1 position — it
    // should be reasonably close to the top (under the navbar), not pushed
    // far down by sidebar content.
    const h1Top = await page.evaluate(() => {
      const h1 = document.querySelector('main h1, .main-frame h1');
      return h1 ? h1.getBoundingClientRect().top : null;
    });
    expect(h1Top).not.toBeNull();
    // Navbar is ~56px tall; h1 should land within ~200px of viewport top.
    expect(h1Top, `h1 pushed down to y=${h1Top}px — sidebar is likely bleeding into content`).toBeLessThan(200);
  });
});

test.describe('Base path sanity — catches common deploy disaster', () => {
  test('all internal links include base prefix', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Collect internal-ish links (exclude anchors, mailto, external)
    const badLinks: string[] = await page.evaluate((base) => {
      const out: string[] = [];
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = (a as HTMLAnchorElement).getAttribute('href') || '';
        if (!href) continue;
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) continue;
        // Internal relative links should resolve under the base path.
        if (!href.startsWith(base) && !href.startsWith('/_astro/')) {
          out.push(href);
        }
      }
      return out;
    }, BASE);

    // Starlight pagefind may use /_pagefind/; that's fine (no base prefix expected).
    const filtered = badLinks.filter((h) => !h.startsWith('/_pagefind/'));
    expect(filtered, `links not under base path: ${filtered.join(' | ')}`).toHaveLength(0);
  });
});
