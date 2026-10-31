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
				`${fixture}/An intentionally long organizational context name/Home`,
				`${fixture}/An intentionally long organizational context name/Home/Projects`,
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

	it('groups Ready organizational systems before collapsed Possible organizational systems with explicit counts and consequences', async function () {
		await runCommand('folder-tag-sync:taxonomy-workbench-open-map');
		await waitForSurface('map');
		await browser.executeObsidian(() => {
			const possible = document.querySelector<HTMLDetailsElement>('[data-dtf-possible-systems="1"]');
			if (possible) possible.open = false;
		});
		await browser.pause(50);

		const cards = await browser.executeObsidian((_context, fixture) => {
			const all = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'));
			const pathParts = (card: HTMLButtonElement) => {
				const semanticPath = card.querySelector<HTMLElement>('[data-dtf-semantic-path="system-occurrence-anchor"]');
				return {
					context: semanticPath?.querySelector<HTMLElement>('[data-dtf-path-context="1"] .dtf-semantic-path-value')?.textContent ?? null,
					focus: semanticPath?.querySelector<HTMLElement>('[data-dtf-path-focus="1"] .dtf-semantic-path-value')?.textContent ?? null,
					aria: semanticPath?.getAttribute('aria-label') ?? null,
				};
			};
			const ready = all.find((card) => {
				const semanticPath = pathParts(card);
				return semanticPath.context === fixture
					&& semanticPath.focus === 'Work'
					&& card.dataset.dtfSystemStatus === 'actionable';
			});
			const possible = all.find((card) => {
				const semanticPath = pathParts(card);
				return semanticPath.context === fixture
					&& semanticPath.focus === 'Home'
					&& card.dataset.dtfSystemStatus === 'incomplete';
			});
			const readyGroup = document.querySelector<HTMLElement>('[data-dtf-system-group="ready"]');
			const possibleGroup = document.querySelector<HTMLDetailsElement>('[data-dtf-possible-systems="1"]');
			const readyList = document.querySelector<HTMLElement>('[data-dtf-system-group-list="ready"]');
			const possibleList = document.querySelector<HTMLElement>('[data-dtf-system-group-list="possible"]');
			const selectedEvidence = document.querySelector<HTMLElement>('[data-dtf-selected-system-evidence="1"]');
			const retiredControls = document.querySelector(
				'[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]',
			);
			return {
				readyKey: ready?.dataset.dtfSystemOccurrenceKey ?? '',
				possibleKey: possible?.dataset.dtfSystemOccurrenceKey ?? '',
				readyContext: ready ? pathParts(ready).context : null,
				readyFocus: ready ? pathParts(ready).focus : null,
				readyPathAria: ready ? pathParts(ready).aria : null,
				readyObjectKind: ready?.querySelector('.dtf-workbench-object-kind')?.lastElementChild?.textContent?.trim() ?? null,
				possibleObjectKind: possible?.querySelector('.dtf-workbench-object-kind')?.lastElementChild?.textContent?.trim() ?? null,
				readyConsequence: ready?.querySelector('.dtf-workbench-consequence')?.textContent ?? null,
				possibleConsequence: possible?.querySelector('.dtf-workbench-consequence')?.textContent ?? null,
				selectionAria: ready?.getAttribute('aria-label') ?? null,
				longAnchorPresent: all.some((card) => {
					const semanticPath = pathParts(card);
					return semanticPath.context?.includes('An intentionally long organizational context name')
						&& semanticPath.focus === 'Home';
				}),
				readyCount: readyList?.querySelectorAll('[data-dtf-system-occurrence-key]').length ?? -1,
				possibleCount: possibleList?.querySelectorAll('[data-dtf-system-occurrence-key]').length ?? -1,
				readyTitle: readyGroup?.querySelector('.dtf-orgsys-group-title')?.textContent ?? null,
				possibleTitle: possibleGroup?.querySelector('summary')?.textContent ?? null,
				possibleOpen: possibleGroup?.open ?? true,
				noSelectedEvidenceBeforeSelection: selectedEvidence === null,
				retiredControlsPresent: retiredControls !== null,
				retiredTogglePresent: document.querySelector('[data-dtf-show-incomplete-systems="1"]') !== null,
				ruleLayerText: document.querySelector('[data-dtf-rule-layers="1"]')?.textContent ?? '',
				ruleLayersOpen: document.querySelector<HTMLDetailsElement>('[data-dtf-rule-layers-disclosure="1"]')?.open ?? true,
				hasSummary: Boolean(document.querySelector('[data-dtf-systems-summary="1"]')),
				browserOpen: document.querySelector('[data-dtf-systems-browser="1"]')?.classList.contains('is-open') ?? false,
				browserAriaHidden: document.querySelector('[data-dtf-systems-browser="1"]')?.getAttribute('aria-hidden') ?? null,
				toggleExpanded: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') ?? null,
				toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
				tabs: Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-workbench-surface-button]'))
					.map((tab) => ({
						role: tab.getAttribute('role'),
						label: tab.getAttribute('aria-label'),
						selected: tab.getAttribute('aria-selected'),
					})),
			};
		}, FIXTURE);
		completeOccurrenceKey = cards.readyKey;
		incompleteOccurrenceKey = cards.possibleKey;
		expect(cards.readyKey).not.toBe('');
		expect(cards.possibleKey).not.toBe('');
		expect(cards.readyKey).not.toBe(cards.possibleKey);
		expect(cards.readyContext).toBe(FIXTURE);
		expect(cards.readyFocus).toBe('Work');
		expect(cards.readyPathAria).toContain('Recognized here: Work');
		expect(cards.readyPathAria).toContain(`Parent context: ${FIXTURE}`);
		expect(cards.readyObjectKind).toBe('Ready organizational system');
		expect(cards.possibleObjectKind).toBe('Possible organizational system');
		expect(cards.readyConsequence).toContain('Ready to propose rules');
		expect(cards.readyConsequence).toContain('choose where they apply');
		expect(cards.possibleConsequence).toContain('More evidence is needed');
		expect(cards.possibleConsequence).toContain('Missing expected folder types');
		expect(cards.selectionAria).toContain('does not add, enable, or silently choose rules');
		expect(cards.longAnchorPresent).toBe(true);
		expect(cards.readyCount).toBe(1);
		expect(cards.possibleCount).toBe(2);
		expect(cards.readyTitle).toBe('Ready organizational systems (1)');
		expect(cards.possibleTitle).toBe('Organizational systems needing more folders (2)');
		expect(cards.possibleOpen).toBe(false);
		expect(cards.noSelectedEvidenceBeforeSelection).toBe(true);
			expect(cards.retiredControlsPresent).toBe(false);
		expect(cards.retiredTogglePresent).toBe(false);
		expect(cards.ruleLayerText).toContain('para');
		expect(cards.ruleLayerText).toContain('Possible organizational system link — inferred');
		expect(cards.ruleLayersOpen).toBe(false);
		expect(cards.hasSummary).toBe(true);
		expect(cards.browserOpen).toBe(true);
		expect(cards.browserAriaHidden).toBe('false');
		expect(cards.toggleExpanded).toBe('true');
			expect(cards.toggleLabel).toBe('Hide organizational systems sidebar');
		expect(cards.tabs).toEqual([
			{ role: 'tab', label: 'Explore your vault', selected: 'true' },
			{ role: 'tab', label: 'Choose where rules apply', selected: 'false' },
			{ role: 'tab', label: 'Review proposed rules', selected: 'false' },
		]);
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
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'))
				.find((card) => card.dataset.dtfSystemOccurrenceKey === key)?.click();
		}, completeOccurrenceKey);
		await browser.pause(150);

		for (const surface of ['scope', 'candidates', 'map'] as const) {
			await clickSurface(surface);
			const state = await browser.executeObsidian(({ app }, key) => {
				const leaf = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0];
				const selected = (leaf?.view.getState() as unknown as {
					selectedSystemInstanceKey?: string | null;
				}).selectedSystemInstanceKey ?? null;
				const summary = document.querySelector<HTMLElement>('[data-dtf-selected-system-summary="1"]');
				return {
					selected,
					selectedCard: Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'))
						.some((card) => card.dataset.dtfSystemOccurrenceKey === key
							&& card.getAttribute('aria-selected') === 'true'),
					deck: document.querySelector('[data-dtf-workbench-persistent-deck="1"]') !== null,
						adjacentEvidence: document.querySelector('[data-dtf-system-occurrence-key][aria-selected="true"] + [data-dtf-selected-system-evidence="1"]') !== null,
						retiredControlsPresent: document.querySelector('[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]') !== null,
					summaryKind: summary?.querySelector('.dtf-workbench-object-kind')?.textContent ?? null,
					summaryContext: summary?.querySelector('[data-dtf-path-context="1"] .dtf-semantic-path-value')?.textContent ?? null,
					summaryFocus: summary?.querySelector('[data-dtf-path-focus="1"] .dtf-semantic-path-value')?.textContent ?? null,
				};
			}, completeOccurrenceKey);
			expect(state.selected).toBe(completeOccurrenceKey);
			expect(state.selectedCard).toBe(true);
			expect(state.deck).toBe(true);
				expect(state.adjacentEvidence).toBe(true);
				expect(state.retiredControlsPresent).toBe(false);
			expect(state.summaryKind).toBe('Focused organizational system');
			expect(state.summaryContext).toBe(FIXTURE);
			expect(state.summaryFocus).toBe('Work');
		}

		await runCommand('folder-tag-sync:scan-and-snap-draft-rules');
		await waitForSurface('candidates');
		const groups = await browser.executeObsidian((_context, fixture) => {
			const headers = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-candidate-occurrence-key]'));
			const anchor = (header: HTMLElement) => ({
				context: header.querySelector<HTMLElement>('[data-dtf-semantic-path="candidate-source-system-anchor"] [data-dtf-path-context="1"] .dtf-semantic-path-value')?.textContent ?? null,
				focus: header.querySelector<HTMLElement>('[data-dtf-semantic-path="candidate-source-system-anchor"] [data-dtf-path-focus="1"] .dtf-semantic-path-value')?.textContent ?? null,
			});
			return {
				count: headers.length,
				hasWork: headers.some((header) => {
					const path = anchor(header);
					return path.context === fixture && path.focus === 'Work';
				}),
				hasHome: headers.some((header) => {
					const path = anchor(header);
					return path.context === fixture && path.focus === 'Home';
				}),
				objectKinds: headers.map((header) => header.querySelector('.dtf-workbench-object-kind')?.textContent ?? null),
				focusActions: headers.map((header) => header.querySelector<HTMLButtonElement>('[data-dtf-candidate-group-header="1"]')?.getAttribute('aria-label') ?? null),
			};
		}, FIXTURE);
		expect(groups.count).toBeGreaterThan(0);
		expect(groups.hasWork).toBe(true);
		expect(groups.hasHome).toBe(false);
		expect(groups.objectKinds.every((kind) => kind === 'Suggested from')).toBe(true);
		expect(groups.focusActions.every((label) => label?.includes('does not change which proposed rules are checked'))).toBe(true);
	});

	it('keeps Possible organizational systems inspect-only, visible, and selected without changing the plan', async function () {
		await clickSurface('map');
		await browser.executeObsidian((_context, key) => {
			const possible = document.querySelector<HTMLDetailsElement>('[data-dtf-possible-systems="1"]');
			if (possible) possible.open = true;
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'))
				.find((card) => card.dataset.dtfSystemOccurrenceKey === key)?.click();
		}, incompleteOccurrenceKey);
		await browser.pause(100);
		const selected = await browser.executeObsidian(({ app }) => {
			const card = document.querySelector<HTMLElement>(
				'[data-dtf-system-occurrence-key][aria-selected="true"]',
			);
			const evidence = card?.nextElementSibling?.matches('[data-dtf-selected-system-evidence="1"]')
				? card.nextElementSibling as HTMLDetailsElement
				: null;
			if (evidence) evidence.open = true;
			return {
				adjacentEvidence: Boolean(evidence),
				evidenceText: evidence?.textContent ?? '',
				objectKind: card?.querySelector('.dtf-workbench-object-kind')?.textContent?.trim() ?? null,
				anchorAria: card?.querySelector('[data-dtf-semantic-path="system-occurrence-anchor"]')?.getAttribute('aria-label') ?? null,
				primaryActionText: document.querySelector('[data-dtf-map-primary-action]')?.textContent?.trim() ?? null,
				retiredControlsPresent: document.querySelector(
					'[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]',
				) !== null,
				hasRetiredRefresh: Array.from(document.querySelectorAll('button'))
					.some((button) => button.textContent?.trim() === 'Refresh after adding folders'),
				possibleOpen: document.querySelector<HTMLDetailsElement>('[data-dtf-possible-systems="1"]')?.open ?? false,
				retiredTogglePresent: document.querySelector('[data-dtf-show-incomplete-systems="1"]') !== null,
				state: app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState(),
			};
		});
		expect(selected.adjacentEvidence).toBe(true);
		expect(selected.evidenceText).toContain('Why Folder Tag Sync recognized this organizational system');
		expect(selected.evidenceText).toContain('Folders that identify this organizational system');
		expect(selected.evidenceText).toContain('Projects');
		expect(selected.objectKind).toContain('Possible organizational system');
		expect(selected.anchorAria).toContain('Recognized here: Home');
		expect(selected.primaryActionText).toBe('Choose a ready organizational system');
		expect(selected.retiredControlsPresent).toBe(false);
		expect(selected.hasRetiredRefresh).toBe(false);
		expect(selected.possibleOpen).toBe(true);
		expect(selected.retiredTogglePresent).toBe(false);
		expect((selected.state as { selectedSystemInstanceKey: string }).selectedSystemInstanceKey)
			.toBe(incompleteOccurrenceKey);

		await clickSurface('scope');
		const inspectOnlyScope = await browser.executeObsidian(({ app }, key) => {
			const chip = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]'))
				.find((element) => element.dataset.dtfOccurrenceKey === key);
			const row = chip?.closest<HTMLElement>('[data-dtf-scope-folder-path]');
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				selectedSystemInstanceKey?: string | null;
				scope?: { selectedPaths?: string[] };
			};
			return {
				hasEvidenceChip: Boolean(chip),
				actionable: row?.dataset.dtfScopeActionable ?? null,
				checkboxDisabled: row?.querySelector<HTMLInputElement>('input[type="checkbox"]')?.disabled ?? false,
				selectedOccurrence: state.selectedSystemInstanceKey ?? null,
				selectedPaths: state.scope?.selectedPaths ?? [],
			};
		}, incompleteOccurrenceKey);
		expect(inspectOnlyScope.hasEvidenceChip).toBe(true);
		expect(inspectOnlyScope.actionable).toBe('false');
		expect(inspectOnlyScope.checkboxDisabled).toBe(true);
		expect(inspectOnlyScope.selectedOccurrence).toBe(incompleteOccurrenceKey);
		expect(inspectOnlyScope.selectedPaths).toEqual([]);

		await clickSurface('map');
		await browser.executeObsidian(() => {
			const toggle = document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]');
			if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false',
		), { timeout: 3_000, timeoutMsg: 'Organizational systems browser did not close before reveal test' });
		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian((_context, key) => {
			const possible = document.querySelector<HTMLDetailsElement>('[data-dtf-possible-systems="1"]');
			const selectedCard = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'))
				.find((card) => card.dataset.dtfSystemOccurrenceKey === key);
			return possible?.open === true
				&& selectedCard?.getAttribute('aria-selected') === 'true'
				&& selectedCard.nextElementSibling?.matches('[data-dtf-selected-system-evidence="1"]') === true;
		}, incompleteOccurrenceKey), {
			timeout: 5_000,
			timeoutMsg: 'Reopened browser did not reveal the selected Possible organizational system and adjacent evidence',
		});
	});

	it('uses a collapsible side browser without decorative cross-panel connectors', async function () {
		await clickSurface('map');
		await browser.executeObsidian((_context, key) => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'))
				.find((card) => card.dataset.dtfSystemOccurrenceKey === key)?.click();
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
			const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'));
			const cardRects = cards.map((card) => card.getBoundingClientRect());
			const selectedCard = cards.find((card) => card.getAttribute('aria-selected') === 'true') ?? null;
			const evidence = selectedCard?.nextElementSibling?.matches('[data-dtf-selected-system-evidence="1"]')
				? selectedCard.nextElementSibling as HTMLElement
				: null;
			const selectedCardRect = selectedCard?.getBoundingClientRect();
			const evidenceRect = evidence?.getBoundingClientRect();
			const itemRect = selectedCard?.parentElement?.getBoundingClientRect();
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
				cardContentOverflow: cards.filter((card) =>
					card.scrollHeight > card.clientHeight + 1).length,
				cardHorizontalOverflow: cards.filter((card) =>
					card.scrollWidth > card.clientWidth + 1).length,
				cardChildOverflow: cards.filter((card, index) => {
					const rect = cardRects[index];
					return Array.from(card.children).some((child) => {
						const childRect = child.getBoundingClientRect();
						return childRect.top < rect.top - 1 || childRect.bottom > rect.bottom + 1;
					});
				}).length,
				cardIntersections: cardRects.slice(0, -1).filter((rect, index) =>
					rect.bottom > cardRects[index + 1].top + 1).length,
				evidenceAdjacent: Boolean(selectedCard && evidence && selectedCard.nextElementSibling === evidence),
				evidencePosition: evidence ? getComputedStyle(evidence).position : null,
				evidenceBelowSelectedCard: Boolean(selectedCardRect && evidenceRect
					&& evidenceRect.top >= selectedCardRect.bottom - 1),
				evidenceWithinOccurrenceItem: Boolean(itemRect && evidenceRect
					&& evidenceRect.left >= itemRect.left - 1
					&& evidenceRect.right <= itemRect.right + 1
					&& evidenceRect.bottom <= itemRect.bottom + 1),
				evidenceOccludedCards: evidenceRect ? cards.filter((card) => {
					if (card === selectedCard) return false;
					const rect = card.getBoundingClientRect();
					if (rect.width === 0 || rect.height === 0) return false;
					return evidenceRect.left < rect.right && evidenceRect.right > rect.left
						&& evidenceRect.top < rect.bottom && evidenceRect.bottom > rect.top;
				}).length : -1,
				retiredControlsPresent: document.querySelector('[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]') !== null,
				connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
				hasConnectorOverlay: document.querySelector('[data-dtf-connector-overlay="1"]') !== null,
				matchingEndpoints: Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]'))
					.filter((element) => element.dataset.dtfOccurrenceKey === key).length,
				toggleExpanded: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
					?.getAttribute('aria-expanded') ?? null,
				toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
					?.getAttribute('aria-label') ?? null,
			};
		}, completeOccurrenceKey);
		expect(desktop.width).toBeGreaterThan(750);
		expect(desktop.browserBesidePanel).toBe(true);
		expect(desktop.browserFillsBody).toBe(true);
		expect(desktop.panelFillsBody).toBe(true);
		expect(desktop.browserOverflow).toBe('auto');
		expect(desktop.deckOverflow).not.toBe('auto');
		expect(desktop.cardContentOverflow).toBe(0);
		expect(desktop.cardHorizontalOverflow).toBe(0);
		expect(desktop.cardChildOverflow).toBe(0);
		expect(desktop.cardIntersections).toBe(0);
		expect(desktop.evidenceAdjacent).toBe(true);
		expect(desktop.evidencePosition).toBe('static');
		expect(desktop.evidenceBelowSelectedCard).toBe(true);
		expect(desktop.evidenceWithinOccurrenceItem).toBe(true);
		expect(desktop.evidenceOccludedCards).toBe(0);
		expect(desktop.retiredControlsPresent).toBe(false);
		expect(desktop.matchingEndpoints).toBeGreaterThan(0);
		expect(desktop.connectors).toBe(0);
		expect(desktop.hasConnectorOverlay).toBe(false);
		expect(desktop.toggleExpanded).toBe('true');
		expect(desktop.toggleLabel).toBe('Hide organizational systems sidebar');
		await snap('organizational-systems-browser-desktop-selected');

		const expandedLayers = await browser.executeObsidian(() => {
			const disclosure = document.querySelector<HTMLDetailsElement>('[data-dtf-rule-layers-disclosure="1"]');
			if (disclosure) disclosure.open = true;
			const browser = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]');
			const evidence = document.querySelector<HTMLElement>('[data-dtf-selected-system-evidence="1"]');
			const layers = document.querySelector<HTMLElement>('[data-dtf-rule-layers="1"]');
			const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-rule-layer-key]'));
			return {
				open: disclosure?.open ?? false,
				cardContentOverflow: cards.filter((card) =>
					card.scrollHeight > card.clientHeight + 1).length,
				cardHorizontalOverflow: cards.filter((card) =>
					card.scrollWidth > card.clientWidth + 1).length,
				evidenceOverlapsLayers: Boolean(evidence && layers
					&& evidence.getBoundingClientRect().bottom > layers.getBoundingClientRect().top + 1),
				browserHorizontalOverflow: browser ? browser.scrollWidth - browser.clientWidth : 1,
				summaryText: disclosure?.querySelector('summary')?.textContent ?? '',
				description: disclosure?.querySelector('.dtf-rule-layers-description')?.textContent ?? '',
				objectKinds: cards.map((card) => card.querySelector('.dtf-workbench-object-kind')?.textContent ?? null),
				associationLabels: cards.map((card) => card.querySelector('.dtf-rule-layer-association-label')?.textContent ?? null),
			};
		});
		expect(expandedLayers.open).toBe(true);
		expect(expandedLayers.cardContentOverflow).toBe(0);
		expect(expandedLayers.cardHorizontalOverflow).toBe(0);
		expect(expandedLayers.evidenceOverlapsLayers).toBe(false);
		expect(expandedLayers.browserHorizontalOverflow).toBeLessThanOrEqual(1);
		expect(expandedLayers.summaryText).toContain('Installed rule layers');
		expect(expandedLayers.description).toContain('not recognized organizational systems');
		expect(expandedLayers.objectKinds.every((kind) => kind === 'Runtime layer')).toBe(true);
		expect(expandedLayers.associationLabels).toContain('Possible organizational system link — inferred');
		await browser.executeObsidian(() => {
			const browser = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]');
			const disclosure = document.querySelector<HTMLElement>('[data-dtf-rule-layers-disclosure="1"]');
			if (!browser || !disclosure) return;
			const browserRect = browser.getBoundingClientRect();
			const disclosureRect = disclosure.getBoundingClientRect();
			browser.scrollTop += disclosureRect.top - browserRect.top - 12;
		});
		await browser.pause(150);
		await snap('organizational-systems-browser-rule-layers-open');

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
				toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
			};
		});
		expect(collapsed.browserDisplay).toBe('none');
		expect(collapsed.browserAriaHidden).toBe('true');
		expect(collapsed.panelUsesBodyWidth).toBe(true);
		expect(collapsed.connectors).toBe(0);
		expect(collapsed.toggleLabel).toBe('Show organizational systems sidebar');

		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true',
		), { timeout: 5_000, timeoutMsg: 'Wide systems browser did not reopen' });
	});

	it('classifies narrow layouts without changing the explicit browser preference', async function () {
		await clickSurface('map');
		await browser.executeObsidian(() => {
			const toggle = document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]');
			if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false',
		), { timeout: 3_000, timeoutMsg: 'Explicit browser close preference was not applied' });
		try {
			await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				if (!shell) return;
				shell.style.width = '480px';
				shell.style.maxWidth = '480px';
				shell.style.alignSelf = 'flex-start';
			});
			// Measured in this harness: after a scripted style mutation the renderer
			// reaches no rendering opportunity on its own, so the view's
			// ResizeObserver never fires and dtfSystemsBrowserMode keeps its
			// pre-resize value. The screenshot capture path forces one frame (a
			// WebDriver pointer move does not). No PNG is written and no assertion
			// below is changed.
			await browser.takeScreenshot();
			await browser.waitUntil(async () => browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const toggle = document.querySelector('[data-dtf-systems-browser-toggle="1"]');
				return Boolean(shell && shell.clientWidth <= 480
					&& shell.dataset.dtfSystemsBrowserMode === 'overlay'
					&& toggle?.getAttribute('aria-expanded') === 'false');
			}), { timeout: 5_000, timeoutMsg: 'Workbench container did not enter narrow classified layout' });

			const narrowClosed = await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				const body = document.querySelector<HTMLElement>('[data-dtf-workbench-body="1"]');
				const summary = document.querySelector<HTMLElement>('[data-dtf-systems-summary="1"]');
				const browser = document.querySelector<HTMLElement>('[data-dtf-systems-browser="1"]');
				const panel = document.querySelector<HTMLElement>('.dtf-workbench-active-panel');
				return {
					outerWidth: window.outerWidth,
					width: shell?.clientWidth ?? 0,
					browserMode: shell?.dataset.dtfSystemsBrowserMode ?? null,
					density: shell?.dataset.dtfWorkbenchDensity ?? null,
					summaryVisible: Boolean(summary?.offsetParent),
					browserDisplay: browser ? getComputedStyle(browser).display : null,
					activeHeightRatio: body && panel && body.clientHeight > 0
						? panel.clientHeight / body.clientHeight
						: 0,
					overflow: shell ? shell.scrollWidth - shell.clientWidth : 1,
					connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
					toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
				};
			});
			expect(narrowClosed.outerWidth).toBeGreaterThan(1000);
			expect(narrowClosed.width).toBeLessThanOrEqual(480);
			expect(narrowClosed.browserMode).toBe('overlay');
			expect(narrowClosed.density).toBe('tight');
			expect(narrowClosed.summaryVisible).toBe(true);
			expect(narrowClosed.browserDisplay).toBe('none');
			expect(narrowClosed.activeHeightRatio).toBeGreaterThan(0.9);
			expect(narrowClosed.overflow).toBeLessThanOrEqual(1);
			expect(narrowClosed.connectors).toBe(0);
			expect(narrowClosed.toggleLabel).toBe('Open organizational systems drawer');

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
				const selectedCard = document.querySelector<HTMLElement>('[data-dtf-system-occurrence-key][aria-selected="true"]');
				const evidence = selectedCard?.nextElementSibling?.matches('[data-dtf-selected-system-evidence="1"]')
					? selectedCard.nextElementSibling as HTMLElement
					: null;
				const cards = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'));
				const cardRects = cards.map((card) => card.getBoundingClientRect());
				const bodyRect = body?.getBoundingClientRect();
				const browserRect = browser?.getBoundingClientRect();
				const selectedCardRect = selectedCard?.getBoundingClientRect();
				const evidenceRect = evidence?.getBoundingClientRect();
				const itemRect = selectedCard?.parentElement?.getBoundingClientRect();
				return {
					position: browser ? getComputedStyle(browser).position : null,
					coversBodyHeight: Boolean(bodyRect && browserRect
						&& browserRect.height >= bodyRect.height - 2),
					panelAriaHidden: panel?.getAttribute('aria-hidden') ?? null,
					panelInert: panel?.hasAttribute('inert') ?? false,
					scrimDisplay: scrim ? getComputedStyle(scrim).display : null,
					toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
					selectedCardPresent: Boolean(selectedCardRect),
					selectedCardWithinBrowser: Boolean(selectedCardRect && browserRect
						&& selectedCardRect.top >= browserRect.top
						&& selectedCardRect.bottom <= browserRect.bottom),
					evidenceAdjacent: Boolean(selectedCard && evidence && selectedCard.nextElementSibling === evidence),
					evidencePosition: evidence ? getComputedStyle(evidence).position : null,
					evidenceBelowSelectedCard: Boolean(selectedCardRect && evidenceRect
						&& evidenceRect.top >= selectedCardRect.bottom - 1),
					evidenceWithinOccurrenceItem: Boolean(itemRect && evidenceRect
						&& evidenceRect.left >= itemRect.left - 1
						&& evidenceRect.right <= itemRect.right + 1
						&& evidenceRect.bottom <= itemRect.bottom + 1),
					evidenceOccludedCards: evidenceRect ? cards.filter((card) => {
						if (card === selectedCard) return false;
						const rect = card.getBoundingClientRect();
						if (rect.width === 0 || rect.height === 0) return false;
						return evidenceRect.left < rect.right && evidenceRect.right > rect.left
							&& evidenceRect.top < rect.bottom && evidenceRect.bottom > rect.top;
					}).length : -1,
					retiredControlsPresent: document.querySelector('[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]') !== null,
					primaryActionText: document.querySelector('[data-dtf-map-primary-action]')?.textContent?.trim() ?? null,
					cardContentOverflow: cards.filter((card) =>
						card.scrollHeight > card.clientHeight + 1).length,
					cardHorizontalOverflow: cards.filter((card) =>
						card.scrollWidth > card.clientWidth + 1).length,
					cardChildOverflow: cards.filter((card, index) => {
						const rect = cardRects[index];
						return Array.from(card.children).some((child) => {
							const childRect = child.getBoundingClientRect();
							return childRect.top < rect.top - 1 || childRect.bottom > rect.bottom + 1;
						});
					}).length,
					cardIntersections: cardRects.slice(0, -1).filter((rect, index) =>
						rect.bottom > cardRects[index + 1].top + 1).length,
					connectors: document.querySelectorAll('[data-dtf-connector="1"]').length,
				};
			});
			expect(drawer.position).toBe('absolute');
			expect(drawer.coversBodyHeight).toBe(true);
			expect(drawer.panelAriaHidden).toBe('true');
			expect(drawer.panelInert).toBe(true);
			expect(drawer.scrimDisplay).toBe('block');
			expect(drawer.toggleLabel).toBe('Close organizational systems drawer');
			expect(drawer.selectedCardPresent).toBe(true);
			expect(drawer.selectedCardWithinBrowser).toBe(true);
			expect(drawer.evidenceAdjacent).toBe(true);
			expect(drawer.evidencePosition).toBe('static');
			expect(drawer.evidenceBelowSelectedCard).toBe(true);
			expect(drawer.evidenceWithinOccurrenceItem).toBe(true);
			expect(drawer.evidenceOccludedCards).toBe(0);
			expect(drawer.retiredControlsPresent).toBe(false);
			expect(drawer.primaryActionText).toBe('Choose where this organizational system applies');
			expect(drawer.cardContentOverflow).toBe(0);
			expect(drawer.cardHorizontalOverflow).toBe(0);
			expect(drawer.cardChildOverflow).toBe(0);
			expect(drawer.cardIntersections).toBe(0);
			expect(drawer.connectors).toBe(0);
			await snap('organizational-systems-browser-480-drawer');

			await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				if (!shell) return;
				shell.style.width = '320px';
				shell.style.maxWidth = '320px';
			});
			await browser.waitUntil(async () => browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				return (shell?.clientWidth ?? 999) <= 320
					&& shell?.dataset.dtfSystemsBrowserMode === 'overlay'
					&& document.querySelector('[data-dtf-systems-browser-toggle="1"]')
						?.getAttribute('aria-expanded') === 'true';
			}), { timeout: 3_000, timeoutMsg: 'Open browser preference did not survive a narrower overlay layout' });
			await browser.executeObsidian(() => {
				const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
				if (!shell) return;
				shell.style.width = '480px';
				shell.style.maxWidth = '480px';
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true',
			), { timeout: 3_000, timeoutMsg: 'Open browser preference changed while resizing overlay mode' });

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
				Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'))
					.find((card) => card.dataset.dtfSystemOccurrenceKey === key)?.click();
			}, completeOccurrenceKey);
			await browser.waitUntil(async () => browser.executeObsidian((_context, key) => {
				const selectedCard = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'))
					.find((card) => card.dataset.dtfSystemOccurrenceKey === key);
				return document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true'
					&& selectedCard?.getAttribute('aria-selected') === 'true'
					&& selectedCard.nextElementSibling?.matches('[data-dtf-selected-system-evidence="1"]') === true
					&& document.querySelector('[data-dtf-map-primary-action]')?.textContent?.trim()
						=== 'Choose where this organizational system applies'
					&& document.querySelector('[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]') === null;
			}, completeOccurrenceKey), {
				timeout: 3_000,
				timeoutMsg: 'Selecting a narrow occurrence did not keep adjacent evidence and the Explore action available',
			});
			const selected = await browser.executeObsidian(({ app }, key, fixture) => {
				const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
					selectedSystemInstanceKey?: string | null;
				};
				const selectedCard = document.querySelector<HTMLElement>('[data-dtf-system-occurrence-key][aria-selected="true"]');
				return {
					key: state.selectedSystemInstanceKey ?? null,
					summary: document.querySelector('[data-dtf-systems-summary="1"]')?.textContent ?? '',
					browserOpen: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') ?? null,
					toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
					panelAriaHidden: document.querySelector('.dtf-workbench-active-panel')?.getAttribute('aria-hidden') ?? null,
					surface: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')
						?.dataset.dtfWorkbenchCurrentSurface ?? null,
					hasAnchor: document.querySelector('[data-dtf-systems-summary="1"] [data-dtf-path-context="1"] .dtf-semantic-path-value')?.textContent === fixture
						&& document.querySelector('[data-dtf-systems-summary="1"] [data-dtf-path-focus="1"] .dtf-semantic-path-value')?.textContent === 'Work',
					hasAdjacentEvidence: selectedCard?.nextElementSibling?.matches('[data-dtf-selected-system-evidence="1"]') === true,
					primaryActionText: document.querySelector('[data-dtf-map-primary-action]')?.textContent?.trim() ?? null,
					retiredControlsPresent: document.querySelector('[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]') !== null,
				};
			}, completeOccurrenceKey, FIXTURE);
			expect(selected.key).toBe(completeOccurrenceKey);
			expect(selected.hasAnchor).toBe(true);
			expect(selected.browserOpen).toBe('true');
			expect(selected.toggleLabel).toBe('Close organizational systems drawer');
			expect(selected.panelAriaHidden).toBe('true');
			expect(selected.surface).toBe('map');
			expect(selected.hasAdjacentEvidence).toBe(true);
			expect(selected.primaryActionText).toBe('Choose where this organizational system applies');
			expect(selected.retiredControlsPresent).toBe(false);

			await browser.executeObsidian(() => {
				document.querySelector<HTMLButtonElement>('[data-dtf-map-primary-action]')?.click();
			});
			await waitForSurface('scope');
			const afterPrimary = await browser.executeObsidian(() => ({
				surface: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')
					?.dataset.dtfWorkbenchCurrentSurface ?? null,
				selectedEvidence: document.querySelector('[data-dtf-system-occurrence-key][aria-selected="true"] + [data-dtf-selected-system-evidence="1"]') !== null,
			}));
			expect(afterPrimary.surface).toBe('scope');
			expect(afterPrimary.selectedEvidence).toBe(true);

			await clickSurface('map');
			await browser.executeObsidian(() => {
				const toggle = document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]');
				if (toggle?.getAttribute('aria-expanded') === 'true') toggle.click();
			});
			await browser.waitUntil(async () => browser.executeObsidian(() =>
				document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'false',
			), { timeout: 3_000, timeoutMsg: 'Organizational systems drawer did not close after returning to Explore' });
			const afterClose = await browser.executeObsidian(() => ({
				panelAriaHidden: document.querySelector('.dtf-workbench-active-panel')?.getAttribute('aria-hidden') ?? null,
				surface: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')
					?.dataset.dtfWorkbenchCurrentSurface ?? null,
				toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-label') ?? null,
			}));
			expect(afterClose.panelAriaHidden).toBeNull();
			expect(afterClose.surface).toBe('map');
			expect(afterClose.toggleLabel).toBe('Open organizational systems drawer');

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
					browserMode: shell?.dataset.dtfSystemsBrowserMode ?? null,
					density: shell?.dataset.dtfWorkbenchDensity ?? null,
					browserOpen: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
						?.getAttribute('aria-expanded') ?? null,
					toggleLabel: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
						?.getAttribute('aria-label') ?? null,
					overflow: shell ? shell.scrollWidth - shell.clientWidth : 1,
					activeHeightRatio: body && panel && body.clientHeight > 0
						? panel.clientHeight / body.clientHeight
						: 0,
					countsDisplay: counts ? getComputedStyle(counts).display : null,
				};
			});
			expect(compact.width).toBeLessThanOrEqual(320);
			expect(compact.browserMode).toBe('overlay');
			expect(compact.density).toBe('tight');
			expect(compact.browserOpen).toBe('false');
			expect(compact.toggleLabel).toBe('Open organizational systems drawer');
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
					density: shell?.dataset.dtfWorkbenchDensity ?? null,
					browserMode: shell?.dataset.dtfSystemsBrowserMode ?? null,
					inspectorMode: shell?.dataset.dtfFolderInspectorMode ?? null,
					browserOpen: document.querySelector('[data-dtf-systems-browser-toggle="1"]')
						?.getAttribute('aria-expanded') ?? null,
				};
			});
			expect(short.bodyHeight).toBeGreaterThan(150);
			expect(short.panelHeight).toBeGreaterThanOrEqual(short.bodyHeight - 2);
			expect(short.mapTreeVisible).toBe(true);
			expect(short.mapTreeHeight).toBeGreaterThanOrEqual(120);
			expect(short.density).toBe('tight');
			expect(short.browserMode).toBe('overlay');
			expect(short.inspectorMode).toBe('overlay');
			expect(short.browserOpen).toBe('false');
			await snap('organizational-systems-browser-short-pane');

			// Regression sweep for the short/narrow pane geometries around the one
			// above. The Explore header (mode toggle, primary action, Refresh) once
			// wrapped into three rows and grew to 114px, leaving the folder
			// hierarchy 116px -- no taller than its own chrome, with 334px of rows
			// to scroll through it. Assert the hierarchy stays the largest thing on
			// the surface across adjacent sizes, and that the space was won by
			// packing the controls rather than by clipping any of them.
			const sweep: Array<{
				width: number;
				height: number;
				treeHeight: number;
				headerHeight: number;
				shellOverflow: number;
				density: string | null;
				controlsInsideShell: boolean;
				controlCount: number;
			}> = [];
			for (const size of [
				{ width: 300, height: 400 },
				{ width: 320, height: 420 },
				{ width: 360, height: 460 },
				{ width: 420, height: 560 },
			]) {
				await browser.executeObsidian((_context, box) => {
					const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
					if (!shell) return;
					shell.style.width = `${box.width}px`;
					shell.style.maxWidth = `${box.width}px`;
					shell.style.height = `${box.height}px`;
				}, size);
				await browser.pause(150);
				sweep.push(await browser.executeObsidian((_context, box) => {
					const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
					const header = document.querySelector<HTMLElement>('.dtf-workbench-map-header');
					const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
					const controls = Array.from(
						document.querySelectorAll<HTMLElement>(
							'.dtf-workbench-map-controls > button, .dtf-workbench-map-controls [data-dtf-mode]',
						),
					);
					const shellRect = shell?.getBoundingClientRect();
					return {
						width: box.width,
						height: box.height,
						treeHeight: tree?.clientHeight ?? 0,
						headerHeight: header?.getBoundingClientRect().height ?? 0,
						shellOverflow: shell ? shell.scrollWidth - shell.clientWidth : 999,
						density: shell?.dataset.dtfWorkbenchDensity ?? null,
						controlCount: controls.length,
						controlsInsideShell: Boolean(shellRect) && controls.every((control) => {
							const rect = control.getBoundingClientRect();
							return rect.width > 0
								&& rect.height > 0
								&& rect.left >= shellRect!.left - 1
								&& rect.right <= shellRect!.right + 1;
						}),
					};
				}, size));
			}
			// eslint-disable-next-line no-console
			console.log('tight-pane geometry sweep', JSON.stringify(sweep));
			for (const measured of sweep) {
				const at = `${measured.width}x${measured.height}`;
				expect({ at, density: measured.density }).toEqual({ at, density: 'tight' });
				// The folder hierarchy keeps a usable height...
				expect({ at, ok: measured.treeHeight >= 120 })
					.toEqual({ at, ok: true });
				// ...and stays at least as tall as the chrome stacked above it.
				expect({ at, ok: measured.treeHeight >= measured.headerHeight })
					.toEqual({ at, ok: true });
				// All five header controls (3 mode buttons, primary action, Refresh)
				// stay laid out and fully inside the shell.
				expect({ at, controls: measured.controlCount }).toEqual({ at, controls: 5 });
				expect({ at, inside: measured.controlsInsideShell })
					.toEqual({ at, inside: true });
				expect({ at, ok: measured.shellOverflow <= 1 }).toEqual({ at, ok: true });
			}
			await snap('organizational-systems-browser-tight-sweep');
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

		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			return shell?.dataset.dtfSystemsBrowserMode === 'side'
				&& document.querySelector('[data-dtf-systems-browser-toggle="1"]')
					?.getAttribute('aria-expanded') === 'false';
		}), { timeout: 5_000, timeoutMsg: 'Closed browser preference did not survive returning to side mode' });
		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-systems-browser-toggle="1"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-systems-browser-toggle="1"]')?.getAttribute('aria-expanded') === 'true',
		), { timeout: 3_000, timeoutMsg: 'Organizational systems browser did not reopen after preference test' });
	});

	it('marks candidate snapshots stale immediately and refreshes before installation', async function () {
		await browser.executeObsidian((_context, size) => window.resizeTo(size.width, size.height), originalWindowSize);
		await clickSurface('candidates');
		const stale = await browser.executeObsidian(async ({ app }, fixture) => {
			const path = `${fixture}/Work/New branch`;
			if (!app.vault.getAbstractFileByPath(path)) await app.vault.createFolder(path);
			const status = document.querySelector<HTMLElement>('[data-dtf-workbench-status]');
			const install = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-candidates="1"] button'))
				.find((button) => /^Save (?:draft rules|\d+ draft rules?)/.test(button.textContent ?? ''));
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
