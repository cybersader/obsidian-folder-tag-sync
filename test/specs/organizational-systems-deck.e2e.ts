import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

const FIXTURE = 'OrgDeckFixture';
const SCREENSHOT_DIR = path.resolve('test/screenshots');
let originalSettings: unknown;
let originalWindowSize: { width: number; height: number };
let leftWasCollapsed = false;
let completeOccurrenceKey = '';
let incompleteOccurrenceKey = '';

async function snap(name: string): Promise<void> {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

async function runCommand(id: string): Promise<void> {
	const executed = await browser.executeObsidian(({ app }, commandId) => {
		const commands = (app as unknown as {
			commands: { executeCommandById(id: string): boolean };
		}).commands;
		return commands.executeCommandById(commandId);
	}, id);
	expect(executed).toBe(true);
}

async function waitForSurface(surface: 'map' | 'scope' | 'candidates'): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian((_context, expected) => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		if (shell?.dataset.dtfWorkbenchCurrentSurface !== expected) return false;
		if (!shell.querySelector('[data-dtf-organizational-systems="1"]')) return false;
		if (expected === 'map') return Boolean(shell.querySelector('[data-dtf-workbench-map="1"]'));
		if (expected === 'scope') return Boolean(shell.querySelector('[data-dtf-workbench-scope="1"]'));
		return Boolean(shell.querySelector('[data-dtf-workbench-candidates="1"]'));
	}, surface), {
		timeout: 15_000,
		timeoutMsg: `Workbench did not finish routing to ${surface}`,
	});
}

async function clickSurface(surface: 'map' | 'scope' | 'candidates'): Promise<void> {
	await browser.executeObsidian((_context, target) => {
		document.querySelector<HTMLButtonElement>(
			`[data-dtf-workbench-surface-button="${target}"]`,
		)?.click();
	}, surface);
	await waitForSurface(surface);
}

describe('Taxonomy Workbench — persistent Organizational systems deck', function () {
	this.timeout(120_000);

	before(async function () {
		originalWindowSize = await browser.executeObsidian(() => ({
			width: window.outerWidth,
			height: window.outerHeight,
		}));
		const setup = await browser.executeObsidian(async ({ app }, fixture) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const workspace = app.workspace as unknown as {
				leftSplit?: { collapsed?: boolean };
			};
			const existing = app.vault.getAbstractFileByPath(fixture);
			if (existing) await app.vault.delete(existing, true);

			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[] } & Record<string, unknown>;
					saveSettings(): Promise<void>;
				}> };
			}).plugins.plugins['folder-tag-sync'];
			const original = JSON.parse(JSON.stringify(plugin.settings));
			plugin.settings = {
				...plugin.settings,
				rules: [{
					id: 'e2e-org-deck-para-layer',
					name: 'E2E organizational deck layer',
					enabled: true,
					priority: 10,
					group: 'para',
					direction: 'folder-to-tag',
					folderPattern: '^OrgDeckFixture(?:/|$)',
					tagEntryPoint: 'org-deck',
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

			for (const folder of [
				fixture,
				`${fixture}/Work`,
				`${fixture}/Work/Projects`,
				`${fixture}/Work/Areas`,
				`${fixture}/Work/Resources`,
				`${fixture}/Work/Archive`,
				`${fixture}/Home`,
				`${fixture}/Home/Projects`,
			]) {
				if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
			return {
				original,
				leftCollapsed: Boolean(workspace.leftSplit?.collapsed),
			};
		}, FIXTURE);
		originalSettings = setup.original;
		leftWasCollapsed = setup.leftCollapsed;
	});

	after(async function () {
		await browser.executeObsidian(async ({ app }, fixture, settings, wasCollapsed) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const existing = app.vault.getAbstractFileByPath(fixture);
			if (existing) await app.vault.delete(existing, true);
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { settings: unknown; saveSettings(): Promise<void> }> };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings = settings;
			await plugin.saveSettings();
			const split = (app.workspace as unknown as {
				leftSplit?: { expand?(): void; collapse?(): void };
			}).leftSplit;
			if (wasCollapsed) split?.collapse?.();
			else split?.expand?.();
		}, FIXTURE, originalSettings, leftWasCollapsed);
		await browser.executeObsidian((_context, size) => window.resizeTo(size.width, size.height), originalWindowSize);
	});

	it('renders separate complete and incomplete occurrences with persistent Rule layers', async function () {
		await runCommand('folder-tag-sync:taxonomy-workbench-open-map');
		await waitForSurface('map');

		const cards = await browser.executeObsidian((_context, fixture) => {
			const all = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'));
			const complete = all.find((card) =>
				(card.textContent ?? '').includes(`At ${fixture}/Work`)
				&& card.dataset.dtfSystemStatus === 'actionable');
			const incomplete = all.find((card) =>
				(card.textContent ?? '').includes(`At ${fixture}/Home`)
				&& card.dataset.dtfSystemStatus === 'incomplete');
			return {
				completeKey: complete?.dataset.dtfSystemOccurrenceKey ?? '',
				incompleteKey: incomplete?.dataset.dtfSystemOccurrenceKey ?? '',
				showIncomplete: document.querySelector<HTMLInputElement>('[data-dtf-show-incomplete-systems="1"]')?.checked ?? false,
				ruleLayerText: document.querySelector('[data-dtf-rule-layers="1"]')?.textContent ?? '',
				tabRoles: Array.from(document.querySelectorAll('[data-dtf-workbench-surface-button]'))
					.map((tab) => [tab.getAttribute('role'), tab.getAttribute('aria-selected')]),
			};
		}, FIXTURE);
		expect(cards.completeKey).not.toBe('');
		expect(cards.incompleteKey).not.toBe('');
		expect(cards.completeKey).not.toBe(cards.incompleteKey);
		expect(cards.showIncomplete).toBe(true);
		expect(cards.ruleLayerText).toContain('para');
		expect(cards.ruleLayerText).toContain('Inferred association');
		expect(cards.tabRoles.every(([role]) => role === 'tab')).toBe(true);
		completeOccurrenceKey = cards.completeKey;
		incompleteOccurrenceKey = cards.incompleteKey;
	});

	it('supports keyboard tab navigation with visible selected state', async function () {
		await browser.executeObsidian(() => {
			const map = document.querySelector<HTMLButtonElement>('[data-dtf-workbench-surface-button="map"]');
			map?.focus();
			map?.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));
		});
		await waitForSurface('scope');
		const focus = await browser.executeObsidian(() => {
			const active = document.activeElement as HTMLElement | null;
			return {
				surface: active?.dataset.dtfWorkbenchSurfaceButton ?? null,
				selected: active?.getAttribute('aria-selected') ?? null,
			};
		});
		expect(focus).toEqual({ surface: 'scope', selected: 'true' });
		await clickSurface('map');
	});

	it('keeps selected occurrence identity across Map, Scope, and grouped Candidates', async function () {
		await browser.executeObsidian((_context, key) => {
			document.querySelector<HTMLButtonElement>(
				`[data-dtf-system-occurrence-key="${CSS.escape(key)}"]`,
			)?.click();
		}, completeOccurrenceKey);
		await browser.pause(150);

		for (const surface of ['scope', 'candidates', 'map'] as const) {
			await clickSurface(surface);
			const state = await browser.executeObsidian(({ app }, key) => {
				const leaf = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0];
				const selected = (leaf?.view.getState() as unknown as {
					selectedSystemInstanceKey?: string | null;
				}).selectedSystemInstanceKey ?? null;
				return {
					selected,
					selectedCard: document.querySelector(
						`[data-dtf-system-occurrence-key="${CSS.escape(key)}"][aria-selected="true"]`,
					) !== null,
					deck: document.querySelector('[data-dtf-workbench-persistent-deck="1"]') !== null,
				};
			}, completeOccurrenceKey);
			expect(state.selected).toBe(completeOccurrenceKey);
			expect(state.selectedCard).toBe(true);
			expect(state.deck).toBe(true);
		}

		await runCommand('folder-tag-sync:scan-and-snap-draft-rules');
		await waitForSurface('candidates');
		const groups = await browser.executeObsidian((_context, fixture) => {
			const headers = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-candidate-occurrence-key]'));
			return {
				count: headers.length,
				hasWork: headers.some((header) => (header.textContent ?? '').includes(`${fixture}/Work`)),
				hasHome: headers.some((header) => (header.textContent ?? '').includes(`${fixture}/Home`)),
			};
		}, FIXTURE);
		expect(groups.count).toBeGreaterThan(0);
		expect(groups.hasWork).toBe(true);
		expect(groups.hasHome).toBe(false);
	});

	it('treats incomplete occurrences as inspect-only and honors the local visibility preference', async function () {
		await browser.executeObsidian((_context, key) => {
			document.querySelector<HTMLButtonElement>(
				`[data-dtf-system-occurrence-key="${CSS.escape(key)}"]`,
			)?.click();
		}, incompleteOccurrenceKey);
		await browser.pause(100);
		const selected = await browser.executeObsidian(({ app }) => ({
			detail: document.querySelector('[data-dtf-selected-system-detail="1"]')?.textContent ?? '',
			state: app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState(),
		}));
		expect(selected.detail).toContain('Inspect only');
		expect((selected.state as { selectedSystemInstanceKey: string }).selectedSystemInstanceKey)
			.toBe(incompleteOccurrenceKey);

		await clickSurface('scope');
		const inspectOnlyScope = await browser.executeObsidian((_context, key) => {
			const chip = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]'))
				.find((element) => element.dataset.dtfOccurrenceKey === key);
			const row = chip?.closest<HTMLElement>('[data-dtf-scope-folder-path]');
			return {
				hasEvidenceChip: Boolean(chip),
				actionable: row?.dataset.dtfScopeActionable ?? null,
				checkboxDisabled: row?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled ?? false,
			};
		}, incompleteOccurrenceKey);
		expect(inspectOnlyScope.hasEvidenceChip).toBe(true);
		expect(inspectOnlyScope.actionable).toBe('false');
		expect(inspectOnlyScope.checkboxDisabled).toBe(true);

		const hidden = await browser.executeObsidian(() => {
			const toggle = document.querySelector<HTMLInputElement>('[data-dtf-show-incomplete-systems="1"]');
			if (!toggle) return false;
			toggle.checked = false;
			toggle.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		});
		expect(hidden).toBe(true);
		await browser.pause(100);
		const result = await browser.executeObsidian(({ app }, key) => ({
			cardStillVisible: document.querySelector(
				`[data-dtf-system-occurrence-key="${CSS.escape(key)}"]`,
			) !== null,
			selected: (app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				selectedSystemInstanceKey: string | null;
			}).selectedSystemInstanceKey,
		}));
		expect(result.cardStillVisible).toBe(false);
		expect(result.selected).toBeNull();
	});

	it('draws selected-only desktop connectors and removes them for narrow panes', async function () {
		await clickSurface('map');
		await browser.executeObsidian((_context, key) => {
			const show = document.querySelector<HTMLInputElement>('[data-dtf-show-incomplete-systems="1"]');
			if (show && !show.checked) {
				show.checked = true;
				show.dispatchEvent(new Event('change', { bubbles: true }));
			}
			document.querySelector<HTMLButtonElement>(
				`[data-dtf-system-occurrence-key="${CSS.escape(key)}"]`,
			)?.click();
		}, completeOccurrenceKey);
		await browser.pause(250);

		const desktop = await browser.executeObsidian((_context, key) => ({
			connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
			matchingEndpoints: Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]'))
				.filter((element) => element.dataset.dtfOccurrenceKey === key).length,
			overlayAriaHidden: document.querySelector('[data-dtf-connector-overlay="1"]')
				?.getAttribute('aria-hidden') ?? null,
		}), completeOccurrenceKey);
		expect(desktop.matchingEndpoints).toBeGreaterThan(0);
		expect(desktop.connectors).toBeGreaterThan(0);
		expect(desktop.overlayAriaHidden).toBe('true');
		await snap('organizational-systems-deck-desktop-selected');

		await browser.executeObsidian(({ app }) => {
			(app.workspace as unknown as { leftSplit?: { collapse?(): void } }).leftSplit?.collapse?.();
			window.resizeTo(520, 800);
		});
		await browser.pause(300);
		const narrow = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			const overlay = document.querySelector<HTMLElement>('[data-dtf-connector-overlay="1"]');
			return {
				width: shell?.clientWidth ?? 0,
				connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
				overlayDisplay: overlay ? getComputedStyle(overlay).display : null,
				overflow: shell ? shell.scrollWidth - shell.clientWidth : 1,
			};
		});
		expect(narrow.width).toBeLessThanOrEqual(520);
		expect(narrow.connectors).toBe(0);
		expect(narrow.overlayDisplay).toBe('none');
		expect(narrow.overflow).toBeLessThanOrEqual(1);
		await snap('organizational-systems-deck-480-pane');

		await browser.executeObsidian(() => window.resizeTo(376, 800));
		await browser.pause(250);
		const compact = await browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			return {
				width: shell?.clientWidth ?? 0,
				connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
				overflow: shell ? shell.scrollWidth - shell.clientWidth : 1,
				selectedCard: document.querySelector('[data-dtf-system-occurrence-key][aria-selected="true"]') !== null,
			};
		});
		expect(compact.width).toBeLessThanOrEqual(376);
		expect(compact.connectors).toBe(0);
		expect(compact.overflow).toBeLessThanOrEqual(1);
		expect(compact.selectedCard).toBe(true);
		await snap('organizational-systems-deck-320-pane');
	});

	it('marks candidate snapshots stale immediately and refreshes before installation', async function () {
		await browser.executeObsidian((_context, size) => window.resizeTo(size.width, size.height), originalWindowSize);
		await clickSurface('candidates');
		const stale = await browser.executeObsidian(async ({ app }, fixture) => {
			const path = `${fixture}/Work/New branch`;
			if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
			const status = document.querySelector<HTMLElement>('[data-dtf-workbench-status]');
			const install = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-candidates="1"] button'))
				.find((button) => /^Install (?:selected rules|\d+ selected rule)/.test(button.textContent ?? ''));
			return {
				status: status?.dataset.dtfWorkbenchStatus ?? null,
				installDisabled: install?.disabled ?? false,
				staleNotice: document.querySelector('[data-dtf-candidate-stale="1"]') !== null,
			};
		}, FIXTURE);
		expect(stale.status).toBe('stale');
		expect(stale.installDisabled).toBe(true);
		expect(stale.staleNotice).toBe(true);

		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector<HTMLElement>('[data-dtf-workbench-status]')?.dataset.dtfWorkbenchStatus === 'ready',
		), {
			timeout: 10_000,
			timeoutMsg: 'Workbench did not refresh its stale candidate snapshot',
		});
	});
});
