---
title: Getting wdio-obsidian-service running
description: Session log documenting the setup of WebDriver-based E2E tests for the plugin — what worked, what broke, and what to do differently next time.
tags: [testing, e2e, wdio, infrastructure]
sidebar:
  label: "04-24 · wdio setup"
  order: -20260424001
date: 2026-04-24
---

## What this session delivered

Working end-to-end testing for the plugin: a real Obsidian instance launches against a sandbox vault, the plugin loads, and the first smoke spec asserts plugin + command registration. Runs locally (with xvfb) and in GitHub Actions on every push/PR.

Files touched in the plugin repo:

- `wdio.conf.mts` — service config (Mocha framework, Obsidian capability, latest-version default)
- `test/vaults/basic/` — sandbox vault wdio copies per run
- `test/specs/smoke.e2e.ts` — first spec: plugin is loaded + commands registered
- `.github/workflows/e2e.yml` — CI job with xvfb + cached Obsidian binaries
- `package.json` scripts: `test:e2e`, `test:e2e:setup`
- `.gitignore`: `.obsidian-cache/`, `wdio-logs/`, `.wdio/`

## Landmines hit (in order)

### 1. "Obsidian headless" is not a headless Obsidian

The repo `obsidianmd/obsidian-headless` is a **CLI client for Obsidian Sync/Publish**, not a headless GUI for plugin testing. Spent research cycles assuming it was the latter. For plugin E2E, `wdio-obsidian-service` is the right choice — it handles headless display via xvfb internally.

Captured separately in the workflow inbox so this doesn't repeat.

### 2. Mocha 11 broke `injectGlobals: false`

Installed latest (`mocha@11.7.5`) by default. WDIO specs use `injectGlobals: false` + named imports:

```ts
import { describe, it } from 'mocha';
```

Mocha 11 made a breaking change such that the named `describe` export doesn't work standalone without a pre-initialized runner. Result: `TypeError: Cannot read properties of undefined (reading 'describe')` at spec parse time.

Fix: pin `mocha@^10.8.2` to match `wdio-obsidian-service-sample-plugin`. Chai also pinned to `^5.3.3` for the same reason.

### 3. Missing `wdio-obsidian-reporter` as separate package

`reporters: ['obsidian']` in wdio.conf expects a package named `wdio-obsidian-reporter`. The service (`wdio-obsidian-service`) doesn't bundle it. First run errored with:

```
Couldn't find plugin "obsidian" reporter, neither as wdio scoped package
"@wdio/obsidian-reporter" nor as community package "wdio-obsidian-reporter".
```

Fix: `bun add -d wdio-obsidian-reporter`.

### 4. `@wdio/globals` `expect` is not chai `expect`

Wrote asserts as:

```ts
expect(info.enabled, 'friendly failure message').toBe(true);
```

This is **chai syntax**. WDIO's expect matcher does not accept a second argument. CI output: `Expect takes at most one argument.`

Fix: drop the second arg.

```ts
expect(info.enabled).toBe(true);
```

For contextual failure messages, prefer an explicit assertion message in the test name or use a separate chai import.

### 5. Standalone `.mocharc.json` conflicted with wdio

Dropped `.mocharc.json` with a `"loader": "ts-node/esm"` override, thinking I needed to tell mocha how to load TypeScript. But wdio's mocha integration uses `tsx` internally, and the external mocharc overrode it in a way that broke spec loading. For unit tests (`mocha` invoked directly), mocharc is useful — for wdio, all mocha config goes in `wdio.conf.mts` under `mochaOpts`.

Fix: deleted `.mocharc.json`. wdio handles everything.

### 6. `bun.lock` must be committed alongside deps

After `bun add -d ...`, `bun.lock` updated. Committed the new scripts + config but forgot the lockfile. CI failed immediately with `lockfile had changes, but lockfile is frozen`.

Always `git add bun.lock` when deps change.

### 7. Local WSL lacks a display server

`DISPLAY` and `WAYLAND_DISPLAY` are both empty on a plain WSL2 install. Obsidian's GUI won't start without one. wdio-xvfb's auto-install hint says to try `xvfbAutoInstall: true` in config, but that still needs sudo.

Fix: one-time manual install of `xvfb` for local e2e runs. CI's Ubuntu runner installs it in the workflow step. On a WSL2 with WSLg enabled (GUI-on-Windows), you may not need xvfb at all.

## What stayed easy

- First spec pattern lifted from the sample plugin worked after fixing the landmines above
- Caching the Obsidian binary with `actions/cache@v4` is one step; avoids ~200MB re-download on every CI run
- `browser.executeObsidian(({ app }) => ...)` is the key primitive — Obsidian's App is the entry point to everything the plugin can observe
- Running alongside the existing `tests.yml` workflow (unit tests) gives clean layering: unit → e2e in two separate jobs, paths-ignore keeps docs changes from triggering either

## What's next

- Add a "fixtures generate + rule sync" e2e spec that installs the fixtures plugin alongside, runs its "Generate PARA fixture set" + "Apply preset rules" commands, then verifies folder→tag sync produces the expected tags
- Multi-version matrix (`OBSIDIAN_VERSIONS="1.6.0/1.6.0 latest/latest"`) once we care about back-compat
- Mobile emulation (sample plugin shows the pattern in `wdio.mobile.conf.mts`) — low priority since this plugin is already desktop-focused

## References

- Service repo: `jesse-r-s-hines/wdio-obsidian-service`
- Sample plugin (authoritative template): `jesse-r-s-hines/wdio-obsidian-service-sample-plugin`
- Service API docs: `https://jesse-r-s-hines.github.io/wdio-obsidian-service/wdio-obsidian-service/README.html`
