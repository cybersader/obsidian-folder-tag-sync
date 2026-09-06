/**
 * workbench-outline-prototype — real-Obsidian evaluation of the hidden
 * `outline` surface (the annotated-outline prototype).
 *
 * Captures the three guided steps at three container widths (plus dark mode,
 * the full-tags column and the conflict group at the widest) and asserts the
 * round-3 grammar the running app has to hold:
 *
 *   • no pseudo-folder rows — a system name is drawn INSIDE its anchor folder's
 *     own row, never on a row of its own;
 *   • one bracket lane per anchor, so co-anchored systems share it;
 *   • no hue anywhere until a system is checked, and then the SAME hue for that
 *     pack id in every later step;
 *   • the manage checkbox writes the shared checked-folder input;
 *   • the conflict line is self-contained and starts with "2 rules claim".
 *
 * Round-4 repairs this spec also guards:
 *
 *   • the fold word and the "N missing types — which?" link live on a SUB-ROW
 *     beneath the anchor, never in the anchor row;
 *   • "Not found" ghost rows appear only after "which?" is activated;
 *   • a disagreeing co-anchored group states counts, never two spliced statuses;
 *   • a conflicting folder row shows only the tag that is used;
 *   • no anchor row exceeds two text lines at 1200px.
 */

import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
import {
	buildUxLabOutlineFolders,
	UX_LAB_OUTLINE_ANCHORS,
	UX_LAB_ROOT,
} from '../helpers/uxLabFixture';

declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

const SCREENSHOT_DIR = path.resolve('test/screenshots');
const VIEW_TYPE = 'taxonomy-workbench-map';
const WIDTHS = [1200, 480, 320] as const;

let originalWindowSize: { width: number; height: number };
let originalLayout: Record<string, unknown>;
let originalSettings: unknown;
let originalSidebars: { leftCollapsed: boolean; rightCollapsed: boolean };
let backupRootPath: string | null = null;
let originalTheme: 'light' | 'dark' = 'dark';

async function snap(name: string): Promise<void> {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

async function waitForOutline(): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian(() => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		return shell?.dataset.dtfWorkbenchCurrentSurface === 'outline'
			&& shell.querySelector('[data-dtf-workbench-outline="1"]') !== null
			&& document.querySelector<HTMLElement>('[data-dtf-workbench-status]')
				?.dataset.dtfWorkbenchStatus === 'ready';
	}), {
		timeout: 20_000,
		timeoutMsg: 'Annotated outline prototype did not become ready',
	});
}

async function settleOutline(): Promise<void> {
	await browser.executeObsidian(async () => {
		await new Promise<void>((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
	});
}

async function resizeWindow(width: number, height: number): Promise<void> {
	await browser.executeObsidian((_context, size) => window.resizeTo(size.width, size.height), {
		width,
		height,
	});
	await settleOutline();
}

async function setWorkbenchSplitDimension(
	axis: 'width' | 'height',
	pixels: number,
): Promise<{ width: number; height: number }> {
	const measured = await browser.executeObsidian(async (_context, request) => {
		type LeafLike = { containerEl: HTMLElement };
		const globals = globalThis as unknown as {
			__dtfOutlineWorkbenchLeaf?: LeafLike;
			__dtfOutlineWidthTarget?: HTMLElement;
			__dtfOutlineHeightTarget?: HTMLElement;
		};
		const leaf = globals.__dtfOutlineWorkbenchLeaf;
		if (!leaf) throw new Error('Missing Workbench split leaf');

		const storedTarget = request.axis === 'width'
			? globals.__dtfOutlineWidthTarget
			: globals.__dtfOutlineHeightTarget;
		let node = leaf.containerEl.closest<HTMLElement>('.workspace-tabs') ?? leaf.containerEl;
		let target: HTMLElement | null = storedTarget?.isConnected ? storedTarget : null;
		let siblings: HTMLElement[] = target?.parentElement
			? Array.from(target.parentElement.children)
				.filter((child): child is HTMLElement => child instanceof HTMLElement && child !== target)
			: [];
		while (!target && node.parentElement) {
			const parent = node.parentElement;
			const candidates = Array.from(parent.children)
				.filter((child): child is HTMLElement => child instanceof HTMLElement)
				.filter((child) => child.getBoundingClientRect().width > 0
					&& child.getBoundingClientRect().height > 0);
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
		if (!target) throw new Error(`Could not find actual ${request.axis} split container`);
		if (request.axis === 'width') globals.__dtfOutlineWidthTarget = target;
		else globals.__dtfOutlineHeightTarget = target;

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
		await new Promise<void>((resolve) =>
			requestAnimationFrame(() => requestAnimationFrame(() => resolve())));
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		return { width: shell?.clientWidth ?? 0, height: shell?.clientHeight ?? 0 };
	}, { axis, pixels });
	await settleOutline();
	return measured;
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
		timeout: 5_000,
		timeoutMsg: `Outline did not move to step ${step}`,
	});
	await settleOutline();
}

async function setShowAllFolders(open: boolean): Promise<void> {
	await browser.executeObsidian((_context, expected) => {
		const toggle = document.querySelector<HTMLInputElement>('[data-dtf-outline-show-all="1"]');
		if (toggle && toggle.checked !== expected) toggle.click();
	}, open);
	await settleOutline();
}

/** Step 3's panel-local column mode: delta reading (off) or full tag chips (on). */
async function setShowFullTags(on: boolean): Promise<void> {
	const found = await browser.executeObsidian((_context, expected) => {
		const toggle = document.querySelector<HTMLInputElement>('[data-dtf-outline-full-tags="1"]');
		if (!toggle) return false;
		if (toggle.checked !== expected) toggle.click();
		return true;
	}, on);
	expect(found).toBe(true);
	await settleOutline();
	await dropFocus();
}

/** The harness vault opens dark, so light/dark captures are set explicitly. */
async function setTheme(theme: 'light' | 'dark'): Promise<void> {
	await browser.executeObsidian((_context, next) => {
		document.body.classList.remove('theme-light', 'theme-dark');
		document.body.classList.add(`theme-${next}`);
	}, theme);
	await settleOutline();
}

/**
 * Step 1's fold toggle on an anchor row — a word, not a glyph. Opening an
 * anchor reveals the real folders that identify the systems recognized there.
 */
async function openAnchor(anchorPath: string): Promise<void> {
	const clicked = await browser.executeObsidian((_context, anchor) => {
		const button = document.querySelector<HTMLButtonElement>(
			`[data-dtf-outline-fold="${anchor}"]`,
		);
		if (!button) return false;
		if (button.getAttribute('aria-expanded') !== 'true') button.click();
		return true;
	}, anchorPath);
	expect(clicked).toBe(true);
	await settleOutline();
	await dropFocus();
}

/**
 * A scripted click (no pointer interaction in the session) leaves the row
 * keyboard-focused, which paints the focus ring in captures; a real pointer
 * click would not, so drop focus after the panel has refocused the row.
 */
async function dropFocus(): Promise<void> {
	await browser.executeObsidian(() => {
		(document.activeElement as HTMLElement | null)?.blur();
	});
	await settleOutline();
}

async function setManaged(anchorPath: string, managed: boolean): Promise<void> {
	const clicked = await browser.executeObsidian((_context, anchor, expected) => {
		const checkbox = Array.from(
			document.querySelectorAll<HTMLInputElement>('[data-dtf-outline-manage-checkbox]'),
		).find((input) => input.dataset.dtfOutlineManageCheckbox === anchor && !input.disabled);
		if (!checkbox) return false;
		if (checkbox.checked !== expected) checkbox.click();
		return true;
	}, anchorPath, managed);
	expect(clicked).toBe(true);
	await waitForOutline();
	await browser.waitUntil(async () => browser.executeObsidian((_context, anchor, expected) => {
		const paths = (globalThis as unknown as {
			__dtfOutlineReadState?: () => { scope: { selectedPaths: string[] } };
		}).__dtfOutlineReadState?.().scope.selectedPaths ?? [];
		return paths.includes(anchor) === expected;
	}, anchorPath, managed), {
		timeout: 15_000,
		timeoutMsg: `${anchorPath} did not become ${managed ? 'managed' : 'unmanaged'}`,
	});
	await settleOutline();
}

async function scrollToAnchor(anchorPath: string): Promise<void> {
	await browser.executeObsidian((_context, anchor) => {
		document.querySelector<HTMLElement>(`[data-dtf-outline-anchor="${anchor}"]`)
			?.scrollIntoView({ block: 'center' });
	}, anchorPath);
	await settleOutline();
}

async function readSelectedPaths(): Promise<string[]> {
	return browser.executeObsidian(() =>
		(globalThis as unknown as {
			__dtfOutlineReadState?: () => { scope: { selectedPaths: string[] } };
		}).__dtfOutlineReadState?.().scope.selectedPaths ?? []);
}

/** Pack id → hue class, for every system currently carrying a hue. */
async function readHuesByPack(): Promise<Record<string, string>> {
	return browser.executeObsidian(() => {
		const hues: Record<string, string> = {};
		for (const system of Array.from(
			document.querySelectorAll<HTMLElement>('[data-dtf-outline-pack]'),
		)) {
			const pack = system.dataset.dtfOutlinePack ?? '';
			const hue = system.dataset.dtfOutlineHue;
			if (pack !== '' && hue !== undefined) hues[pack] = hue;
		}
		return hues;
	});
}

/**
 * Fix 2/5 — the name cell owns the left of the row and the trailing cell owns
 * the right edge. A cell printing over its neighbour ON THE SAME LINE means the
 * grid let the right-hand content eat the name; cells that wrap onto separate
 * lines are by design (the trailing cell wraps rather than overflow, and a
 * stacked narrow row puts every column on its own line).
 */
async function readColumnCollisions(): Promise<string[]> {
	return browser.executeObsidian(() => {
		const outline = document.querySelector<HTMLElement>('[data-dtf-workbench-outline="1"]');
		if (!outline) return ['missing outline'];
		const collisions: string[] = [];
		for (const row of Array.from(outline.querySelectorAll<HTMLElement>('.dtf-outline-row'))) {
			const cells: Array<[string, HTMLElement]> = [];
			for (const [label, selector] of [
				['name', '.dtf-outline-name'],
				['annotation', '.dtf-outline-annotation'],
				['status', '.dtf-outline-status'],
			] as const) {
				const cell = row.querySelector<HTMLElement>(selector);
				if (cell && cell.getBoundingClientRect().width > 0) cells.push([label, cell]);
			}
			for (let index = 1; index < cells.length; index++) {
				const before = cells[index - 1][1].getBoundingClientRect();
				const after = cells[index][1].getBoundingClientRect();
				// Different lines is not an overlap.
				if (after.top >= before.bottom - 1) continue;
				if (before.right > after.left + 1) {
					collisions.push(`${row.dataset.dtfOutlineRow}:${cells[index - 1][0]}/`
						+ `${cells[index][0]}@${Math.round(before.right - after.left)}`);
				}
			}
		}
		return collisions.slice(0, 8);
	});
}

async function readConflictLines(): Promise<string[]> {
	return browser.executeObsidian(() => Array.from(
		document.querySelectorAll<HTMLElement>('[data-dtf-outline-conflict-line]'),
	).map((line) => line.textContent ?? ''));
}

async function resetOutline(): Promise<void> {
	await browser.executeObsidian(async ({ app }, viewType) => {
		type LeafLike = {
			view: { getState(): Record<string, unknown> };
			setViewState(state: Record<string, unknown>): Promise<void>;
		};
		const leaf = (app.workspace as unknown as {
			getLeavesOfType(type: string): LeafLike[];
		}).getLeavesOfType(viewType)[0];
		if (!leaf) throw new Error('Missing outline leaf');
		const current = leaf.view.getState();
		await leaf.setViewState({
			type: viewType,
			active: true,
			state: {
				...current,
				surface: 'outline',
				scope: { selectedPaths: [], signalFilter: null },
			},
		});
	}, VIEW_TYPE);
	await waitForOutline();
	await setStep(1);
	await setShowAllFolders(false);
	// Re-fold whatever a previous case opened so the folded capture is folded.
	// At most one anchor is open at a time, and clicking rerenders the rows, so
	// re-fold the single open one rather than a stale list.
	await browser.executeObsidian(() => {
		document
			.querySelector<HTMLButtonElement>('[data-dtf-outline-fold][aria-expanded="true"]')
			?.click();
	});
	await settleOutline();
	await dropFocus();
}

/** Measure text against composited native theme surfaces, including yellow
 * system labels. Hue is a secondary cue; names and exact outputs stay readable. */
async function auditOutlineContrast(theme: 'light' | 'dark'): Promise<void> {
	const report = await browser.executeObsidian(() => {
		const canvas = document.createElement('canvas'); canvas.width = canvas.height = 1;
		const ctx = canvas.getContext('2d')!;
		const rgba = (color: string): number[] => {
			ctx.clearRect(0, 0, 1, 1); ctx.fillStyle = color; ctx.fillRect(0, 0, 1, 1);
			return Array.from(ctx.getImageData(0, 0, 1, 1).data).map((value, i) => i === 3 ? value / 255 : value);
		};
		const blend = (fg: number[], bg: number[]): number[] => fg.slice(0, 3).map((v, i) => v * fg[3] + bg[i] * (1 - fg[3])).concat(1);
		const luminance = (rgb: number[]): number => rgb.slice(0, 3).map((c) => {
			const v = c / 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
		}).reduce((sum, v, i) => sum + v * [0.2126, 0.7152, 0.0722][i], 0);
		const rows = Array.from(document.querySelectorAll<HTMLElement>('.dtf-outline .dtf-outline-system-name[data-dtf-outline-hue], .dtf-outline .dtf-outline-tag, .dtf-outline .dtf-outline-no-tag'))
			.filter((el) => el.getBoundingClientRect().width > 0).map((el) => {
				const ancestors: HTMLElement[] = []; let node: HTMLElement | null = el;
				while (node) { ancestors.unshift(node); node = node.parentElement; }
				let bg = [255, 255, 255, 1];
				for (const ancestor of ancestors) bg = blend(rgba(getComputedStyle(ancestor).backgroundColor), bg);
				const fg = blend(rgba(getComputedStyle(el).color), bg);
				const a = luminance(fg); const b = luminance(bg);
				return { text: el.textContent, hue: el.dataset.dtfOutlineHue, color: getComputedStyle(el).color,
					background: bg.slice(0, 3), ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
			});
		const style = getComputedStyle(document.body);
		return { rows, nativeHues: ['blue', 'green', 'purple', 'pink', 'cyan', 'yellow'].map((hue) => ({ hue,
			rgb: style.getPropertyValue(`--color-${hue}-rgb`).trim() })) };
	});
	await fs.writeFile(path.join(SCREENSHOT_DIR, `conflict-preview-contrast-${theme}.json`), JSON.stringify(report, null, 2));
	expect(report.rows.length).toBeGreaterThan(0);
	expect(report.rows.filter((row) => row.ratio < 4.5)).toEqual([]);
}

/** One deterministic chosen-systems → compare → exact review → return journey.
 * Real summary activation uses Enter, not merely DOM-state mutation. */
async function exerciseConflictReview(width: number): Promise<void> {
	const folder = `${UX_LAB_OUTLINE_ANCHORS.nestedJd}/10 - Projects`;
	const selected = await readSelectedPaths();
	await browser.waitUntil(async () => browser.executeObsidian((_context, target) =>
		document.querySelector(`[data-dtf-outline-compare="${target}"]`) !== null, folder),
	{ timeout: 10_000, timeoutMsg: 'Expected nested conflict comparison did not appear' });
	await browser.executeObsidian((_context, target) => {
		const summary = document.querySelector<HTMLElement>(`[data-dtf-outline-compare="${target}"]`)!;
		const details = summary.parentElement as HTMLDetailsElement;
		if (details.open) summary.click();
		summary.closest('.dtf-outline-comparison')!.scrollIntoView({ block: 'center', behavior: 'instant' });
		summary.focus({ preventScroll: true });
	}, folder);
	await settleOutline();
	await snap(`conflict-preview-${width}-summary`);
	await browser.keys('Enter');
	await browser.waitUntil(async () => browser.executeObsidian((_context, target) =>
		(document.querySelector(`[data-dtf-outline-compare="${target}"]`)?.parentElement as HTMLDetailsElement)?.open === true, folder),
	{ timeout: 5_000, timeoutMsg: 'Keyboard did not expand comparison' });
	await settleOutline();
	// Place the folder above its open comparison in the screenshot; preserve this
	// exact scroller position across review and return.
	await browser.executeObsidian((_context, target) => {
		document.querySelector(`[data-dtf-outline-path="${target}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' });
	}, folder);
	await settleOutline();
	const facts = await browser.executeObsidian((_context, target) => {
		const card = document.querySelector<HTMLElement>(`[data-dtf-outline-conflict-line="${target}"]`)!;
		const outline = document.querySelector<HTMLElement>('[data-dtf-workbench-outline]')!;
		const folderRow = document.querySelector<HTMLElement>(`[data-dtf-outline-path="${target}"]`)!;
		const name = folderRow.querySelector<HTMLElement>('.dtf-outline-name')!;
		const rails = Array.from(outline.querySelectorAll<HTMLElement>('[data-dtf-outline-bracket]'));
		const cardRect = card.getBoundingClientRect();
		const issues: string[] = [];
		for (const el of Array.from(card.querySelectorAll<HTMLElement>('*'))) {
			const rect = el.getBoundingClientRect();
			if (rect.width === 0) continue;
			if (rect.right > cardRect.right + 1 || rect.left < cardRect.left - 1) issues.push(el.className || el.tagName);
		}
		const crossing = rails.filter((rail) => {
			const rect = rail.getBoundingClientRect();
			return rect.bottom > cardRect.top && rect.top < cardRect.bottom && rect.right > cardRect.left;
		}).length;
		return {
			issues, crossing, leftDelta: cardRect.left - name.getBoundingClientRect().left,
			overflow: outline.scrollWidth - outline.clientWidth,
			tags: Array.from(card.querySelectorAll<HTMLElement>('.dtf-outline-tag')).map((el) => el.textContent),
			rawOutputs: Array.from(card.querySelectorAll<HTMLElement>('.dtf-outline-raw-output')).map((el) => el.textContent),
			generationError: card.textContent?.includes('Generation error') ?? false,
			reason: card.querySelector('.dtf-outline-decision')?.textContent ?? '',
			guidance: card.querySelector('.dtf-outline-review-guidance')?.textContent ?? '',
			focus: document.activeElement?.getAttribute('data-dtf-outline-compare'),
			folderTop: folderRow.getBoundingClientRect().top,
			reviewKey: card.querySelector<HTMLElement>('[data-dtf-outline-review]')?.dataset.dtfOutlineReview,
		};
	}, folder);
	await snap(`conflict-preview-${width}-expanded`);
	await fs.writeFile(path.join(SCREENSHOT_DIR, `conflict-preview-${width}-pre-review.json`), JSON.stringify(facts, null, 2));
	expect(facts.tags).toContain('#10-projects');
	expect(facts.rawOutputs.length).toBeGreaterThan(0);
	expect(facts.generationError).toBe(true);
	// The old #-clip claim came from a reverse-only rule. It remains available
	// as a raw transform example under direction review, never a forward rival.
	expect(facts.tags.some((tag) => tag?.startsWith('#-clip/'))).toBe(false);
	expect(facts.reason).toContain('alphabetical group order');
	expect(facts.guidance).toContain('no per-child exclusion');
	expect(facts.issues).toEqual([]);
	expect(facts.crossing).toBe(0);
	expect(facts.leftDelta).toBeGreaterThanOrEqual(-1);
	expect(facts.overflow).toBeLessThanOrEqual(1);
	expect(facts.focus).toBe(folder);
	await snap(`conflict-preview-${width}-expanded`);
	if (width === 1200) {
		await setTheme('dark');
		await snap('conflict-preview-1200-expanded-dark');
		await setTheme('light');
	}
	if (width === 320) {
		await browser.executeObsidian((_context, target) => {
			document.querySelector(`[data-dtf-outline-conflict-line="${target}"] .dtf-outline-review-guidance`)?.scrollIntoView({ block: 'end', behavior: 'instant' });
		}, folder);
		await settleOutline();
		await snap('conflict-preview-320-expanded-tail');
		await browser.executeObsidian((_context, target) => document.querySelector(`[data-dtf-outline-path="${target}"]`)?.scrollIntoView({ block: 'start', behavior: 'instant' }), folder);
		await settleOutline();
	}
	// Review the exact occurrence associated with the proposed result.
	await browser.executeObsidian((_context, target) => {
		const button = document.querySelector<HTMLElement>(`[data-dtf-outline-conflict-line="${target}"] [data-dtf-outline-review]`)!;
		button.focus({ preventScroll: true });
		button.click();
	}, folder);
	await browser.waitUntil(async () => browser.executeObsidian((_context, key) => {
		const notice = document.querySelector<HTMLElement>('[data-dtf-outline-review-target]');
		return document.querySelector<HTMLElement>('[data-dtf-workbench-outline]')?.dataset.dtfOutlineStep === '2'
			&& notice?.dataset.dtfOutlineReviewTarget === key
			&& ((document.activeElement as HTMLElement)?.dataset.dtfOutlineChoice === key
				|| (document.activeElement as HTMLElement)?.dataset.dtfOutlineOccurrenceTarget === key);
	}, facts.reviewKey), { timeout: 5_000, timeoutMsg: 'Review did not focus the exact occurrence/choice in step 2' });
	expect(await readSelectedPaths()).toEqual(selected);
	const reviewFacts = await browser.executeObsidian((_context, anchor) => {
		const notice = document.querySelector<HTMLElement>('[data-dtf-outline-review-target]')!;
		const checkbox = document.querySelector<HTMLInputElement>(`[data-dtf-outline-manage-checkbox="${anchor}"]`)!;
		const rect = document.activeElement!.getBoundingClientRect();
		return { text: notice.textContent, checked: checkbox.checked, disabled: checkbox.disabled,
			focusVisible: rect.top >= 0 && rect.bottom <= window.innerHeight };
	}, UX_LAB_OUTLINE_ANCHORS.nestedJd);
	expect(reviewFacts.checked).toBe(true);
	expect(reviewFacts.disabled).toBe(true);
	expect(reviewFacts.text).toContain('cannot be excluded while that parent is checked');
	expect(reviewFacts.focusVisible).toBe(true);
	await snap(`conflict-preview-${width}-review-target`);
	await browser.executeObsidian(() => document.querySelector<HTMLButtonElement>('[data-dtf-outline-return]')!.click());
	await browser.waitUntil(async () => browser.executeObsidian((_context, target, key) => {
		const card = document.querySelector<HTMLElement>(`[data-dtf-outline-conflict-line="${target}"]`);
		return card?.querySelector('details')?.open === true
			&& (document.activeElement as HTMLElement)?.dataset.dtfOutlineFocus === `review-${target}-${key}`;
	}, folder, facts.reviewKey), { timeout: 5_000, timeoutMsg: 'Return did not restore expanded comparison and originating control focus' });
	expect(await readSelectedPaths()).toEqual(selected);
	const returnedTop = await browser.executeObsidian((_context, target) =>
		document.querySelector(`[data-dtf-outline-path="${target}"]`)!.getBoundingClientRect().top, folder);
	expect(Math.abs(returnedTop - facts.folderTop)).toBeLessThanOrEqual(2);
	await fs.writeFile(path.join(SCREENSHOT_DIR, `conflict-preview-${width}-evidence.json`), JSON.stringify({ width, selected, facts, reviewFacts, returnedTop }, null, 2));
	await browser.executeObsidian((_context, target) => document.querySelector<HTMLElement>(`[data-dtf-outline-compare="${target}"]`)!.click(), folder);
	await settleOutline();
}

describe('Taxonomy Workbench — annotated outline prototype', function () {
	this.timeout(400_000);

	before(async function () {
		originalWindowSize = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		originalTheme = await browser.executeObsidian(() =>
			(document.body.classList.contains('theme-light') ? 'light' : 'dark'));

		const setup = await browser.executeObsidian(async ({ app }, root, folders, viewType) => {
			type PluginLike = {
				settings: { rules: unknown[] } & Record<string, unknown>;
				saveSettings(): Promise<void>;
			};
			type SplitLike = { collapsed?: boolean; collapse?(): void; expand?(): void };
			type LeafLike = {
				containerEl: HTMLElement;
				view: { getState(): Record<string, unknown> };
				setViewState(state: Record<string, unknown>): Promise<void>;
			};
			const workspace = app.workspace as unknown as {
				getLayout(): Record<string, unknown>;
				getLeaf(type: 'tab'): LeafLike;
				createLeafBySplit(leaf: LeafLike, direction: 'vertical', before?: boolean): LeafLike;
				detachLeavesOfType(type: string): void;
				getLeavesOfType(type: string): LeafLike[];
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

			workspace.detachLeavesOfType(viewType);
			const existing = app.vault.getAbstractFileByPath(root);
			let backupPath: string | null = null;
			if (existing) {
				backupPath = `${root}.__e2e_outline_backup_${Date.now()}`;
				await app.vault.rename(existing, backupPath);
			}

			// No installed rules: the prototype's conflicts must come from the
			// proposed rules themselves, not from a leftover vault rule.
			plugin.settings = { ...plugin.settings, rules: [], groupPrecedence: [] };
			await plugin.saveSettings();

			for (const folder of folders) {
				if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			}

			workspace.leftSplit?.collapse?.();
			workspace.rightSplit?.collapse?.();
			const baseLeaf = workspace.getLeaf('tab');
			await baseLeaf.setViewState({ type: 'empty', active: true });
			const workbenchLeaf = workspace.createLeafBySplit(baseLeaf, 'vertical', false);
			(globalThis as unknown as { __dtfOutlineWorkbenchLeaf?: LeafLike })
				.__dtfOutlineWorkbenchLeaf = workbenchLeaf;
			await workbenchLeaf.setViewState({
				type: viewType,
				active: true,
				state: {
					version: 2,
					surface: 'outline',
					mapMode: 'both',
					scope: { selectedPaths: [], signalFilter: null },
					candidates: { source: 'scope-selection', sort: 'noise', selectedKeys: null },
					detailPath: null,
					selectedSystemInstanceKey: null,
					preferences: { showIncompleteSystems: true },
				},
			});

			// Test-only readers for view-owned state and the collected snapshot.
			(globalThis as unknown as {
				__dtfOutlineReadState?: () => Record<string, unknown>;
				__dtfOutlineReadSnapshot?: () => Record<string, unknown> | null;
			}).__dtfOutlineReadState = () => workspace.getLeavesOfType(viewType)[0]
				.view.getState();
			(globalThis as unknown as {
				__dtfOutlineVisibleOccurrenceCount?: () => number;
				__dtfOutlineVisibleAnchorCount?: () => number;
			}).__dtfOutlineVisibleOccurrenceCount = () => {
				const snapshot = (workspace.getLeavesOfType(viewType)[0].view as unknown as {
					snapshot: { occurrences: Array<{ status: string }> } | null;
				}).snapshot;
				return (snapshot?.occurrences ?? [])
					.filter((occurrence) => occurrence.status !== 'suppressed').length;
			};
			(globalThis as unknown as {
				__dtfOutlineVisibleAnchorCount?: () => number;
			}).__dtfOutlineVisibleAnchorCount = () => {
				const snapshot = (workspace.getLeavesOfType(viewType)[0].view as unknown as {
					snapshot: { occurrences: Array<{ status: string; anchorPath: string }> } | null;
				}).snapshot;
				return new Set((snapshot?.occurrences ?? [])
					.filter((occurrence) => occurrence.status !== 'suppressed')
					.map((occurrence) => occurrence.anchorPath)).size;
			};

			
			return { layout, settings, sidebars, backupPath };
		}, UX_LAB_ROOT, buildUxLabOutlineFolders(), VIEW_TYPE);

		originalLayout = setup.layout;
		originalSettings = setup.settings;
		originalSidebars = setup.sidebars;
		backupRootPath = setup.backupPath;
		await resizeWindow(1440, 1000);
		await waitForOutline();
	});

	after(async function () {
		await setTheme(originalTheme);
		await resizeWindow(originalWindowSize.width, originalWindowSize.height);
		await browser.executeObsidian(
			async ({ app }, root, backupPath, settings, layout, sidebars, viewType) => {
				type PluginLike = { settings: unknown; saveSettings(): Promise<void> };
				type SplitLike = { collapse?(): void; expand?(): void };
				const workspace = app.workspace as unknown as {
					detachLeavesOfType(type: string): void;
					changeLayout(layout: Record<string, unknown>): Promise<void>;
					leftSplit?: SplitLike;
					rightSplit?: SplitLike;
				};
				workspace.detachLeavesOfType(viewType);
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
				const globals = globalThis as unknown as Record<string, unknown>;
				delete globals.__dtfOutlineWorkbenchLeaf;
				delete globals.__dtfOutlineWidthTarget;
				delete globals.__dtfOutlineHeightTarget;
				delete globals.__dtfOutlineReadState;
				delete globals.__dtfOutlineReadSnapshot;
				delete globals.__dtfOutlineVisibleOccurrenceCount;
				delete globals.__dtfOutlineVisibleAnchorCount;
			},
			UX_LAB_ROOT,
			backupRootPath,
			originalSettings,
			originalLayout,
			originalSidebars,
			VIEW_TYPE,
		);
	});

	it('annotates anchor folder rows and never adds a pseudo-folder row', async function () {
		await setWorkbenchSplitDimension('width', WIDTHS[0]);
		await resetOutline();

		const facts = await browser.executeObsidian((_context, overlapAnchor) => {
			const globals = globalThis as unknown as {
				__dtfOutlineVisibleOccurrenceCount: () => number;
				__dtfOutlineVisibleAnchorCount: () => number;
			};
			const anchorRows = Array.from(
				document.querySelectorAll<HTMLElement>('[data-dtf-outline-anchor]'),
			);
			const systems = Array.from(
				document.querySelectorAll<HTMLElement>('.dtf-outline-system-name'),
			);
			// Every system name must live inside a real folder row that is an
			// anchor: no row exists solely to represent a system.
			const systemsOutsideAnchorRows = systems.filter((system) => {
				const row = system.closest<HTMLElement>('.dtf-outline-row');
				return row === null
					|| row.dataset.dtfOutlineRow !== 'folder'
					|| row.dataset.dtfOutlineAnchor === undefined;
			}).length;
			const anchorRowsWithFolderName = anchorRows.filter((row) =>
				row.querySelector('.dtf-outline-folder-name') !== null).length;
			return {
				occurrenceCount: globals.__dtfOutlineVisibleOccurrenceCount(),
				anchorCount: globals.__dtfOutlineVisibleAnchorCount(),
				anchorRowCount: anchorRows.length,
				uniqueAnchorRowCount: new Set(
					anchorRows.map((row) => row.dataset.dtfOutlineAnchor ?? ''),
				).size,
				anchorRowsWithFolderName,
				systemNameCount: systems.length,
				systemsOutsideAnchorRows,
				bracketCount: document.querySelectorAll('[data-dtf-outline-bracket]').length,
				colouredSystemNames: systems
					.filter((system) => system.dataset.dtfOutlineHue !== undefined).length,
				colouredBrackets: Array.from(
					document.querySelectorAll<HTMLElement>('[data-dtf-outline-bracket]'),
				).filter((bracket) => bracket.classList.contains('is-coloured')).length,
				overlapSystemCount: anchorRows
					.filter((row) => row.dataset.dtfOutlineAnchor === overlapAnchor)
					.map((row) => row.querySelectorAll('.dtf-outline-system-name').length)[0] ?? 0,
			};
		}, UX_LAB_OUTLINE_ANCHORS.overlap);

		// Contract 1 — occurrences annotate the anchor folder row.
		expect(facts.systemNameCount).toBe(facts.occurrenceCount);
		expect(facts.systemsOutsideAnchorRows).toBe(0);
		// P1 — one anchor row per anchor, however many systems sit there.
		expect(facts.anchorRowCount).toBe(facts.uniqueAnchorRowCount);
		expect(facts.anchorRowCount).toBe(facts.anchorCount);
		expect(facts.anchorRowsWithFolderName).toBe(facts.anchorRowCount);
		// One bracket lane per anchor: co-anchored systems share it.
		expect(facts.bracketCount).toBeLessThanOrEqual(facts.anchorCount);
		// Contract 2/7 — hue appears only once a system is checked in step 2.
		expect(facts.colouredSystemNames).toBe(0);
		expect(facts.colouredBrackets).toBe(0);
		// The fixture's shared anchor really does carry two systems on one row.
		expect(facts.overlapSystemCount).toBe(2);
	});

	it('reads the co-anchored anchor row as "folder · system + system"', async function () {
		const titles = await browser.executeObsidian((_context, overlap, studio) => {
			const read = (anchor: string) => {
				const row = document.querySelector<HTMLElement>(`[data-dtf-outline-anchor="${anchor}"]`);
				return row?.querySelector('.dtf-outline-name')?.textContent ?? null;
			};
			return { overlap: read(overlap), studio: read(studio) };
		}, UX_LAB_OUTLINE_ANCHORS.overlap, UX_LAB_OUTLINE_ANCHORS.studio);

		expect(titles.studio).toBe('Studio · PARA');
		expect(titles.overlap).toContain('Overlap · ');
		expect(titles.overlap).toContain(' + ');
	});

	it('unfolds an anchor from its own sub-row and states its completeness', async function () {
		const before = await browser.executeObsidian((_context, anchor) => {
			const row = document.querySelector<HTMLElement>(`[data-dtf-outline-anchor="${anchor}"]`);
			return {
				// Fix 2 — the fold word left the anchor row for a sub-row of its own.
				foldInAnchorRow: row?.querySelector('[data-dtf-outline-fold]') !== null,
				fold: document.querySelector(`[data-dtf-outline-fold="${anchor}"]`)?.textContent ?? null,
				foldOnSubRow: document.querySelector(`[data-dtf-outline-fold="${anchor}"]`)
					?.closest('.dtf-outline-row.is-sub') !== null,
				completeness: row?.querySelector('[data-dtf-outline-completeness]')?.textContent ?? null,
				state: row?.querySelector<HTMLElement>('[data-dtf-outline-completeness]')
					?.dataset.dtfOutlineCompleteness ?? null,
				evidenceRows: document.querySelectorAll('.dtf-outline-row.is-evidence').length,
			};
		}, UX_LAB_OUTLINE_ANCHORS.studio);

		// Contract 1/11 — a fold WORD, never a hollow radio glyph.
		expect(before.fold).toMatch(/^Show \d+ matched folders?$/);
		expect(before.foldInAnchorRow).toBe(false);
		expect(before.foldOnSubRow).toBe(true);
		// Contract 6 — one verb per state.
		expect(before.state).toBe('complete');
		expect(before.completeness).toMatch(/^Complete · /);

		await openAnchor(UX_LAB_OUTLINE_ANCHORS.studio);
		const after = await browser.executeObsidian((_context, anchor) => ({
			fold: document.querySelector(`[data-dtf-outline-fold="${anchor}"]`)?.textContent ?? null,
			evidenceRows: document.querySelectorAll('.dtf-outline-row.is-evidence').length,
			// Fix 3 — a plain unfold shows MATCHED members only.
			ghostRows: document.querySelectorAll('[data-dtf-outline-ghost]').length,
			colouredSystemNames: Array.from(
				document.querySelectorAll<HTMLElement>('.dtf-outline-system-name'),
			).filter((system) => system.dataset.dtfOutlineHue !== undefined).length,
		}), UX_LAB_OUTLINE_ANCHORS.studio);

		expect(after.fold).toBe('Hide');
		expect(after.evidenceRows).toBeGreaterThan(before.evidenceRows);
		expect(after.ghostRows).toBe(0);
		// Contract 7 — step 1 uses the accent, never a system hue.
		expect(after.colouredSystemNames).toBe(0);
	});

	it('shows missing-type rows only after "which?" is activated', async function () {
		const club = await browser.executeObsidian((_context, anchor) => {
			const row = document.querySelector<HTMLElement>(`[data-dtf-outline-anchor="${anchor}"]`);
			const link = document.querySelector<HTMLElement>(
				`[data-dtf-outline-missing-types="${anchor}"]`,
			);
			return {
				present: row !== null,
				state: row?.querySelector<HTMLElement>('[data-dtf-outline-completeness]')
					?.dataset.dtfOutlineCompleteness ?? null,
				text: row?.querySelector('[data-dtf-outline-completeness]')?.textContent ?? null,
				link: link?.textContent ?? null,
				linkOnSubRow: link?.closest('.dtf-outline-row.is-sub') !== null,
				linkInAnchorRow: row?.querySelector('[data-dtf-outline-missing-types]') !== null,
				ghostRows: document.querySelectorAll('[data-dtf-outline-ghost]').length,
			};
		}, UX_LAB_OUTLINE_ANCHORS.club);

		expect(club.present).toBe(true);
		expect(club.state).toBe('too-few');
		expect(club.text).toMatch(/^Too few · \d+ of \d+ — add /);
		// Fix 3/7 — the reveal is an explicit link, on the fold sub-row.
		expect(club.link).toMatch(/^\d+ missing types? — which\?$/);
		expect(club.linkOnSubRow).toBe(true);
		expect(club.linkInAnchorRow).toBe(false);
		// Fix 3 — nothing is revealed until it is asked for.
		expect(club.ghostRows).toBe(0);

		const opened = await browser.executeObsidian((_context, anchor) => {
			document.querySelector<HTMLButtonElement>(
				`[data-dtf-outline-missing-types="${anchor}"]`,
			)?.click();
			return true;
		}, UX_LAB_OUTLINE_ANCHORS.club);
		expect(opened).toBe(true);
		await settleOutline();

		const revealed = await browser.executeObsidian((_context, anchor) => ({
			ghostRows: document.querySelectorAll(`[data-dtf-outline-ghost="${anchor}"]`).length,
			link: document.querySelector(`[data-dtf-outline-missing-types="${anchor}"]`)
				?.textContent ?? null,
			ghostText: Array.from(
				document.querySelectorAll<HTMLElement>(`[data-dtf-outline-ghost="${anchor}"]`),
			).map((row) => row.querySelector('.dtf-outline-ghost-text')?.textContent ?? ''),
		}), UX_LAB_OUTLINE_ANCHORS.club);

		expect(revealed.ghostRows).toBeGreaterThan(0);
		expect(revealed.link).toBe('Hide missing types');
		expect(revealed.ghostText.every((text) => text === 'Not found')).toBe(true);

		// Put it back so later captures start from the same folded state.
		await browser.executeObsidian((_context, anchor) => {
			document.querySelector<HTMLButtonElement>(
				`[data-dtf-outline-missing-types="${anchor}"]`,
			)?.click();
		}, UX_LAB_OUTLINE_ANCHORS.club);
		await settleOutline();
		await dropFocus();
	});

	it('writes the shared checked-folder input when a system is managed here', async function () {
		await setStep(2);
		expect(await readSelectedPaths()).toEqual([]);
		await setManaged(UX_LAB_OUTLINE_ANCHORS.studio, true);
		expect(await readSelectedPaths()).toEqual([UX_LAB_OUTLINE_ANCHORS.studio]);

		const managed = await browser.executeObsidian((_context, anchor) => {
			const row = document.querySelector<HTMLElement>(`[data-dtf-outline-anchor="${anchor}"]`);
			return {
				manage: row?.dataset.dtfOutlineManage ?? null,
				label: row?.querySelector('[data-dtf-outline-manage-label]')?.textContent ?? null,
				// Contract 12 — the label sits in the name column, next to the box.
				labelInName: row?.querySelector('.dtf-outline-name [data-dtf-outline-manage-label]')
					!== null,
				hue: row?.querySelector<HTMLElement>('.dtf-outline-system-name')
					?.dataset.dtfOutlineHue ?? null,
			};
		}, UX_LAB_OUTLINE_ANCHORS.studio);
		expect(managed.manage).toBe('manage');
		expect(managed.label).toBe('Manage here');
		expect(managed.labelInName).toBe(true);
		// Contract 2/7 — the hue arrives with the check.
		expect(managed.hue).not.toBeNull();

		await setManaged(UX_LAB_OUTLINE_ANCHORS.studio, false);
		expect(await readSelectedPaths()).toEqual([]);
	});

	it('draws parent inclusion on the descendant anchor it manages', async function () {
		await setStep(2);
		await setManaged(UX_LAB_OUTLINE_ANCHORS.seacow, true);
		const nested = await browser.executeObsidian((_context, anchor) => {
			const row = document.querySelector<HTMLElement>(`[data-dtf-outline-anchor="${anchor}"]`);
			const checkbox = row?.querySelector<HTMLInputElement>('[data-dtf-outline-manage-checkbox]');
			return {
				present: row !== null,
				manage: row?.dataset.dtfOutlineManage ?? null,
				note: row?.querySelector('[data-dtf-outline-manage-note]')?.textContent ?? null,
				checked: checkbox?.checked ?? null,
				disabled: checkbox?.disabled ?? null,
				// Co-anchored systems still say they will all be managed — on a
				// sub-row, so it never replaces the reason this anchor is managed.
				inclusion: document.querySelector(`[data-dtf-outline-group-inclusion="${anchor}"]`)
					?.textContent ?? null,
				systemCount: row?.querySelectorAll('.dtf-outline-system-name').length ?? 0,
			};
		}, UX_LAB_OUTLINE_ANCHORS.nestedJd);

		expect(nested.present).toBe(true);
		// Contract 3 — a disabled-checked control plus "included by <folder>".
		expect(nested.manage).toBe('included-by');
		expect(nested.checked).toBe(true);
		expect(nested.disabled).toBe(true);
		expect(nested.note).toBe('included by SEACOW workshop');
		if (nested.systemCount > 1) {
			expect(nested.inclusion).toBe('both systems will be managed');
		}

		await setManaged(UX_LAB_OUTLINE_ANCHORS.seacow, false);
	});

	it('offers one manage checkbox at a co-anchored group, with a predicted choice and its evidence', async function () {
		await setStep(2);
		const readGroup = (anchor: string) => browser.executeObsidian((_context, target) => {
			const row = document.querySelector<HTMLElement>(`[data-dtf-outline-anchor="${target}"]`);
			const radios = Array.from(
				document.querySelectorAll<HTMLInputElement>(`[data-dtf-outline-choice-anchor="${target}"]`),
			);
			return {
				present: row !== null,
				systemCount: row?.querySelectorAll('.dtf-outline-system-name').length ?? 0,
				note: row?.querySelector('[data-dtf-outline-manage-note]')?.textContent ?? null,
				inclusion: document.querySelector(`[data-dtf-outline-group-inclusion="${target}"]`)
					?.textContent ?? null,
				// Fix 4 — a disagreeing group's anchor state is COUNTS, one line.
				anchorState: row?.querySelector('[data-dtf-outline-completeness]')?.textContent ?? null,
				anchorGroupState: row
					?.querySelector<HTMLElement>('[data-dtf-outline-completeness]')
					?.dataset.dtfOutlineGroupState ?? null,
				radioCount: radios.length,
				checkedRadioCount: radios.filter((radio) => radio.checked).length,
				// Scoped to this anchor: another managed group may also be choosing.
				choiceLabels: radios
					.map((radio) => radio.closest<HTMLElement>('.dtf-outline-row')
						?.querySelector('[data-dtf-outline-choice-label]')?.textContent ?? ''),
				// Fix 4 — each system's own state lives on its radio sub-row.
				radioStates: radios
					.map((radio) => radio.closest<HTMLElement>('.dtf-outline-row')
						?.querySelector('[data-dtf-outline-completeness]')?.textContent ?? null)
					.filter((text): text is string => text !== null),
				evidence: radios
					.map((radio) => radio.closest<HTMLElement>('.dtf-outline-row')
						?.querySelector('[data-dtf-outline-choice-evidence]')?.textContent ?? null)
					.filter((text): text is string => text !== null),
				hint: document.querySelector('[data-dtf-outline-hint="1"]')?.textContent ?? '',
				checkboxCount: document.querySelectorAll(
					`[data-dtf-outline-manage-checkbox="${target}"]`,
				).length,
			};
		}, anchor);

		// Before managing there are no candidates, so nothing is promised yet.
		const unmanaged = await readGroup(UX_LAB_OUTLINE_ANCHORS.overlap);
		expect(unmanaged.present).toBe(true);
		expect(unmanaged.systemCount).toBe(2);
		// P2 — one manage checkbox at the anchor, never one per system.
		expect(unmanaged.checkboxCount).toBe(1);
		expect(unmanaged.radioCount).toBe(0);

		// Managing the anchor builds the candidates, which decide the collision.
		await setManaged(UX_LAB_OUTLINE_ANCHORS.overlap, true);
		const group = await readGroup(UX_LAB_OUTLINE_ANCHORS.overlap);
		expect(group.checkboxCount).toBe(1);
		if (group.radioCount > 0) {
			expect(group.radioCount).toBe(2);
			expect(group.checkedRadioCount).toBe(1);
			expect(group.choiceLabels.sort()).toEqual(['Alternative', 'Predicted on sample']);
			// Contract 9 — "Predicted" shows its evidence in one muted line.
			expect(group.evidence).toHaveLength(1);
			expect(group.evidence[0]).toMatch(/^found \d+ (of \d+ folder types|matching folders?)/);
			// P3 — the hint names the live choice instead of repeating the counts.
			expect(group.hint).toContain('matches competing systems');
			const selection = await readSelectedPaths();
			const changed = await browser.executeObsidian((_context, anchor) => {
				const radios = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-dtf-outline-choice-anchor="${anchor}"]`));
				const original = radios.find((radio) => radio.checked)!.dataset.dtfOutlineChoice!;
				const other = radios.find((radio) => !radio.checked)!;
				const next = other.dataset.dtfOutlineChoice!;
				other.focus(); other.click();
				return { original, next };
			}, UX_LAB_OUTLINE_ANCHORS.overlap);
			await settleOutline();
			await setStep(3);
			await setStep(2);
			const restored = await browser.executeObsidian((_context, anchor, keys) => {
				const radios = Array.from(document.querySelectorAll<HTMLInputElement>(`[data-dtf-outline-choice-anchor="${anchor}"]`));
				const checked = radios.find((radio) => radio.checked)?.dataset.dtfOutlineChoice;
				radios.find((radio) => radio.dataset.dtfOutlineChoice === keys.original)!.click();
				return checked;
			}, UX_LAB_OUTLINE_ANCHORS.overlap, changed);
			expect(restored).toBe(changed.next);
			expect(await readSelectedPaths()).toEqual(selection);
		} else {
			expect(group.inclusion).toBe('both systems will be managed');
		}

		// Fix 4 — a disagreeing co-anchored group NEVER splices two statuses into
		// one anchor string; it counts them, and the per-system state sits on the
		// radio sub-rows.
		if (group.anchorGroupState === '1') {
			expect(group.anchorState).toMatch(/^\d+ systems · \d+ can manage$/);
			expect(group.anchorState).not.toContain('Too few');
			expect(group.anchorState).not.toContain(': ');
		}
		const partial = await readGroup(UX_LAB_OUTLINE_ANCHORS.partialEnterprise);
		expect(partial.anchorState).not.toContain(': ');

		await setManaged(UX_LAB_OUTLINE_ANCHORS.overlap, false);
	});

	it('reads step 3 as a delta and keeps every pack hue from step 2', async function () {
		await setStep(2);
		await setManaged(UX_LAB_OUTLINE_ANCHORS.studio, true);
		await setManaged(UX_LAB_OUTLINE_ANCHORS.seacow, true);
		const stepTwoHues = await readHuesByPack();
		expect(Object.keys(stepTwoHues).length).toBeGreaterThan(0);

		await setStep(3);
		const stepThreeHues = await readHuesByPack();
		// Contract 2 — a pack id keeps its hue across frames and steps.
		for (const [pack, hue] of Object.entries(stepTwoHues)) {
			if (stepThreeHues[pack] !== undefined) expect(stepThreeHues[pack]).toBe(hue);
		}

		const result = await browser.executeObsidian(() => {
			const rows = Array.from(
				document.querySelectorAll<HTMLElement>('[data-dtf-outline-delta]'),
			);
			// An anchor row states the tag ROOT instead of its own delta, so it
			// carries a delta kind but no ✓ or arrow of its own.
			const kinds = rows
				.filter((row) => !row.classList.contains('is-anchor'))
				.map((row) => row.dataset.dtfOutlineDelta ?? '');
			return {
				rowCount: rows.length,
				sameCount: kinds.filter((kind) => kind === 'same').length,
				deltaCount: kinds.filter((kind) => kind === 'delta').length,
				tickCount: document.querySelectorAll('.dtf-outline-tick').length,
				deltaChipCount: document.querySelectorAll('.dtf-outline-delta').length,
				chipCount: document.querySelectorAll('.dtf-outline-tag').length,
				// Contract 4 — the full tag root is stated once, at the anchor.
				rootCount: document.querySelectorAll('[data-dtf-outline-root], [data-dtf-outline-own-tag]').length,
				ownTagCount: document.querySelectorAll('[data-dtf-outline-own-tag]').length,
				rootTexts: Array.from(
					document.querySelectorAll<HTMLElement>('[data-dtf-outline-root]'),
				).map((root) => root.textContent ?? ''),
				noTagCount: document.querySelectorAll('[data-dtf-outline-no-tag]').length,
				degenerateChips: Array.from(
					document.querySelectorAll<HTMLElement>('.dtf-outline-tag'),
				).filter((chip) => /^#?$|^#\/|\/\/|\/$/.test(chip.textContent ?? '')).length,
			};
		});

		expect(result.rowCount).toBeGreaterThan(0);
		// Contract 4 — the delta reading, not a column of full tags.
		expect(result.tickCount).toBe(result.sameCount);
		expect(result.deltaChipCount).toBe(result.deltaCount);
		expect(result.rootCount).toBeGreaterThan(0);
		expect(result.ownTagCount).toBe(0); // Reverse-only raw examples are not anchor forward outputs.
			expect(result.rootTexts.some((text) => text.includes('tags start with #-clip'))).toBe(false);
		// Contract 10 — a degenerate tag never renders as a chip.
		expect(result.degenerateChips).toBe(0);
	});

	it('expands one line with the full tag when a delta row is clicked', async function () {
		const expansion = await browser.executeObsidian(() => {
			const row = document.querySelector<HTMLElement>('.dtf-outline-row.is-expandable');
			if (!row) return null;
			row.click();
			const line = document.querySelector<HTMLElement>('[data-dtf-outline-full-tag]');
			return { text: line?.textContent ?? null };
		});
		expect(expansion).not.toBeNull();
		// Contract 4 — "full tag #… · from rule <system> → <folder>".
		expect(expansion!.text).toMatch(/^full tag #.+ · from rule .+ → .+$/);
		await browser.executeObsidian(() => {
			document.querySelector<HTMLElement>('.dtf-outline-row.is-expandable[aria-expanded="true"]')
				?.click();
		});
		await settleOutline();
		await dropFocus();
	});

	it('switches the column to full tag chips from the footer toggle', async function () {
		await setShowFullTags(true);
		const chips = await browser.executeObsidian(() => ({
			tickCount: document.querySelectorAll('.dtf-outline-tick').length,
			deltaCount: document.querySelectorAll('.dtf-outline-delta').length,
			chipCount: document.querySelectorAll('.dtf-outline-tag').length,
			lead: document.querySelector('[data-dtf-outline-instruction="1"]')?.textContent ?? '',
		}));
		// Contract 4 — the toggle swaps the whole column for round-2 chips.
		expect(chips.tickCount).toBe(0);
		expect(chips.deltaCount).toBe(0);
		expect(chips.chipCount).toBeGreaterThan(0);
		expect(chips.lead).toContain('Proposed tags, shown in full.');
		await setShowFullTags(false);
	});

	it('attaches comparisons to folders without claiming both outputs will be applied', async function () {
		const conflicts = await readConflictLines();
		expect(conflicts.length).toBeGreaterThan(0);
		for (const text of conflicts) {
			expect(text).toContain('rules produce different tags');
			expect(text).toContain('Proposed result');
			expect(text).toContain('Compare rules');
			expect(text).toContain('as if enabled');
			expect(text).not.toContain('(used — predicted)');
		}
		const facts = await browser.executeObsidian(() => ({
			notesAcrossRails: document.querySelectorAll('.dtf-outline-row.is-note').length,
			directions: document.querySelectorAll('[data-dtf-outline-directions]').length,
			saveDisabled: document.querySelector<HTMLButtonElement>('[data-dtf-outline-save]')?.disabled,
		}));
		expect(facts.notesAcrossRails).toBe(0);
		expect(facts.directions).toBeGreaterThan(0);
		expect(facts.saveDisabled).toBe(true);
		const raw = await browser.executeObsidian(() => {
			const outer = document.querySelector<HTMLDetailsElement>('[data-dtf-outline-directions]')!;
			outer.querySelector<HTMLElement>('summary')!.click();
			const details = outer.querySelector<HTMLDetailsElement>('[data-dtf-outline-raw-direction-output]')!;
			details.querySelector<HTMLElement>('summary')!.click();
			details.scrollIntoView({ block: 'center', behavior: 'instant' });
			return { outerOpen: outer.open, rawOpen: details.open, text: details.textContent,
				tags: Array.from(details.querySelectorAll<HTMLElement>('.dtf-outline-tag')).map((el) => el.textContent) };
		});
		expect(raw.outerOpen).toBe(true);
		expect(raw.rawOpen).toBe(true);
		expect(raw.text).toContain('not eligible to win the forward comparison');
		expect(raw.tags.some((tag) => tag?.startsWith('#-clip/'))).toBe(true);
		await snap('conflict-preview-1200-raw-reverse-only');
		await browser.executeObsidian(() => document.querySelector<HTMLElement>('[data-dtf-outline-directions] > summary')!.click());
	});

	/**
	 * Fix 2 — permanent geometry guard: an anchor row names a folder and its
	 * systems and states one thing about them. It may take a second line rather
	 * than cut a system name mid-word, but never a third: everything else (the
	 * fold word, the tag root, the conflict line) is a sub-row, not a column.
	 */
	it('keeps anchor text contained without imposing a line-count ceiling', async function () {
		await setWorkbenchSplitDimension('width', 1200);
		for (const step of [1, 2, 3] as const) {
			await setStep(step);
			const tall = await browser.executeObsidian(() => {
				const offenders: string[] = [];
				for (const row of Array.from(
					document.querySelectorAll<HTMLElement>('.dtf-outline-row.is-anchor'),
				)) {
					const bounds = row.getBoundingClientRect();
					for (const child of Array.from(row.querySelectorAll<HTMLElement>('.dtf-outline-name, .dtf-outline-trailing'))) {
						const rect = child.getBoundingClientRect();
						if (rect.bottom > bounds.bottom + 1 || rect.right > bounds.right + 1) offenders.push(row.dataset.dtfOutlineAnchor ?? 'unknown');
					}
				}
				return offenders.slice(0, 8);
			});
			expect(tall).toEqual([]);
		}
	});

	for (const width of WIDTHS) {
		it(`captures the three guided steps at ${width}px`, async function () {
			const measured = await setWorkbenchSplitDimension('width', width);
			expect(measured.width).toBeGreaterThan(0);
			await setTheme('light');
			await resetOutline();

			await snap(`outline-${width}-step1-folded`);
			expect(await readColumnCollisions()).toEqual([]);

			await openAnchor(UX_LAB_OUTLINE_ANCHORS.studio);
			await scrollToAnchor(UX_LAB_OUTLINE_ANCHORS.studio);
			await snap(`outline-${width}-step1-selected`);
			if (width === WIDTHS[0]) {
				await setTheme('dark');
				await snap(`outline-${width}-step1-selected-dark`);
				await setTheme('light');
			}

			await setStep(2);
			await setManaged(UX_LAB_OUTLINE_ANCHORS.studio, true);
			await setManaged(UX_LAB_OUTLINE_ANCHORS.seacow, true);
			await snap(`outline-${width}-step2`);
			expect(await readColumnCollisions()).toEqual([]);

			await setStep(3);
			await exerciseConflictReview(width);
			await snap(`outline-${width}-step3`);
			expect(await readColumnCollisions()).toEqual([]);
			if (width === WIDTHS[0]) {
				await setTheme('dark');
				await snap(`outline-${width}-step3-dark`);
				await setTheme('light');

				// The same folders read as full tag chips instead of deltas.
				await setShowFullTags(true);
				await snap(`outline-${width}-step3-fulltags`);
				await setShowFullTags(false);

				// The nested Johnny Decimal group, where two rules compete.
				await scrollToAnchor(UX_LAB_OUTLINE_ANCHORS.nestedJd);
				await snap(`outline-${width}-step3-conflict`);

				// The co-anchored group: radio choice at step 2, its tags at step 3.
				await setStep(2);
				await setManaged(UX_LAB_OUTLINE_ANCHORS.overlap, true);
				await scrollToAnchor(UX_LAB_OUTLINE_ANCHORS.overlap);
				await snap(`outline-${width}-step2-overlap`);
				await auditOutlineContrast('light');
				await setTheme('dark');
				await auditOutlineContrast('dark');
				await snap('conflict-preview-1200-choices-dark');
				await setTheme('light');
				await setStep(3);
				await scrollToAnchor(UX_LAB_OUTLINE_ANCHORS.overlap);
				await snap(`outline-${width}-step3-overlap`);
				await setStep(2);
				await setManaged(UX_LAB_OUTLINE_ANCHORS.overlap, false);
			}

			await setStep(1);
			await setShowAllFolders(true);
			await snap(`outline-${width}-step1-showall`);
			await setShowAllFolders(false);

			const layout = await browser.executeObsidian(() => {
				const outline = document.querySelector<HTMLElement>('[data-dtf-workbench-outline="1"]');
				if (!outline) return { mode: null, clientWidth: 0, overflow: Number.NaN, offenders: [] };
				const right = outline.getBoundingClientRect().right;
				const offenders = Array.from(outline.querySelectorAll<HTMLElement>('*'))
					.filter((el) => el.getBoundingClientRect().right > right + 1)
					.map((el) => `${el.className || el.tagName}@${
						Math.round(el.getBoundingClientRect().right - right)}`)
					.slice(0, 6);
				return {
					mode: outline.dataset.dtfOutlineLayout ?? null,
					clientWidth: outline.clientWidth,
					overflow: outline.scrollWidth - outline.clientWidth,
					offenders,
				};
			});
			// A named offender is far easier to fix than a bare pixel count.
			expect(layout.offenders).toEqual([]);
			expect(layout.overflow).toBeLessThanOrEqual(1);
			expect(layout.mode).toBe(layout.clientWidth < 480 ? 'stacked' : 'inline');
		});
	}
});
