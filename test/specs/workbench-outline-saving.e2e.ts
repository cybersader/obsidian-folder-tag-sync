import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

const VIEW_TYPE = 'taxonomy-workbench-map';
const COMMAND_ID = 'folder-tag-sync:taxonomy-workbench-open-outline';
const ROOT = 'Outline Saving M1 Fixture';
const MARKER_PATH = `${ROOT}/.dtf-outline-saving-owned.md`;
const MARKER_BYTES = '# Owned E2E fixture\n\nworkbench-outline-saving.e2e.ts\n';
const STUDIO = `${ROOT}/Studio`;
const OVERLAP = `${ROOT}/Overlap`;
const SEACOW = `${ROOT}/SEACOW workshop`;
const SCREENSHOT_DIR = path.resolve('test/screenshots');
const WIDTHS = [1200, 480, 320] as const;

const FIXTURE_FOLDERS = [
	ROOT,
	STUDIO,
	`${STUDIO}/Projects`,
	`${STUDIO}/Projects/Reviewed project`,
	`${STUDIO}/Areas`,
	`${STUDIO}/Resources`,
	`${STUDIO}/Archive`,
	OVERLAP,
	`${OVERLAP}/0 - Tasks, Planning`,
	`${OVERLAP}/0 - Tasks, Planning/Reviewed intake`,
	`${OVERLAP}/1 - Workspaces, Projects`,
	`${OVERLAP}/1 - Workspaces, Projects/Reviewed workspace`,
	`${OVERLAP}/2 - Areas, Initiatives`,
	`${OVERLAP}/3 - Docs, Intel, SOPs`,
	SEACOW,
	`${SEACOW}/Capture`,
	`${SEACOW}/Capture/Inbox`,
	`${SEACOW}/Entity`,
	`${SEACOW}/Output`,
	`${SEACOW}/Output/Main`,
	`${SEACOW}/Output/Main/10 - Projects`,
	`${SEACOW}/Output/Main/20 - Areas`,
	`${SEACOW}/System`,
	`${ROOT}/Unrelated notes`,
] as const;

const FIXTURE_FILES: Record<string, string> = {
	[MARKER_PATH]: MARKER_BYTES,
	[`${STUDIO}/Projects/reviewed.md`]: [
		'---',
		'tags: [hand-authored/m1]',
		'owner: outline-saving-e2e',
		'---',
		'# Reviewed project',
		'',
		'These bytes must remain unchanged while disabled rules are saved.',
	].join('\n'),
	[`${OVERLAP}/1 - Workspaces, Projects/overlap.md`]: [
		'---',
		'tags: [manual/overlap]',
		'---',
		'# Overlap fixture',
	].join('\n'),
};

const RULE_OPTIONS = {
	createFolders: false,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: false,
	syncOnFileMove: false,
	syncOnFileRename: false,
};

const INSTALLED_VALID_ID = 'e2e-outline-m1-installed-valid';
const INSTALLED_INVALID_ID = 'e2e-outline-m1-installed-invalid';
const INSTALLED_RULES = [
	{
		id: INSTALLED_VALID_ID,
		name: 'Installed project competitor',
		description: 'Synthetic enabled competitor for the M1 comparison.',
		enabled: true,
		priority: 10,
		group: 'installed-valid',
		direction: 'folder-to-tag',
		folderPattern: `^${STUDIO}/Projects(?:/|$)`,
		folderEntryPoint: `${STUDIO}/Projects`,
		tagEntryPoint: 'installed-project',
		folderTransforms: { caseTransform: 'none' },
		tagTransforms: { caseTransform: 'kebab-case' },
		options: { ...RULE_OPTIONS },
	},
	{
		id: INSTALLED_INVALID_ID,
		name: 'Installed invalid areas rule',
		description: 'Synthetic invalid installed output must not be blamed on a draft.',
		enabled: true,
		priority: 10,
		group: 'installed-invalid',
		direction: 'folder-to-tag',
		folderPattern: `^${STUDIO}/Areas(?:/|$)`,
		folderEntryPoint: `${STUDIO}/Areas`,
		tagEntryPoint: '#/',
		folderTransforms: { caseTransform: 'none' },
		tagTransforms: { caseTransform: 'none' },
		options: { ...RULE_OPTIONS },
	},
] as const;

interface FixtureSnapshot {
	folders: string[];
	files: Record<string, string>;
}

let originalSettings: unknown;
let originalLayout: Record<string, unknown>;
let originalWindowSize: { width: number; height: number };
let originalTheme: 'light' | 'dark';
let reviewedState: Record<string, unknown>;
let expectedSavedIds: string[] = [];
let declinedOccurrenceKey = '';
let declinedRuleIds: string[] = [];
let includedOccurrenceKeys: string[] = [];

async function snap(name: string): Promise<void> {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

async function settle(): Promise<void> {
	let previous = '';
	await browser.waitUntil(async () => {
		const signature = await browser.executeObsidian(() => {
			const outline = document.querySelector<HTMLElement>('[data-dtf-workbench-outline="1"]');
			if (!outline) return 'missing';
			const active = document.activeElement as HTMLElement | null;
			return JSON.stringify({
				width: outline.clientWidth,
				height: outline.clientHeight,
				scrollWidth: outline.scrollWidth,
				scrollHeight: outline.scrollHeight,
				step: outline.dataset.dtfOutlineStep,
				focus: active?.dataset.dtfOutlineFocus ?? active?.tagName ?? '',
			});
		});
		const stable = signature !== 'missing' && signature === previous;
		previous = signature;
		return stable;
	}, {
		timeout: 5_000,
		interval: 100,
		timeoutMsg: 'Outline geometry did not reach a stable rendered state',
	});
}

async function waitForOutline(): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian(() => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		return shell?.dataset.dtfWorkbenchCurrentSurface === 'outline'
			&& shell.querySelector('[data-dtf-workbench-outline="1"]') !== null
			&& shell.querySelector<HTMLElement>('[data-dtf-workbench-status]')
				?.dataset.dtfWorkbenchStatus === 'ready';
	}), {
		timeout: 20_000,
		timeoutMsg: 'Annotated outline did not become ready',
	});
}

async function openOutline(state?: Record<string, unknown>): Promise<void> {
	const opened = await browser.executeObsidian(({ app }, commandId) => {
		const commands = (app as unknown as {
			commands: { executeCommandById(id: string): boolean };
		}).commands;
		return commands.executeCommandById(commandId);
	}, COMMAND_ID);
	expect(opened).toBe(true);
	await waitForOutline();
	if (state) {
		await browser.executeObsidian(async ({ app }, viewType, nextState) => {
			type LeafLike = { setViewState(state: Record<string, unknown>): Promise<void> };
			const leaf = (app.workspace as unknown as {
				getLeavesOfType(type: string): LeafLike[];
			}).getLeavesOfType(viewType)[0];
			if (!leaf) throw new Error('Missing outline leaf while restoring reviewed state');
			await leaf.setViewState({ type: viewType, active: true, state: nextState });
		}, VIEW_TYPE, state);
		await waitForOutline();
	}
}

async function closeWorkbench(): Promise<void> {
	await browser.executeObsidian(({ app }, viewType) => {
		app.workspace.detachLeavesOfType(viewType);
		(app as unknown as { setting?: { close?(): void } }).setting?.close?.();
	}, VIEW_TYPE);
}

async function setStep(step: 1 | 2 | 3): Promise<void> {
	const clicked = await browser.executeObsidian((_context, target) => {
		const button = document.querySelector<HTMLButtonElement>(
			`[data-dtf-outline-step-button="${target}"]`,
		);
		button?.click();
		return Boolean(button);
	}, step);
	expect(clicked).toBe(true);
	await browser.waitUntil(async () => browser.executeObsidian((_context, target) =>
		document.querySelector<HTMLElement>('[data-dtf-workbench-outline="1"]')
			?.dataset.dtfOutlineStep === String(target), step), {
		timeout: 10_000,
		timeoutMsg: `Outline did not move to step ${step}`,
	});
	await settle();
}

async function setManaged(anchorPath: string, managed: boolean): Promise<void> {
	const found = await browser.executeObsidian((_context, anchor, expected) => {
		const checkbox = Array.from(
			document.querySelectorAll<HTMLInputElement>('[data-dtf-outline-manage-checkbox]'),
		).find((candidate) => candidate.dataset.dtfOutlineManageCheckbox === anchor
			&& !candidate.disabled);
		if (!checkbox) return false;
		if (checkbox.checked !== expected) checkbox.click();
		return true;
	}, anchorPath, managed);
	expect(found).toBe(true);
	await waitForOutline();
	await browser.waitUntil(async () => browser.executeObsidian(({ app }, viewType, anchor, expected) => {
		const state = app.workspace.getLeavesOfType(viewType)[0]?.view.getState() as unknown as {
			scope: { selectedPaths: string[] };
		};
		return state.scope.selectedPaths.includes(anchor) === expected;
	}, VIEW_TYPE, anchorPath, managed), {
		timeout: 15_000,
		timeoutMsg: `${anchorPath} did not become ${managed ? 'managed' : 'unmanaged'}`,
	});
}

async function fixtureSnapshot(): Promise<FixtureSnapshot> {
	return browser.executeObsidian(async ({ app }, root) => {
		const adapter = app.vault.adapter;
		const folders: string[] = [];
		const files: Record<string, string> = {};
		const visit = async (folder: string): Promise<void> => {
			const listing = await adapter.list(folder);
			for (const child of listing.folders.sort()) {
				folders.push(child);
				await visit(child);
			}
			for (const file of listing.files.sort()) files[file] = await adapter.read(file);
		};
		if (await adapter.exists(root)) {
			folders.push(root);
			await visit(root);
		}
		return { folders, files };
	}, ROOT);
}

async function readSettingsRules(): Promise<Array<{ id: string; name: string; enabled: boolean }>> {
	return browser.executeObsidian(({ app }) => {
		const plugin = (app as unknown as {
			plugins: { plugins: Record<string, {
				settings: { rules: Array<{ id: string; name: string; enabled: boolean }> };
			}> };
		}).plugins.plugins['folder-tag-sync'];
		return plugin.settings.rules.map((rule) => ({
			id: rule.id,
			name: rule.name,
			enabled: rule.enabled,
		}));
	});
}

/**
 * Visual scaffolding. The draft version of this helper forced the first
 * ancestor that merely had more than one non-zero-width child, which is not
 * necessarily the horizontal split container: a stacked (column) parent
 * happily accepts `width: 320px !important` on one child while its siblings
 * keep their own width, so the workbench pane ends up hanging outside the
 * viewport and the screenshots are of a pane the user could never see.
 *
 * Reuse the proven contract from test/specs/workbench-outline-prototype.e2e.ts
 * (`setWorkbenchSplitDimension`, :84-157) instead: require a true side-by-side
 * sibling on the requested axis before adopting a node as the resize target,
 * and cache that target while it stays connected.
 *
 * Settling stays with this spec's own `settle()` (geometry polled to a stable
 * fixpoint). The prototype settles on a double `requestAnimationFrame` inside
 * the page; under this harness that frame callback does not always run while
 * the window is unfocused, and awaiting it inside `executeObsidian` wedges the
 * renderer for the full script timeout. `settle()` observes the same thing
 * without depending on a frame ever being painted.
 *
 * `clearWorkbenchSplitDimension` puts every forced style back so the later,
 * non-visual part of the journey runs at real geometry.
 */
async function ensureWidthSplit(): Promise<void> {
	await browser.executeObsidian(async ({ app }, viewType) => {
		type LeafLike = {
			containerEl: HTMLElement;
			setViewState(state: Record<string, unknown>): Promise<void>;
		};
		const workspace = app.workspace as unknown as {
			getLeavesOfType(type: string): LeafLike[];
			createLeafBySplit(leaf: LeafLike, direction: 'vertical', before?: boolean): LeafLike;
		};
		const globals = globalThis as unknown as {
			__dtfOutlineSavingLeaf?: LeafLike;
			__dtfOutlineSavingSibling?: LeafLike;
		};
		const leaf = workspace.getLeavesOfType(viewType)[0];
		if (!leaf) throw new Error('Missing Workbench leaf for visual split');
		globals.__dtfOutlineSavingLeaf = leaf;
		if (!globals.__dtfOutlineSavingSibling?.containerEl.isConnected) {
			const sibling = workspace.createLeafBySplit(leaf, 'vertical', true);
			await sibling.setViewState({ type: 'empty', active: false });
			globals.__dtfOutlineSavingSibling = sibling;
		}
	}, VIEW_TYPE);
	await settle();
}

interface WorkbenchWidthMeasurement {
	shellWidth: number;
	targetRect: { left: number; right: number; width: number };
	outlineRect: { left: number; right: number; width: number };
	viewportWidth: number;
}

async function setWorkbenchWidth(width: number): Promise<WorkbenchWidthMeasurement> {
	await browser.executeObsidian((_context, requested) => {
		type LeafLike = { containerEl: HTMLElement };
		const globals = globalThis as unknown as {
			__dtfOutlineSavingLeaf?: LeafLike;
			__dtfOutlineSavingWidthTarget?: HTMLElement;
			__dtfOutlineSavingWidthSiblings?: HTMLElement[];
		};
		const leaf = globals.__dtfOutlineSavingLeaf;
		if (!leaf) throw new Error('Missing owned Workbench split leaf');

		let target: HTMLElement | null = globals.__dtfOutlineSavingWidthTarget?.isConnected
			? globals.__dtfOutlineSavingWidthTarget
			: null;
		let siblings: HTMLElement[] = target?.parentElement
			? Array.from(target.parentElement.children)
				.filter((child): child is HTMLElement => child instanceof HTMLElement && child !== target)
			: [];
		let node = leaf.containerEl.closest<HTMLElement>('.workspace-tabs') ?? leaf.containerEl;
		while (!target && node.parentElement) {
			const parent = node.parentElement;
			const candidates = Array.from(parent.children)
				.filter((child): child is HTMLElement => child instanceof HTMLElement)
				.filter((child) => child.getBoundingClientRect().width > 0
					&& child.getBoundingClientRect().height > 0);
			if (candidates.length > 1 && candidates.includes(node)) {
				const rect = node.getBoundingClientRect();
				// A real horizontal split sibling shares the row and sits beside
				// this node. A stacked sibling does not, and forcing a width on a
				// column child is how the pane left the viewport.
				const hasAxisSibling = candidates.some((candidate) => {
					if (candidate === node) return false;
					const other = candidate.getBoundingClientRect();
					return Math.abs(other.top - rect.top) <= 4 && Math.abs(other.left - rect.left) > 4;
				});
				if (hasAxisSibling) {
					target = node;
					siblings = candidates.filter((candidate) => candidate !== node);
					break;
				}
			}
			node = parent;
		}
		if (!target) throw new Error('Could not find the actual Workbench width split container');
		globals.__dtfOutlineSavingWidthTarget = target;
		globals.__dtfOutlineSavingWidthSiblings = siblings;

		target.style.setProperty('flex', `0 0 ${requested}px`, 'important');
		target.style.setProperty('flex-basis', `${requested}px`, 'important');
		target.style.setProperty('width', `${requested}px`, 'important');
		target.style.setProperty('min-width', '0', 'important');
		target.style.setProperty('min-height', '0', 'important');
		target.style.removeProperty('height');
		for (const sibling of siblings) {
			sibling.style.setProperty('flex', '1 1 0', 'important');
			sibling.style.removeProperty('flex-basis');
			sibling.style.removeProperty('width');
			sibling.style.setProperty('min-width', '0', 'important');
			sibling.style.setProperty('min-height', '0', 'important');
		}
		window.dispatchEvent(new Event('resize'));
	}, width);
	await settle();
	return browser.executeObsidian(() => {
		const globals = globalThis as unknown as { __dtfOutlineSavingWidthTarget?: HTMLElement };
		const target = globals.__dtfOutlineSavingWidthTarget;
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		const outline = document.querySelector<HTMLElement>('[data-dtf-workbench-outline="1"]');
		if (!target || !shell || !outline) throw new Error('Missing settled Workbench geometry');
		const targetRect = target.getBoundingClientRect();
		const outlineRect = outline.getBoundingClientRect();
		return {
			shellWidth: shell.clientWidth,
			targetRect: { left: targetRect.left, right: targetRect.right, width: targetRect.width },
			outlineRect: { left: outlineRect.left, right: outlineRect.right, width: outlineRect.width },
			viewportWidth: window.innerWidth,
		};
	});
}

async function clearWorkbenchSplitDimension(): Promise<void> {
	await browser.executeObsidian(() => {
		const globals = globalThis as unknown as {
			__dtfOutlineSavingWidthTarget?: HTMLElement;
			__dtfOutlineSavingWidthSiblings?: HTMLElement[];
		};
		const reset = (element: HTMLElement | undefined) => {
			if (!element) return;
			for (const property of ['flex', 'flex-basis', 'width', 'height', 'min-width', 'min-height']) {
				element.style.removeProperty(property);
			}
		};
		reset(globals.__dtfOutlineSavingWidthTarget);
		for (const sibling of globals.__dtfOutlineSavingWidthSiblings ?? []) reset(sibling);
		delete globals.__dtfOutlineSavingWidthTarget;
		delete globals.__dtfOutlineSavingWidthSiblings;
		window.dispatchEvent(new Event('resize'));
	});
	await settle();
}

async function setTheme(theme: 'light' | 'dark'): Promise<void> {
	await browser.executeObsidian((_context, next) => {
		document.body.classList.remove('theme-light', 'theme-dark');
		document.body.classList.add(`theme-${next}`);
	}, theme);
	await settle();
}

async function assertVisualCheckpoint(width: number, theme: 'light' | 'dark'): Promise<void> {
	// Measure once to learn where the split target actually starts, then clamp the
	// request to the space genuinely available to its right. A 1200px request in a
	// 1440px window previously produced a target spanning x344..1544 -- 104px off
	// the right edge -- and the old assertions passed it by only checking the
	// visible slice, so the "1200" screenshot was not evidence of a contained
	// 1200px pane. The narrow 480/320 requests fit inside the available space and
	// are therefore unchanged and still exact.
	const probe = await setWorkbenchWidth(width);
	const availableWidth = Math.max(0, probe.viewportWidth - probe.targetRect.left);
	const effectiveWidth = Math.min(width, availableWidth);
	const measured = effectiveWidth === width ? probe : await setWorkbenchWidth(effectiveWidth);
	expect(measured.shellWidth).toBeGreaterThan(0);
	// The pane is exactly the width we could actually ask for...
	expect(Math.abs(measured.targetRect.width - effectiveWidth)).toBeLessThanOrEqual(2);
	// ...and the whole pane is on screen, not merely its visible slice.
	expect({
		containedLeft: measured.targetRect.left >= -1,
		containedRight: measured.targetRect.right <= measured.viewportWidth + 1,
		requestedWidth: width,
		availableWidth,
		effectiveWidth,
		targetRect: measured.targetRect,
		viewportWidth: measured.viewportWidth,
	}).toEqual({
		containedLeft: true,
		containedRight: true,
		requestedWidth: width,
		availableWidth,
		effectiveWidth,
		targetRect: measured.targetRect,
		viewportWidth: measured.viewportWidth,
	});
	expect(Math.abs(measured.shellWidth - measured.targetRect.width)).toBeLessThanOrEqual(2);
	await setTheme(theme);
	const facts = await browser.executeObsidian(() => {
		const outline = document.querySelector<HTMLElement>('[data-dtf-workbench-outline="1"]')!;
		const rows = outline.querySelector<HTMLElement>('[data-dtf-outline-rows="1"]')!;
		const footer = outline.querySelector<HTMLElement>('[data-dtf-outline-footer="1"]')!;
		const save = outline.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]')!;
		const note = outline.querySelector<HTMLElement>('.dtf-outline-save-note')!;
		save.scrollIntoView({ block: 'nearest', behavior: 'instant' });
		save.focus({ preventScroll: true });
		const outlineRect = outline.getBoundingClientRect();
		const footerRect = footer.getBoundingClientRect();
		const saveRect = save.getBoundingClientRect();
		const inset = Math.min(4, saveRect.width / 4, saveRect.height / 4);
		const hitPoints = [
			[saveRect.left + inset, saveRect.top + inset],
			[saveRect.left + saveRect.width / 2, saveRect.top + inset],
			[saveRect.right - inset, saveRect.top + inset],
			[saveRect.left + inset, saveRect.top + saveRect.height / 2],
			[saveRect.left + saveRect.width / 2, saveRect.top + saveRect.height / 2],
			[saveRect.right - inset, saveRect.top + saveRect.height / 2],
			[saveRect.left + inset, saveRect.bottom - inset],
			[saveRect.left + saveRect.width / 2, saveRect.bottom - inset],
			[saveRect.right - inset, saveRect.bottom - inset],
		] as const;
		const saveEntirelyHitTestable = hitPoints.every(([x, y]) => {
			const hit = document.elementFromPoint(x, y);
			return Boolean(hit && save.contains(hit));
		});
		note.scrollIntoView({ block: 'nearest', behavior: 'instant' });
		const noteRect = note.getBoundingClientRect();
		const noteReachable = noteRect.width > 0 && noteRect.height > 0
			&& noteRect.left >= outlineRect.left - 1 && noteRect.right <= outlineRect.right + 1
			&& noteRect.top >= 0 && noteRect.bottom <= window.innerHeight;
		save.scrollIntoView({ block: 'nearest', behavior: 'instant' });
		save.focus({ preventScroll: true });
		const finalSaveRect = save.getBoundingClientRect();
		const contained = (element: HTMLElement) => {
			const rect = element.getBoundingClientRect();
			return rect.left >= outlineRect.left - 1 && rect.right <= outlineRect.right + 1;
		};
		const offenders = Array.from(outline.querySelectorAll<HTMLElement>(
			'.dtf-outline-confirmation, .dtf-outline-error, .dtf-outline-behavior-comparison, .dtf-outline-footer-controls',
		)).filter((element) => !contained(element)).map((element) => element.className);
		const footerRailCrossings = Array.from(
			outline.querySelectorAll<HTMLElement>('[data-dtf-outline-bracket]'),
		).filter((rail) => {
			const rect = rail.getBoundingClientRect();
			return rect.bottom > footerRect.top && rect.top < footerRect.bottom;
		}).length;
		return {
			outlineOverflow: outline.scrollWidth - outline.clientWidth,
			rowsOverflow: rows.scrollWidth - rows.clientWidth,
			outlineInsideViewport: outlineRect.left >= -1 && outlineRect.right <= window.innerWidth + 1,
			outlineRect: {
				left: Math.round(outlineRect.left),
				right: Math.round(outlineRect.right),
				width: Math.round(outlineRect.width),
				viewport: window.innerWidth,
			},
			offenders,
			footerRailCrossings,
			saveDisabled: save.disabled,
			saveFocused: document.activeElement === save,
			saveEntirelyHitTestable,
			saveVisible: finalSaveRect.width > 0 && finalSaveRect.height > 0
				&& finalSaveRect.top >= 0 && finalSaveRect.bottom <= window.innerHeight,
			saveInsideOutline: finalSaveRect.left >= outlineRect.left - 1
				&& finalSaveRect.right <= outlineRect.right + 1,
			noteReachable,
			noteText: note.textContent ?? '',
		};
	});
	// Capture after the measurement, before the assertions: the picture then
	// shows the exact state that was measured — Save scrolled into view and
	// focused — and a failing checkpoint still leaves that picture behind.
	console.log(`[outline-saving-visual] ${JSON.stringify({
		requestedWidth: width, availableWidth, effectiveWidth, theme, measured, facts,
	})}`);
	// Name the file by the width the pane actually has, so a clamped checkpoint is
	// never filed as proof of the width that was merely requested.
	await snap(`outline-saving-m1-${effectiveWidth}-${theme}`);
	expect(facts.outlineOverflow).toBeLessThanOrEqual(1);
	expect(facts.rowsOverflow).toBeLessThanOrEqual(1);
	expect({ contained: facts.outlineInsideViewport, rect: facts.outlineRect })
		.toEqual({ contained: true, rect: facts.outlineRect });
	expect(facts.offenders).toEqual([]);
	expect(facts.footerRailCrossings).toBe(0);
	expect(facts.saveDisabled).toBe(false);
	expect(facts.saveFocused).toBe(true);
	expect(facts.saveEntirelyHitTestable).toBe(true);
	expect(facts.saveVisible).toBe(true);
	expect(facts.saveInsideOutline).toBe(true);
	expect(facts.noteReachable).toBe(true);
	expect(facts.noteText).toBe('New rules are saved disabled. No folders, notes, tags, or active rule states change.');
}

async function waitForSettingsFocus(
	expectedIds: readonly string[],
	handoff?: unknown,
): Promise<string> {
	// What the product actually promises here is a bounded pulse:
	// SettingsTab.consumeFocusRule (src/ui/SettingsTab.ts:62-82) waits ~50ms past
	// display(), then scrolls the row into view, makes it a keyboard return target
	// (tabIndex -1), focuses it and marks it data-dtf-rule-focus="active", and
	// removes that marker 2200ms later. Synchronise on that marker, taking the
	// whole observation in one in-page evaluation so the read cannot straddle the
	// pulse — the same contract as test/specs/workbench-novice-journey.e2e.ts:398.
	//
	// `document.activeElement` is deliberately NOT part of the wait condition.
	// el.focus() only moves the document's active element while the Obsidian
	// window itself holds OS focus, which this harness does not guarantee; making
	// it a gate turns an environment fact into a product verdict and can never
	// succeed on an unfocused window. It is asserted below whenever
	// document.hasFocus() says the assertion is meaningful.
	let observed = {
		activeTabId: null as string | null,
		focusedIds: [] as string[],
		activeElementId: '',
		documentHasFocus: false,
		focusedTabIndex: null as number | null,
		visibleIds: [] as string[],
	};
	await browser.waitUntil(async () => {
		observed = await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as {
				setting?: { activeTab?: { id?: string; containerEl?: HTMLElement } };
			}).setting;
			const container = setting?.activeTab?.containerEl;
			const rows = Array.from(container?.querySelectorAll<HTMLElement>('[data-dtf-rule-id]') ?? []);
			const pulsed = rows.filter((row) => row.dataset.dtfRuleFocus === 'active');
			return {
				activeTabId: setting?.activeTab?.id ?? null,
				focusedIds: pulsed.map((row) => row.dataset.dtfRuleId ?? ''),
				activeElementId: (document.activeElement as HTMLElement | null)?.dataset.dtfRuleId ?? '',
				documentHasFocus: document.hasFocus(),
				focusedTabIndex: pulsed[0]?.tabIndex ?? null,
				visibleIds: rows.filter((row) => {
					const rect = row.getBoundingClientRect();
					return row.offsetParent !== null && rect.width > 0 && rect.height > 0
						&& rect.top >= 0 && rect.bottom <= window.innerHeight;
				}).map((row) => row.dataset.dtfRuleId ?? ''),
			};
		});
		return observed.activeTabId === 'folder-tag-sync'
			&& observed.focusedIds.length === 1
			&& expectedIds.includes(observed.focusedIds[0])
			&& observed.visibleIds.includes(observed.focusedIds[0]);
	}, { timeout: 8_000, timeoutMsg: 'Settings did not focus exactly one saved rule' })
		.catch((error: Error) => {
			// `timeoutMsg` is a plain string built before `waitUntil` runs, so
			// interpolating the observation there only ever reports the initial
			// placeholder — which is how this failure was first read as "activeTab
			// stayed null". Report what was actually last seen instead.
			throw new Error(`${error.message}: last observation ${JSON.stringify(observed)}`
				+ ` (handoff: ${JSON.stringify(handoff ?? null)})`);
		});
	// The keyboard return target the product creates, and — only where the window
	// can actually own focus — that it really received it.
	expect(observed.focusedTabIndex).toBe(-1);
	if (observed.documentHasFocus) expect(observed.activeElementId).toBe(observed.focusedIds[0]);
	return observed.focusedIds[0];
}

describe('Taxonomy Workbench — M1 outline review and disabled save', function () {
	this.timeout(300_000);

	before(async function () {
		const setup = await browser.executeObsidian(async ({ app }, root, markerPath, markerBytes, folders, files, installedRules) => {
			type PluginLike = {
				settings: { rules: unknown[]; groupPrecedence?: string[] } & Record<string, unknown>;
				saveSettings(): Promise<void>;
			};
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, PluginLike> };
			}).plugins.plugins['folder-tag-sync'];
			const adapter = app.vault.adapter;
			const original = JSON.parse(JSON.stringify(plugin.settings));
			const layout = JSON.parse(JSON.stringify(app.workspace.getLayout())) as Record<string, unknown>;
			if (await adapter.exists(root)) {
				if (!(await adapter.exists(markerPath)) || await adapter.read(markerPath) !== markerBytes) {
					throw new Error(`Refusing to remove non-owned fixture root: ${root}`);
				}
				const existing = app.vault.getAbstractFileByPath(root);
				if (existing) await app.vault.delete(existing, true);
				else await adapter.rmdir(root, true);
			}
			plugin.settings = {
				...plugin.settings,
				rules: installedRules,
				groupPrecedence: ['para', 'jd', 'enterprise-jd', 'seacow-outer', 'installed-valid', 'installed-invalid'],
			};
			await plugin.saveSettings();
			for (const folder of folders) {
				if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
			}
			for (const [filePath, bytes] of Object.entries(files)) await adapter.write(filePath, bytes as string);
			return {
				original,
				layout,
				windowSize: { width: window.outerWidth, height: window.outerHeight },
				theme: document.body.classList.contains('theme-light') ? 'light' : 'dark',
			};
		}, ROOT, MARKER_PATH, MARKER_BYTES, [...FIXTURE_FOLDERS], FIXTURE_FILES, INSTALLED_RULES);
		originalSettings = setup.original;
		originalLayout = setup.layout;
		originalWindowSize = setup.windowSize;
		originalTheme = setup.theme;
		await browser.waitUntil(async () => browser.executeObsidian(async ({ app }, root, files) => {
			if (!(await app.vault.adapter.exists(root))) return false;
			for (const filePath of Object.keys(files)) {
				if (!(await app.vault.adapter.exists(filePath))) return false;
			}
			return true;
		}, ROOT, FIXTURE_FILES), {
			timeout: 10_000,
			timeoutMsg: 'Owned M1 fixture did not become available',
		});
	});

	after(async function () {
		// Bounded teardown phases: close owned UI, remove only marker-owned fixture,
		// restore layout/theme/window, then restore the user settings last.
		await closeWorkbench();
		const removal = await browser.executeObsidian(async ({ app }, root, markerPath, markerBytes) => {
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(root))) return 'already-absent';
			if (!(await adapter.exists(markerPath)) || await adapter.read(markerPath) !== markerBytes) {
				throw new Error(`Refusing to remove fixture without its ownership marker: ${root}`);
			}
			const existing = app.vault.getAbstractFileByPath(root);
			if (existing) await app.vault.delete(existing, true);
			else await adapter.rmdir(root, true);
			return 'removed';
		}, ROOT, MARKER_PATH, MARKER_BYTES);
		expect(['removed', 'already-absent']).toContain(removal);
		await browser.waitUntil(async () => browser.executeObsidian(
			async ({ app }, root) => !(await app.vault.adapter.exists(root)), ROOT,
		), { timeout: 10_000, timeoutMsg: `Owned fixture ${ROOT} was not removed` });
		await browser.executeObsidian(async ({ app }, layout, theme, size) => {
			await app.workspace.changeLayout(layout as Record<string, unknown>);
			document.body.classList.remove('theme-light', 'theme-dark');
			document.body.classList.add(`theme-${theme}`);
			window.resizeTo(size.width, size.height);
			const globals = globalThis as unknown as Record<string, unknown>;
			delete globals.__dtfOutlineSavingLeaf;
			delete globals.__dtfOutlineSavingSibling;
			delete globals.__dtfOutlineSavingWidthTarget;
		}, originalLayout, originalTheme, originalWindowSize);
		await browser.executeObsidian(async ({ app }, settings) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { settings: unknown; saveSettings(): Promise<void> }> };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings = settings;
			await plugin.saveSettings();
		}, originalSettings);
	});

	it('blocks an invalid chosen draft while attributing invalid installed behavior separately', async function () {
		await openOutline();
		await setStep(2);
		await setManaged(SEACOW, true);
		await setStep(3);
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const status = document.querySelector<HTMLElement>('[data-dtf-outline-review-status="1"]');
			const save = document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]');
			return (status?.textContent ?? '').includes('Save blocked: a chosen draft generates invalid tag syntax.')
				&& save?.disabled === true;
		}), { timeout: 10_000, timeoutMsg: 'Invalid chosen draft did not block guided Save' });
		const blocked = await browser.executeObsidian(() => ({
			text: document.querySelector('[data-dtf-outline-review-status="1"]')?.textContent ?? '',
			confirmation: document.querySelector('[data-dtf-outline-confirmation="1"]') !== null,
		}));
		expect(blocked.text).toContain('Deselect');
		expect(blocked.confirmation).toBe(false);
		expect((await readSettingsRules()).map((rule) => rule.id)).toEqual([
			INSTALLED_VALID_ID,
			INSTALLED_INVALID_ID,
		]);

		await setStep(2);
		await setManaged(SEACOW, false);
		await setManaged(STUDIO, true);
		await setManaged(OVERLAP, true);
		const choice = await browser.executeObsidian((_context, anchor) => {
			const boxes = Array.from(document.querySelectorAll<HTMLInputElement>(
				`[data-dtf-outline-choice-anchor="${CSS.escape(anchor)}"]`,
			));
			const current = boxes.find((box) => box.checked);
			const alternative = boxes.find((box) => !box.checked);
			if (!current || !alternative) return null;
			const result = {
				declined: current.dataset.dtfOutlineChoice ?? '',
				included: alternative.dataset.dtfOutlineChoice ?? '',
			};
			alternative.click();
			return result;
		}, OVERLAP);
		expect(choice).not.toBeNull();
		declinedOccurrenceKey = choice!.declined;
		await browser.waitUntil(async () => browser.executeObsidian((_context, included, declined) => {
			const read = (key: string) => document.querySelector<HTMLInputElement>(
				`[data-dtf-outline-choice="${CSS.escape(key)}"]`,
			)?.checked;
			return read(included) === true && read(declined) === false;
		}, choice!.included, choice!.declined), {
			timeout: 5_000,
			timeoutMsg: 'Explicit co-anchored occurrence choice did not persist',
		});

		const review = await browser.executeObsidian(({ app }, viewType, declined) => {
			type Candidate = { occurrenceKey: string; rule: { id: string } };
			const view = app.workspace.getLeavesOfType(viewType)[0]?.view as unknown as {
				getState(): Record<string, unknown>;
				snapshot: { candidatePlan: { candidates: Candidate[] } | null };
			};
			const checked = Array.from(document.querySelectorAll<HTMLInputElement>('[data-dtf-outline-choice]:checked'))
				.map((box) => box.dataset.dtfOutlineChoice ?? '')
				.filter(Boolean);
			const checkedSet = new Set(checked);
			const candidates = view.snapshot.candidatePlan?.candidates ?? [];
			return {
				state: view.getState(),
				checked,
				expectedIds: candidates.filter((candidate) => checkedSet.has(candidate.occurrenceKey))
					.map((candidate) => candidate.rule.id),
				declinedIds: candidates.filter((candidate) => candidate.occurrenceKey === declined)
					.map((candidate) => candidate.rule.id),
			};
		}, VIEW_TYPE, declinedOccurrenceKey);
		reviewedState = review.state;
		includedOccurrenceKeys = review.checked;
		expectedSavedIds = review.expectedIds;
		declinedRuleIds = review.declinedIds;
		expect(includedOccurrenceKeys.length).toBeGreaterThanOrEqual(2);
		expect(expectedSavedIds.length).toBeGreaterThanOrEqual(5);
		expect(declinedRuleIds.length).toBeGreaterThan(0);
		await setStep(3);

		const comparison = await browser.executeObsidian((_context, projectFolder, areasFolder) => {
			const read = (folder: string) => {
				const details = document.querySelector<HTMLDetailsElement>(
					`[data-dtf-outline-behavior-comparison="${CSS.escape(folder)}"]`,
				);
				if (details && !details.open) details.querySelector<HTMLElement>('summary')?.click();
				const outcomes = Array.from(details?.querySelectorAll<HTMLElement>('.dtf-outline-behavior-outcome') ?? []);
				return {
					summary: details?.querySelector('summary')?.textContent ?? '',
					current: outcomes[0]?.textContent ?? '',
					hypothetical: outcomes[1]?.textContent ?? '',
				};
			};
			return { project: read(projectFolder), areas: read(areasFolder) };
		}, `${STUDIO}/Projects`, `${STUDIO}/Areas`);
		expect(comparison.project.current).toContain('Installed rule: Installed project competitor');
		expect(comparison.project.hypothetical).toContain('Proposed rule: PARA: Projects');
		expect(comparison.project.summary).toContain('Behavior changes');
		expect(comparison.areas.current).toContain('produces invalid output');
		expect(comparison.areas.current).toContain('Installed rule: Installed invalid areas rule');
		expect(comparison.areas.hypothetical).toContain('Proposed rule: PARA: Areas');
		const unrelatedComparison = await browser.executeObsidian((_context, folder) =>
			document.querySelector(`[data-dtf-outline-behavior-comparison="${CSS.escape(folder)}"]`) !== null,
		`${ROOT}/Unrelated notes`);
		expect(unrelatedComparison).toBe(false);
		const saveState = await browser.executeObsidian(() => ({
			text: document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]')?.textContent ?? '',
			disabled: document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]')?.disabled ?? true,
			blocked: (document.querySelector('[data-dtf-outline-review-status="1"]')?.textContent ?? '')
				.includes('Save blocked:'),
		}));
		expect(saveState.text).toBe(`Save ${expectedSavedIds.length} disabled rules`);
		expect(saveState.disabled).toBe(false);
		expect(saveState.blocked).toBe(false);
	});

	it('cancels with zero added rules and refuses a stale confirmation without writing drafts', async function () {
		const before = await readSettingsRules();
		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-outline-confirmation="1"]') !== null,
		), { timeout: 5_000, timeoutMsg: 'Save confirmation did not open for cancellation' });
		await browser.executeObsidian(() => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-outline-confirmation="1"] button'))
				.find((button) => button.textContent?.trim() === 'Cancel')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-outline-confirmation="1"]') === null,
		), { timeout: 5_000, timeoutMsg: 'Save confirmation did not cancel' });
		expect(await readSettingsRules()).toEqual(before);

		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-outline-confirmation="1"]') !== null,
		), { timeout: 5_000, timeoutMsg: 'Save confirmation did not reopen for stale guard' });
		await browser.executeObsidian(async ({ app }, id) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: Array<{ id: string; description?: string }> };
					saveSettings(): Promise<void>;
				}> };
			}).plugins.plugins['folder-tag-sync'];
			const competitor = plugin.settings.rules.find((rule) => rule.id === id);
			if (!competitor) throw new Error('Missing installed competitor for stale mutation');
			competitor.description = 'Changed after review to force a real settings revision.';
			await plugin.saveSettings();
		}, INSTALLED_VALID_ID);
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const text = document.querySelector('[data-dtf-outline-review-status="1"]')?.textContent ?? '';
			return text.includes('Saving is paused until the refreshed proposal is reviewed.')
				&& document.querySelector('[data-dtf-outline-confirmation="1"]') === null
				&& document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]')?.disabled === true;
		}), { timeout: 5_000, timeoutMsg: 'Stale settings revision did not close and block confirmation' });
		expect((await readSettingsRules()).map((rule) => rule.id)).toEqual([
			INSTALLED_VALID_ID,
			INSTALLED_INVALID_ID,
		]);
	});

	it('saves the exact reviewed IDs disabled, preserves fixture bytes/topology, and focuses the exact Settings row', async function () {
		await closeWorkbench();
		await openOutline(reviewedState);
		await setStep(3);
		await browser.waitUntil(async () => browser.executeObsidian((_context, count) => {
			const save = document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]');
			return save?.textContent?.trim() === `Save ${count} disabled rules` && !save.disabled;
		}, expectedSavedIds.length), {
			timeout: 15_000,
			timeoutMsg: 'Fresh reopened review did not restore the exact saveable set',
		});

		await browser.executeObsidian(() => window.resizeTo(1440, 1000));
		await settle();
		await ensureWidthSplit();
		for (const width of WIDTHS) {
			for (const theme of ['light', 'dark'] as const) {
				await assertVisualCheckpoint(width, theme);
			}
		}

		// The visual split is test scaffolding, not part of the save journey. Drop
		// the forced `!important` geometry first — `changeLayout` restores the leaf
		// tree but not inline styles on a reused container — then return to the
		// captured real workspace layout and reopen the reviewed state before
		// exercising the exact post-save Settings handoff.
		await clearWorkbenchSplitDimension();
		await browser.executeObsidian(async ({ app }, layout) => {
			await app.workspace.changeLayout(layout as Record<string, unknown>);
			const globals = globalThis as unknown as Record<string, unknown>;
			delete globals.__dtfOutlineSavingLeaf;
			delete globals.__dtfOutlineSavingSibling;
			delete globals.__dtfOutlineSavingWidthTarget;
			delete globals.__dtfOutlineSavingWidthSiblings;
		}, originalLayout);
		await openOutline(reviewedState);
		await setStep(3);
		await browser.waitUntil(async () => browser.executeObsidian((_context, count) => {
			const save = document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]');
			return save?.textContent?.trim() === `Save ${count} disabled rules` && !save.disabled;
		}, expectedSavedIds.length), {
			timeout: 15_000,
			timeoutMsg: 'Clean unsplit review did not restore the exact saveable set',
		});

		const beforeSaveFixture = await fixtureSnapshot();
		const beforeSaveRules = await readSettingsRules();
		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian((_context, count, systems) => {
			const confirmation = document.querySelector<HTMLElement>('[data-dtf-outline-confirmation="1"]');
			const text = confirmation?.textContent ?? '';
			return text.includes(`Save ${count} disabled rules?`)
				&& text.includes(`${systems} selected systems produce ${count} reviewed rules`);
		}, expectedSavedIds.length, includedOccurrenceKeys.length), {
			timeout: 5_000,
			timeoutMsg: 'Confirmation did not consume the exact reviewed system/rule set',
		});
		await browser.executeObsidian((_context, count) => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-outline-confirmation="1"] button'))
				.find((button) => button.textContent?.trim() === `Save ${count} disabled rules`)?.click();
		}, expectedSavedIds.length);
		await browser.waitUntil(async () => browser.executeObsidian((_context, count) =>
			(document.querySelector('[data-dtf-outline-review-status="1"]')?.textContent ?? '')
				.includes(`${count} disabled rules saved`), expectedSavedIds.length), {
			timeout: 20_000,
			timeoutMsg: 'Exact disabled-rule save result did not appear',
		});

		const afterSaveRules = await readSettingsRules();
		expect(afterSaveRules.slice(0, beforeSaveRules.length)).toEqual(beforeSaveRules);
		expect(afterSaveRules.slice(beforeSaveRules.length).map((rule) => rule.id)).toEqual(expectedSavedIds);
		expect(afterSaveRules.slice(beforeSaveRules.length).every((rule) => rule.enabled === false)).toBe(true);
		expect(afterSaveRules.find((rule) => rule.id === INSTALLED_VALID_ID)?.enabled).toBe(true);
		expect(afterSaveRules.find((rule) => rule.id === INSTALLED_INVALID_ID)?.enabled).toBe(true);
		for (const declinedId of declinedRuleIds) {
			expect(afterSaveRules.some((rule) => rule.id === declinedId)).toBe(false);
		}
		expect(await fixtureSnapshot()).toEqual(beforeSaveFixture);

		// Take the receipt handoff the way a person does: find the single visible
		// receipt button and click it. Everything observable about that click is
		// captured in the same in-page task, so a failure names the actual cause
		// (no button, a detached duplicate, a thrown handler, a missing settings
		// tab) instead of only reporting that focus never arrived.
		const handoff = await browser.executeObsidian(({ app }) => {
			const errors: string[] = [];
			const onError = (event: ErrorEvent) => errors.push(
				`${event.message} @ ${event.filename}:${event.lineno}`,
			);
			const onRejection = (event: PromiseRejectionEvent) =>
				errors.push(`unhandled rejection: ${String(event.reason)}`);
			window.addEventListener('error', onError);
			window.addEventListener('unhandledrejection', onRejection);
			const statuses = Array.from(
				document.querySelectorAll<HTMLElement>('[data-dtf-outline-review-status="1"]'),
			);
			const buttons = statuses.flatMap((status) =>
				Array.from(status.querySelectorAll<HTMLButtonElement>('button')));
			const matches = buttons.filter(
				(candidate) => candidate.textContent?.trim() === 'Review saved rule in settings',
			);
			const button = matches[0];
			const rect = button?.getBoundingClientRect();
			const hitTarget = rect
				? document.elementFromPoint(rect.left + rect.width / 2, rect.top + rect.height / 2)
				: null;
			let thrown: string | null = null;
			try {
				button?.click();
			} catch (error) {
				thrown = String(error);
			}
			window.removeEventListener('error', onError);
			window.removeEventListener('unhandledrejection', onRejection);
			const setting = (app as unknown as {
				setting?: {
					activeTab?: { id?: string; containerEl?: HTMLElement };
					settingTabs?: Array<{ id?: string }>;
					pluginTabs?: Array<{ id?: string }>;
				};
			}).setting;
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { focusRuleId?: string }> };
			}).plugins.plugins['folder-tag-sync'];
			return {
				statusCount: statuses.length,
				matchCount: matches.length,
				connected: button?.isConnected ?? false,
				reachable: Boolean(button && hitTarget && button.contains(hitTarget)),
				thrown,
				errors,
				settingPresent: Boolean(setting),
				// The rendered settings surface the user lands on. Obsidian's
				// modal keeps its own containerEl detached, so the honest probe
				// is the active tab's own container (same one asserted by
				// test/specs/workbench-novice-journey.e2e.ts:413).
				activeTabConnected: setting?.activeTab?.containerEl?.isConnected ?? false,
				activeTabId: setting?.activeTab?.id ?? null,
				tabIds: [
					...(setting?.settingTabs ?? []),
					...(setting?.pluginTabs ?? []),
				].map((tab) => tab.id ?? ''),
				pendingFocus: plugin.focusRuleId ?? null,
			};
		});
		expect(handoff.statusCount).toBe(1);
		expect(handoff.matchCount).toBe(1);
		expect(handoff.connected).toBe(true);
		expect(handoff.reachable).toBe(true);
		expect(handoff.thrown).toBeNull();
		expect(handoff.errors).toEqual([]);
		// The user's click alone must open plugin settings on this plugin's own
		// tab; nothing later in this test nudges it there.
		expect({ rendered: handoff.activeTabConnected, tab: handoff.activeTabId })
			.toEqual({ rendered: true, tab: 'folder-tag-sync' });
		const focusedSavedId = await waitForSettingsFocus(expectedSavedIds, handoff);
		expect(expectedSavedIds).toContain(focusedSavedId);
		expect(await fixtureSnapshot()).toEqual(beforeSaveFixture);
	});

	it('reopens as saved without duplicates and reports enabled, disabled, and edited same-ID rules truthfully', async function () {
		await closeWorkbench();
		await openOutline(reviewedState);
		await setStep(3);
		await browser.waitUntil(async () => browser.executeObsidian((_context, count) => {
			const status = document.querySelector('[data-dtf-outline-review-status="1"]')?.textContent ?? '';
			const save = document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]');
			return status.includes(`${count} already saved rules are unchanged and will not be duplicated`)
				&& save?.textContent?.trim() === 'No new rules to save'
				&& save.disabled;
		}, expectedSavedIds.length), {
			timeout: 15_000,
			timeoutMsg: 'Reopened outline did not reconcile persisted rules as already saved',
		});
		const countBeforeVariant = (await readSettingsRules()).length;
		expect(countBeforeVariant).toBe(INSTALLED_RULES.length + expectedSavedIds.length);

		expect(expectedSavedIds.length).toBeGreaterThanOrEqual(3);
		const activeSavedId = expectedSavedIds[0];
		const disabledSavedId = expectedSavedIds[1];
		const editedSavedId = expectedSavedIds[2];
		await browser.executeObsidian(async ({ app }, activeId, disabledId, editedId) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: Array<{ id: string; name: string; enabled: boolean }> };
					saveSettings(): Promise<void>;
				}> };
			}).plugins.plugins['folder-tag-sync'];
			const active = plugin.settings.rules.find((rule) => rule.id === activeId);
			const disabled = plugin.settings.rules.find((rule) => rule.id === disabledId);
			const edited = plugin.settings.rules.find((rule) => rule.id === editedId);
			if (!active || !disabled || !edited) throw new Error('Missing saved rules for installed-state variants');
			active.enabled = true;
			disabled.enabled = false;
			edited.name = `${edited.name} edited locally`;
			await plugin.saveSettings();
		}, activeSavedId, disabledSavedId, editedSavedId);

		await closeWorkbench();
		await openOutline(reviewedState);
		await setStep(3);
		const expectedUnchanged = expectedSavedIds.length - 1;
		const expectedDisabledUnchanged = expectedUnchanged - 1;
		await browser.waitUntil(async () => browser.executeObsidian(
			(_context, unchanged, disabledCount) => {
				const text = document.querySelector('[data-dtf-outline-review-status="1"]')?.textContent ?? '';
				return text.includes(`${unchanged} already saved rules are unchanged and will not be duplicated`)
					&& text.includes('1 active')
					&& text.includes(`${disabledCount} disabled`)
					&& text.includes('1 existing same-ID rule has changed')
					&& text.includes('Saving will not overwrite it');
			}, expectedUnchanged, expectedDisabledUnchanged), {
			timeout: 15_000,
			timeoutMsg: 'Saved enabled/disabled/edited reconciliation did not appear',
		});
		const variant = await browser.executeObsidian((_context, id) => {
			const status = document.querySelector<HTMLElement>('[data-dtf-outline-review-status="1"]');
			const review = Array.from(status?.querySelectorAll<HTMLButtonElement>('button') ?? [])
				.find((button) => button.textContent?.includes('edited locally'));
			const save = document.querySelector<HTMLButtonElement>('[data-dtf-outline-save="1"]');
			return {
				reviewPresent: Boolean(review),
				reviewText: review?.textContent ?? '',
				saveText: save?.textContent ?? '',
				saveDisabled: save?.disabled ?? false,
				rowId: id,
			};
		}, editedSavedId);
		expect(variant.reviewPresent).toBe(true);
		expect(variant.reviewText).toContain('in settings');
		expect(variant.saveText).toBe('No new rules to save');
		expect(variant.saveDisabled).toBe(true);
		expect((await readSettingsRules()).length).toBe(countBeforeVariant);
	});
});
