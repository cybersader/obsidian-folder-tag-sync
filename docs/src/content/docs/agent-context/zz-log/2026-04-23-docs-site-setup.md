---
title: Docs site setup
description: Scaffolded Astro Starlight docs site, Playwright tests, visual harness. Caught and fixed Nova theme Tailwind regression.
tags: [docs, testing, infrastructure]
sidebar:
  label: "04-23 · Docs site setup"
  order: -20260423000
date: 2026-04-23
---

## What happened

### Scaffolded docs site

Mirrored crosswalker's pattern: Astro 6 + Starlight 0.38 + Bun + Nova theme + Tailwind v4.

Created `docs/` with:

- `astro.config.mjs` — Starlight config with Nova theme, site-graph, image-zoom, heading-badges, obsidian-callout, wiki-link plugins
- `src/content/docs/` — sections for getting-started, concepts, features, reference, development, about
- `src/styles/brand.css` — proactive UX fixes ported from crosswalker (Nova overflow, content width clamp, sidebar tuning, font scale)
- `public/favicon.svg`
- `tests/` — Playwright smoke, ux-regression, deployment specs
- `scripts/` — `smoke.mjs`, `visual.mjs` (both ported pattern-wise from portaconv)

Seeded content from the existing repo-root `.md` files (README, PROJECT_BRIEF, FEATURE_ROADMAP, TAG_DEPTH_NUANCE, WILDCARD_MATCHING_CHALLENGE, TESTING_GUIDE, CLAUDE_CODE_WORKFLOW, ENVIRONMENT_SETUP, RELEASE_CHECKLIST, UI_IMPROVEMENTS_SUMMARY, CONTRIBUTING) with Starlight frontmatter.

### Built testing harness

Three layers of feedback speed:

| Layer | Command | Time |
|---|---|---|
| Bun smoke | `bun run smoke` | ~15s |
| Playwright smoke | `bun run test:smoke` | ~50s |
| UX regression | `bun run test:ux` | ~45s |
| Visual harness | `bun run visual` | ~90s |

`visual.mjs` screenshots all 10 key pages at 4 viewports (mobile / tablet / desktop / wide), writes a `report.md` with console errors, horizontal scroll, failed requests per page/viewport combination.

### Caught a silent Nova regression

First visual run revealed the mobile layout was completely broken — sidebar nav was rendering inline with main content, pushing the h1 halfway down the page. Programmatic smoke tests passed; no console errors; no overflow. Only visual inspection found it.

**Root cause:** `global.css` was `@import 'tailwindcss'` only. Missing the `@source` directives that tell Tailwind v4 to scan Nova's source tree:

```css
@source '../../node_modules/starlight-theme-nova/src';
@source '../../node_modules/starlight-theme-nova/components';
```

Without those, Tailwind strips Nova's utility classes (`invisible`, `md:visible`, `fixed`, etc.) from the build. Nova's sidebar still *has* the classes in its HTML, but the CSS rules don't exist — so `visibility: hidden` never applies on mobile.

**Fix:** Added the two `@source` lines. Sidebar now computes `visibility: hidden` at mobile as expected.

**Regression guard:** Added a new test group in `ux-regression.spec.ts` — "Tailwind @source includes Nova" — that asserts:

- Mobile: `#starlight__sidebar` computes `visibility: hidden`
- Desktop: same element computes `visibility: visible`
- Mobile: h1 is within 200px of viewport top (bleed guard)

If anyone removes the `@source` lines again, the test fails with a message pointing directly at `global.css`.

### Aligned with canonical project patterns

Cross-referenced against actual projects (crosswalker, cyberbaser, portaconv, portagenty, obsidian-daily-notes-ng, tasknotes) — not the workflow meta repos.

Ported:

- `scripts/serve.mjs` (from portaconv) — interactive dev server with dev/preview/build/tailscale/cloudflare modes
- `scripts/preflight.mjs` (from cyberbaser) — WSL↔Windows binary-stub resolver

Wired preflight into every astro command (`"build": "bun run preflight && astro build"`, etc.) following cyberbaser's pattern.

Aligned `.github/workflows/deploy-docs.yml` with portaconv's canonical:

- Triggers on PR (build + test + smoke without deploy)
- `--frozen-lockfile` install
- `actions/configure-pages@v5` step
- `FORCE_JAVASCRIPT_ACTIONS_TO_NODE24` env var
- Deploy job gated to main branch only

## Final state

- Bun smoke: **19/19** pass
- Playwright: **42/42** pass (2 git-gated skipped until first commit)
- Visual harness: **40 captures**, 0 issues
- Build time: ~20s for a clean build

## Deployment

Committed and pushed as `eb7b4ef` on 2026-04-24. First push-triggered run failed at the `configure-pages` step because GitHub Pages hadn't been enabled yet. After the user enabled Pages (Settings → Pages → Source: GitHub Actions), a re-triggered `workflow_dispatch` run succeeded and the site went live at:

**https://cybersader.github.io/obsidian-folder-tag-sync/**

All 44 Playwright tests passed in CI (the 2 git-gated `lastUpdated` tests skipped locally now pass in CI, where the files have git history).

## Next priorities

- Take plugin screenshots, add them to the docs (currently no images)
- Add `zz-research/` if we accumulate research briefs
- Wire `preflight` into CI as well (currently only local)
