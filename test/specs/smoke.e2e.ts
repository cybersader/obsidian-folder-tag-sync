import { browser, expect } from '@wdio/globals';
// `describe` / `it` come from wdio-mocha-framework's runtime-bound globals.
// Importing them from 'mocha' fails because the module's bindings aren't
// populated until mocha.run() — which happens AFTER tsx has loaded the spec.
declare const describe: (name: string, fn: () => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;

/**
 * Smoke test: Obsidian launches, the plugin loads and registers its commands.
 * If this fails, the e2e infrastructure itself is broken — nothing else will
 * work until this passes.
 */
describe('folder-tag-sync plugin — smoke', function () {
  it('is loaded and enabled in the test vault', async function () {
    const info = await browser.executeObsidian(({ app }) => {
      const plugins = (app as unknown as {
        plugins: { plugins: Record<string, unknown>; enabledPlugins: Set<string> };
      }).plugins;
      return {
        enabled: plugins.enabledPlugins.has('folder-tag-sync'),
        instance: 'folder-tag-sync' in plugins.plugins,
      };
    });

    expect(info.enabled).toBe(true);
    expect(info.instance).toBe(true);
  });

  it('registers its sync commands', async function () {
    const commandIds = await browser.executeObsidian(({ app }) => {
      const commands = (app as unknown as {
        commands: { commands: Record<string, unknown> };
      }).commands.commands;
      return Object.keys(commands).filter((id) => id.startsWith('folder-tag-sync:'));
    });

    // At minimum we expect the manual sync commands defined in main.ts
    expect(commandIds.length).toBeGreaterThan(0);
  });
});
