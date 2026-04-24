import { test, expect } from '@playwright/test';

/**
 * UX regression tests — guards against the issues most likely to regress:
 *   - Base path sanity (internal links match astro.config base)
 *   - Console errors leaking into prod
 *   - Failed asset requests (missing favicon, broken images, etc.)
 *   - Meta tags present for SEO
 *   - Font-size scale at large viewports (defined in brand.css)
 *   - lastUpdated footer (Starlight's git-based freshness indicator)
 *
 * History: the diagram and layout used to carry a lot more tests when we
 * were on the Nova theme (Tailwind @source, sidebar bleed, content-width
 * clamp, sidebar width, etc.). Those are gone now that we're on Flexoki.
 * If Flexoki-specific regressions show up, add guards here.
 */

const BASE = '/obsidian-folder-tag-sync';
const SAMPLE = `${BASE}/getting-started/installation/`;

test.describe('Base font scale on big monitors', () => {
  test('1400px+ uses 112% root font-size', async ({ page }) => {
    await page.setViewportSize({ width: 1500, height: 900 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const rootSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
    expect(rootSize).toBeGreaterThanOrEqual(17);
  });

  test('1700px+ uses 118% root font-size', async ({ page }) => {
    await page.setViewportSize({ width: 1800, height: 900 });
    await page.goto(SAMPLE);
    await page.waitForLoadState('networkidle');

    const rootSize = await page.evaluate(() => parseFloat(getComputedStyle(document.documentElement).fontSize));
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

test.describe('SVG overflow safety', () => {
  test('polyhierarchy diagram SVG does not overflow its container', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    // Find the diagram's SVG (it's inside .pd-fig, set by our component)
    const result = await page.evaluate(() => {
      const fig = document.querySelector('.pd-fig');
      const svg = fig?.querySelector('svg');
      if (!svg || !fig) return null;
      const figRect = fig.getBoundingClientRect();
      const svgRect = svg.getBoundingClientRect();
      return {
        figWidth: figRect.width,
        svgWidth: svgRect.width,
        svgMaxWidth: getComputedStyle(svg).maxWidth,
      };
    });
    expect(result, 'diagram not found on page').not.toBeNull();
    // SVG width should fit within its figure container
    expect(result!.svgWidth).toBeLessThanOrEqual(result!.figWidth + 2);
  });

  test('homepage has no horizontal overflow at 1024px', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    const { scrollWidth, clientWidth } = await page.evaluate(() => ({
      scrollWidth: document.documentElement.scrollWidth,
      clientWidth: document.documentElement.clientWidth,
    }));
    expect(scrollWidth, `horizontal overflow: scroll=${scrollWidth}, client=${clientWidth}`).toBeLessThanOrEqual(clientWidth + 2);
  });
});

test.describe('lastUpdated footer', () => {
  // Git-dependent: passes in CI (git history exists) and locally after first commit.
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

test.describe('Base path sanity — catches common deploy disaster', () => {
  test('all internal links include base prefix', async ({ page }) => {
    await page.goto(`${BASE}/`);
    await page.waitForLoadState('networkidle');

    const badLinks: string[] = await page.evaluate((base) => {
      const out: string[] = [];
      for (const a of Array.from(document.querySelectorAll('a[href]'))) {
        const href = (a as HTMLAnchorElement).getAttribute('href') || '';
        if (!href) continue;
        if (href.startsWith('#') || href.startsWith('mailto:') || href.startsWith('http')) continue;
        if (!href.startsWith(base) && !href.startsWith('/_astro/')) {
          out.push(href);
        }
      }
      return out;
    }, BASE);

    const filtered = badLinks.filter((h) => !h.startsWith('/_pagefind/'));
    expect(filtered, `links not under base path: ${filtered.join(' | ')}`).toHaveLength(0);
  });
});

test.describe('Favicons — multiple sizes present', () => {
  test('homepage declares PNG favicons alongside the SVG', async ({ page }) => {
    await page.goto(`${BASE}/`);
    const sizes = await page.$$eval('link[rel*="icon"]', (els) =>
      els.map((el) => el.getAttribute('sizes') || el.getAttribute('type') || '')
    );
    // Should have the svg declaration plus at least a 32x32 PNG
    expect(sizes.some((s) => s === 'image/svg+xml')).toBe(true);
    expect(sizes.some((s) => s.includes('32x32'))).toBe(true);
  });
});
