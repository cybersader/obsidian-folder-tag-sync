import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

const SCREENSHOT_DIR = path.resolve('test/screenshots');
const FIXTURE_ROOT = 'ScopeDetectFixture';
const COMMAND_ID = 'folder-tag-sync:scan-vault-for-systems';
const VIEW_TYPE = 'taxonomy-workbench-map';

const NESTED_FOLDERS = [
	FIXTURE_ROOT,
	`${FIXTURE_ROOT}/Work`,
	`${FIXTURE_ROOT}/Work/Projects`,
	`${FIXTURE_ROOT}/Work/Areas`,
	`${FIXTURE_ROOT}/Work/Resources`,
	`${FIXTURE_ROOT}/Work/Archive`,
	`${FIXTURE_ROOT}/Work/Capture`,
	`${FIXTURE_ROOT}/Work/Capture/Inbox`,
];

async function snap(name: string): Promise<void> {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

/**
 * Real-Obsidian coverage for the consolidated Workbench Scope route.
 *
 * The historical scan command must retain its exact command id, but it now
 * opens the persistent Taxonomy Workbench leaf on Scope instead of creating a
 * separate detection modal. The fixture deliberately nests all four PARA signals
 * beneath one ancestor so the test can prove hierarchy selection,
 * minimal-cover absorption, scope tint, deployment counts, and Candidates
 * routing through the actual UI.
 */
describe('Taxonomy Workbench Scope — hierarchy-first detection', function () {
	this.timeout(60_000);

	before(async function () {
		await browser.executeObsidian(async ({ app }, fixtureRoot: string, folders: string[]) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			(app as unknown as { setting?: { close?: () => void } }).setting?.close?.();

			const existing = app.vault.getAbstractFileByPath(fixtureRoot);
			if (existing) await app.vault.delete(existing, true);

			for (const folderPath of folders) {
				if (!app.vault.getAbstractFileByPath(folderPath)) {
					await app.vault.createFolder(folderPath);
				}
				const placeholder = `${folderPath}/_placeholder.md`;
				if (!app.vault.getAbstractFileByPath(placeholder)) {
					await app.vault.create(placeholder, '# scope detection fixture');
				}
			}
			await new Promise((resolve) => setTimeout(resolve, 500));
		}, FIXTURE_ROOT, NESTED_FOLDERS);
	});

	after(async function () {
		await browser.executeObsidian(async ({ app }, fixtureRoot: string) => {
			(app as unknown as { setting?: { close?: () => void } }).setting?.close?.();
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const existing = app.vault.getAbstractFileByPath(fixtureRoot);
			if (existing) await app.vault.delete(existing, true);
			delete (globalThis as unknown as { __dtfSettingsScanModal?: HTMLElement }).__dtfSettingsScanModal;
		}, FIXTURE_ROOT);
	});

	it('preserves the exact scan-vault-for-systems command id', async function () {
		const registered = await browser.executeObsidian(({ app }, commandId: string) => {
			const commands = (app as unknown as {
				commands: { commands: Record<string, unknown> };
			}).commands.commands;
			return commandId in commands;
		}, COMMAND_ID);
		expect(registered).toBe(true);
	});

	it('the scan command opens and reuses exactly one persistent Scope leaf', async function () {
		const first = await browser.executeObsidian(({ app }, commandId: string) => {
			const commands = (app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			}).commands;
			return commands.executeCommandById(commandId);
		}, COMMAND_ID);
		expect(first).toBe(true);
		await browser.pause(1500);

		const second = await browser.executeObsidian(({ app }, commandId: string) => {
			const commands = (app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			}).commands;
			return commands.executeCommandById(commandId);
		}, COMMAND_ID);
		expect(second).toBe(true);
		await browser.pause(700);

		const state = await browser.executeObsidian(({ app }, viewType: string) => ({
			leafCount: app.workspace.getLeavesOfType(viewType).length,
			hasScope: Boolean(document.querySelector('[data-dtf-workbench-scope="1"]')),
			hasTree: Boolean(document.querySelector('[data-dtf-detect-tree="1"]')),
			currentSurface: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')
				?.dataset.dtfWorkbenchCurrentSurface ?? null,
			detectModalCount: document.querySelectorAll('.dtf-detect-modal').length,
		}), VIEW_TYPE);

		expect(state.leafCount).toBe(1);
		expect(state.hasScope).toBe(true);
		expect(state.hasTree).toBe(true);
		expect(state.currentSurface).toBe('scope');
		expect(state.detectModalCount).toBe(0);
	});

	it('renders organizational-system controls with stable row geometry and plan-neutral recognition highlights', async function () {
		await browser.executeObsidian(() => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('button'))
				.find((button) => button.textContent?.trim() === 'Expand all')?.click();
		});
		await browser.pause(150);
		const info = await browser.executeObsidian(({ app }) => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const tree = scope?.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			const disclosure = scope?.querySelector<HTMLDetailsElement>('[data-dtf-scope-detection-details="1"]');
			const surfacedChips = Array.from(
				disclosure?.querySelectorAll<HTMLElement>('[data-dtf-signal-pack-id]') ?? [],
			);
			const occurrenceChips = Array.from(
				tree?.querySelectorAll<HTMLElement>('[data-dtf-occurrence-key]') ?? [],
			);
			const buttons = Array.from(scope?.querySelectorAll<HTMLButtonElement>('button') ?? []);
			const root = scope?.querySelector<HTMLInputElement>('input[aria-label="Organize the whole vault"]');
			const chooser = scope?.querySelector<HTMLElement>('[data-dtf-scope-chooser-scroller="1"]');
			const plan = scope?.querySelector<HTMLElement>('[data-dtf-scope-plan-scroller="1"]');
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				scope: { selectedPaths: string[]; signalFilter: unknown };
			};

			const geometryRows = Array.from(tree?.querySelectorAll<HTMLElement>('.dtf-scope-folder-row') ?? [])
				.filter((row) => row.getClientRects().length > 0)
				.map((row) => {
					const rail = row.querySelector<HTMLElement>('[data-dtf-scope-row-slot="rail"]');
					const checkbox = row.querySelector<HTMLInputElement>('[data-dtf-scope-checkbox-path]');
					const folderIcon = Array.from(row.children)
						.find((child) => (child.textContent ?? '').trim() === '📁');
					const name = folderIcon?.nextElementSibling as HTMLElement | null;
					return {
						depth: row.style.paddingLeft,
						railX: rail?.getBoundingClientRect().left ?? Number.NaN,
						checkboxX: checkbox?.getBoundingClientRect().left ?? Number.NaN,
						nameX: name?.getBoundingClientRect().left ?? Number.NaN,
					};
				});
			const geometryByDepth = new Map<string, typeof geometryRows>();
			for (const row of geometryRows) {
				const siblings = geometryByDepth.get(row.depth) ?? [];
				siblings.push(row);
				geometryByDepth.set(row.depth, siblings);
			}
			const siblingGeometry = [...geometryByDepth.values()].filter((rows) => rows.length > 1);
			const xIsStable = (values: number[]): boolean =>
				values.every(Number.isFinite) && Math.max(...values) - Math.min(...values) <= 1;

			return {
				heading: scope?.querySelector('h3')?.textContent ?? null,
				intro: scope?.querySelector('.dtf-workbench-surface-intro')?.textContent ?? null,
				taskSummary: scope?.querySelector('[data-dtf-scope-task-summary="1"]')?.textContent ?? null,
				disclosureSummary: disclosure?.querySelector('summary')?.textContent ?? null,
				disclosureOpen: disclosure?.open ?? null,
				highlightLabel: Array.from(disclosure?.querySelectorAll('div') ?? [])
					.find((el) => (el.textContent ?? '').trim() === 'Highlight detection evidence:')
					?.textContent?.trim() ?? null,
				highlightNote: Array.from(disclosure?.querySelectorAll('div') ?? [])
					.find((el) => (el.textContent ?? '').trim().startsWith('These highlights explain the scan.'))
					?.textContent?.trim() ?? null,
				surfacedSignalCount: surfacedChips.length,
				hasPackIdentity: surfacedChips.some((chip) =>
					(chip.dataset.dtfSignalPackId ?? '').length > 0,
				),
				signalControlsAreNativeButtons: surfacedChips.every((chip) => chip.tagName === 'BUTTON'),
				occurrenceControlsAreNativeButtons: occurrenceChips.every((chip) => chip.tagName === 'BUTTON'),
				checkboxCount: tree?.querySelectorAll('input[type="checkbox"]').length ?? 0,
				folderCount: (tree?.textContent ?? '').match(/📁/g)?.length ?? 0,
				hasSelectAllHits: buttons.some((button) => button.textContent?.trim() === 'Select all hits'),
				clearChoices: buttons.find((button) => button.textContent?.trim() === 'Clear choices')?.textContent?.trim() ?? null,
				rootLabel: root?.getAttribute('aria-label') ?? null,
				rootText: root?.closest('.dtf-scope-root-row')?.textContent?.includes('Organize the whole vault') ?? false,
				relationLabels: Array.from(scope?.querySelectorAll<HTMLElement>('.dtf-folder-occurrence-relation') ?? [])
					.map((element) => element.textContent?.trim() ?? ''),
				anchorLabels: Array.from(scope?.querySelectorAll<HTMLElement>('[data-dtf-semantic-path="scope-occurrence-anchor"]') ?? [])
					.map((element) => element.getAttribute('aria-label') ?? ''),
				selectedPaths: state.scope.selectedPaths,
				signalFilter: state.scope.signalFilter,
				candidateAction: buttons.find((button) => button.textContent?.trim().startsWith('Review proposed rules'))
					?.textContent?.trim() ?? null,
				chooserScroller: {
					present: Boolean(chooser),
					role: chooser?.getAttribute('role') ?? null,
					label: chooser?.getAttribute('aria-label') ?? null,
					overflow: chooser?.style.overflow ?? null,
				},
				planScroller: {
					present: Boolean(plan),
					role: plan?.getAttribute('role') ?? null,
					label: plan?.getAttribute('aria-label') ?? null,
					overflow: plan?.style.overflow ?? null,
				},
				distinctScrollers: Boolean(chooser && plan && chooser !== plan),
				siblingGeometryGroups: siblingGeometry.length,
				stableRailX: siblingGeometry.every((rows) => xIsStable(rows.map((row) => row.railX))),
				stableCheckboxX: siblingGeometry.every((rows) => xIsStable(rows.map((row) => row.checkboxX))),
				stableNameX: siblingGeometry.every((rows) => xIsStable(rows.map((row) => row.nameX))),
			};
		});

		expect(info.heading).toBe('Choose where rules apply');
		expect(info.intro).toBe('Select the highest folder you want Folder Tag Sync to organize. Ready organizational systems inside that folder and everything below it can propose rules.');
		expect(info.taskSummary).toBe('0 highest-level folders included · 0 Ready organizational systems will continue');
		expect(info.disclosureSummary).toBe('Why Folder Tag Sync recognized these organizational systems');
		expect(info.disclosureOpen).toBe(false);
		expect(info.highlightLabel).toBe('Highlight detection evidence:');
		expect(info.highlightNote).toBe('These highlights explain the scan. They do not change the folders you chose.');
		expect(info.surfacedSignalCount).toBeGreaterThan(0);
		expect(info.hasPackIdentity).toBe(true);
		expect(info.signalControlsAreNativeButtons).toBe(true);
		expect(info.occurrenceControlsAreNativeButtons).toBe(true);
		expect(info.checkboxCount).toBeGreaterThan(0);
		expect(info.folderCount).toBeGreaterThanOrEqual(NESTED_FOLDERS.length - 1);
		expect(info.hasSelectAllHits).toBe(false);
		expect(info.clearChoices).toBe('Clear choices');
		expect(info.rootLabel).toBe('Organize the whole vault');
		expect(info.rootText).toBe(true);
		expect(info.relationLabels).toContain('Identifies');
		expect(info.relationLabels).toContain('Supports');
		expect(info.relationLabels.every((label) => label === 'Identifies' || label === 'Supports')).toBe(true);
		expect(info.anchorLabels.every((label) => label.includes('Rules start here:'))).toBe(true);
		expect(info.selectedPaths).toEqual([]);
		expect(info.signalFilter).toBeNull();
		expect(info.candidateAction).toBe('Review proposed rules (choose a Ready organizational system first)');
		expect(info.chooserScroller).toEqual({
			present: true,
			role: 'region',
			label: 'Choose folders to organize',
			overflow: 'auto',
		});
		expect(info.planScroller).toEqual({
			present: true,
			role: 'region',
			label: 'Scope plan and next actions',
			overflow: 'auto',
		});
		expect(info.distinctScrollers).toBe(true);
		expect(info.siblingGeometryGroups).toBeGreaterThan(0);
		expect(info.stableRailX).toBe(true);
		expect(info.stableCheckboxX).toBe(true);
		expect(info.stableNameX).toBe(true);

		const highlighted = await browser.executeObsidian(() => {
			const disclosure = document.querySelector<HTMLDetailsElement>('[data-dtf-scope-detection-details="1"]');
			const chip = disclosure?.querySelector<HTMLButtonElement>('[data-dtf-signal-pack-id]');
			chip?.click();
			return Boolean(chip);
		});
		expect(highlighted).toBe(true);
		await browser.pause(250);

		const afterHighlight = await browser.executeObsidian(({ app }) => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				scope: { selectedPaths: string[]; signalFilter: unknown };
			};
			return {
				selectedPaths: state.scope.selectedPaths,
				signalFilter: state.scope.signalFilter,
				taskSummary: scope?.querySelector('[data-dtf-scope-task-summary="1"]')?.textContent ?? null,
				candidateAction: Array.from(scope?.querySelectorAll<HTMLButtonElement>('button') ?? [])
					.find((button) => button.textContent?.trim().startsWith('Review proposed rules'))
					?.textContent?.trim() ?? null,
				disclosureOpen: scope?.querySelector<HTMLDetailsElement>('[data-dtf-scope-detection-details="1"]')?.open ?? null,
			};
		});
		expect(afterHighlight.selectedPaths).toEqual(info.selectedPaths);
		expect(afterHighlight.signalFilter).not.toBeNull();
		expect(afterHighlight.taskSummary).toBe(info.taskSummary);
		expect(afterHighlight.candidateAction).toBe(info.candidateAction);
		expect(afterHighlight.disclosureOpen).toBe(false);
	});

	it('exposes an accessible pointer and keyboard separator with min, default, and max plan heights', async function () {
		const separator = await browser.executeObsidian(() => {
			const element = document.querySelector<HTMLElement>('[data-dtf-scope-separator="1"]');
			if (!element) return null;
			const value = (name: string): number => Number(element.getAttribute(name) ?? Number.NaN);
			const snapshot = () => ({
				min: value('aria-valuemin'),
				max: value('aria-valuemax'),
				now: value('aria-valuenow'),
				valueText: element.getAttribute('aria-valuetext'),
			});
			const key = (keyName: string, shiftKey = false) => {
				element.dispatchEvent(new KeyboardEvent('keydown', {
					key: keyName,
					shiftKey,
					bubbles: true,
					cancelable: true,
				}));
			};

			const initial = snapshot();
			key('ArrowUp');
			const arrowUp = snapshot();
			key('ArrowDown');
			const arrowDown = snapshot();
			key('Home');
			const home = snapshot();
			key('End');
			const end = snapshot();
			element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
			const reset = snapshot();

			let capturedPointerId: number | null = null;
			let releasedPointerId: number | null = null;
			(element as unknown as { setPointerCapture(pointerId: number): void }).setPointerCapture = (pointerId) => {
				capturedPointerId = pointerId;
			};
			(element as unknown as { hasPointerCapture(pointerId: number): boolean }).hasPointerCapture = (pointerId) =>
				capturedPointerId === pointerId;
			(element as unknown as { releasePointerCapture(pointerId: number): void }).releasePointerCapture = (pointerId) => {
				releasedPointerId = pointerId;
				capturedPointerId = null;
			};
			element.dispatchEvent(new PointerEvent('pointerdown', {
				pointerId: 17,
				button: 0,
				clientY: 240,
				bubbles: true,
				cancelable: true,
			}));
			element.dispatchEvent(new PointerEvent('pointermove', {
				pointerId: 17,
				clientY: 200,
				bubbles: true,
				cancelable: true,
			}));
			const pointerMove = snapshot();
			element.dispatchEvent(new PointerEvent('pointerup', {
				pointerId: 17,
				clientY: 200,
				bubbles: true,
				cancelable: true,
			}));
			const pointerReleased = releasedPointerId;
			element.dispatchEvent(new MouseEvent('dblclick', { bubbles: true, cancelable: true }));
			const finalReset = snapshot();

			return {
				tagName: element.tagName,
				role: element.getAttribute('role'),
				label: element.getAttribute('aria-label'),
				orientation: element.getAttribute('aria-orientation'),
				tabIndex: element.tabIndex,
				disabled: element.getAttribute('aria-disabled'),
				initial,
				arrowUp,
				arrowDown,
				home,
				end,
				reset,
				pointerMove,
				pointerReleased,
				finalReset,
			};
		});

		expect(separator).not.toBeNull();
		if (!separator) return;
		expect(separator.tagName).toBe('DIV');
		expect(separator.role).toBe('separator');
		expect(separator.label).toBe('Resize folder chooser and plan');
		expect(separator.orientation).toBe('horizontal');
		expect(separator.tabIndex).toBe(0);
		expect(separator.disabled).toBe('false');
		expect(separator.initial.min).toBeLessThan(separator.initial.max);
		expect(separator.initial.now).toBe(Math.min(Math.max(240, separator.initial.min), separator.initial.max));
		expect(separator.initial.valueText).toBe(`Plan height ${separator.initial.now} pixels`);
		expect(separator.arrowUp.now).toBe(Math.min(separator.initial.now + 10, separator.initial.max));
		expect(separator.arrowDown.now).toBe(Math.max(separator.arrowUp.now - 10, separator.arrowDown.min));
		expect(separator.home.now).toBe(separator.initial.min);
		expect(separator.end.now).toBe(separator.initial.max);
		expect(separator.reset.now).toBe(separator.initial.now);
		expect(separator.pointerMove.now).toBe(Math.min(separator.reset.now + 40, separator.reset.max));
		expect(separator.pointerReleased).toBe(17);
		expect(separator.finalReset.now).toBe(separator.initial.now);
	});

	it('shows Ready current focus outside and inside the plan without focus mutating checked folders', async function () {
		const beforeFocus = await browser.executeObsidian(({ app }) => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				scope: { selectedPaths: string[] };
			};
			const para = Array.from(scope?.querySelectorAll<HTMLButtonElement>('[data-dtf-occurrence-key]') ?? [])
				.find((button) => (button.textContent ?? '').includes('Identifies')
					&& (button.textContent ?? '').includes('PARA'));
			const deployments = Array.from(scope?.querySelectorAll<HTMLElement>('[data-dtf-scope-deployment]') ?? [])
				.map((row) => row.dataset.dtfScopeDeployment ?? '');
			para?.click();
			return {
				clicked: Boolean(para),
				occurrenceKey: para?.dataset.dtfOccurrenceKey ?? '',
				selectedPaths: state.scope.selectedPaths,
				deployments,
			};
		});
		expect(beforeFocus.clicked).toBe(true);
		expect(beforeFocus.occurrenceKey).not.toBe('');
		await browser.pause(250);

		const outsidePlan = await browser.executeObsidian(({ app }) => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				scope: { selectedPaths: string[] };
			};
			const context = scope?.querySelector<HTMLElement>('[data-dtf-scope-current-system]');
			return {
				selectedPaths: state.scope.selectedPaths,
				deployments: Array.from(scope?.querySelectorAll<HTMLElement>('[data-dtf-scope-deployment]') ?? [])
					.map((row) => row.dataset.dtfScopeDeployment ?? ''),
				occurrenceKey: context?.dataset.dtfScopeCurrentSystem ?? '',
				title: context?.querySelector('.dtf-scope-current-system-title')?.textContent?.trim() ?? '',
				explanation: context?.querySelector('.dtf-scope-current-system-explanation')?.textContent?.trim() ?? '',
			};
		});
		expect(outsidePlan.selectedPaths).toEqual(beforeFocus.selectedPaths);
		expect(outsidePlan.deployments).toEqual(beforeFocus.deployments);
		expect(outsidePlan.occurrenceKey).toBe(beforeFocus.occurrenceKey);
		expect(outsidePlan.title).toBe(`PARA Ready · ${FIXTURE_ROOT}/Work`);
		expect(outsidePlan.explanation).toBe('The current organizational system is not included by the checked folders. The plan below still includes every organizational system selected by those folders.');

		const selected = await browser.executeObsidian((_context, projectPath: string) => {
			const checkbox = document.querySelector<HTMLInputElement>(
				`[data-dtf-scope-checkbox-path="${projectPath}"]`,
			);
			if (!checkbox) return false;
			checkbox.checked = true;
			checkbox.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		}, `${FIXTURE_ROOT}/Work/Projects`);
		expect(selected).toBe(true);
		await browser.pause(300);

		const includedFocus = await browser.executeObsidian(({ app }, occurrenceKey: string) => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				scope: { selectedPaths: string[] };
			};
			const context = scope?.querySelector<HTMLElement>('[data-dtf-scope-current-system]');
			const currentRows = Array.from(
				scope?.querySelectorAll<HTMLElement>('[data-dtf-scope-current-focus="1"]') ?? [],
			);
			const para = Array.from(scope?.querySelectorAll<HTMLButtonElement>('[data-dtf-occurrence-key]') ?? [])
				.find((button) => button.dataset.dtfOccurrenceKey === occurrenceKey);
			const beforeClick = [...state.scope.selectedPaths];
			para?.click();
			return {
				selectedPathsBeforeFocusClick: beforeClick,
				selectedPathsAfterFocusClick: state.scope.selectedPaths,
				contextExplanation: context?.querySelector('.dtf-scope-current-system-explanation')?.textContent?.trim() ?? '',
				currentRowCount: currentRows.length,
				currentDeploymentKey: currentRows[0]?.dataset.dtfScopeDeployment ?? '',
				currentBadge: currentRows[0]?.querySelector('.dtf-scope-current-focus-badge')?.textContent?.trim() ?? '',
			};
		}, beforeFocus.occurrenceKey);
		expect(includedFocus.selectedPathsBeforeFocusClick).toEqual([`${FIXTURE_ROOT}/Work/Projects`]);
		expect(includedFocus.selectedPathsAfterFocusClick).toEqual(includedFocus.selectedPathsBeforeFocusClick);
		expect(includedFocus.contextExplanation).toBe('This organizational system is included by the checked folders and marked Current focus below. Checked folders still determine the complete plan.');
		expect(includedFocus.currentRowCount).toBe(1);
		expect(includedFocus.currentDeploymentKey).toBe(beforeFocus.occurrenceKey);
		expect(includedFocus.currentBadge).toBe('Current focus');

		await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			Array.from(scope?.querySelectorAll<HTMLButtonElement>('button') ?? [])
				.find((button) => button.textContent?.trim() === 'Clear choices')?.click();
		});
		await browser.pause(200);
	});

	it('ancestor selection absorbs a selected descendant while preserving the complete checked-folder plan', async function () {
		const selectResult = await browser.executeObsidian((_context, descendantPath) => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			if (!scope) return { cleared: false, descendant: false };

			const clear = Array.from(scope.querySelectorAll('button'))
				.find((button) => (button.textContent ?? '').trim() === 'Clear choices') as HTMLButtonElement | undefined;
			clear?.click();

			const descendant = scope.querySelector<HTMLInputElement>(
				`[data-dtf-scope-checkbox-path="${CSS.escape(descendantPath)}"]`,
			);
			if (descendant) {
				descendant.checked = true;
				descendant.dispatchEvent(new Event('change', { bubbles: true }));
			}
			return { cleared: Boolean(clear), descendant: Boolean(descendant) };
		}, `${FIXTURE_ROOT}/Work/Projects`);
		expect(selectResult.cleared).toBe(true);
		expect(selectResult.descendant).toBe(true);
		await browser.pause(350);

		const descendantPlan = await readScopeCounts();
		expect(descendantPlan.selectedFolders).toBe(1);
		expect(descendantPlan.minimalScopes).toBe(1);
		expect(descendantPlan.deployments).toBe(1);
		const directHitPlan = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const boundary = scope?.querySelector<HTMLElement>('[data-dtf-semantic-path="scope-inclusion-boundary"]');
			const anchor = scope?.querySelector<HTMLElement>('[data-dtf-semantic-path="scope-system-anchor"]');
			return {
				boundaryContext: boundary?.querySelector('[data-dtf-path-context="1"] .dtf-semantic-path-value')?.textContent ?? null,
				boundaryFocus: boundary?.querySelector('[data-dtf-path-focus="1"] .dtf-semantic-path-value')?.textContent ?? null,
				anchorContext: anchor?.querySelector('[data-dtf-path-context="1"] .dtf-semantic-path-value')?.textContent ?? null,
				anchorFocus: anchor?.querySelector('[data-dtf-path-focus="1"] .dtf-semantic-path-value')?.textContent ?? null,
				system: scope?.querySelector('.dtf-scope-deployment-system > span:first-child')?.textContent ?? null,
			};
		});
		expect(directHitPlan).toEqual({
			boundaryContext: 'ScopeDetectFixture/Work',
			boundaryFocus: 'Projects',
			anchorContext: 'ScopeDetectFixture',
			anchorFocus: 'Work',
			system: 'PARA',
		});

		const ancestorSelected = await browser.executeObsidian((_context, ancestorPath) => {
			const ancestor = document.querySelector<HTMLInputElement>(
				`[data-dtf-scope-checkbox-path="${CSS.escape(ancestorPath)}"]`,
			);
			if (!ancestor) return false;
			ancestor.checked = true;
			ancestor.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		}, `${FIXTURE_ROOT}/Work`);
		expect(ancestorSelected).toBe(true);
		await browser.pause(350);

		const cover = await browser.executeObsidian((_context, descendantPath, ancestorPath) => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const taskSummary = scope?.querySelector('[data-dtf-scope-task-summary="1"]')?.textContent ?? '';
			const taskCounts = taskSummary.match(/(\d+) highest-level folders? included · (\d+) Ready organizational systems? will continue/);
			const descendantRow = scope?.querySelector<HTMLElement>(
				`[data-dtf-scope-folder-path="${CSS.escape(descendantPath)}"]`,
			);
			const ancestorRow = scope?.querySelector<HTMLElement>(
				`[data-dtf-scope-folder-path="${CSS.escape(ancestorPath)}"]`,
			);
			return {
				selectedFolders: Array.from(scope?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
					.filter((checkbox) => checkbox.checked).length,
				minimalScopes: Number(taskCounts?.[1] ?? Number.NaN),
				deployments: Number(taskCounts?.[2] ?? Number.NaN),
				hasScopeBadge: Array.from(ancestorRow?.querySelectorAll('span') ?? [])
					.some((span) => (span.textContent ?? '').trim() === 'Starts here'),
				hasAbsorbedBadge: (descendantRow?.textContent ?? '').includes('Already included by a parent folder'),
				hasScopeTint: (descendantRow?.style.background ?? '') !== '',
				hasAbsorbedBorder: (descendantRow?.querySelector<HTMLElement>('[data-dtf-scope-row-slot="rail"]')?.style.borderLeft ?? '').includes('dashed'),
				summary: scope?.querySelector('[data-dtf-scope-plan-summary="1"]')?.textContent ?? '',
			};
		}, `${FIXTURE_ROOT}/Work/Projects`, `${FIXTURE_ROOT}/Work`);

		expect(cover.selectedFolders).toBe(2);
		expect(cover.minimalScopes).toBe(1);
		expect(cover.deployments).toBeGreaterThanOrEqual(descendantPlan.deployments);
		expect(cover.hasScopeBadge).toBe(true);
		expect(cover.hasAbsorbedBadge).toBe(true);
		expect(cover.hasScopeTint).toBe(true);
		expect(cover.hasAbsorbedBorder).toBe(true);
		expect(cover.summary).toContain('What happens next');
		expect(cover.summary).toContain('Folders included (1)');
		expect(cover.summary).toContain(`Organizational systems that will propose rules (${cover.deployments})`);

		// Expand the selected ancestor so the screenshot visibly captures the
		// absorbed descendant rather than only proving it in hidden tree DOM.
		await browser.executeObsidian((_context, ancestorPath) => {
			document.querySelector<HTMLButtonElement>(
				`button[aria-label="Expand ${CSS.escape(ancestorPath)}"]`,
			)?.click();
		}, `${FIXTURE_ROOT}/Work`);
		await browser.pause(200);
		await browser.executeObsidian(() => {
			document.querySelector('[data-dtf-scope-plan-summary="1"]')
				?.scrollIntoView({ block: 'center', behavior: 'instant' as ScrollBehavior });
		});
		await browser.pause(150);
		await snap('18-workbench-scope-minimal-cover');
	});

	it('vault-root selection creates one minimal scope across all surfaced systems', async function () {
		const selected = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const clear = Array.from(scope?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim() === 'Clear choices') as HTMLButtonElement | undefined;
			clear?.click();
			const root = scope?.querySelector<HTMLInputElement>('input[aria-label="Organize the whole vault"]');
			if (!root) return false;
			root.checked = true;
			root.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		});
		expect(selected).toBe(true);
		await browser.pause(350);

		const counts = await readScopeCounts();
		expect(counts.selectedFolders).toBe(1);
		expect(counts.minimalScopes).toBe(1);
		expect(counts.deployments).toBeGreaterThan(0);
		expect(counts.deployments).toBe(counts.surfacedSystems);

		const rootBadge = await browser.executeObsidian(() => {
			const root = document.querySelector<HTMLInputElement>('input[aria-label="Organize the whole vault"]');
			return Array.from(root?.closest('.dtf-scope-root-row')?.querySelectorAll('span') ?? [])
				.some((span) => (span.textContent ?? '').trim() === 'Starts here');
		});
		expect(rootBadge).toBe(true);
	});

	it('Review proposed rules routes the reused leaf from Scope to Candidates', async function () {
		const review = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const draft = Array.from(scope?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim().startsWith('Review proposed rules for')) as HTMLButtonElement | undefined;
			const deployments = scope?.querySelectorAll('[data-dtf-scope-deployment]').length ?? 0;
			const label = draft?.textContent?.trim() ?? null;
			if (!draft || draft.disabled) return { clicked: false, label, deployments };
			draft.click();
			return { clicked: true, label, deployments };
		});
		expect(review.clicked).toBe(true);
		expect(review.deployments).toBeGreaterThan(0);
		expect(review.label).toBe(`Review proposed rules for ${review.deployments} organizational system${review.deployments === 1 ? '' : 's'}`);
		await browser.pause(1200);

		const routed = await browser.executeObsidian(({ app }, viewType: string) => ({
			leafCount: app.workspace.getLeavesOfType(viewType).length,
			hasCandidates: Boolean(document.querySelector('[data-dtf-workbench-candidates="1"]')),
			hasScope: Boolean(document.querySelector('[data-dtf-workbench-scope="1"]')),
			currentSurface: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')
				?.dataset.dtfWorkbenchCurrentSurface ?? null,
		}), VIEW_TYPE);
		expect(routed.leafCount).toBe(1);
		expect(routed.hasCandidates).toBe(true);
		expect(routed.hasScope).toBe(false);
		expect(routed.currentSurface).toBe('candidates');
	});

	it('Settings Choose folders closes settings and hands off to Scope without a duplicate leaf', async function () {
		await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as {
				setting: { open(): void; openTabById(id: string): void };
			}).setting;
			setting.open();
			setting.openTabById('folder-tag-sync');
		});
		await browser.pause(500);

		const clickResult = await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as {
				setting: { activeTab?: { containerEl?: HTMLElement } };
			}).setting;
			const container = setting.activeTab?.containerEl;
			const name = Array.from(container?.querySelectorAll('.setting-item-name') ?? [])
				.find((el) => (el.textContent ?? '').trim() === 'Choose where rules apply');
			const row = name?.closest('.setting-item');
			const button = Array.from(row?.querySelectorAll('button') ?? [])
				.find((el) => (el.textContent ?? '').trim() === 'Choose folders') as HTMLButtonElement | undefined;
			const modal = row?.closest('.modal') as HTMLElement | null;
			if (!button || !modal) return { found: false, settingsWasOpen: false };
			(globalThis as unknown as { __dtfSettingsScanModal?: HTMLElement }).__dtfSettingsScanModal = modal;
			const settingsWasOpen = modal.isConnected;
			button.click();
			return { found: true, settingsWasOpen };
		});
		expect(clickResult.found).toBe(true);
		expect(clickResult.settingsWasOpen).toBe(true);
		await browser.pause(1200);

		const handedOff = await browser.executeObsidian(({ app }, viewType: string) => ({
			leafCount: app.workspace.getLeavesOfType(viewType).length,
			settingsMarkerStillMounted: (globalThis as unknown as { __dtfSettingsScanModal?: HTMLElement })
				.__dtfSettingsScanModal?.isConnected ?? false,
			hasScope: Boolean(document.querySelector('[data-dtf-workbench-scope="1"]')),
			hasTree: Boolean(document.querySelector('[data-dtf-detect-tree="1"]')),
			currentSurface: document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]')
				?.dataset.dtfWorkbenchCurrentSurface ?? null,
			detectModalCount: document.querySelectorAll('.dtf-detect-modal').length,
		}), VIEW_TYPE);

		expect(handedOff.settingsMarkerStillMounted).toBe(false);
		expect(handedOff.leafCount).toBe(1);
		expect(handedOff.hasScope).toBe(true);
		expect(handedOff.hasTree).toBe(true);
		expect(handedOff.currentSurface).toBe('scope');
		expect(handedOff.detectModalCount).toBe(0);
	});
});

async function readScopeCounts(): Promise<{
	selectedFolders: number;
	minimalScopes: number;
	deployments: number;
	surfacedSystems: number;
}> {
	return browser.executeObsidian(() => {
		const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
		const taskSummary = scope?.querySelector('[data-dtf-scope-task-summary="1"]')?.textContent ?? '';
		const taskCounts = taskSummary.match(/(\d+) highest-level folders? included · (\d+) Ready organizational systems? will continue/);
		const stat = (label: string): number => {
			const labelEl = Array.from(scope?.querySelectorAll('div') ?? [])
				.find((el) => el.children.length === 0 && (el.textContent ?? '').trim() === label);
			return Number(labelEl?.previousElementSibling?.textContent ?? Number.NaN);
		};
		return {
			selectedFolders: Array.from(scope?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
				.filter((checkbox) => checkbox.checked).length,
			minimalScopes: Number(taskCounts?.[1] ?? Number.NaN),
			deployments: Number(taskCounts?.[2] ?? Number.NaN),
			surfacedSystems: stat('Ready organizational systems'),
		};
	});
}
