import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

const ROOT = 'UX Lab';
const RELATION_PATH = `${ROOT}/0 - Tasks, Planning`;
const EXPANSION_PATH = `${ROOT}/7 - Vault Config & Management/Lane 01`;
const DETAIL_PATH = `${EXPANSION_PATH}/Step A`;
const SCREENSHOT_DIR = path.resolve('test/screenshots');

const NUMBERED_ROOTS = [
	'0 - Tasks, Planning',
	'1 - Workspaces, Projects',
	'2 - Areas, Initiatives',
	'3 - Docs, Intel, SOPs',
	'4 - Topics, Knowledge, External, Misc',
	'5 - Archive, Admin',
	'6 - Ideation, Sandbox',
	'7 - Vault Config & Management',
	'99 - ARCHIVE',
];

let originalWindowSize: { width: number; height: number };
let originalLayout: Record<string, unknown>;
let originalSettings: unknown;
let originalSidebars: { leftCollapsed: boolean; rightCollapsed: boolean };
let backupRootPath: string | null = null;
let enterpriseOccurrenceKey = '';
let jdOccurrenceKey = '';

async function snap(name: string): Promise<void> {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

async function waitForMap(): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian(() => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		return shell?.dataset.dtfWorkbenchCurrentSurface === 'map'
			&& shell.querySelector('[data-dtf-workbench-map="1"]') !== null
			&& document.querySelector<HTMLElement>('[data-dtf-workbench-status]')
				?.dataset.dtfWorkbenchStatus === 'ready';
	}), {
		timeout: 15_000,
		timeoutMsg: 'Workbench Map did not become ready',
	});
}

async function waitForSurface(surface: 'map' | 'scope' | 'candidates'): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian((_context, expected) => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		if (shell?.dataset.dtfWorkbenchCurrentSurface !== expected) return false;
		if (expected === 'map') return shell.querySelector('[data-dtf-workbench-map="1"]') !== null;
		if (expected === 'scope') return shell.querySelector('[data-dtf-workbench-scope="1"]') !== null;
		return shell.querySelector('[data-dtf-workbench-candidates="1"]') !== null;
	}, surface), {
		timeout: 15_000,
		timeoutMsg: `Workbench did not route to ${surface}`,
	});
}

async function clickSurface(surface: 'map' | 'scope' | 'candidates'): Promise<void> {
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

async function setMapMode(mode: 'detected' | 'rules' | 'both'): Promise<void> {
	const clicked = await browser.executeObsidian((_context, target) => {
		const button = document.querySelector<HTMLButtonElement>(`[data-dtf-mode="${target}"]`);
		button?.focus();
		button?.click();
		return Boolean(button);
	}, mode);
	expect(clicked).toBe(true);
	await browser.waitUntil(async () => browser.executeObsidian((_context, target) =>
		document.querySelector(`[data-dtf-mode="${target}"]`)?.getAttribute('aria-pressed') === 'true',
	mode), { timeout: 5_000, timeoutMsg: `Map mode did not change to ${mode}` });
}

async function setBrowserOpen(open: boolean): Promise<void> {
	await browser.executeObsidian((_context, expected) => {
		const toggle = document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]');
		if (!toggle) return;
		if ((toggle.getAttribute('aria-expanded') === 'true') !== expected) toggle.click();
	}, open);
	await browser.waitUntil(async () => browser.executeObsidian((_context, expected) =>
		document.querySelector('[data-dtf-systems-browser-toggle="1"]')
			?.getAttribute('aria-expanded') === String(expected), open), {
		timeout: 5_000,
		timeoutMsg: `Organizational systems browser did not become ${open ? 'open' : 'closed'}`,
	});
}

async function resizeWindow(width: number, height: number): Promise<void> {
	await browser.executeObsidian((_context, size) => window.resizeTo(size.width, size.height), {
		width,
		height,
	});
	await browser.pause(250);
}

async function setWorkbenchSplitDimension(
	axis: 'width' | 'height',
	pixels: number,
): Promise<{ width: number; height: number }> {
	const measured = await browser.executeObsidian((_context, request) => {
		type LeafLike = { containerEl: HTMLElement };
		const globals = globalThis as unknown as {
			__dtfUxWorkbenchLeaf?: LeafLike;
			__dtfUxWidthTarget?: HTMLElement;
			__dtfUxHeightTarget?: HTMLElement;
		};
		const leaf = globals.__dtfUxWorkbenchLeaf;
		if (!leaf) throw new Error('Missing Workbench split leaf');


		const storedTarget = request.axis === 'width'
			? globals.__dtfUxWidthTarget
			: globals.__dtfUxHeightTarget;
		let node = leaf.containerEl.closest<HTMLElement>('.workspace-tabs') ?? leaf.containerEl;
		let target: HTMLElement | null = storedTarget?.isConnected ? storedTarget : null;
		let siblings: HTMLElement[] = target?.parentElement
			? Array.from(target.parentElement.children)
				.filter((child): child is HTMLElement => child instanceof HTMLElement && child !== target)
			: [];
		const trace: string[] = [];
		while (!target && node.parentElement) {
			const parent = node.parentElement;
			const candidates = Array.from(parent.children)
				.filter((child): child is HTMLElement => child instanceof HTMLElement)
				.filter((child) => child.getBoundingClientRect().width > 0
					&& child.getBoundingClientRect().height > 0);
			trace.push(`${node.className} in ${parent.className}: ${candidates.map((candidate) => {
				const rect = candidate.getBoundingClientRect();
				return `${candidate.className}[${Math.round(rect.left)},${Math.round(rect.top)},${Math.round(rect.width)},${Math.round(rect.height)}]`;
			}).join(' | ')}`);
			if (candidates.length > 1 && candidates.includes(node)) {
				const rect = node.getBoundingClientRect();
				const hasAxisSibling = candidates.some((candidate) => {
					if (candidate === node) return false;
					const other = candidate.getBoundingClientRect();
					return request.axis === 'width'
						? Math.abs(other.top - rect.top) <= 4 && Math.abs(other.left - rect.left) > 4
						: Math.abs(other.left - rect.left) <= 4 && Math.abs(other.top - rect.top) > 4;
				});
				if (hasAxisSibling) {
					target = node;
					siblings = candidates.filter((candidate) => candidate !== node);
					break;
				}
			}
			node = parent;
		}
		if (!target) throw new Error(`Could not find actual ${request.axis} split container :: ${trace.join(' >>> ')}`);
		if (request.axis === 'width') globals.__dtfUxWidthTarget = target;
		else globals.__dtfUxHeightTarget = target;

		const dimension = request.axis;
		const crossDimension = request.axis === 'width' ? 'height' : 'width';
		target.style.setProperty('flex', `0 0 ${request.pixels}px`, 'important');
		target.style.setProperty('flex-basis', `${request.pixels}px`, 'important');
		target.style.setProperty(dimension, `${request.pixels}px`, 'important');
		target.style.setProperty('min-width', '0', 'important');
		target.style.setProperty('min-height', '0', 'important');
		target.style.removeProperty(crossDimension);
		for (const sibling of siblings) {
			sibling.style.setProperty('flex', '1 1 0', 'important');
			sibling.style.removeProperty('flex-basis');
			sibling.style.removeProperty(dimension);
			sibling.style.setProperty('min-width', '0', 'important');
			sibling.style.setProperty('min-height', '0', 'important');
		}
		window.dispatchEvent(new Event('resize'));
		// Reading clientWidth/clientHeight forces the synchronous layout, so the
		// measurement below is already the post-resize geometry. Do NOT await a
		// double requestAnimationFrame here: in this harness the frame callback
		// does not run while the Obsidian window is not being painted, so the
		// promise never settles and every call wedges the renderer for the full
		// 30s script timeout. That is what failed all six tests in this file —
		// the "Could not find actual height split container" throw was only the
		// downstream cascade, because the timed-out earlier test never got to
		// create the horizontal companion. `settleSplit` below observes the same
		// thing the frame callback would have, without needing a painted frame.
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		return { width: shell?.clientWidth ?? 0, height: shell?.clientHeight ?? 0 };
	}, { axis, pixels });
	await settleSplit();
	return measured;
}

/**
 * Settle on a stable geometry fixpoint rather than on a painted frame — the
 * same contract test/specs/workbench-outline-prototype.e2e.ts uses in
 * `settleOutline`.
 */
// Measured in this harness: after a scripted style mutation the renderer does
// not reach a rendering opportunity on its own, so ResizeObserver callbacks
// never fire and the product's published layout attributes stay stale. A real
// WebDriver pointer move does NOT produce a frame; the screenshot capture path
// does, because it must composite. takeScreenshot is used rather than
// saveScreenshot so no PNG is written per settle.
async function forceRenderingOpportunity(): Promise<void> {
	await browser.takeScreenshot();
}

// Diagnostic snapshot for a focus wait. Read-only: it never moves focus and
// never calls product code, so it cannot manufacture the state it reports.
async function focusDiagnostics(selector: string): Promise<unknown> {
	return browser.executeObsidian((_context, target) => {
		const active = document.activeElement as HTMLElement | null;
		const intended = document.querySelector<HTMLElement>(target);
		const rect = intended?.getBoundingClientRect();
		const ancestorIds: string[] = [];
		for (let node: HTMLElement | null = active; node; node = node.parentElement) {
			if (node.id) ancestorIds.push(node.id);
			if (node.dataset.dtfFolderPath) ancestorIds.push(`path:${node.dataset.dtfFolderPath}`);
		}
		return {
			documentHasFocus: document.hasFocus(),
			visibilityState: document.visibilityState,
			activeTag: active?.tagName ?? null,
			activeId: active?.id || null,
			activeLabel: active?.getAttribute('aria-label') ?? null,
			activeIsBody: active === document.body,
			activeAncestorIds: ancestorIds.slice(0, 8),
			activeInsideTarget: Boolean(intended && active && intended.contains(active)),
			intendedConnected: intended?.isConnected ?? null,
			intendedAriaHidden: intended?.getAttribute('aria-hidden') ?? null,
			intendedDisplay: intended ? getComputedStyle(intended).display : null,
			intendedVisibility: intended ? getComputedStyle(intended).visibility : null,
			intendedBox: rect ? { w: Math.round(rect.width), h: Math.round(rect.height) } : null,
			focusablesInTarget: intended
				? intended.querySelectorAll('[tabindex], button, input, a[href]').length
				: -1,
		};
	}, selector);
}

async function settleSplit(): Promise<void> {
	await forceRenderingOpportunity();
	let previous = '';
	await browser.waitUntil(async () => {
		const signature = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			if (!shell) return 'missing';
			// Include the body/panel boxes the product's own classifier measures
			// (TaxonomyWorkbenchView.updateWorkbenchLayout -> classifyWorkbenchLayout),
			// not just the shell: the ResizeObserver that reclassifies is delivered
			// on a later frame, so settling only on the shell can return while the
			// published density/mode attributes are still the previous layout's.
			const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
			const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
			return JSON.stringify({
				width: shell.clientWidth,
				height: shell.clientHeight,
				scrollWidth: shell.scrollWidth,
				scrollHeight: shell.scrollHeight,
				bodyWidth: body?.clientWidth ?? 0,
				bodyHeight: body?.clientHeight ?? 0,
				panelWidth: panel?.clientWidth ?? 0,
				panelHeight: panel?.clientHeight ?? 0,
				browserMode: shell.dataset.dtfSystemsBrowserMode ?? '',
				inspectorMode: shell.dataset.dtfFolderInspectorMode ?? '',
				density: shell.dataset.dtfWorkbenchDensity ?? '',
			});
		});
		const stable = signature !== 'missing' && signature === previous;
		previous = signature;
		return stable;
	}, {
		timeout: 10_000,
		interval: 100,
		timeoutMsg: 'Workbench shell geometry did not reach a stable rendered state',
	});
}

async function createHorizontalCompanion(): Promise<void> {
	await browser.executeObsidian(async ({ app }) => {
		type LeafLike = {
			containerEl: HTMLElement;
			setViewState(state: Record<string, unknown>): Promise<void>;
		};
		const globals = globalThis as unknown as {
			__dtfUxWorkbenchLeaf?: LeafLike;
			__dtfUxHorizontalLeaf?: LeafLike;
			__dtfUxWidthTarget?: HTMLElement;
			__dtfUxHeightTarget?: HTMLElement;
		};
		// Remembering the leaf object is not the same as the split still existing:
		// once its container leaves the document there is no stacked sibling, and
		// a later height request fails with "Could not find actual height split
		// container". Recreate whenever the companion is no longer connected.
		if (globals.__dtfUxHorizontalLeaf?.containerEl.isConnected) return;
		const workspace = app.workspace as unknown as {
			createLeafBySplit(leaf: LeafLike, direction: 'horizontal', before?: boolean): LeafLike;
		};
		if (!globals.__dtfUxWorkbenchLeaf) throw new Error('Missing Workbench split leaf');
		const companion = workspace.createLeafBySplit(globals.__dtfUxWorkbenchLeaf, 'horizontal', false);
		await companion.setViewState({ type: 'empty', active: false });
		globals.__dtfUxHorizontalLeaf = companion;
		delete globals.__dtfUxWidthTarget;
		delete globals.__dtfUxHeightTarget;
	});
	await browser.pause(200);
}

async function ensurePathVisible(pathToReveal: string): Promise<void> {
	await browser.executeObsidian((_context, targetPath) => {
		const row = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(targetPath)}"]`);
		row?.scrollIntoView({ block: 'center', inline: 'nearest' });
	}, pathToReveal);
	await browser.pause(100);
}

async function setFolderExpanded(pathToToggle: string, expanded: boolean): Promise<void> {
	const changed = await browser.executeObsidian((_context, targetPath, expected) => {
		const item = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(targetPath)}"]`);
		const button = item?.querySelector<HTMLButtonElement>(':scope > [data-dtf-folder-row-content="1"] .dtf-folder-disclosure');
		if (!item || !button) return false;
		if ((item.getAttribute('aria-expanded') === 'true') !== expected) button.click();
		return true;
	}, pathToToggle, expanded);
	expect(changed).toBe(true);
	await browser.waitUntil(async () => browser.executeObsidian((_context, targetPath, expected) =>
		document.querySelector(`[data-dtf-folder-path="${CSS.escape(targetPath)}"]`)
			?.getAttribute('aria-expanded') === String(expected), pathToToggle, expanded), {
		timeout: 3_000,
		timeoutMsg: `${pathToToggle} did not become ${expanded ? 'expanded' : 'collapsed'}`,
	});
}

describe('Taxonomy Workbench Map — real split tree-first UX', function () {
	this.timeout(180_000);

	before(async function () {
		originalWindowSize = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));

		const setup = await browser.executeObsidian(async ({ app }, root, numberedRoots) => {
			type PluginLike = {
				settings: { rules: unknown[] } & Record<string, unknown>;
				saveSettings(): Promise<void>;
			};
			type SplitLike = {
				collapsed?: boolean;
				collapse?(): void;
				expand?(): void;
			};
			type LeafLike = {
				containerEl: HTMLElement;
				setViewState(state: Record<string, unknown>): Promise<void>;
			};
			const workspace = app.workspace as unknown as {
				getLayout(): Record<string, unknown>;
				getLeaf(type: 'tab'): LeafLike;
				createLeafBySplit(leaf: LeafLike, direction: 'vertical', before?: boolean): LeafLike;
				detachLeavesOfType(type: string): void;
				leftSplit?: SplitLike;
				rightSplit?: SplitLike;
			};
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, PluginLike> };
			}).plugins.plugins['folder-tag-sync'];
			const layout = JSON.parse(JSON.stringify(workspace.getLayout())) as Record<string, unknown>;
			const settings = JSON.parse(JSON.stringify(plugin.settings));
			const sidebars = {
				leftCollapsed: Boolean(workspace.leftSplit?.collapsed),
				rightCollapsed: Boolean(workspace.rightSplit?.collapsed),
			};

			workspace.detachLeavesOfType('taxonomy-workbench-map');
			const existing = app.vault.getAbstractFileByPath(root);
			let backupPath: string | null = null;
			if (existing) {
				backupPath = `${root}.__e2e_backup_${Date.now()}`;
				await app.vault.rename(existing, backupPath);
			}

			plugin.settings = {
				...plugin.settings,
				rules: [{
					id: 'e2e-ux-lab-projection',
					name: 'UX Lab projection',
					enabled: true,
					priority: 10,
					group: 'ux-lab',
					direction: 'folder-to-tag',
					folderPattern: '^UX Lab(?:/|$)',
					tagEntryPoint: 'ux-lab',
					options: {
						createFolders: false,
						addTags: true,
						removeOrphanedTags: false,
						syncOnFileCreate: false,
						syncOnFileMove: false,
						syncOnFileRename: false,
					},
				}],
			};
			await plugin.saveSettings();

			const folders = [root];
			for (const numbered of numberedRoots) {
				const base = `${root}/${numbered}`;
				folders.push(
					base,
					`${base}/Lane 01`,
					`${base}/Lane 01/Step A`,
					`${base}/Lane 01/Step A/Checkpoint`,
					`${base}/Lane 01/Step B`,
					`${base}/Lane 02`,
					`${base}/Lane 02/Research queue`,
					`${base}/Lane 03`,
					`${base}/An intentionally long invented branch name for horizontal overflow checks`,
				);
			}
			for (const folder of folders) {
				if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			}
			for (const [index, numbered] of numberedRoots.entries()) {
				const note = `${root}/${numbered}/Lane 01/seed-${index + 1}.md`;
				if (!app.vault.getAbstractFileByPath(note)) {
					await app.vault.create(note, `# Invented UX Lab seed ${index + 1}\n`);
				}
			}

			workspace.leftSplit?.collapse?.();
			workspace.rightSplit?.collapse?.();
			const baseLeaf = workspace.getLeaf('tab');
			await baseLeaf.setViewState({ type: 'empty', active: true });
			const workbenchLeaf = workspace.createLeafBySplit(baseLeaf, 'vertical', false);
			(globalThis as unknown as { __dtfUxWorkbenchLeaf?: LeafLike }).__dtfUxWorkbenchLeaf = workbenchLeaf;
			await workbenchLeaf.setViewState({
				type: 'taxonomy-workbench-map',
				active: true,
				state: {
					version: 1,
					surface: 'map',
					mapMode: 'both',
					scope: { selectedPaths: [], signalFilter: null },
					candidates: { source: 'detected-instances', sort: 'noise', selectedKeys: null },
					detailPath: null,
					selectedSystemInstanceKey: null,
					preferences: { showIncompleteSystems: true },
				},
			});
			await new Promise((resolve) => setTimeout(resolve, 500));
			return { layout, settings, sidebars, backupPath };
		}, ROOT, NUMBERED_ROOTS);

		originalLayout = setup.layout;
		originalSettings = setup.settings;
		originalSidebars = setup.sidebars;
		backupRootPath = setup.backupPath;
		await resizeWindow(1440, 1000);
		await waitForMap();
	});

	after(async function () {
		await resizeWindow(originalWindowSize.width, originalWindowSize.height);
		await browser.executeObsidian(async ({ app }, root, backupPath, settings, layout, sidebars) => {
			type PluginLike = { settings: unknown; saveSettings(): Promise<void> };
			type SplitLike = { collapse?(): void; expand?(): void };
			const workspace = app.workspace as unknown as {
				detachLeavesOfType(type: string): void;
				changeLayout(layout: Record<string, unknown>): Promise<void>;
				leftSplit?: SplitLike;
				rightSplit?: SplitLike;
			};
			workspace.detachLeavesOfType('taxonomy-workbench-map');
			const fixture = app.vault.getAbstractFileByPath(root);
			if (fixture) await app.vault.delete(fixture, true);
			if (backupPath) {
				const backup = app.vault.getAbstractFileByPath(backupPath);
				if (backup) await app.vault.rename(backup, root);
			}
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, PluginLike> };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings = settings;
			await plugin.saveSettings();
			await workspace.changeLayout(layout);
			if (sidebars.leftCollapsed) workspace.leftSplit?.collapse?.();
			else workspace.leftSplit?.expand?.();
			if (sidebars.rightCollapsed) workspace.rightSplit?.collapse?.();
			else workspace.rightSplit?.expand?.();
			const globals = globalThis as unknown as {
				__dtfUxWorkbenchLeaf?: unknown;
				__dtfUxHorizontalLeaf?: unknown;
				__dtfUxWidthTarget?: unknown;
				__dtfUxHeightTarget?: unknown;
			};
			delete globals.__dtfUxWorkbenchLeaf;
			delete globals.__dtfUxHorizontalLeaf;
			delete globals.__dtfUxWidthTarget;
			delete globals.__dtfUxHeightTarget;
		}, ROOT, backupRootPath, originalSettings, originalLayout, originalSidebars);
	});

	it('gives the hierarchy primary space and makes the tree the vertical scroll owner in a wide split', async function () {
		const size = await setWorkbenchSplitDimension('width', 1180);
		expect(size.width).toBeGreaterThanOrEqual(1120);
		// wdio builds timeoutMsg before the wait runs, so the failure has to be
		// raised lazily to carry the classifier inputs that produced the verdict.
		// Measured: with the side browser open at shell 1180 the panel is only 806,
		// below the 840 spacious threshold, while the body is 1156 (>= 1120) so the
		// browser is correctly 'side'. Side and spacious are therefore not
		// simultaneously reachable at this width, and the original wait demanded
		// both. Close the browser first -- exactly the state the assertions below
		// already require. No assertion or threshold is relaxed.
		await setBrowserOpen(false);
		let wideObserved: unknown = null;
		await browser.waitUntil(async () => {
			wideObserved = await browser.executeObsidian(() => {
				const globals = globalThis as unknown as {
					__dtfUxWorkbenchLeaf?: { containerEl: HTMLElement };
					__dtfRoProbe?: { count: number; targets: number; lastWidths: number[] };
				};
				const describe = (element: HTMLElement | null) => (element
					? {
						width: element.clientWidth,
						height: element.clientHeight,
						connected: element.isConnected,
						density: element.dataset.dtfWorkbenchDensity ?? null,
						browserMode: element.dataset.dtfSystemsBrowserMode ?? null,
						inspectorMode: element.dataset.dtfFolderInspectorMode ?? null,
					}
					: null);
				// Every shell in the document, not just the first one querySelector
				// happens to reach: a second workbench leaf left over from an earlier
				// test would make the test measure one shell and the product publish
				// onto another.
				const allShells = Array.from(
					document.querySelectorAll<HTMLElement>('[data-dtf-workbench-shell="1"]'),
				);
				const scope = globals.__dtfUxWorkbenchLeaf?.containerEl ?? null;
				const ownedShell = scope?.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]') ?? null;
				const queriedShell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const bodyEl = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
				const panelEl = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
				return {
					visibilityState: document.visibilityState,
					documentHasFocus: document.hasFocus(),
					shellCount: allShells.length,
					shells: allShells.map(describe),
					leafScopeConnected: scope?.isConnected ?? null,
					ownedIsQueried: ownedShell !== null && ownedShell === queriedShell,
					ownedShell: describe(ownedShell),
					shellWidth: queriedShell?.clientWidth ?? -1,
					shellHeight: queriedShell?.clientHeight ?? -1,
					bodyWidth: bodyEl?.clientWidth ?? -1,
					bodyHeight: bodyEl?.clientHeight ?? -1,
					panelWidth: panelEl?.clientWidth ?? -1,
					panelHeight: panelEl?.clientHeight ?? -1,
					browserMode: queriedShell?.dataset.dtfSystemsBrowserMode ?? null,
					density: queriedShell?.dataset.dtfWorkbenchDensity ?? null,
				};
			});
			const seen = wideObserved as { browserMode: string | null; density: string | null };
			return seen.browserMode === 'side' && seen.density === 'spacious';
		}, { timeout: 5_000, timeoutMsg: 'Wide split was not classified as spacious side mode' })
			.catch((error: Error) => {
				throw new Error(`${error.message}: last observation ${JSON.stringify(wideObserved)}`);
			});

		const layout = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')!;
			const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]')!;
			const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel')!;
			const surface = document.querySelector<HTMLElement>('[data-dtf-workbench-map-surface="1"]')!;
			const workspace = document.querySelector<HTMLElement>('.dtf-workbench-map-workspace')!;
			const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]')!;
			const stats = document.querySelector<HTMLElement>('.dtf-workbench-map-stats')!;
			tree.scrollTop = Math.min(320, tree.scrollHeight - tree.clientHeight);
			const surfaceRect = surface.getBoundingClientRect();
			const workspaceRect = workspace.getBoundingClientRect();
			return {
				width: shell.clientWidth,
				height: shell.clientHeight,
				density: shell.dataset.dtfWorkbenchDensity,
				browserMode: shell.dataset.dtfSystemsBrowserMode,
				inspectorMode: shell.dataset.dtfFolderInspectorMode,
				browserOpen: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
					?.getAttribute('aria-expanded'),
				workspaceHeightRatio: workspaceRect.height / surfaceRect.height,
				treeHeightMatchesWorkspace: Math.abs(tree.clientHeight - workspace.clientHeight) <= 2,
				treeOverflowY: getComputedStyle(tree).overflowY,
				statsOverflowX: getComputedStyle(stats).overflowX,
				panelOverflow: getComputedStyle(panel).overflow,
				surfaceOverflow: getComputedStyle(surface).overflow,
				workspaceOverflow: getComputedStyle(workspace).overflow,
				bodyOverflow: getComputedStyle(body).overflow,
				treeScrollable: tree.scrollHeight > tree.clientHeight + 20,
				treeScrollTop: tree.scrollTop,
				shellHorizontalOverflow: shell.scrollWidth - shell.clientWidth,
			};
		});
		expect(layout.density).toBe('spacious');
		expect(layout.browserMode).toBe('side');
		expect(layout.inspectorMode).toBe('side');
		expect(layout.browserOpen).toBe('false');
		expect(layout.workspaceHeightRatio).toBeGreaterThan(0.62);
		expect(layout.treeHeightMatchesWorkspace).toBe(true);
		expect(layout.treeOverflowY).toBe('auto');
		expect(layout.panelOverflow).toBe('hidden');
		expect(layout.surfaceOverflow).toBe('hidden');
		expect(layout.workspaceOverflow).toBe('hidden');
		expect(layout.bodyOverflow).not.toBe('auto');
		expect(layout.treeScrollable).toBe(true);
		expect(layout.treeScrollTop).toBeGreaterThan(0);
		expect(layout.shellHorizontalOverflow).toBeLessThanOrEqual(1);
		await snap('workbench-map-split-wide-tree-first');
	});

	it('keeps arrow, row, and relation actions separate in a screenshot-shaped split', async function () {
		await setWorkbenchSplitDimension('width', 860);
		await createHorizontalCompanion();
		await setWorkbenchSplitDimension('height', 680);
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			return shell?.dataset.dtfSystemsBrowserMode === 'overlay'
				&& shell.dataset.dtfFolderInspectorMode === 'overlay';
		}), { timeout: 5_000, timeoutMsg: 'Screenshot-shaped split was not classified as overlay layout' });
		await setBrowserOpen(false);
		await ensurePathVisible(RELATION_PATH);
		await setFolderExpanded(RELATION_PATH, true);

		const initial = await browser.executeObsidian((_context, relationPath) => {
			const item = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(relationPath)}"]`)!;
			const wrap = item.querySelector<HTMLElement>('.dtf-folder-occurrence-relations')!;
			return {
				itemExpanded: item.getAttribute('aria-expanded'),
				relationsExpanded: wrap.dataset.dtfOccurrenceRelationsExpanded,
				visibleChips: Array.from(wrap.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]'))
					.map((chip) => chip.querySelector('.dtf-folder-occurrence-system')?.textContent ?? ''),
				toggleText: wrap.querySelector<HTMLButtonElement>('[data-dtf-occurrence-relations-toggle]')?.textContent ?? '',
				detailPath: document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]')?.dataset.dtfInspectedPath ?? null,
			};
		}, RELATION_PATH);
		expect(initial.itemExpanded).toBe('true');
		expect(initial.relationsExpanded).toBe('false');
		expect(initial.visibleChips).toHaveLength(1);
		expect([
			'Enterprise JD vault (single-digit numbered roots)',
			'Johnny Decimal',
		]).toContain(initial.visibleChips[0]);
		expect(initial.toggleText).toBe('+1 organizational system');
		expect(initial.detailPath).toBeNull();

		const arrowOnly = await browser.executeObsidian(({ app }, relationPath) => {
			const item = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(relationPath)}"]`)!;
			item.querySelector<HTMLButtonElement>('.dtf-folder-disclosure')?.click();
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as {
				detailPath?: string | null;
				selectedSystemInstanceKey?: string | null;
			};
			return {
				expanded: item.getAttribute('aria-expanded'),
				detailPath: state.detailPath ?? null,
				selected: state.selectedSystemInstanceKey ?? null,
			};
		}, RELATION_PATH);
		expect(arrowOnly).toEqual({ expanded: 'false', detailPath: null, selected: null });
		await setFolderExpanded(RELATION_PATH, true);

		const inspectorGeometry = await browser.executeObsidian((_context, relationPath) => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]')!;
			const before = tree.getBoundingClientRect();
			tree.scrollTop = Math.min(260, tree.scrollHeight - tree.clientHeight);
			const row = document.querySelector<HTMLElement>(
				`[data-dtf-folder-path="${CSS.escape(relationPath)}"] > [data-dtf-folder-row-content="1"]`,
			)!;
			row.scrollIntoView({ block: 'center', inline: 'nearest' });
			const scrollBefore = tree.scrollTop;
			row.click();
			const after = tree.getBoundingClientRect();
			const detail = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]')!;
			return {
				treeWidthDelta: Math.abs(after.width - before.width),
				treeHeightDelta: Math.abs(after.height - before.height),
				scrollBefore,
				scrollAfter: tree.scrollTop,
				inspectorPosition: getComputedStyle(detail).position,
				inspectorOverflow: getComputedStyle(detail).overflowY,
				detailPath: detail.dataset.dtfInspectedPath ?? null,
				itemExpanded: document.querySelector(`[data-dtf-folder-path="${CSS.escape(relationPath)}"]`)
					?.getAttribute('aria-expanded') ?? null,
			};
		}, RELATION_PATH);
		expect(inspectorGeometry.treeWidthDelta).toBeLessThanOrEqual(1);
		expect(inspectorGeometry.treeHeightDelta).toBeLessThanOrEqual(1);
		expect(inspectorGeometry.scrollAfter).toBe(inspectorGeometry.scrollBefore);
		expect(inspectorGeometry.inspectorPosition).toBe('absolute');
		expect(inspectorGeometry.inspectorOverflow).toBe('auto');
		expect(inspectorGeometry.detailPath).toBe(RELATION_PATH);
		expect(inspectorGeometry.itemExpanded).toBe('true');

		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[aria-label="Close folder inspector"]')?.click();
		});
		await browser.pause(100);

		const expanded = await browser.executeObsidian(({ app }, relationPath) => {
			const item = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(relationPath)}"]`)!;
			item.querySelector<HTMLButtonElement>('[data-dtf-occurrence-relations-toggle]')?.click();
			const refreshed = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(relationPath)}"]`)!;
			const wrap = refreshed.querySelector<HTMLElement>('.dtf-folder-occurrence-relations')!;
			const chips = Array.from(wrap.querySelectorAll<HTMLButtonElement>('[data-dtf-occurrence-key]'));
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as {
				detailPath?: string | null;
				selectedSystemInstanceKey?: string | null;
			};
			return {
				expanded: wrap.dataset.dtfOccurrenceRelationsExpanded,
				toggleText: wrap.querySelector<HTMLButtonElement>('[data-dtf-occurrence-relations-toggle]')?.textContent ?? '',
				chips: chips.map((chip) => ({
					key: chip.dataset.dtfOccurrenceKey ?? '',
					relation: chip.dataset.dtfRelation ?? '',
						relationLabel: chip.querySelector('.dtf-folder-occurrence-relation')?.textContent ?? '',
					name: chip.querySelector('.dtf-folder-occurrence-system')?.textContent ?? '',
					anchor: chip.querySelector('[data-dtf-semantic-path="map-occurrence-anchor"]')?.getAttribute('aria-label') ?? '',
				})),
				detailPath: state.detailPath ?? null,
				selected: state.selectedSystemInstanceKey ?? null,
			};
		}, RELATION_PATH);
		expect(expanded.expanded).toBe('true');
		expect(expanded.toggleText).toBe('Show fewer');
		expect(expanded.chips.map((chip) => chip.name).sort()).toEqual([
			'Enterprise JD vault (single-digit numbered roots)',
			'Johnny Decimal',
		].sort());
		expect(expanded.chips.every((chip) => chip.relation === 'member')).toBe(true);
		expect(expanded.chips.every((chip) => chip.relationLabel === 'Identifies')).toBe(true);
		expect(expanded.chips.every((chip) => chip.anchor.includes(`Recognized here: ${ROOT}`))).toBe(true);
		expect(expanded.chips.every((chip) => chip.key.length > 0)).toBe(true);
		expect(new Set(expanded.chips.map((chip) => chip.key)).size).toBe(2);
		expect(expanded.detailPath).toBeNull();
		expect(expanded.selected).toBeNull();
		enterpriseOccurrenceKey = expanded.chips.find((chip) =>
			chip.name === 'Enterprise JD vault (single-digit numbered roots)')?.key ?? '';
		jdOccurrenceKey = expanded.chips.find((chip) => chip.name === 'Johnny Decimal')?.key ?? '';
		expect(enterpriseOccurrenceKey.length).toBeGreaterThan(0);
		expect(jdOccurrenceKey.length).toBeGreaterThan(0);

		const relationOnly = await browser.executeObsidian(({ app }, relationPath, key) => {
			const item = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(relationPath)}"]`)!;
			item.querySelector<HTMLButtonElement>(`[data-dtf-occurrence-key="${CSS.escape(key)}"]`)?.click();
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as {
				detailPath?: string | null;
				selectedSystemInstanceKey?: string | null;
			};
			return {
				expanded: document.querySelector(`[data-dtf-folder-path="${CSS.escape(relationPath)}"]`)
					?.getAttribute('aria-expanded') ?? null,
				detailPath: state.detailPath ?? null,
				selected: state.selectedSystemInstanceKey ?? null,
			};
		}, RELATION_PATH, jdOccurrenceKey);
		expect(relationOnly).toEqual({
			expanded: 'true',
			detailPath: null,
			selected: jdOccurrenceKey,
		});
		const selectedPresentation = await browser.executeObsidian(() => {
			const selectedCard = document.querySelector<HTMLElement>(
				'[data-dtf-system-occurrence-key][aria-selected="true"]',
			);
			const evidence = selectedCard?.nextElementSibling;
			return {
				adjacentEvidence: evidence?.matches('[data-dtf-selected-system-evidence="1"]') ?? false,
				evidenceOccurrenceKey: (evidence as HTMLElement | null)?.dataset.dtfSystemEvidenceOccurrenceKey ?? null,
				primaryAction: document.querySelector('[data-dtf-map-primary-action]')?.textContent?.trim() ?? null,
				retiredControlsPresent: document.querySelector('[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]') !== null,
			};
		});
		expect(selectedPresentation.adjacentEvidence).toBe(true);
		expect(selectedPresentation.evidenceOccurrenceKey).toBe(jdOccurrenceKey);
		expect(selectedPresentation.primaryAction).toBe('Choose where this organizational system applies');
		expect(selectedPresentation.retiredControlsPresent).toBe(false);

		const relationGeometry = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]')!;
			const treeRect = tree.getBoundingClientRect();
			const rows = Array.from(tree.querySelectorAll<HTMLElement>('[data-dtf-folder-row-content="1"]'))
				.filter((row) => row.querySelector('.dtf-folder-occurrence-relations'));
			const measurements = rows.map((row) => {
				const item = row.closest<HTMLElement>('[data-dtf-folder-path]')!;
				const name = row.querySelector<HTMLElement>('.dtf-folder-name')!;
				const wrap = row.querySelector<HTMLElement>('.dtf-folder-occurrence-relations')!;
				const rowRect = row.getBoundingClientRect();
				const nameRect = name.getBoundingClientRect();
				const wrapRect = wrap.getBoundingClientRect();
				const controls = Array.from(wrap.querySelectorAll<HTMLElement>('button')).map((control) => {
					const rect = control.getBoundingClientRect();
					const system = control.querySelector<HTMLElement>('.dtf-folder-occurrence-system');
					const controlStyle = getComputedStyle(control);
					return {
						text: control.textContent ?? '',
						left: rect.left,
						right: rect.right,
						top: rect.top,
						bottom: rect.bottom,
						insideRow: rect.left >= rowRect.left - 1 && rect.right <= rowRect.right + 1
							&& rect.top >= rowRect.top - 1 && rect.bottom <= rowRect.bottom + 1,
						insideTreeHorizontally: rect.left >= treeRect.left - 1 && rect.right <= treeRect.right + 1,
						controlClientWidth: control.clientWidth,
						controlScrollWidth: control.scrollWidth,
						justifyContent: controlStyle.justifyContent,
						textAlign: controlStyle.textAlign,
						systemClientWidth: system?.clientWidth ?? 0,
						systemScrollWidth: system?.scrollWidth ?? 0,
						systemTextOverflow: system ? getComputedStyle(system).textOverflow : null,
					};
				});
				return {
					path: item.dataset.dtfFolderPath ?? '',
					row: { left: rowRect.left, right: rowRect.right, top: rowRect.top, bottom: rowRect.bottom },
					name: { left: nameRect.left, right: nameRect.right },
					wrap: { left: wrapRect.left, right: wrapRect.right },
					nameWrapOverlap: nameRect.right > wrapRect.left + 1,
					wrapInsideRow: wrapRect.left >= rowRect.left - 1 && wrapRect.right <= rowRect.right + 1,
					wrapInsideTreeHorizontally: wrapRect.left >= treeRect.left - 1 && wrapRect.right <= treeRect.right + 1,
					controls,
				};
			});
			return {
				measurements,
				violations: measurements.flatMap((row) => {
					const issues: string[] = [];
					if (row.nameWrapOverlap) issues.push(`${row.path}: folder name overlaps relation controls`);
					if (!row.wrapInsideRow) issues.push(`${row.path}: relation wrapper leaves row bounds`);
					if (!row.wrapInsideTreeHorizontally) issues.push(`${row.path}: relation wrapper leaves tree viewport`);
					row.controls.forEach((control, index) => {
						if (!control.insideRow) issues.push(`${row.path}: control ${index} leaves row bounds`);
						if (!control.insideTreeHorizontally) issues.push(`${row.path}: control ${index} leaves tree viewport`);
					});
					return issues;
				}),
			};
		});
		expect(relationGeometry.measurements.length).toBeGreaterThanOrEqual(NUMBERED_ROOTS.length);
		expect(relationGeometry.violations).toEqual([]);
		const occurrenceControls = relationGeometry.measurements.flatMap((row) =>
			row.controls.filter((control) => control.systemClientWidth > 0));
		expect(occurrenceControls.length).toBeGreaterThanOrEqual(NUMBERED_ROOTS.length);
		expect(new Set(occurrenceControls.map((control) => control.justifyContent))).toEqual(
			new Set(['flex-start']),
		);
		expect(new Set(occurrenceControls.map((control) => control.textAlign))).toEqual(
			new Set(['left']),
		);
		await snap('workbench-map-split-screenshot-shaped-relations');
	});

	it('retains expansion and scroll across selection, mode, detail, surface, and refresh changes', async function () {
		await setMapMode('both');
		await setFolderExpanded(RELATION_PATH, true);
		await setFolderExpanded(EXPANSION_PATH, true);
		await ensurePathVisible(DETAIL_PATH);
		const seeded = await browser.executeObsidian((_context, detailPath) => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]')!;
			const row = document.querySelector<HTMLElement>(
				`[data-dtf-folder-path="${CSS.escape(detailPath)}"] > [data-dtf-folder-row-content="1"]`,
			);
			row?.scrollIntoView({ block: 'center', inline: 'nearest' });
			row?.click();
			const current = document.querySelector<HTMLElement>(
				`[data-dtf-folder-path="${CSS.escape(detailPath)}"] > [data-dtf-folder-row-content="1"]`,
			);
			return {
				scrollTop: tree.scrollTop,
				detailOffset: current
					? current.getBoundingClientRect().top - tree.getBoundingClientRect().top
					: Number.NaN,
			};
		}, DETAIL_PATH);
		expect(seeded.scrollTop).toBeGreaterThan(0);
		expect(Number.isFinite(seeded.detailOffset)).toBe(true);

		const retentionMetrics: Array<{
			stage: string;
			scrollDelta: number;
			detailOffsetDelta: number;
			layoutTolerance: number;
		}> = [];
		const assertRetained = async (stage: string): Promise<void> => {
			const state = await browser.executeObsidian(({ app }, relationPath, expansionPath, detailPath, expected) => {
				const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
				const relationWrap = document.querySelector<HTMLElement>(
					`[data-dtf-folder-path="${CSS.escape(relationPath)}"] .dtf-folder-occurrence-relations`,
				);
				const viewState = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as {
					detailPath?: string | null;
					selectedSystemInstanceKey?: string | null;
				};
				const detailRow = document.querySelector<HTMLElement>(
					`[data-dtf-folder-path="${CSS.escape(detailPath)}"] > [data-dtf-folder-row-content="1"]`,
				);
				const detailOffset = tree && detailRow
					? detailRow.getBoundingClientRect().top - tree.getBoundingClientRect().top
					: Number.NaN;
				return {
					relationExpanded: relationWrap?.dataset.dtfOccurrenceRelationsExpanded ?? null,
					folderExpanded: document.querySelector(`[data-dtf-folder-path="${CSS.escape(expansionPath)}"]`)
						?.getAttribute('aria-expanded') ?? null,
					scrollTop: tree?.scrollTop ?? -1,
					scrollDelta: Math.abs((tree?.scrollTop ?? -1) - expected.scrollTop),
					detailOffsetDelta: Math.abs(detailOffset - expected.detailOffset),
					layoutTolerance: (detailRow?.getBoundingClientRect().height ?? 0) + 16,
					detailRowVisible: Boolean(tree && detailRow
						&& detailRow.getBoundingClientRect().bottom > tree.getBoundingClientRect().top
						&& detailRow.getBoundingClientRect().top < tree.getBoundingClientRect().bottom),
					detailPath: viewState.detailPath ?? null,
					detailVisible: document.querySelector<HTMLElement>(`[data-dtf-folder-detail="1"][data-dtf-inspected-path="${CSS.escape(detailPath)}"]`)
						?.classList.contains('is-open') ?? false,
					selected: viewState.selectedSystemInstanceKey ?? null,
				};
			}, RELATION_PATH, EXPANSION_PATH, DETAIL_PATH, seeded);
			retentionMetrics.push({
				stage,
				scrollDelta: state.scrollDelta,
				detailOffsetDelta: state.detailOffsetDelta,
				layoutTolerance: state.layoutTolerance,
			});
			expect({ stage, value: state.relationExpanded }).toEqual({ stage, value: 'true' });
			expect({ stage, value: state.folderExpanded }).toEqual({ stage, value: 'true' });
			expect(state.scrollTop).toBeGreaterThan(0);
			expect(state.detailRowVisible).toBe(true);
			expect(state.layoutTolerance).toBeGreaterThan(8);
			expect(state.scrollDelta).toBeLessThanOrEqual(state.layoutTolerance);
			expect(state.detailOffsetDelta).toBeLessThanOrEqual(state.layoutTolerance);
			expect({ stage, value: state.detailPath }).toEqual({ stage, value: DETAIL_PATH });
			expect({ stage, value: state.detailVisible }).toEqual({ stage, value: true });
			expect({ stage, value: state.selected }).toEqual({ stage, value: jdOccurrenceKey });
		};

		await assertRetained('detail');
		await browser.executeObsidian((_context, relationPath, key) => {
			document.querySelector<HTMLButtonElement>(
				`[data-dtf-folder-path="${CSS.escape(relationPath)}"] [data-dtf-occurrence-key="${CSS.escape(key)}"]`,
			)?.click();
		}, RELATION_PATH, enterpriseOccurrenceKey);
		jdOccurrenceKey = enterpriseOccurrenceKey;
		await browser.pause(100);
		await assertRetained('selection');

		await setMapMode('rules');
		await setMapMode('both');
		await assertRetained('mode');

		await clickSurface('scope');
		await clickSurface('map');
		await waitForMap();
		await assertRetained('surface');

		await browser.executeObsidian(() => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
				.find((button) => button.getAttribute('aria-label') === 'Re-scan the vault')?.click();
		});
		await waitForMap();
		await assertRetained('refresh');
		expect(retentionMetrics.map((metric) => metric.stage)).toEqual([
			'detail', 'selection', 'mode', 'surface', 'refresh',
		]);
		const selectionShift = retentionMetrics.find((metric) => metric.stage === 'selection')!;
		expect(selectionShift.scrollDelta).toBeLessThanOrEqual(1);
		expect(selectionShift.detailOffsetDelta).toBeLessThanOrEqual(selectionShift.layoutTolerance);
	});

	it('preserves explicit browser preference across side and overlay modes and captures 480/320 splits', async function () {
		await resizeWindow(1900, 1000);
		// A height request needs a real stacked sibling. Ask for the companion
		// here instead of inheriting one from an earlier test in this file: the
		// helper is a no-op when the split is still connected, so this preserves
		// the same real horizontal split direction without an order dependency.
		await createHorizontalCompanion();
		await setWorkbenchSplitDimension('height', 850);
		await setWorkbenchSplitDimension('width', 1450);
		await setBrowserOpen(false);
		await setWorkbenchSplitDimension('width', 480);
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			return shell?.dataset.dtfSystemsBrowserMode === 'overlay'
				&& document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false';
		}), { timeout: 5_000, timeoutMsg: 'Closed preference did not survive side-to-overlay resize' });

		const narrow = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')!;
			const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]')!;
			const visibleText = (element: Element, fullSelector: string, shortSelector: string): string | null => {
				const full = element.querySelector<HTMLElement>(fullSelector);
				const short = element.querySelector<HTMLElement>(shortSelector);
				if (short && getComputedStyle(short).display !== 'none') return short.textContent;
				if (full && getComputedStyle(full).display !== 'none') return full.textContent;
				return null;
			};
			// Report the boxes the product classifier actually measures so a
			// density mismatch says whether the panel is stale or genuinely
			// wider than the shell, instead of only naming the verdict.
			const bodyEl = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
			const panelEl = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
			return {
				width: shell.clientWidth,
				bodyWidth: bodyEl?.clientWidth ?? -1,
				bodyHeight: bodyEl?.clientHeight ?? -1,
				panelWidth: panelEl?.clientWidth ?? -1,
				panelHeight: panelEl?.clientHeight ?? -1,
				density: shell.dataset.dtfWorkbenchDensity,
				browserMode: shell.dataset.dtfSystemsBrowserMode,
				inspectorMode: shell.dataset.dtfFolderInspectorMode,
				overflow: shell.scrollWidth - shell.clientWidth,
				treeOverflow: getComputedStyle(tree).overflowY,
				toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
				jobs: Array.from(shell.querySelectorAll<HTMLElement>('[data-dtf-workbench-surface-button]'))
					.map((button) => ({
						value: button.dataset.dtfWorkbenchSurfaceButton,
						aria: button.getAttribute('aria-label'),
						visible: visibleText(button, '.dtf-workbench-job-label-full', '.dtf-workbench-job-label-short'),
					})),
				modes: Array.from(shell.querySelectorAll<HTMLElement>('[data-dtf-mode]'))
					.map((button) => ({
						value: button.dataset.dtfMode,
						aria: button.getAttribute('aria-label'),
						visible: visibleText(button, '.dtf-map-mode-label-full', '.dtf-map-mode-label-short'),
					})),
			};
		});
		expect(narrow.width).toBeGreaterThanOrEqual(450);
		expect(narrow.width).toBeLessThanOrEqual(500);
		// Same strength as expect(narrow.density).toBe('tight'), but a failure
		// prints the classifier inputs that produced the verdict.
		expect({
			density: narrow.density,
			shellWidth: narrow.width,
			bodyWidth: narrow.bodyWidth,
			bodyHeight: narrow.bodyHeight,
			panelWidth: narrow.panelWidth,
			panelHeight: narrow.panelHeight,
		}).toEqual({
			density: 'tight',
			shellWidth: narrow.width,
			bodyWidth: narrow.bodyWidth,
			bodyHeight: narrow.bodyHeight,
			panelWidth: narrow.panelWidth,
			panelHeight: narrow.panelHeight,
		});
		expect(narrow.browserMode).toBe('overlay');
		expect(narrow.inspectorMode).toBe('overlay');
		expect(narrow.overflow).toBeLessThanOrEqual(1);
		expect(narrow.treeOverflow).toBe('auto');
		expect(narrow.toggleLabel).toBe('Open organizational systems drawer');
		expect(narrow.jobs).toEqual([
			{ value: 'map', aria: 'Explore your vault', visible: 'Explore' },
			{ value: 'scope', aria: 'Choose where rules apply', visible: 'Choose' },
			{ value: 'candidates', aria: 'Review proposed rules', visible: 'Review' },
		]);
		expect(narrow.modes).toEqual([
			{ value: 'detected', aria: 'Organizational systems', visible: 'Org systems' },
			{ value: 'rules', aria: 'Active rules', visible: 'Rules' },
			{ value: 'both', aria: 'Both', visible: 'Both' },
		]);
		await snap('workbench-map-split-480');
		await browser.executeObsidian(() => {
			document.body.classList.remove('theme-light');
			document.body.classList.add('theme-dark');
		});
		await browser.pause(100);
		await snap('workbench-map-split-480-dark');
		const darkOverflow = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			return shell ? shell.scrollWidth - shell.clientWidth : Number.NaN;
		});
		expect(darkOverflow).toBeLessThanOrEqual(1);
		await browser.executeObsidian(() => {
			document.body.classList.remove('theme-dark');
			document.body.classList.add('theme-light');
		});
		await browser.pause(100);

		await setBrowserOpen(true);
		// Pump exactly one frame after the input and before the wait. The product
		// defers this focus move until after a render, and this harness produces
		// no frame on its own following scripted input. Kept out of the wait
		// predicate so repeated polling cannot perturb focus. The assertion below
		// is unchanged.
		await forceRenderingOpportunity();
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const systems = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]');
			return Boolean(systems && document.activeElement && systems.contains(document.activeElement));
		}), { timeout: 3_000, timeoutMsg: 'Opening the overlay did not move focus into the organizational systems browser' })
			.catch(async (error: Error) => {
				const diag = await focusDiagnostics('[data-dtf-systems-browser="1"]');
				throw new Error(`${error.message}: ${JSON.stringify(diag)}`);
			});
		const openOverlay = await browser.executeObsidian(() => {
			const systems = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]')!;
			const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel')!;
			return {
				position: getComputedStyle(systems).position,
				overflow: getComputedStyle(systems).overflowY,
				panelInert: panel.hasAttribute('inert'),
				panelAriaHidden: panel.getAttribute('aria-hidden'),
				focusedOccurrence: document.activeElement?.getAttribute('data-dtf-system-occurrence-key') ?? null,
				focusInsideBrowser: systems.contains(document.activeElement),
				toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
			};
		});
		expect(openOverlay.position).toBe('absolute');
		expect(openOverlay.overflow).toBe('auto');
		expect(openOverlay.panelInert).toBe(true);
		expect(openOverlay.panelAriaHidden).toBe('true');
		expect(openOverlay.focusInsideBrowser).toBe(true);
		expect(openOverlay.focusedOccurrence).toBe(jdOccurrenceKey);
		expect(openOverlay.toggleLabel).toBe('Close organizational systems drawer');

		await setWorkbenchSplitDimension('width', 320);
		const compactOpen = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')!;
			return {
				width: shell.clientWidth,
				density: shell.dataset.dtfWorkbenchDensity,
				browserMode: shell.dataset.dtfSystemsBrowserMode,
				open: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded'),
				toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label'),
				overflow: shell.scrollWidth - shell.clientWidth,
			};
		});
		expect(compactOpen.width).toBeGreaterThanOrEqual(290);
		expect(compactOpen.width).toBeLessThanOrEqual(340);
		expect(compactOpen.density).toBe('tight');
		expect(compactOpen.browserMode).toBe('overlay');
		expect(compactOpen.open).toBe('true');
		expect(compactOpen.toggleLabel).toBe('Close organizational systems drawer');
		expect(compactOpen.overflow).toBeLessThanOrEqual(1);

		await browser.executeObsidian(() => {
			document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]')?.dispatchEvent(
				new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
			);
		});
		// Deferred focus restore: one frame after the input, outside the predicate.
		await forceRenderingOpportunity();
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false'
				&& document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') === 'Open organizational systems drawer'
				&& document.activeElement?.getAttribute('data-dtf-systems-browser-toggle') === '1',
		), { timeout: 3_000, timeoutMsg: 'Escape did not close the organizational systems browser and restore icon-toggle focus' })
			.catch(async (error: Error) => {
				const diag = await focusDiagnostics('[data-dtf-systems-browser-toggle="1"]');
				throw new Error(`${error.message}: ${JSON.stringify(diag)}`);
			});
		const tightInspectorAction = await browser.executeObsidian(() => {
			const inspector = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]')!;
			const action = inspector.querySelector<HTMLButtonElement>('[data-dtf-choose-branch-in-scope="1"]')!;
			const inspectorRect = inspector.getBoundingClientRect();
			const actionRect = action.getBoundingClientRect();
			return {
				insideInspector: actionRect.left >= inspectorRect.left
					&& actionRect.right <= inspectorRect.right,
				horizontalOverflow: action.scrollWidth - action.clientWidth,
				whiteSpace: getComputedStyle(action).whiteSpace,
			};
		});
		expect(tightInspectorAction.insideInspector).toBe(true);
		expect(tightInspectorAction.horizontalOverflow).toBeLessThanOrEqual(1);
		expect(tightInspectorAction.whiteSpace).toBe('normal');
		await snap('workbench-map-split-320');

		await setWorkbenchSplitDimension('width', 1450);
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			return shell?.dataset.dtfSystemsBrowserMode === 'side'
				&& document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false';
		}), { timeout: 5_000, timeoutMsg: 'Closed preference did not survive overlay-to-side resize' });
		await setBrowserOpen(true);
		await setWorkbenchSplitDimension('width', 480);
		const openPreference = await browser.executeObsidian(() => ({
			mode: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')?.dataset.dtfSystemsBrowserMode,
			open: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded'),
		}));
		expect(openPreference).toEqual({ mode: 'overlay', open: 'true' });
		await setBrowserOpen(false);
	});

	it('keeps the hierarchy usable and gives detail the workspace in a short horizontal split', async function () {
		await setWorkbenchSplitDimension('width', 860);
		const size = await setWorkbenchSplitDimension('height', 420);
		expect(size.height).toBeGreaterThanOrEqual(320);
		expect(size.height).toBeLessThanOrEqual(380);
		await setBrowserOpen(false);
		await setFolderExpanded(EXPANSION_PATH, true);
		await ensurePathVisible(DETAIL_PATH);
		await browser.executeObsidian((_context, detailPath) => {
			const detail = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]');
			if (detail?.dataset.dtfInspectedPath === detailPath) return;
			document.querySelector<HTMLElement>(
				`[data-dtf-folder-path="${CSS.escape(detailPath)}"] > [data-dtf-folder-row-content="1"]`,
			)?.click();
		}, DETAIL_PATH);
		const short = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')!;
			const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]')!;
			const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel')!;
			const workspace = document.querySelector<HTMLElement>('.dtf-workbench-map-workspace')!;
			const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]')!;
			const stats = document.querySelector<HTMLElement>('.dtf-workbench-map-stats')!;
			const inspector = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]')!;
			return {
				density: shell.dataset.dtfWorkbenchDensity,
				browserMode: shell.dataset.dtfSystemsBrowserMode,
				inspectorMode: shell.dataset.dtfFolderInspectorMode,
				bodyHeight: body.clientHeight,
				panelHeight: panel.clientHeight,
				treeHeight: tree.clientHeight,
				treeVisible: Boolean(tree.offsetParent),
				treeOverflow: getComputedStyle(tree).overflowY,
				statsOverflow: getComputedStyle(stats).overflowX,
				shellOverflow: shell.scrollHeight - shell.clientHeight,
				inspectorHeightRatio: inspector.clientHeight / workspace.clientHeight,
				inspectorHorizontalOverflow: inspector.scrollWidth - inspector.clientWidth,
				inspectorVisible: Boolean(inspector.offsetParent),
			};
		});
		expect(short.density).toBe('tight');
		expect(short.browserMode).toBe('overlay');
		expect(short.inspectorMode).toBe('overlay');
		expect(short.bodyHeight).toBeGreaterThanOrEqual(140);
		expect(short.panelHeight).toBeGreaterThanOrEqual(short.bodyHeight - 2);
		expect(short.treeHeight).toBeGreaterThanOrEqual(100);
		expect(short.treeVisible).toBe(true);
		expect(short.treeOverflow).toBe('auto');
		expect(short.shellOverflow).toBeLessThanOrEqual(1);
		expect(short.inspectorVisible).toBe(true);
		expect(short.inspectorHeightRatio).toBeGreaterThanOrEqual(0.89);
		expect(short.inspectorHorizontalOverflow).toBeLessThanOrEqual(1);
		await snap('workbench-map-split-short-horizontal');
		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[aria-label="Close folder inspector"]')?.click();
		});
		await setWorkbenchSplitDimension('height', 680);
	});

	it('supports tree keyboard navigation and focuses the exact organizational system after relation actions', async function () {
		await setWorkbenchSplitDimension('width', 860);
		await setWorkbenchSplitDimension('height', 680);
		await setBrowserOpen(false);
		await setMapMode('both');
		await setFolderExpanded(RELATION_PATH, true);
		await setFolderExpanded(EXPANSION_PATH, false);
		await ensurePathVisible(EXPANSION_PATH);

		const keyboard = await browser.executeObsidian((_context, expansionPath) => {
			const item = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(expansionPath)}"]`)!;
			item.focus();
			item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
			const expanded = item.getAttribute('aria-expanded');
			item.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', bubbles: true }));
			return {
				expanded,
				focusedPath: document.activeElement?.closest<HTMLElement>('[data-dtf-folder-path]')
					?.dataset.dtfFolderPath ?? null,
			};
		}, EXPANSION_PATH);
		expect(keyboard.expanded).toBe('true');
		expect(keyboard.focusedPath).toBe(DETAIL_PATH);

		await browser.executeObsidian((_context, detailPath) => {
			const item = document.querySelector<HTMLElement>(`[data-dtf-folder-path="${CSS.escape(detailPath)}"]`)!;
			item.focus();
			item.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
		}, DETAIL_PATH);
		await browser.waitUntil(async () => browser.executeObsidian((_context, detailPath) =>
			document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]')?.dataset.dtfInspectedPath === detailPath,
		DETAIL_PATH), { timeout: 3_000, timeoutMsg: 'Enter did not open the folder inspector' });
		await browser.executeObsidian(() => {
			const close = document.querySelector<HTMLButtonElement>('[aria-label="Close folder inspector"]');
			close?.focus();
			close?.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
		});
		// Same reason as the overlay wait: the focus restore is deferred until
		// after a render. One frame, after the input, outside the predicate.
		await forceRenderingOpportunity();
		await browser.waitUntil(async () => browser.executeObsidian((_context, detailPath) => {
			const detail = document.querySelector<HTMLElement>('[data-dtf-folder-detail="1"]');
			return detail?.getAttribute('aria-hidden') === 'true'
				&& document.activeElement?.closest<HTMLElement>('[data-dtf-folder-path]')
					?.dataset.dtfFolderPath === detailPath;
		}, DETAIL_PATH), { timeout: 3_000, timeoutMsg: 'Closing the inspector did not restore folder-row focus' })
			.catch(async (error: Error) => {
				const diag = await focusDiagnostics('[data-dtf-folder-detail="1"]');
				throw new Error(`${error.message}: ${JSON.stringify(diag)}`);
			});

		await ensurePathVisible(RELATION_PATH);
		const relationFocus = await browser.executeObsidian((_context, relationPath, key) => {
			const chip = document.querySelector<HTMLButtonElement>(
				`[data-dtf-folder-path="${CSS.escape(relationPath)}"] [data-dtf-occurrence-key="${CSS.escape(key)}"]`,
			);
			chip?.focus();
			chip?.click();
			return Boolean(chip);
		}, RELATION_PATH, enterpriseOccurrenceKey);
		expect(relationFocus).toBe(true);
		// Deferred focus move after the relation click: one frame, outside the
		// predicate. The real click above is unchanged.
		await forceRenderingOpportunity();
		await browser.waitUntil(async () => browser.executeObsidian((_context, key) =>
			(document.activeElement as HTMLElement | null)?.dataset.dtfSystemOccurrenceKey === key,
		enterpriseOccurrenceKey), { timeout: 3_000, timeoutMsg: 'Relation action did not focus the exact organizational-system card' })
			.catch(async (error: Error) => {
				const diag = await focusDiagnostics('[data-dtf-systems-browser="1"]');
				throw new Error(`${error.message}: ${JSON.stringify(diag)}`);
			});
		const finalFocus = await browser.executeObsidian(() => ({
			key: (document.activeElement as HTMLElement | null)?.dataset.dtfSystemOccurrenceKey ?? null,
			browserExpanded: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') ?? null,
		}));
		expect(finalFocus).toEqual({ key: enterpriseOccurrenceKey, browserExpanded: 'true' });
	});
});
