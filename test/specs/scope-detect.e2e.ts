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
			document.querySelectorAll('[data-dtf-e2e-settings-scan="1"]').forEach((el) => el.remove());
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

	it('renders the surfaced signal legend and hierarchy controls', async function () {
		const info = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const tree = scope?.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			const legendLabel = Array.from(scope?.querySelectorAll('div') ?? [])
				.find((el) => (el.textContent ?? '').trim() === 'Detected signals (click to filter visually):');
			const surfacedChips = scope?.querySelectorAll<HTMLElement>('[data-dtf-signal-pack-id]') ?? [];
			return {
				hasLegend: Boolean(legendLabel),
				surfacedSignalCount: surfacedChips.length,
				hasPackIdentity: Array.from(surfacedChips).some((chip) =>
					(chip.dataset.dtfSignalPackId ?? '').length > 0,
				),
				checkboxCount: tree?.querySelectorAll('input[type="checkbox"]').length ?? 0,
				folderCount: (tree?.textContent ?? '').match(/📁/g)?.length ?? 0,
			};
		});

		expect(info.hasLegend).toBe(true);
		expect(info.surfacedSignalCount).toBeGreaterThan(0);
		expect(info.hasPackIdentity).toBe(true);
		expect(info.checkboxCount).toBeGreaterThan(0);
		expect(info.folderCount).toBeGreaterThanOrEqual(NESTED_FOLDERS.length - 1);
	});

	it('ancestor selection absorbs a selected descendant without adding a deployment', async function () {
		const selectResult = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const tree = scope?.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			if (!scope || !tree) return { cleared: false, descendant: false };

			const clear = Array.from(scope.querySelectorAll('button'))
				.find((button) => (button.textContent ?? '').trim() === 'Select none') as HTMLButtonElement | undefined;
			clear?.click();

			const findCheckbox = (folderName: string): HTMLInputElement | undefined =>
				Array.from(tree.querySelectorAll<HTMLInputElement>('input[type="checkbox"]'))
					.find((checkbox) => Array.from(checkbox.parentElement?.children ?? [])
						.some((child) => child.tagName === 'SPAN'
							&& (child.textContent ?? '').trim() === folderName));
			const descendant = findCheckbox('Projects');
			if (descendant) {
				descendant.checked = true;
				descendant.dispatchEvent(new Event('change', { bubbles: true }));
			}
			return { cleared: Boolean(clear), descendant: Boolean(descendant) };
		});
		expect(selectResult.cleared).toBe(true);
		expect(selectResult.descendant).toBe(true);
		await browser.pause(350);

		const descendantPlan = await readScopeCounts();
		expect(descendantPlan.selectedFolders).toBe(1);
		expect(descendantPlan.minimalScopes).toBe(1);
		expect(descendantPlan.deployments).toBe(1);
		const directHitDeployment = await browser.executeObsidian(() =>
			document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]')?.textContent ?? '',
		);
		expect(directHitDeployment).toContain('ScopeDetectFixture/Work: PARA');

		const ancestorSelected = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			const ancestor = Array.from(tree?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
				.find((checkbox) => Array.from(checkbox.parentElement?.children ?? [])
					.some((child) => child.tagName === 'SPAN'
						&& (child.textContent ?? '').trim() === 'Work'));
			if (!ancestor) return false;
			ancestor.checked = true;
			ancestor.dispatchEvent(new Event('change', { bubbles: true }));
			return true;
		});
		expect(ancestorSelected).toBe(true);
		await browser.pause(350);

		const cover = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const tree = scope?.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			const stat = (label: string): number => {
				const labelEl = Array.from(scope?.querySelectorAll('div') ?? [])
					.find((el) => el.children.length === 0 && (el.textContent ?? '').trim() === label);
				return Number(labelEl?.previousElementSibling?.textContent ?? Number.NaN);
			};
			const rows = Array.from(tree?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
				.map((checkbox) => checkbox.parentElement as HTMLElement | null)
				.filter((row): row is HTMLElement => Boolean(row));
			const rowFor = (name: string): HTMLElement | undefined => rows.find((row) =>
				Array.from(row.children).some((child) => child.tagName === 'SPAN'
					&& (child.textContent ?? '').trim() === name),
			);
			const descendantRow = rowFor('Projects');
			const ancestorRow = rowFor('Work');
			const summary = Array.from(scope?.querySelectorAll('div') ?? [])
				.map((el) => (el.textContent ?? '').trim())
				.find((text) => /^1 minimal scope · 1 deployment$/.test(text)) ?? '';
			return {
				selectedFolders: stat('Selected folders'),
				minimalScopes: stat('Minimal scopes'),
				deployments: stat('Deployments'),
				hasScopeBadge: Array.from(ancestorRow?.querySelectorAll('span') ?? [])
					.some((span) => (span.textContent ?? '').trim() === 'scope'),
				hasAbsorbedBadge: (descendantRow?.textContent ?? '').includes('↑ absorbed'),
				hasScopeTint: (descendantRow?.style.background ?? '') !== '',
				hasAbsorbedBorder: (descendantRow?.style.borderLeft ?? '').includes('dashed'),
				summary,
			};
		});

		expect(cover.selectedFolders).toBe(2);
		expect(cover.minimalScopes).toBe(1);
		expect(cover.deployments).toBe(1);
		expect(cover.hasScopeBadge).toBe(true);
		expect(cover.hasAbsorbedBadge).toBe(true);
		expect(cover.hasScopeTint).toBe(true);
		expect(cover.hasAbsorbedBorder).toBe(true);
		expect(cover.summary).toBe('1 minimal scope · 1 deployment');

		// Expand the selected ancestor so the screenshot visibly captures the
		// absorbed descendant rather than only proving it in hidden tree DOM.
		await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			const workCheckbox = Array.from(tree?.querySelectorAll<HTMLInputElement>('input[type="checkbox"]') ?? [])
				.find((checkbox) => Array.from(checkbox.parentElement?.children ?? [])
					.some((child) => child.tagName === 'SPAN'
						&& (child.textContent ?? '').trim() === 'Work'));
			workCheckbox?.parentElement?.click();
		});
		await browser.pause(200);
		await snap('18-workbench-scope-minimal-cover');
	});

	it('vault-root selection creates one minimal scope across all surfaced systems', async function () {
		const selected = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const clear = Array.from(scope?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim() === 'Select none') as HTMLButtonElement | undefined;
			clear?.click();
			const root = scope?.querySelector<HTMLInputElement>('input[aria-label="Scope the entire vault"]');
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
			const root = document.querySelector<HTMLInputElement>('input[aria-label="Scope the entire vault"]');
			return Array.from(root?.parentElement?.querySelectorAll('span') ?? [])
				.some((span) => (span.textContent ?? '').trim() === 'scope');
		});
		expect(rootBadge).toBe(true);
	});

	it('Draft candidates routes the reused leaf from Scope to Candidates', async function () {
		const clicked = await browser.executeObsidian(() => {
			const scope = document.querySelector<HTMLElement>('[data-dtf-workbench-scope="1"]');
			const draft = Array.from(scope?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim().startsWith('Draft candidates')) as HTMLButtonElement | undefined;
			if (!draft || draft.disabled) return false;
			draft.click();
			return true;
		});
		expect(clicked).toBe(true);
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

	it('Settings Scan closes settings and hands off to Scope without a duplicate leaf', async function () {
		await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as {
				setting: { open(): void; openTabById(id: string): void };
			}).setting;
			setting.open();
			setting.openTabById('folder-tag-sync');
		});
		await browser.pause(500);

		const clickResult = await browser.executeObsidian(() => {
			const name = Array.from(document.querySelectorAll('.setting-item-name'))
				.find((el) => (el.textContent ?? '').trim() === 'Scan vault for organizational systems');
			const row = name?.closest('.setting-item');
			const button = Array.from(row?.querySelectorAll('button') ?? [])
				.find((el) => (el.textContent ?? '').trim() === 'Scan') as HTMLButtonElement | undefined;
			const modal = row?.closest('.modal') as HTMLElement | null;
			if (!button || !modal) return { found: false, settingsWasOpen: false };
			modal.dataset.dtfE2eSettingsScan = '1';
			button.click();
			return { found: true, settingsWasOpen: true };
		});
		expect(clickResult.found).toBe(true);
		expect(clickResult.settingsWasOpen).toBe(true);
		await browser.pause(1200);

		const handedOff = await browser.executeObsidian(({ app }, viewType: string) => ({
			leafCount: app.workspace.getLeavesOfType(viewType).length,
			settingsMarkerStillMounted: Boolean(document.querySelector('[data-dtf-e2e-settings-scan="1"]')),
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
		const stat = (label: string): number => {
			const labelEl = Array.from(scope?.querySelectorAll('div') ?? [])
				.find((el) => el.children.length === 0 && (el.textContent ?? '').trim() === label);
			return Number(labelEl?.previousElementSibling?.textContent ?? Number.NaN);
		};
		return {
			selectedFolders: stat('Selected folders'),
			minimalScopes: stat('Minimal scopes'),
			deployments: stat('Deployments'),
			surfacedSystems: stat('Surfaced systems'),
		};
	});
}
