import { browser, expect } from '@wdio/globals';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

/**
 * E2E for the Taxonomy Workbench map "Sensing" slice — the "my rules" layer.
 *
 * The base `workbench-map.e2e.ts` proves the pane renders the DETECTED-systems
 * hierarchy. This sibling proves the new layer: with an installed rule injected
 * into settings (the `folder-tag-idempotency.e2e.ts` injection pattern), the
 * map annotates a covered folder with a "my rules" EMISSION chip, exposes the
 * "Open settings" round-trip affordance, and serves a right-click context menu
 * with the expected items — all in a REAL Obsidian.
 *
 * Strategy:
 *   - `before` injects a forward rule matching the `SensingTest/` fixture and
 *     materializes the fixture folders via the adapter (TFolders appear once
 *     the adapter sees the directory).
 *   - `after` restores the prior rules, removes the fixture, and detaches the
 *     workbench leaf so later specs see a clean vault + workspace.
 */

const FOLDER = 'SensingTest';

// Minimal forward rule that emits a tag for SensingTest/* (mirrors the
// idempotency spec's rule shape). SensingTest → #sensingtest;
// SensingTest/Web → #sensingtest/web.
const RULE = {
	id: 'e2e-sensing-rule',
	name: 'E2E sensing rule',
	enabled: true,
	priority: 5,
	direction: 'folder-to-tag',
	folderPattern: '^SensingTest(?:/|$)',
	folderEntryPoint: 'SensingTest',
	folderTransforms: { caseTransform: 'kebab-case', emojiHandling: 'keep' },
	tagEntryPoint: 'sensingtest',
	tagTransforms: { caseTransform: 'kebab-case', emojiHandling: 'keep' },
	options: {
		createFolders: true, addTags: true, removeOrphanedTags: false,
		syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true,
	},
};

describe('Taxonomy Workbench map — "my rules" sensing layer', function () {
	this.timeout(60_000);

	before(async function () {
		await browser.executeObsidian(async ({ app }, rule, folder) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { rules: unknown[] }; saveSettings: () => Promise<void> }> } }).plugins.plugins['folder-tag-sync'];
			// Stash + inject the rule so the map's folderRuleView covers the fixture.
			(globalThis as unknown as { __sensingPrevRules?: unknown[] }).__sensingPrevRules = plugin.settings.rules;
			plugin.settings.rules = [rule];
			await plugin.saveSettings();

			const adapter = app.vault.adapter;
			for (const f of [folder, `${folder}/Web`]) {
				if (!(await adapter.exists(f))) await adapter.mkdir(f);
				const placeholder = `${f}/_placeholder.md`;
				if (!(await adapter.exists(placeholder))) await adapter.write(placeholder, '# placeholder');
			}
			await new Promise((r) => setTimeout(r, 500));
		}, RULE, FOLDER);
	});

	after(async function () {
		await browser.executeObsidian(async ({ app }, folder) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { rules: unknown[] }; saveSettings: () => Promise<void> }> } }).plugins.plugins['folder-tag-sync'];
			const prev = (globalThis as unknown as { __sensingPrevRules?: unknown[] }).__sensingPrevRules;
			if (prev) { plugin.settings.rules = prev; await plugin.saveSettings(); }
			// Remove any lingering context menus we popped open.
			document.querySelectorAll('.menu').forEach((m) => m.remove());
			const adapter = app.vault.adapter;
			if (await adapter.exists(folder)) await adapter.rmdir(folder, true);
		}, FOLDER);
	});

	it('opens the map with the injected rule in effect', async function () {
		const cmdOk = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as { commands: { executeCommandById: (id: string) => boolean } }).commands;
			return commands.executeCommandById('folder-tag-sync:taxonomy-workbench-open-map');
		});
		expect(cmdOk).toBe(true);
		await browser.pause(1500);

		const leafCount = await browser.executeObsidian(({ app }) =>
			app.workspace.getLeavesOfType('taxonomy-workbench-map').length,
		);
		expect(leafCount).toBeGreaterThanOrEqual(1);
	});

	it('(a) renders a "my rules" emission annotation for a covered folder', async function () {
		const info = await browser.executeObsidian(() => {
			const map = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
			if (!map) return { hasMap: false, hasEmission: false, emissionText: '' };
			// The covered fixture row carries the green emission chip.
			const row = map.querySelector<HTMLElement>('[data-dtf-folder-path="SensingTest"]');
			const emission = (row ?? map).querySelector<HTMLElement>('[data-dtf-rule-emission="1"]');
			return {
				hasMap: true,
				hasEmission: Boolean(emission),
				emissionText: emission?.textContent ?? '',
			};
		});
		expect(info.hasMap).toBe(true);
		expect(info.hasEmission).toBe(true);
		// Chip reads "→ #sensingtest" (the winning rule's emission for this folder).
		expect(info.emissionText).toContain('#sensingtest');
	});

	it('(b) exposes the "Open settings" round-trip affordance', async function () {
		const hasBtn = await browser.executeObsidian(() =>
			Boolean(document.querySelector('[data-dtf-open-settings="1"]')),
		);
		expect(hasBtn).toBe(true);
	});

	it('(c) right-click on a covered folder row yields the context-menu items', async function () {
		const titles = await browser.executeObsidian(() => {
			const map = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
			const row = map?.querySelector<HTMLElement>('[data-dtf-folder-path="SensingTest"]');
			if (!row) return [];
			row.dispatchEvent(new MouseEvent('contextmenu', {
				bubbles: true, cancelable: true, clientX: 12, clientY: 12,
			}));
			return Array.from(document.querySelectorAll('.menu-item-title')).map((n) => n.textContent ?? '');
		});
		expect(titles).toContain('Show rules affecting this folder');
		expect(titles).toContain('Open Folder Tag Sync settings');
		expect(titles).toContain('Preview sync for this folder');

		// Close the popped menu so it can't overlay later specs.
		await browser.executeObsidian(() => {
			document.querySelectorAll('.menu').forEach((m) => m.remove());
		});
	});

	it('detaching the leaf cleans up', async function () {
		await browser.executeObsidian(({ app }) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
		});
		await browser.pause(400);
		const stillOpen = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map').length;
			const dom = document.querySelector('[data-dtf-workbench-map="1"]');
			return { leaves, hasDom: Boolean(dom) };
		});
		expect(stillOpen.leaves).toBe(0);
		expect(stillOpen.hasDom).toBe(false);
	});
});
