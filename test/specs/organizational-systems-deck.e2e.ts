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

describe('Taxonomy Workbench — responsive Organizational systems browser', function () {
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
		await browser.executeObsidian(({ app }) => {
			(app.workspace as unknown as { leftSplit?: { collapse?(): void } }).leftSplit?.collapse?.();
			window.resizeTo(1440, 1000);
		});
		await browser.pause(250);
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

	it('renders separate complete and incomplete occurrences in the wide systems browser', async function () {
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
				ruleLayersOpen: document.querySelector<HTMLDetailsElement>('[data-dtf-rule-layers-disclosure="1"]')?.open ?? true,
				hasSummary: Boolean(document.querySelector('[data-dtf-systems-summary="1"]')),
				browserOpen: document.querySelector('[data-dtf-systems-browser="1"]')?.classList.contains('is-open') ?? false,
				browserAriaHidden: document.querySelector('[data-dtf-systems-browser="1"]')?.getAttribute('aria-hidden') ?? null,
				toggleExpanded: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') ?? null,
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
		expect(cards.ruleLayersOpen).toBe(false);
		expect(cards.hasSummary).toBe(true);
		expect(cards.browserOpen).toBe(true);
		expect(cards.browserAriaHidden).toBe('false');
		expect(cards.toggleExpanded).toBe('true');
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

	it('uses a collapsible side browser without decorative cross-panel connectors', async function () {
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
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true'
			&& document.querySelector('[data-dtf-system-occurrence-key][aria-selected="true"]') !== null,
		), { timeout: 5_000, timeoutMsg: 'Wide systems browser did not retain the selected occurrence' });

		const desktop = await browser.executeObsidian((_context, key) => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
			const browser = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]');
			const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
			const deck = document.querySelector<HTMLElement>('[data-dtf-workbench-persistent-deck="1"]');
			const bodyRect = body?.getBoundingClientRect();
			const browserRect = browser?.getBoundingClientRect();
			const panelRect = panel?.getBoundingClientRect();
			return {
				width: shell?.clientWidth ?? 0,
				browserBesidePanel: Boolean(browserRect && panelRect
					&& browserRect.right <= panelRect.left + 1
					&& Math.abs(browserRect.top - panelRect.top) <= 1),
				browserFillsBody: Boolean(bodyRect && browserRect
					&& browserRect.height >= bodyRect.height - 2),
				panelFillsBody: Boolean(bodyRect && panelRect
					&& panelRect.height >= bodyRect.height - 2),
				browserOverflow: browser ? getComputedStyle(browser).overflowY : null,
				deckOverflow: deck ? getComputedStyle(deck).overflowY : null,
				connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
				hasConnectorOverlay: document.querySelector('[data-dtf-connector-overlay="1"]') !== null,
				matchingEndpoints: Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]'))
					.filter((element) => element.dataset.dtfOccurrenceKey === key).length,
				toggleExpanded: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
					?.getAttribute('aria-expanded') ?? null,
			};
		}, completeOccurrenceKey);
		expect(desktop.width).toBeGreaterThan(750);
		expect(desktop.browserBesidePanel).toBe(true);
		expect(desktop.browserFillsBody).toBe(true);
		expect(desktop.panelFillsBody).toBe(true);
		expect(desktop.browserOverflow).toBe('auto');
		expect(desktop.deckOverflow).not.toBe('auto');
		expect(desktop.matchingEndpoints).toBeGreaterThan(0);
		expect(desktop.connectors).toBe(0);
		expect(desktop.hasConnectorOverlay).toBe(false);
		expect(desktop.toggleExpanded).toBe('true');
		await snap('organizational-systems-browser-desktop-selected');

		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false',
		), { timeout: 3_000, timeoutMsg: 'Wide systems browser did not collapse' });
		const collapsed = await browser.executeObsidian(() => {
			const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
			const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
			const bodyRect = body?.getBoundingClientRect();
			const panelRect = panel?.getBoundingClientRect();
			return {
				browserDisplay: getComputedStyle(document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]')!).display,
				browserAriaHidden: document.querySelector('[data-dtf-systems-browser="1"]')?.getAttribute('aria-hidden'),
				panelUsesBodyWidth: Boolean(bodyRect && panelRect
					&& Math.abs(panelRect.left - bodyRect.left) <= 1
					&& Math.abs(panelRect.right - bodyRect.right) <= 1),
				connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
			};
		});
		expect(collapsed.browserDisplay).toBe('none');
		expect(collapsed.browserAriaHidden).toBe('true');
		expect(collapsed.panelUsesBodyWidth).toBe(true);
		expect(collapsed.connectors).toBe(0);

		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true',
		), { timeout: 5_000, timeoutMsg: 'Wide systems browser did not reopen' });
	});

	it('responds to Workbench container width with a temporary narrow drawer', async function () {
		await clickSurface('map');
		try {
			await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				if (!shell) return;
				shell.style.width = '480px';
				shell.style.maxWidth = '480px';
				shell.style.alignSelf = 'flex-start';
			});
			await browser.waitUntil(async () => browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const toggle = document.querySelector('[data-dtf-systems-browser-toggle="1"]');
				return Boolean(shell && shell.clientWidth <= 480
					&& toggle?.getAttribute('aria-expanded') === 'false');
			}), { timeout: 5_000, timeoutMsg: 'Workbench container did not enter narrow layout' });

			const narrowClosed = await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
				const summary = document.querySelector<HTMLElement>('[data-dtf-systems-summary="1"]');
				const browser = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]');
				const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
				return {
					outerWidth: window.outerWidth,
					width: shell?.clientWidth ?? 0,
					summaryVisible: Boolean(summary?.offsetParent),
					browserDisplay: browser ? getComputedStyle(browser).display : null,
					activeHeightRatio: body && panel && body.clientHeight > 0
						? panel.clientHeight / body.clientHeight
						: 0,
					overflow: shell ? shell.scrollWidth - shell.clientWidth : 1,
					connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
				};
			});
			expect(narrowClosed.outerWidth).toBeGreaterThan(1000);
			expect(narrowClosed.width).toBeLessThanOrEqual(480);
			expect(narrowClosed.summaryVisible).toBe(true);
			expect(narrowClosed.browserDisplay).toBe('none');
			expect(narrowClosed.activeHeightRatio).toBeGreaterThan(0.9);
			expect(narrowClosed.overflow).toBeLessThanOrEqual(1);
			expect(narrowClosed.connectors).toBe(0);

			await browser.executeObsidian(() => {
				document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true',
			), { timeout: 3_000, timeoutMsg: 'Narrow systems drawer did not open' });
			const drawer = await browser.executeObsidian(() => {
				const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
				const browser = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]');
				const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
				const scrim = document.querySelector<HTMLElement>('.dtf-workbench-systems-scrim');
				const bodyRect = body?.getBoundingClientRect();
				const browserRect = browser?.getBoundingClientRect();
				return {
					position: browser ? getComputedStyle(browser).position : null,
					coversBodyHeight: Boolean(bodyRect && browserRect
						&& browserRect.height >= bodyRect.height - 2),
					panelAriaHidden: panel?.getAttribute('aria-hidden') ?? null,
					panelInert: panel?.hasAttribute('inert') ?? false,
					scrimDisplay: scrim ? getComputedStyle(scrim).display : null,
					connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
				};
			});
			expect(drawer.position).toBe('absolute');
			expect(drawer.coversBodyHeight).toBe(true);
			expect(drawer.panelAriaHidden).toBe('true');
			expect(drawer.panelInert).toBe(true);
			expect(drawer.scrimDisplay).toBe('block');
			expect(drawer.connectors).toBe(0);
			await snap('organizational-systems-browser-480-drawer');

			await browser.executeObsidian(() => {
				document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-close="1"]')?.click();
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false',
			), { timeout: 3_000, timeoutMsg: 'Narrow systems drawer close button did not close it' });

			await browser.executeObsidian(() => {
				document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true',
			), { timeout: 3_000, timeoutMsg: 'Narrow systems drawer did not reopen' });
			await browser.executeObsidian(() => {
				document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]')?.dispatchEvent(
					new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
				);
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false',
			), { timeout: 3_000, timeoutMsg: 'Escape did not close the narrow systems drawer' });
			await browser.executeObsidian(() => {
				document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true',
			), { timeout: 3_000, timeoutMsg: 'Narrow systems drawer did not reopen for selection' });
			await browser.executeObsidian((_context, key) => {
				document.querySelector<HTMLButtonElement>(
					`[data-dtf-system-occurrence-key="${CSS.escape(key)}"]`,
				)?.click();
			}, completeOccurrenceKey);
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false',
			), { timeout: 3_000, timeoutMsg: 'Selecting a narrow occurrence did not close the drawer' });
			const selected = await browser.executeObsidian(({ app }, key, fixture) => {
				const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
					selectedSystemInstanceKey?: string | null;
				};
				return {
					key: state.selectedSystemInstanceKey ?? null,
					summary: document.querySelector('[data-dtf-systems-summary="1"]')?.textContent ?? '',
					panelAriaHidden: document.querySelector('.dtf-workbench-active-panel')?.getAttribute('aria-hidden') ?? null,
					surface: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')
						?.dataset.dtfWorkbenchCurrentSurface ?? null,
					hasAnchor: (document.querySelector('[data-dtf-systems-summary="1"]')?.textContent ?? '')
						.includes(`${fixture}/Work`),
				};
			}, completeOccurrenceKey, FIXTURE);
			expect(selected.key).toBe(completeOccurrenceKey);
			expect(selected.hasAnchor).toBe(true);
			expect(selected.panelAriaHidden).toBeNull();
			expect(selected.surface).toBe('map');

			await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				if (!shell) return;
				shell.style.width = '320px';
				shell.style.maxWidth = '320px';
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				(document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')?.clientWidth ?? 999) <= 320,
			), { timeout: 3_000, timeoutMsg: 'Workbench container did not reach 320 px layout' });
			const compact = await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
				const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
				const counts = document.querySelector<HTMLElement>('.dtf-systems-summary-counts');
				return {
					width: shell?.clientWidth ?? 0,
					overflow: shell ? shell.scrollWidth - shell.clientWidth : 1,
					activeHeightRatio: body && panel && body.clientHeight > 0
						? panel.clientHeight / body.clientHeight
						: 0,
					countsDisplay: counts ? getComputedStyle(counts).display : null,
				};
			});
			expect(compact.width).toBeLessThanOrEqual(320);
			expect(compact.overflow).toBeLessThanOrEqual(1);
			expect(compact.activeHeightRatio).toBeGreaterThan(0.9);
			expect(compact.countsDisplay).toBe('none');
			await snap('organizational-systems-browser-320-pane');

			await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				if (shell) shell.style.height = '420px';
			});
			await browser.pause(100);
			const short = await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
				const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
				const mapTree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
				return {
					bodyHeight: body?.clientHeight ?? 0,
					panelHeight: panel?.clientHeight ?? 0,
					mapTreeHeight: mapTree?.clientHeight ?? 0,
					mapTreeVisible: Boolean(mapTree?.offsetParent),
					shortClass: shell?.classList.contains('is-short-workbench') ?? false,
					statsDisplay: getComputedStyle(document.querySelector<HTMLElement>('.dtf-workbench-map-stats')!).display,
					browserOpen: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
						?.getAttribute('aria-expanded') ?? null,
				};
			});
			expect(short.bodyHeight).toBeGreaterThan(150);
			expect(short.panelHeight).toBeGreaterThanOrEqual(short.bodyHeight - 2);
			expect(short.mapTreeVisible).toBe(true);
			expect(short.mapTreeHeight).toBeGreaterThanOrEqual(120);
			expect(short.shortClass).toBe(true);
			expect(short.statsDisplay).toBe('none');
			expect(short.browserOpen).toBe('false');
			await snap('organizational-systems-browser-short-pane');
		} finally {
			await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				if (!shell) return;
				shell.style.width = '';
				shell.style.maxWidth = '';
				shell.style.alignSelf = '';
				shell.style.height = '100%';
			});
			await browser.pause(250);
		}
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
