// wdio-obsidian-service configuration for folder-tag-sync E2E tests.
//
// Starts a real Obsidian instance (downloaded + cached in .obsidian-cache/)
// against the sandbox test vault at test/vaults/basic, installs this plugin,
// and drives the UI via WebDriver. On Linux CI, the service runs Obsidian
// under xvfb so no display server is needed.
//
// Run:
//   bun run test:e2e           # all specs
//   bun run test:e2e test/specs/smoke.e2e.ts   # single spec

import * as path from 'node:path';
import { parseObsidianVersions } from 'wdio-obsidian-service';
import { env } from 'node:process';

const cacheDir = path.resolve('.obsidian-cache');

// Default to latest Obsidian only. Set OBSIDIAN_VERSIONS="1.6.0/1.6.0 latest/latest"
// to test across multiple versions.
const versions = await parseObsidianVersions(
  env.OBSIDIAN_VERSIONS ?? 'latest/latest',
  { cacheDir },
);

if (env.CI) {
  console.log('obsidian-cache-key:', JSON.stringify(versions));
}

export const config: WebdriverIO.Config = {
  runner: 'local',
  framework: 'mocha',

  specs: ['./test/specs/**/*.e2e.ts'],

  maxInstances: Number(env.WDIO_MAX_INSTANCES || 1),

  capabilities: versions.map<WebdriverIO.Capabilities>(
    ([appVersion, installerVersion]) => ({
      browserName: 'obsidian',
      'wdio:obsidianOptions': {
        appVersion,
        installerVersion,
        // "." tells the service to use THIS plugin (the repo we're in).
        // It's symlinked/copied into the test vault's .obsidian/plugins/.
        plugins: ['.'],
        vault: 'test/vaults/basic',
      },
    }),
  ),

  services: ['obsidian'],
  reporters: [['obsidian', { realtimeReporting: true }]],

  mochaOpts: {
    ui: 'bdd',
    timeout: 60 * 1000,
  },

  waitforInterval: 250,
  waitforTimeout: 5 * 1000,
  logLevel: 'warn',

  cacheDir,

  injectGlobals: false,
};
