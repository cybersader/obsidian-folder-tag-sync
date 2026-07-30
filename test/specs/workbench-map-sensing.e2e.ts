import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

/**
 * E2E for the Workbench Map "my rules" layer. In addition to neutral emission
 * and explicit conflict assertions, this proves that context-menu actions have visible button
 * equivalents for click/touch users and that the consolidated shell remains
 * usable at a narrow desktop/mobile-like width.
 */

const SCREENSHOT_DIR = path.resolve('test/screenshots');
const FOLDER = 'SensingTest';
const LONG_FOLDER = `${FOLDER}/This is an intentionally very long Workbench branch name that must remain readable without horizontal clipping`;
const FIXTURE_FOLDERS = [FOLDER, `${FOLDER}/Web`, LONG_FOLDER];

let originalWindowSize: { width: number; height: number } | null = null;

async function snap(name: string): Promise<void> {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

async function resizeWindow(width: number, height: number): Promise<void> {
	await browser.executeObsidian((_context, size) => {
		window.resizeTo(size.width, size.height);
	}, { width, height });
	await browser.pause(200);
}

async function waitForSurface(surface: 'map' | 'scope'): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian((_context, expected) => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		if (shell?.dataset.dtfWorkbenchCurrentSurface !== expected) return false;
		return expected === 'map'
			? Boolean(shell.querySelector('[data-dtf-workbench-map="1"]'))
			: Boolean(shell.querySelector('[data-dtf-workbench-scope="1"]'));
	}, surface), {
		timeout: 10_000,
		timeoutMsg: `Workbench did not finish routing to ${surface}`,
	});
}

// Minimal forward rule that emits a tag for SensingTest/*.
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

const CONFLICT_RULE = {
	...RULE,
	id: 'e2e-sensing-conflict-rule',
	name: 'E2E secondary sensing rule',
	priority: 50,
	tagEntryPoint: 'sensing-secondary',
};

describe('Taxonomy Workbench map — "my rules" sensing and touch actions', function () {
	this.timeout(90_000);

	before(async function () {
		originalWindowSize = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		await browser.executeObsidian(async ({ app }, rule, folders) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[] };
					saveSettings: () => Promise<void>;
				}> };
			}).plugins.plugins['folder-tag-sync'];
			(globalThis as unknown as { __sensingPrevRules?: unknown[] }).__sensingPrevRules = plugin.settings.rules;
			plugin.settings.rules = [rule];
			await plugin.saveSettings();

			const adapter = app.vault.adapter;
			for (const folder of folders) {
				if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
				const placeholder = `${folder}/_placeholder.md`;
				if (!(await adapter.exists(placeholder))) await adapter.write(placeholder, '# placeholder');
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}, RULE, FIXTURE_FOLDERS);
	});

	after(async function () {
		if (originalWindowSize) {
			await resizeWindow(originalWindowSize.width, originalWindowSize.height);
		}
		await browser.executeObsidian(async ({ app }, folder) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const setting = (app as unknown as { setting?: { close(): void } }).setting;
			setting?.close();
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[] };
					saveSettings: () => Promise<void>;
				}> };
			}).plugins.plugins['folder-tag-sync'];
			const globals = globalThis as unknown as { __sensingPrevRules?: unknown[] };
			if (globals.__sensingPrevRules) {
				plugin.settings.rules = globals.__sensingPrevRules;
				await plugin.saveSettings();
			}
			delete globals.__sensingPrevRules;
			document.querySelectorAll('.menu, .notice').forEach((element) => element.remove());
			const adapter = app.vault.adapter;
			if (await adapter.exists(folder)) await adapter.rmdir(folder, true);
		}, FOLDER);
	});

	it('opens one consolidated Workbench leaf with the injected rule in effect', async function () {
		const cmdOk = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			}).commands;
			return commands.executeCommandById('folder-tag-sync:taxonomy-workbench-open-map');
		});
		expect(cmdOk).toBe(true);
		await waitForSurface('map');

		const info = await browser.executeObsidian(({ app }) => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			const map = shell?.querySelector('[data-dtf-workbench-map="1"]');
			return {
				leafCount: app.workspace.getLeavesOfType('taxonomy-workbench-map').length,
				hasShell: Boolean(shell),
				hasMap: Boolean(map),
				hasDetectTree: Boolean(map?.querySelector('[data-dtf-detect-tree="1"]')),
			};
		});
		expect(info).toEqual({ leafCount: 1, hasShell: true, hasMap: true, hasDetectTree: false });
	});

	it('recollects settings changes when the map command reuses the existing leaf', async function () {
		const setRuleEnabledAndOpenMap = async (enabled: boolean): Promise<void> => {
			await browser.executeObsidian(async ({ app }, nextEnabled: boolean) => {
				const plugin = (app as unknown as {
					plugins: { plugins: Record<string, {
						settings: { rules: Array<{ id: string; enabled: boolean }> };
						saveSettings: () => Promise<void>;
					}> };
					commands: { executeCommandById: (id: string) => boolean };
				}).plugins.plugins['folder-tag-sync'];
				const rule = plugin.settings.rules.find((candidate) => candidate.id === 'e2e-sensing-rule');
				if (!rule) throw new Error('Missing E2E sensing rule');
				rule.enabled = nextEnabled;
				await plugin.saveSettings();
				(app as unknown as {
					commands: { executeCommandById: (id: string) => boolean };
				}).commands.executeCommandById('folder-tag-sync:taxonomy-workbench-open-map');
			}, enabled);
		};

		await setRuleEnabledAndOpenMap(false);
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			!document.querySelector('[data-dtf-folder-path="SensingTest"] [data-dtf-rule-emission="1"]'),
		), { timeout: 8_000, timeoutMsg: 'Reused Map leaf kept stale enabled-rule coverage' });

		await setRuleEnabledAndOpenMap(true);
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			Boolean(document.querySelector('[data-dtf-folder-path="SensingTest"] [data-dtf-rule-emission="1"]')),
		), { timeout: 8_000, timeoutMsg: 'Reused Map leaf did not recollect re-enabled rule coverage' });

		const leafCount = await browser.executeObsidian(({ app }) =>
			app.workspace.getLeavesOfType('taxonomy-workbench-map').length,
		);
		expect(leafCount).toBe(1);
	});

	it('renders a "my rules" emission and folder detail for a covered branch', async function () {
		const info = await browser.executeObsidian(() => {
			const map = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
			const row = map?.querySelector<HTMLElement>('[data-dtf-folder-path="SensingTest"]');
			const emission = row?.querySelector<HTMLElement>('[data-dtf-rule-emission="1"]');
			const probe = document.createElement('span');
			probe.style.background = 'var(--background-secondary-alt)';
			probe.style.color = 'var(--text-muted)';
			probe.style.border = '1px solid var(--background-modifier-border)';
			document.body.appendChild(probe);
			const emissionStyle = emission ? getComputedStyle(emission) : null;
			const probeStyle = getComputedStyle(probe);
			const neutralStyle = Boolean(emissionStyle)
				&& emissionStyle!.backgroundColor === probeStyle.backgroundColor
				&& emissionStyle!.color === probeStyle.color
				&& emissionStyle!.borderColor === probeStyle.borderColor;
			probe.remove();
			row?.click();
			return {
				hasMap: Boolean(map),
				hasEmission: Boolean(emission),
				emissionText: emission?.textContent ?? '',
				neutralStyle,
				hasConflict: Boolean(row?.querySelector('[data-dtf-rule-conflict="1"]')),
			};
		});
		expect(info.hasMap).toBe(true);
		expect(info.hasEmission).toBe(true);
		expect(info.emissionText).toContain('#sensingtest');
		expect(info.neutralStyle).toBe(true);
		expect(info.hasConflict).toBe(false);

		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const detail = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]');
			return detail?.style.display === 'block' && (detail.textContent ?? '').includes('E2E sensing rule');
		}), { timeout: 5_000, timeoutMsg: 'Covered folder detail did not open' });

		const detail = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0];
			const state = leaf?.view.getState() as unknown as { detailPath?: string | null };
			const panel = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]');
			return {
				detailPath: state?.detailPath ?? null,
				text: panel?.textContent ?? '',
			};
		});
		expect(detail.detailPath).toBe(FOLDER);
		expect(detail.text).toContain('Winning rule: E2E sensing rule');
		expect(detail.text).toContain('Would emit: #sensingtest');
	});

	it('labels multiple matching rules with explicit Conflict text', async function () {
		await browser.executeObsidian(async ({ app }, conflictRule) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[] };
					saveSettings: () => Promise<void>;
				}> };
				commands: { executeCommandById: (id: string) => boolean };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings.rules = [plugin.settings.rules[0], conflictRule];
			await plugin.saveSettings();
			(app as unknown as { commands: { executeCommandById: (id: string) => boolean } })
				.commands.executeCommandById('folder-tag-sync:taxonomy-workbench-open-map');
		}, CONFLICT_RULE);

		await browser.waitUntil(async () => browser.executeObsidian(() =>
			Boolean(document.querySelector('[data-dtf-folder-path="SensingTest"] [data-dtf-rule-conflict="1"]')),
		), { timeout: 8_000, timeoutMsg: 'Conflict badge did not appear after adding a second matching rule' });

		const conflict = await browser.executeObsidian(() => {
			const badge = document.querySelector<HTMLElement>(
				'[data-dtf-folder-path="SensingTest"] [data-dtf-rule-conflict="1"]',
			);
			return {
				text: badge?.textContent?.trim() ?? '',
				ariaLabel: badge?.getAttribute('aria-label') ?? '',
				color: badge?.style.color ?? '',
			};
		});
		expect(conflict.text).toBe('Conflict');
		expect(conflict.ariaLabel).toContain('e2e-sensing-rule');
		expect(conflict.ariaLabel).toContain('e2e-sensing-conflict-rule');
		expect(conflict.ariaLabel).toContain('Predicted winner: E2E sensing rule');
		expect(conflict.color).toBe('var(--text-warning)');

		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[] };
					saveSettings: () => Promise<void>;
				}> };
				commands: { executeCommandById: (id: string) => boolean };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings.rules = plugin.settings.rules.filter((rule) =>
				(rule as { id?: string }).id !== 'e2e-sensing-conflict-rule');
			await plugin.saveSettings();
			(app as unknown as { commands: { executeCommandById: (id: string) => boolean } })
				.commands.executeCommandById('folder-tag-sync:taxonomy-workbench-open-map');
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			!document.querySelector('[data-dtf-folder-path="SensingTest"] [data-dtf-rule-conflict="1"]'),
		), { timeout: 8_000, timeoutMsg: 'Conflict badge remained after restoring one matching rule' });
	});

	it('keeps the Open settings header affordance and exposes every context-menu action', async function () {
		const info = await browser.executeObsidian(() => {
			const map = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
			const row = map?.querySelector<HTMLElement>('[data-dtf-folder-path="SensingTest"]');
			row?.dispatchEvent(new MouseEvent('contextmenu', {
				bubbles: true, cancelable: true, clientX: 12, clientY: 12,
			}));
			return {
				hasOpenSettings: Boolean(document.querySelector('[data-dtf-open-settings="1"]')),
				titles: Array.from(document.querySelectorAll('.menu-item-title'))
					.map((node) => node.textContent ?? ''),
			};
		});
		expect(info.hasOpenSettings).toBe(true);
		expect(info.titles).toContain('Show rules affecting this folder');
		expect(info.titles).toContain('Open Folder Tag Sync settings');
		expect(info.titles).toContain('Preview emitted tags');
		expect(info.titles).toContain('Choose this branch in scope');

		await browser.executeObsidian(() => {
			document.querySelectorAll('.menu').forEach((menu) => menu.remove());
		});
	});

	it('duplicates preview, Settings, and choose-branch context actions as visible click/touch buttons', async function () {
		const buttons = await browser.executeObsidian(() => {
			const detail = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]');
			const expected = [
				'Open settings for the winning rule',
				'Preview emitted tags',
				'Choose this branch in scope',
			];
			return expected.map((label) => {
				const button = Array.from(detail?.querySelectorAll<HTMLButtonElement>('button') ?? [])
					.find((candidate) => candidate.textContent?.trim() === label);
				const rect = button?.getBoundingClientRect();
				return {
					label,
					found: Boolean(button),
					visible: Boolean(button && button.offsetParent && rect && rect.width > 0 && rect.height > 0),
				};
			});
		});
		expect(buttons).toEqual([
			{ label: 'Open settings for the winning rule', found: true, visible: true },
			{ label: 'Preview emitted tags', found: true, visible: true },
			{ label: 'Choose this branch in scope', found: true, visible: true },
		]);

		await browser.executeObsidian(() => {
			document.querySelectorAll('.notice').forEach((notice) => notice.remove());
			document.querySelector<HTMLButtonElement>('[data-dtf-preview-emitted-tags="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			Array.from(document.querySelectorAll('.notice'))
				.some((notice) => (notice.textContent ?? '').includes('SensingTest → #sensingtest')),
		), { timeout: 5_000, timeoutMsg: 'Preview emitted-tags notice did not appear' });

		const settingsClicked = await browser.executeObsidian(() => {
			const detail = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]');
			const button = Array.from(detail?.querySelectorAll<HTMLButtonElement>('button') ?? [])
				.find((candidate) => candidate.textContent?.trim() === 'Open settings for the winning rule');
			button?.click();
			return Boolean(button);
		});
		expect(settingsClicked).toBe(true);
		await browser.pause(150);

		const settings = await browser.executeObsidian(() => {
			const rule = document.querySelector<HTMLElement>('[data-dtf-rule-id="e2e-sensing-rule"]');
			return {
				hasMappingRules: document.body.textContent?.includes('Mapping rules') ?? false,
				hasFocusedRule: Boolean(rule),
				outline: rule?.style.outline ?? '',
			};
		});
		expect(settings.hasMappingRules).toBe(true);
		expect(settings.hasFocusedRule).toBe(true);
		expect(settings.outline).toContain('solid');

		await browser.executeObsidian(({ app }) => {
			(app as unknown as { setting: { close(): void } }).setting.close();
		});
		await browser.pause(100);

		const scopeClicked = await browser.executeObsidian(() => {
			const button = document.querySelector<HTMLButtonElement>('[data-dtf-choose-branch-in-scope="1"]');
			button?.click();
			return Boolean(button);
		});
		expect(scopeClicked).toBe(true);
		await waitForSurface('scope');

		const scope = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map');
			const state = leaves[0]?.view.getState() as unknown as {
				surface: string;
				scope: { selectedPaths: string[] };
				detailPath: string | null;
			};
			return { leafCount: leaves.length, state };
		});
		expect(scope.leafCount).toBe(1);
		expect(scope.state).toMatchObject({
			surface: 'scope',
			scope: { selectedPaths: [FOLDER] },
			detailPath: FOLDER,
		});

		const mapClicked = await browser.executeObsidian(() => {
			const button = document.querySelector<HTMLButtonElement>('[data-dtf-workbench-surface-button="map"]');
			button?.click();
			return Boolean(button);
		});
		expect(mapClicked).toBe(true);
		await waitForSurface('map');
		const returned = await browser.executeObsidian(({ app }) => {
			const leaf = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0];
			const state = leaf?.view.getState() as unknown as { detailPath: string | null };
			return {
				detailPath: state.detailPath,
				hasDetail: document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]')
					?.style.display === 'block',
				hasDetectTree: Boolean(document.querySelector('[data-dtf-detect-tree="1"]')),
			};
		});
		expect(returned).toEqual({ detailPath: FOLDER, hasDetail: true, hasDetectTree: false });
	});

	it('keeps surface navigation, long paths, and actions visible near 480 CSS px without horizontal clipping', async function () {
		const restore = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		const sidebarState = await browser.executeObsidian(({ app }) => {
			const workspace = app.workspace as unknown as {
				leftSplit?: { collapsed: boolean; collapse(): void };
				rightSplit?: { collapsed: boolean; collapse(): void };
			};
			const state = {
				leftCollapsed: workspace.leftSplit?.collapsed ?? true,
				rightCollapsed: workspace.rightSplit?.collapsed ?? true,
			};
			workspace.leftSplit?.collapse();
			workspace.rightSplit?.collapse();
			return state;
		});
		try {
			await resizeWindow(480, 900);

			const rulesClicked = await browser.executeObsidian(() => {
				const button = document.querySelector<HTMLButtonElement>('[data-dtf-mode="rules"]');
				button?.click();
				return Boolean(button);
			});
			expect(rulesClicked).toBe(true);
			await waitForSurface('map');

			const rowClicked = await browser.executeObsidian((_context, longFolder) => {
				const row = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${longFolder}"]`);
				row?.click();
				return Boolean(row);
			}, LONG_FOLDER);
			expect(rowClicked).toBe(true);
			await browser.pause(100);

			const layout = await browser.executeObsidian((_context, longFolder) => {
				document.querySelectorAll('.notice').forEach((notice) => notice.remove());
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const nav = shell?.querySelector<HTMLElement>('[data-dtf-workbench-surface-nav="1"]');
				const body = shell?.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
				const panel = shell?.querySelector<HTMLElement>('.dtf-workbench-active-panel');
				const map = shell?.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
				const row = map?.querySelector<HTMLElement>(`[data-dtf-folder-path="${longFolder}"]`);
				const detail = shell?.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]');
				detail?.scrollIntoView({ block: 'end', inline: 'nearest' });
				if (detail) detail.scrollTop = detail.scrollHeight;
				const shellRect = shell?.getBoundingClientRect();
				const mapRect = map?.getBoundingClientRect();
				const rowRect = row?.getBoundingClientRect();
				const navButtons = Array.from(
					nav?.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-surface-button]') ?? [],
				);
				const actionButtons = Array.from(detail?.querySelectorAll<HTMLButtonElement>('button') ?? [])
					.filter((button) => [
						'Open settings for the winning rule',
						'Preview emitted tags',
						'Choose this branch in scope',
					].includes(button.textContent?.trim() ?? ''));
				const insideShell = (element: HTMLElement): boolean => {
					const rect = element.getBoundingClientRect();
					return Boolean(shellRect)
						&& rect.width > 0
						&& rect.height > 0
						&& rect.left >= shellRect!.left - 1
						&& rect.right <= shellRect!.right + 1;
				};
				return {
					innerWidth: window.innerWidth,
					hasShell: Boolean(shell),
					hasMap: Boolean(map),
					hasSummary: Boolean(shell?.querySelector('[data-dtf-systems-summary="1"]')),
					browserExpanded: shell?.querySelector('[data-dtf-systems-browser-toggle="1"]')
						?.getAttribute('aria-expanded') ?? null,
					activeHeightRatio: body && panel && body.clientHeight > 0
						? panel.clientHeight / body.clientHeight
						: 0,
					hasDetectTree: Boolean(map?.querySelector('[data-dtf-detect-tree="1"]')),
					shellFits: Boolean(shell && shell.scrollWidth <= shell.clientWidth + 1),
					mapInsideShell: Boolean(shellRect && mapRect && mapRect.right <= shellRect.right + 1),
					longRowVisible: Boolean(row && row.offsetParent && rowRect && rowRect.width > 0),
					longRowFits: Boolean(mapRect && rowRect && rowRect.right <= mapRect.right + 1),
					longPathInDetail: (detail?.textContent ?? '').includes(longFolder),
					navButtonCount: navButtons.length,
					navButtonsFit: navButtons.every(insideShell),
					actionButtonCount: actionButtons.length,
					actionButtonsFit: actionButtons.every(insideShell),
					actionButtonsInViewport: actionButtons.every((button) => {
						const rect = button.getBoundingClientRect();
						return rect.top >= 0 && rect.bottom <= window.innerHeight;
					}),
				};
			}, LONG_FOLDER);
			expect(layout.innerWidth).toBeGreaterThanOrEqual(430);
			expect(layout.innerWidth).toBeLessThanOrEqual(520);
			expect(layout.hasShell).toBe(true);
			expect(layout.hasMap).toBe(true);
				expect(layout.hasSummary).toBe(true);
				expect(layout.browserExpanded).toBe('false');
				expect(layout.activeHeightRatio).toBeGreaterThan(0.9);
			expect(layout.hasDetectTree).toBe(false);
			expect(layout.shellFits).toBe(true);
			expect(layout.mapInsideShell).toBe(true);
			expect(layout.longRowVisible).toBe(true);
			expect(layout.longRowFits).toBe(true);
			expect(layout.longPathInDetail).toBe(true);
			expect(layout.navButtonCount).toBe(3);
			expect(layout.navButtonsFit).toBe(true);
			expect(layout.actionButtonCount).toBe(3);
			expect(layout.actionButtonsFit).toBe(true);
			expect(layout.actionButtonsInViewport).toBe(true);

			await browser.pause(150);
			await snap('workbench-narrow');
		} finally {
			await resizeWindow(restore.width, restore.height);
			await browser.executeObsidian(({ app }, state) => {
				const workspace = app.workspace as unknown as {
					leftSplit?: { expand(): void };
					rightSplit?: { expand(): void };
				};
				if (!state.leftCollapsed) workspace.leftSplit?.expand();
				if (!state.rightCollapsed) workspace.rightSplit?.expand();
			}, sidebarState);
		}

		const restored = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		expect(restored).toEqual(restore);
	});

	it('detaching the leaf cleans up', async function () {
		await browser.executeObsidian(({ app }) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
		});
		await browser.pause(400);
		const stillOpen = await browser.executeObsidian(({ app }) => ({
			leaves: app.workspace.getLeavesOfType('taxonomy-workbench-map').length,
			hasShell: Boolean(document.querySelector('[data-dtf-workbench-shell="1"]')),
			hasMap: Boolean(document.querySelector('[data-dtf-workbench-map="1"]')),
		}));
		expect(stillOpen).toEqual({ leaves: 0, hasShell: false, hasMap: false });
	});
});
