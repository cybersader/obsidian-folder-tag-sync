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
 * E2E tests for the consolidated Taxonomy Workbench shell. The Map remains the
 * annotated hierarchy surface, while the same persistent ItemView now routes to
 * Scope and Candidates without opening parallel leaves or losing unrelated
 * Workbench state.
 */

const SCREENSHOT_DIR = path.resolve('test/screenshots');
const NESTED_FOLDERS = [
	'01 - Projects',
	'01 - Projects/Cybersader',
	'01 - Projects/Cybersader/01 - Active',
	'01 - Projects/Cybersader/02 - Archive',
	'01 - Projects/Cybersader/03 - Reference',
	'02 - Areas',
	'02 - Areas/Health',
	'03 - Resources',
	'Capture',
	'Capture/Inbox',
	'Entity',
	'Entity/Cybersader',
	'Output',
	'Output/Main',
	'System',
	'Templates',
];

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

async function runCommand(id: string): Promise<void> {
	const ok = await browser.executeObsidian(({ app }, commandId) => {
		const commands = (app as unknown as {
			commands: { executeCommandById: (id: string) => boolean };
		}).commands;
		return commands.executeCommandById(commandId);
	}, id);
	expect(ok).toBe(true);
}

async function waitForSurface(surface: 'map' | 'scope' | 'candidates'): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian((_context, expected) => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		if (shell?.dataset.dtfWorkbenchCurrentSurface !== expected) return false;
		if (expected === 'map') return Boolean(shell.querySelector('[data-dtf-workbench-map="1"]'));
		if (expected === 'scope') return Boolean(shell.querySelector('[data-dtf-workbench-scope="1"]'));
		return Boolean(shell.querySelector('[data-dtf-workbench-candidates="1"]'));
	}, surface), {
		timeout: 10_000,
		timeoutMsg: `Workbench did not finish routing to ${surface}`,
	});
}

describe('Taxonomy Workbench map — consolidated shell and routing', function () {
	this.timeout(90_000);

	before(async function () {
		originalWindowSize = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		await browser.executeObsidian(async ({ app }, folders) => {
			const adapter = app.vault.adapter;
			for (const folder of folders) {
				if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
				const placeholder = `${folder}/_placeholder.md`;
				if (!(await adapter.exists(placeholder))) {
					await adapter.write(placeholder, '# placeholder');
				}
			}
			// Let the metadata cache pick up the freshly-created folders.
			await new Promise((resolve) => setTimeout(resolve, 500));
		}, NESTED_FOLDERS);
	});

	after(async function () {
		if (originalWindowSize) {
			await resizeWindow(originalWindowSize.width, originalWindowSize.height);
		}
		await browser.executeObsidian(async ({ app }) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			delete (globalThis as unknown as { __workbenchRoutingLeaf?: unknown }).__workbenchRoutingLeaf;
			const adapter = app.vault.adapter;
			const top = [
				'01 - Projects', '02 - Areas', '03 - Resources',
				'Capture', 'Entity', 'Output', 'System', 'Templates',
			];
			for (const folder of top) {
				if (await adapter.exists(folder)) await adapter.rmdir(folder, true);
			}
		});
	});

	it('registers the canonical and legacy Workbench commands', async function () {
		const found = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { commands: Record<string, unknown> };
			}).commands.commands;
			return {
				map: Boolean(commands['folder-tag-sync:taxonomy-workbench-open-map']),
				scope: Boolean(commands['folder-tag-sync:scan-vault-for-systems']),
				candidates: Boolean(commands['folder-tag-sync:scan-and-snap-draft-rules']),
			};
		});
		expect(found).toEqual({ map: true, scope: true, candidates: true });
	});

	it('opens one Workbench leaf with Map, Scope, and Candidates navigation hooks', async function () {
		await runCommand('folder-tag-sync:taxonomy-workbench-open-map');
		await waitForSurface('map');

		const initial = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map');
			(globalThis as unknown as { __workbenchRoutingLeaf?: unknown }).__workbenchRoutingLeaf = leaves[0];
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			const map = shell?.querySelector('[data-dtf-workbench-map="1"]');
			return {
				leafCount: leaves.length,
				hasShell: Boolean(shell),
				hasMap: Boolean(map),
				mapHasDetectTree: Boolean(map?.querySelector('[data-dtf-detect-tree="1"]')),
				shellHasDetectTree: Boolean(shell?.querySelector('[data-dtf-detect-tree="1"]')),
				navSurfaces: Array.from(
					shell?.querySelectorAll<HTMLElement>('[data-dtf-workbench-surface-button]') ?? [],
				).map((button) => button.dataset.dtfWorkbenchSurfaceButton),
				activeSurface: shell?.querySelector<HTMLElement>('[data-dtf-workbench-active-surface="1"]')
					?.dataset.dtfWorkbenchSurfaceButton ?? null,
			};
		});
		expect(initial.leafCount).toBe(1);
		expect(initial.hasShell).toBe(true);
		expect(initial.hasMap).toBe(true);
		expect(initial.mapHasDetectTree).toBe(false);
		expect(initial.shellHasDetectTree).toBe(false);
		expect(initial.navSurfaces).toEqual(['map', 'scope', 'candidates']);
		expect(initial.activeSurface).toBe('map');

		for (const surface of ['scope', 'candidates', 'map'] as const) {
			const clicked = await browser.executeObsidian((_context, target) => {
				const button = document.querySelector<HTMLButtonElement>(
					`[data-dtf-workbench-surface-button="${target}"]`,
				);
				button?.click();
				return Boolean(button);
			}, surface);
			expect(clicked).toBe(true);
			await waitForSurface(surface);
		}

		const final = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map');
			const original = (globalThis as unknown as { __workbenchRoutingLeaf?: unknown })
				.__workbenchRoutingLeaf;
			return {
				leafCount: leaves.length,
				sameLeaf: leaves[0] === original,
				activeSurface: document.querySelector<HTMLElement>('[data-dtf-workbench-active-surface="1"]')
					?.dataset.dtfWorkbenchSurfaceButton ?? null,
				hasMap: Boolean(document.querySelector('[data-dtf-workbench-map="1"]')),
				hasDetectTree: Boolean(document.querySelector('[data-dtf-detect-tree="1"]')),
			};
		});
		expect(final.leafCount).toBe(1);
		expect(final.sameLeaf).toBe(true);
		expect(final.activeSurface).toBe('map');
		expect(final.hasMap).toBe(true);
		expect(final.hasDetectTree).toBe(false);
	});

	it('renders explicit occurrence relations on neutral Map rows and captures the desktop surface', async function () {
		const bothClicked = await browser.executeObsidian(() => {
			const button = document.querySelector<HTMLButtonElement>('[data-dtf-mode="both"]');
			button?.click();
			return Boolean(button);
		});
		expect(bothClicked).toBe(true);
		await waitForSurface('map');

		const info = await browser.executeObsidian(() => {
			const map = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
			if (!map) {
				return {
					hasMap: false,
					hasDetectTree: false,
					railCount: 0,
					tintedRowCount: 0,
					maxOccurrenceRelationsInARow: 0,
					folderCount: 0,
					mode: null,
				};
			}
			let maxOccurrenceRelationsInARow = 0;
			let tintedRowCount = 0;
			map.querySelectorAll<HTMLElement>('[data-dtf-folder-path]').forEach((row) => {
				maxOccurrenceRelationsInARow = Math.max(
					maxOccurrenceRelationsInARow,
					new Set(Array.from(row.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]'))
						.map((chip) => chip.dataset.dtfOccurrenceKey)).size,
				);
				const content = row.querySelector<HTMLElement>('[data-dtf-folder-row-content="1"]');
				if (content?.style.background
					&& content.style.background !== 'var(--background-modifier-hover)') {
					tintedRowCount++;
				}
			});
			return {
				hasMap: true,
				hasDetectTree: Boolean(map.querySelector('[data-dtf-detect-tree="1"]')),
				railCount: map.querySelectorAll('[data-dtf-system-rail]').length,
				tintedRowCount,
				maxOccurrenceRelationsInARow,
				folderCount: map.querySelectorAll('[data-dtf-folder-path]').length,
				mode: document.querySelector<HTMLButtonElement>('[data-dtf-mode="both"]')
					?.getAttribute('aria-pressed') ?? null,
			};
		});
		expect(info.hasMap).toBe(true);
		expect(info.hasDetectTree).toBe(false);
		expect(info.folderCount).toBeGreaterThanOrEqual(1);
		expect(info.railCount).toBe(0);
		expect(info.tintedRowCount).toBe(0);
		expect(info.maxOccurrenceRelationsInARow).toBeGreaterThanOrEqual(2);
		expect(info.mode).toBe('true');

		const restore = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		try {
			await resizeWindow(1440, 1000);
			await browser.executeObsidian(() => {
				document.querySelectorAll('.notice').forEach((notice) => notice.remove());
			});
			await snap('workbench-map-desktop-both');
		} finally {
			await resizeWindow(restore.width, restore.height);
		}
	});

	it('reuses exactly one leaf across repeated canonical and legacy routes while preserving unrelated state', async function () {
		const seededMap = await browser.executeObsidian(async ({ app }) => {
			const leaf = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0];
			const view = leaf?.view as unknown as {
				getState(): Record<string, unknown>;
				setState(state: Record<string, unknown>, result: { history: boolean }): Promise<void>;
			};
			if (!leaf || !view?.getState || !view?.setState) return false;
			await view.setState({
				...view.getState(),
				version: 1,
				surface: 'map',
				mapMode: 'rules',
				scope: { selectedPaths: ['01 - Projects'], signalFilter: null },
				candidates: { source: 'scope-selection', sort: 'conflict', selectedKeys: [] },
				detailPath: '01 - Projects',
			}, { history: true });
			return true;
		});
		expect(seededMap).toBe(true);

		for (let index = 0; index < 2; index++) {
			await runCommand('folder-tag-sync:taxonomy-workbench-open-map');
			await waitForSurface('map');
		}

		const afterCanonical = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map');
			const state = leaves[0]?.view.getState() as unknown as {
				surface: string;
				mapMode: string;
				scope: { selectedPaths: string[] };
				candidates: { source: string; sort: string; selectedKeys: string[] | null };
				detailPath: string | null;
			};
			return {
				leafCount: leaves.length,
				sameLeaf: leaves[0] === (globalThis as unknown as { __workbenchRoutingLeaf?: unknown })
					.__workbenchRoutingLeaf,
				state,
			};
		});
		expect(afterCanonical.leafCount).toBe(1);
		expect(afterCanonical.sameLeaf).toBe(true);
		expect(afterCanonical.state).toMatchObject({
			surface: 'map',
			mapMode: 'rules',
			scope: { selectedPaths: ['01 - Projects'] },
			candidates: { source: 'scope-selection', sort: 'conflict', selectedKeys: [] },
			detailPath: '01 - Projects',
		});

		for (let index = 0; index < 2; index++) {
			await runCommand('folder-tag-sync:scan-vault-for-systems');
			await waitForSurface('scope');
		}
		const afterLegacyScan = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map');
			return {
				leafCount: leaves.length,
				sameLeaf: leaves[0] === (globalThis as unknown as { __workbenchRoutingLeaf?: unknown })
					.__workbenchRoutingLeaf,
				state: leaves[0]?.view.getState(),
			};
		});
		expect(afterLegacyScan.leafCount).toBe(1);
		expect(afterLegacyScan.sameLeaf).toBe(true);
		expect(afterLegacyScan.state).toMatchObject({
			surface: 'scope',
			mapMode: 'rules',
			scope: { selectedPaths: [], signalFilter: null },
			candidates: { source: 'scope-selection', sort: 'conflict', selectedKeys: [] },
			detailPath: '01 - Projects',
		});

		const seededDraft = await browser.executeObsidian(async ({ app }) => {
			const leaf = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0];
			const view = leaf?.view as unknown as {
				getState(): Record<string, unknown>;
				setState(state: Record<string, unknown>, result: { history: boolean }): Promise<void>;
			};
			if (!view?.getState || !view?.setState) return false;
			await view.setState({
				...view.getState(),
				version: 1,
				surface: 'scope',
				mapMode: 'both',
				scope: { selectedPaths: ['01 - Projects'], signalFilter: null },
				candidates: { source: 'scope-selection', sort: 'conflict', selectedKeys: [] },
				detailPath: '01 - Projects',
			}, { history: true });
			return true;
		});
		expect(seededDraft).toBe(true);

		for (let index = 0; index < 2; index++) {
			await runCommand('folder-tag-sync:scan-and-snap-draft-rules');
			await waitForSurface('candidates');
		}
		const afterLegacyDraft = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map');
			return {
				leafCount: leaves.length,
				sameLeaf: leaves[0] === (globalThis as unknown as { __workbenchRoutingLeaf?: unknown })
					.__workbenchRoutingLeaf,
				state: leaves[0]?.view.getState(),
			};
		});
		expect(afterLegacyDraft.leafCount).toBe(1);
		expect(afterLegacyDraft.sameLeaf).toBe(true);
		expect(afterLegacyDraft.state).toMatchObject({
			surface: 'candidates',
			mapMode: 'both',
			scope: { selectedPaths: ['01 - Projects'], signalFilter: null },
			candidates: { source: 'detected-instances', sort: 'noise', selectedKeys: null },
			detailPath: '01 - Projects',
		});

		for (let index = 0; index < 2; index++) {
			await runCommand('folder-tag-sync:taxonomy-workbench-open-map');
			await waitForSurface('map');
		}
		const afterReturnToMap = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map');
			return {
				leafCount: leaves.length,
				sameLeaf: leaves[0] === (globalThis as unknown as { __workbenchRoutingLeaf?: unknown })
					.__workbenchRoutingLeaf,
				state: leaves[0]?.view.getState(),
				hasMap: Boolean(document.querySelector('[data-dtf-workbench-map="1"]')),
				hasDetectTree: Boolean(document.querySelector('[data-dtf-detect-tree="1"]')),
			};
		});
		expect(afterReturnToMap.leafCount).toBe(1);
		expect(afterReturnToMap.sameLeaf).toBe(true);
		expect(afterReturnToMap.hasMap).toBe(true);
		expect(afterReturnToMap.hasDetectTree).toBe(false);
		expect(afterReturnToMap.state).toMatchObject({
			surface: 'map',
			mapMode: 'both',
			scope: { selectedPaths: ['01 - Projects'], signalFilter: null },
			candidates: { source: 'detected-instances', sort: 'noise', selectedKeys: null },
			detailPath: '01 - Projects',
		});
	});

	it('detaching the leaf cleans up the consolidated shell', async function () {
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
