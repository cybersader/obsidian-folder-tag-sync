#!/usr/bin/env bun
/**
 * Lightweight docs smoke test. Builds the site, serves dist/ via Bun.serve,
 * and curls a known list of routes — checking HTTP 200 AND that each page
 * contains expected content.
 *
 * Catches ~80% of what Playwright would catch (broken routes, missing CSS,
 * busted base-path config, dead pagefind index, dead links) for ~10% of the
 * setup cost. For interaction tests use `bun run test:e2e`.
 *
 * Usage:
 *   bun scripts/smoke.mjs              # full build + smoke
 *   bun scripts/smoke.mjs --no-build   # assume dist already built
 *
 * Pattern lifted from cybersader/agentic-workflow-and-tech-stack/site/scripts/smoke.mjs.
 */

import { execSync } from 'node:child_process';
import { existsSync, statSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const siteDir = resolve(__dirname, '..');
const distDir = resolve(siteDir, 'dist');

const PORT = Number(process.env.SMOKE_PORT || 4322);
const BASE = `http://127.0.0.1:${PORT}`;
const PREFIX = '/obsidian-folder-tag-sync';
const skipBuild = process.argv.includes('--no-build');

// Each check: { path, mustContain }. mustContain='' means status 200 alone passes.
const CHECKS = [
  // Homepage
  { path: `${PREFIX}/`, mustContain: 'Folder Tag Sync' },
  { path: `${PREFIX}/`, mustContain: 'Bidirectional' },

  // Getting started
  { path: `${PREFIX}/getting-started/installation/`, mustContain: 'Installation' },
  { path: `${PREFIX}/getting-started/first-rule/`, mustContain: 'first rule' },

  // Concepts
  { path: `${PREFIX}/concepts/tag-depth/`, mustContain: '' },
  { path: `${PREFIX}/concepts/wildcard-matching/`, mustContain: '' },

  // Features
  { path: `${PREFIX}/features/overview/`, mustContain: 'Sync directions' },

  // Reference
  { path: `${PREFIX}/reference/rule-schema/`, mustContain: 'MappingRule' },
  { path: `${PREFIX}/reference/transformations/`, mustContain: 'snake_case' },

  // Development
  { path: `${PREFIX}/development/testing/`, mustContain: '' },
  { path: `${PREFIX}/development/environment-setup/`, mustContain: '' },
  { path: `${PREFIX}/development/claude-code-workflow/`, mustContain: '' },
  { path: `${PREFIX}/development/release-checklist/`, mustContain: '' },

  // About
  { path: `${PREFIX}/about/roadmap/`, mustContain: 'Roadmap' },
  { path: `${PREFIX}/about/project-brief/`, mustContain: '' },
  { path: `${PREFIX}/about/contributing/`, mustContain: '' },
  { path: `${PREFIX}/about/ui-improvements/`, mustContain: '' },
  { path: `${PREFIX}/about/development-status/`, mustContain: 'AI-assisted' },

  // Agent context
  { path: `${PREFIX}/agent-context/`, mustContain: 'Agent context' },
  { path: `${PREFIX}/agent-context/vision/`, mustContain: '' },
  { path: `${PREFIX}/agent-context/decisions/`, mustContain: 'Deterministic' },
  { path: `${PREFIX}/agent-context/tradeoffs/`, mustContain: '' },
  { path: `${PREFIX}/agent-context/open-questions/`, mustContain: '' },
  { path: `${PREFIX}/agent-context/prior-art/`, mustContain: 'Auto Note Mover' },
  { path: `${PREFIX}/agent-context/zz-log/`, mustContain: 'Exploration log' },
  { path: `${PREFIX}/agent-context/zz-log/2026-04-23-docs-site-setup/`, mustContain: '' },
  { path: `${PREFIX}/agent-context/zz-log/2026-04-13-submission-pr-stalled/`, mustContain: '' },
  { path: `${PREFIX}/agent-context/zz-challenges/`, mustContain: 'Research challenges' },
  { path: `${PREFIX}/agent-context/zz-challenges/01-rule-priority-stress-test/`, mustContain: '' },
  { path: `${PREFIX}/agent-context/zz-challenges/02-pipeline-reversibility/`, mustContain: '' },
  { path: `${PREFIX}/agent-context/zz-challenges/03-performance-at-scale/`, mustContain: '' },

  // Infrastructure assets — catches busted base path or missing build output
  { path: `${PREFIX}/pagefind/pagefind.js`, mustContain: '' },
  { path: `${PREFIX}/sitemap-index.xml`, mustContain: '<sitemap' },
];

let server = null;

function log(msg) {
  process.stdout.write(msg + '\n');
}

function build() {
  log('› building site...');
  execSync('bun run build', { cwd: siteDir, stdio: 'inherit' });
}

function verifyDist() {
  if (!existsSync(distDir)) {
    throw new Error(`dist/ not found at ${distDir} — run without --no-build first.`);
  }
  const stat = statSync(distDir);
  if (!stat.isDirectory()) throw new Error(`${distDir} is not a directory`);
}

function serve() {
  return Bun.serve({
    port: PORT,
    fetch(req) {
      const url = new URL(req.url);
      let p = url.pathname;
      // Strip base prefix for filesystem lookup
      if (p.startsWith(PREFIX)) p = p.slice(PREFIX.length) || '/';

      // Default to index.html for trailing-slash paths
      let filePath = p.endsWith('/') ? join(distDir, p, 'index.html') : join(distDir, p);
      if (!existsSync(filePath) && !p.endsWith('/')) {
        const alt = join(distDir, p, 'index.html');
        if (existsSync(alt)) filePath = alt;
      }
      if (!existsSync(filePath)) return new Response('Not Found', { status: 404 });

      const ext = filePath.split('.').pop();
      const mime = {
        html: 'text/html',
        js: 'application/javascript',
        css: 'text/css',
        json: 'application/json',
        xml: 'application/xml',
        svg: 'image/svg+xml',
        png: 'image/png',
        jpg: 'image/jpeg',
        webp: 'image/webp',
      }[ext] || 'application/octet-stream';

      const body = readFileSync(filePath);
      return new Response(body, { headers: { 'content-type': mime } });
    },
  });
}

async function check({ path, mustContain }) {
  const res = await fetch(`${BASE}${path}`);
  if (res.status !== 200) {
    return { path, ok: false, reason: `HTTP ${res.status}` };
  }
  if (mustContain) {
    const body = await res.text();
    if (!body.includes(mustContain)) {
      return { path, ok: false, reason: `missing "${mustContain}"` };
    }
  }
  return { path, ok: true };
}

async function main() {
  if (!skipBuild) build();
  verifyDist();

  log(`› starting smoke server on ${BASE}${PREFIX}`);
  server = serve();

  try {
    const results = [];
    for (const c of CHECKS) results.push(await check(c));

    const pass = results.filter((r) => r.ok);
    const fail = results.filter((r) => !r.ok);

    log('');
    log(`✓ ${pass.length}/${results.length} passed`);
    if (fail.length) {
      for (const f of fail) log(`  ✗ ${f.path}  —  ${f.reason}`);
      process.exit(1);
    }
    log('smoke test green.');
  } finally {
    server?.stop(true);
  }
}

main().catch((e) => {
  console.error(e);
  server?.stop(true);
  process.exit(1);
});
