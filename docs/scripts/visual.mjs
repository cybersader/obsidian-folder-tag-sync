#!/usr/bin/env bun
/**
 * Visual iteration harness. Builds the site, serves dist/, launches chromium,
 * and captures full-page screenshots of a curated set of pages across four
 * viewports — plus a markdown report flagging console errors, horizontal
 * scroll, and failed requests per page/viewport combination.
 *
 * Usage:
 *   bun scripts/visual.mjs                    # full build + capture
 *   bun scripts/visual.mjs --no-build         # reuse existing dist/
 *   bun scripts/visual.mjs --page /about/roadmap/   # single page only
 *   bun scripts/visual.mjs --viewport mobile        # single viewport only
 *
 * Outputs to docs/visual-reports/<timestamp>/:
 *   - <viewport>/<page-slug>.png    Full-page screenshots
 *   - report.md                      Summary of findings
 *   - issues.md                      Only pages/viewports with problems
 *
 * Read screenshots with your preferred image viewer, or in Claude Code via
 * the Read tool. report.md is scannable for programmatic findings.
 *
 * Pattern adapted from agentic-workflow-and-tech-stack/site/scripts/visual.mjs.
 */

import { execSync } from 'node:child_process';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(__dirname, '..');
const distDir = resolve(siteDir, 'dist');

const skipBuild = process.argv.includes('--no-build');
const pageArg = getArg('--page');
const viewportArg = getArg('--viewport');

const PORT = 4324;
const PREFIX = '/obsidian-folder-tag-sync';

const VIEWPORTS = {
  mobile: { width: 390, height: 844 },     // iPhone 13
  tablet: { width: 768, height: 1024 },    // iPad portrait
  desktop: { width: 1440, height: 900 },   // common laptop
  wide: { width: 1920, height: 1080 },     // 27" monitor
};

const PAGES = [
  { path: '/', slug: 'index', name: 'Homepage' },
  { path: '/getting-started/installation/', slug: 'installation', name: 'Installation' },
  { path: '/getting-started/first-rule/', slug: 'first-rule', name: 'First rule' },
  { path: '/concepts/tag-depth/', slug: 'tag-depth', name: 'Tag depth' },
  { path: '/concepts/wildcard-matching/', slug: 'wildcard-matching', name: 'Wildcard matching' },
  { path: '/features/overview/', slug: 'features-overview', name: 'Features overview' },
  { path: '/reference/rule-schema/', slug: 'rule-schema', name: 'Rule schema' },
  { path: '/reference/transformations/', slug: 'transformations', name: 'Transformations' },
  { path: '/about/roadmap/', slug: 'roadmap', name: 'Roadmap' },
  { path: '/about/project-brief/', slug: 'project-brief', name: 'Project brief' },
  { path: '/about/development-status/', slug: 'development-status', name: 'Development status' },
  { path: '/agent-context/', slug: 'agent-context-index', name: 'Agent context index' },
  { path: '/agent-context/vision/', slug: 'agent-vision', name: 'Vision' },
  { path: '/agent-context/decisions/', slug: 'agent-decisions', name: 'Decisions' },
  { path: '/agent-context/tradeoffs/', slug: 'agent-tradeoffs', name: 'Tradeoffs' },
  { path: '/agent-context/open-questions/', slug: 'agent-open-questions', name: 'Open questions' },
  { path: '/agent-context/prior-art/', slug: 'agent-prior-art', name: 'Prior art' },
  { path: '/agent-context/zz-log/', slug: 'zz-log-index', name: 'zz-log index' },
  { path: '/agent-context/zz-log/2026-04-23-docs-site-setup/', slug: 'zz-log-docs-setup', name: 'zz-log: docs setup' },
  { path: '/agent-context/zz-challenges/', slug: 'zz-challenges-index', name: 'zz-challenges index' },
];

function getArg(flag) {
  const idx = process.argv.indexOf(flag);
  return idx >= 0 ? process.argv[idx + 1] : null;
}

function log(msg) {
  process.stdout.write(msg + '\n');
}

function build() {
  log('› building site...');
  execSync('bun run build', { cwd: siteDir, stdio: 'inherit' });
}

function verifyDist() {
  if (!existsSync(distDir) || !statSync(distDir).isDirectory()) {
    throw new Error(`dist/ not found — run without --no-build first.`);
  }
}

function serve() {
  const MIME = {
    html: 'text/html; charset=utf-8',
    js: 'application/javascript',
    mjs: 'application/javascript',
    css: 'text/css',
    json: 'application/json',
    svg: 'image/svg+xml',
    png: 'image/png',
    jpg: 'image/jpeg',
    webp: 'image/webp',
    xml: 'application/xml',
    woff: 'font/woff',
    woff2: 'font/woff2',
    ico: 'image/x-icon',
  };
  return Bun.serve({
    hostname: '127.0.0.1',
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      let p = decodeURIComponent(url.pathname);
      if (p === PREFIX || p.startsWith(`${PREFIX}/`)) p = p.slice(PREFIX.length) || '/';
      let filePath = join(distDir, p);
      if (existsSync(filePath) && statSync(filePath).isDirectory()) {
        filePath = join(filePath, 'index.html');
      }
      if (!existsSync(filePath)) return new Response('Not found', { status: 404 });
      const ext = filePath.split('.').pop();
      return new Response(Bun.file(filePath), {
        headers: { 'Content-Type': MIME[ext] || 'application/octet-stream' },
      });
    },
  });
}

async function capturePage(page, url) {
  const errors = [];
  const failed = [];
  const handleConsole = (m) => {
    if (m.type() === 'error') errors.push(m.text());
  };
  const handleFailed = (r) => failed.push(r.url());

  page.on('console', handleConsole);
  page.on('requestfailed', handleFailed);

  const res = await page.goto(url, { waitUntil: 'networkidle', timeout: 30_000 });
  await page.waitForTimeout(600); // let lazy hydration settle

  const metrics = await page.evaluate(() => ({
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    bodyHeight: document.body.getBoundingClientRect().height,
    h1Text: document.querySelector('h1')?.textContent?.trim().slice(0, 100) || null,
    hasFooter: !!document.querySelector('footer'),
    hasLastUpdated: !!document.querySelector('time'),
  }));

  page.off('console', handleConsole);
  page.off('requestfailed', handleFailed);

  return {
    status: res?.status() ?? 0,
    errors: errors.filter((e) => !e.includes('favicon') && !e.toLowerCase().includes('third-party cookie')),
    failed,
    metrics,
  };
}

async function main() {
  if (!skipBuild) build();
  verifyDist();

  const server = serve();
  const browser = await chromium.launch({ headless: true });

  const ts = new Date().toISOString().replace(/[:.]/g, '-').replace('T', '_').split('.')[0];
  const outDir = join(siteDir, 'visual-reports', ts);
  mkdirSync(outDir, { recursive: true });
  log(`› output: ${outDir}`);

  const viewportNames = viewportArg ? [viewportArg] : Object.keys(VIEWPORTS);
  const pages = pageArg
    ? PAGES.filter((p) => p.path === pageArg || p.slug === pageArg.replace(/^\//, '').replace(/\/$/, ''))
    : PAGES;

  if (!pages.length) {
    log(`✗ No matching page for "${pageArg}".`);
    log(`  Known: ${PAGES.map((p) => p.path).join(', ')}`);
    browser.close();
    server.stop(true);
    process.exit(1);
  }

  const findings = []; // { viewport, page, issues: [] }

  try {
    for (const vpName of viewportNames) {
      const viewport = VIEWPORTS[vpName];
      if (!viewport) {
        log(`  ⚠ unknown viewport: ${vpName}`);
        continue;
      }
      mkdirSync(join(outDir, vpName), { recursive: true });

      const context = await browser.newContext({ viewport });
      const page = await context.newPage();

      for (const p of pages) {
        const url = `http://127.0.0.1:${PORT}${PREFIX}${p.path}`;
        process.stdout.write(`  [${vpName}] ${p.slug}... `);
        const result = await capturePage(page, url);

        const shot = join(outDir, vpName, `${p.slug}.png`);
        await page.screenshot({ path: shot, fullPage: true });

        const issues = [];
        if (result.status !== 200) issues.push(`HTTP ${result.status}`);
        if (result.metrics.scrollWidth > result.metrics.clientWidth + 2) {
          issues.push(`horizontal scroll (${result.metrics.scrollWidth}px > ${result.metrics.clientWidth}px)`);
        }
        if (result.errors.length) issues.push(`${result.errors.length} console error(s)`);
        if (result.failed.length) issues.push(`${result.failed.length} failed request(s)`);

        findings.push({ viewport: vpName, page: p, result, issues, screenshot: shot });
        process.stdout.write(issues.length ? `⚠ ${issues.join(', ')}\n` : `ok\n`);
      }

      await context.close();
    }
  } finally {
    await browser.close();
    server.stop(true);
  }

  // Report
  const lines = [
    `# Visual report`,
    ``,
    `- Generated: ${new Date().toISOString()}`,
    `- Viewports: ${viewportNames.join(', ')}`,
    `- Pages: ${pages.length}`,
    `- Screenshots: ${viewportNames.length * pages.length}`,
    ``,
  ];

  const withIssues = findings.filter((f) => f.issues.length);

  lines.push(`## Summary`);
  lines.push('');
  lines.push(withIssues.length ? `⚠ ${withIssues.length} / ${findings.length} captures have issues.` : `✓ All ${findings.length} captures clean.`);
  lines.push('');

  if (withIssues.length) {
    lines.push(`## Issues`);
    lines.push('');
    for (const f of withIssues) {
      lines.push(`### [${f.viewport}] ${f.page.name} (${f.page.path})`);
      lines.push('');
      lines.push(`- Screenshot: \`${f.screenshot.replace(siteDir + '/', '')}\``);
      for (const iss of f.issues) lines.push(`- ⚠ ${iss}`);
      if (f.result.errors.length) {
        lines.push('');
        lines.push('  Console errors:');
        for (const e of f.result.errors.slice(0, 5)) lines.push(`  - \`${e.slice(0, 200)}\``);
      }
      if (f.result.failed.length) {
        lines.push('');
        lines.push('  Failed requests:');
        for (const u of f.result.failed.slice(0, 5)) lines.push(`  - \`${u}\``);
      }
      lines.push('');
    }
  }

  lines.push(`## All captures`);
  lines.push('');
  lines.push(`| Viewport | Page | Status | scroll/client | h1 |`);
  lines.push(`|---|---|---|---|---|`);
  for (const f of findings) {
    const m = f.result.metrics;
    lines.push(
      `| ${f.viewport} | ${f.page.name} | ${f.result.status} | ${m.scrollWidth}/${m.clientWidth} | ${(m.h1Text || '—').replace(/\|/g, '\\|')} |`
    );
  }

  await writeFile(join(outDir, 'report.md'), lines.join('\n'));

  if (withIssues.length) {
    const issueLines = [`# Issues only\n\n`, `${withIssues.length} findings:\n\n`];
    for (const f of withIssues) {
      issueLines.push(`- [${f.viewport}] ${f.page.path} — ${f.issues.join(', ')}`);
    }
    await writeFile(join(outDir, 'issues.md'), issueLines.join('\n'));
  }

  log('');
  log(`✓ ${findings.length} captures; ${withIssues.length} with issues.`);
  log(`  Report: ${join(outDir, 'report.md').replace(siteDir + '/', '')}`);
  if (withIssues.length) {
    process.exit(1);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
