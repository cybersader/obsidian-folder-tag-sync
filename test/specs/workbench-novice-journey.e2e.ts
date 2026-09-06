import { browser, expect } from '@wdio/globals';
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

const ROOT = 'Novice Journey Fixture';
const READY_ANCHOR = `${ROOT}/Work`;
const POSSIBLE_ANCHOR = `${ROOT}/Home`;
const FIXTURE_FOLDERS = [
	ROOT,
	READY_ANCHOR,
	`${READY_ANCHOR}/Projects`,
	`${READY_ANCHOR}/Areas`,
	`${READY_ANCHOR}/Resources`,
	`${READY_ANCHOR}/Archive`,
	POSSIBLE_ANCHOR,
	`${POSSIBLE_ANCHOR}/Projects`,
] as const;
const FIXTURE_FILES: Record<string, string> = {
	[`${READY_ANCHOR}/Projects/alpha.md`]: [
		'---',
		'tags: [hand-authored]',
		'owner: novice-e2e',
		'---',
		'# Alpha',
		'',
		'This content must remain byte-for-byte unchanged.',
	].join('\n'),
	[`${POSSIBLE_ANCHOR}/Projects/possible.md`]: [
		'---',
		'tags: [possible/manual]',
		'---',
		'# Possible',
	].join('\n'),
};

type FixtureSnapshot = {
	folders: string[];
	contents: Record<string, string>;
	frontmatter: Record<string, unknown>;
};

let originalSettings: unknown;
let initialSnapshot: FixtureSnapshot;
let readyOccurrenceKey = '';
let possibleOccurrenceKey = '';
let firstAddedRuleId = '';

async function waitForSurface(surface: 'map' | 'scope' | 'candidates'): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian((_context, expected) => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		const status = document.querySelector<HTMLElement>('[data-dtf-workbench-status]');
		if (shell?.dataset.dtfWorkbenchCurrentSurface !== expected) return false;
		if (status?.dataset.dtfWorkbenchStatus !== 'ready') return false;
		return shell.querySelector(`[data-dtf-workbench-${expected}="1"]`) !== null;
	}, surface), {
		timeout: 15_000,
		timeoutMsg: `Workbench did not become ready on ${surface}`,
	});
}

async function fixtureSnapshot(): Promise<FixtureSnapshot> {
	return browser.executeObsidian(async ({ app }, folders, files) => {
		const adapter = app.vault.adapter;
		const existingFolders: string[] = [];
		for (const folder of folders) {
			if (await adapter.exists(folder)) existingFolders.push(folder);
		}
		const contents: Record<string, string> = {};
		const frontmatter: Record<string, unknown> = {};
		for (const filePath of Object.keys(files)) {
			contents[filePath] = await adapter.read(filePath);
			const file = app.vault.getAbstractFileByPath(filePath);
			const cache = file && 'extension' in file
				? app.metadataCache.getFileCache(file as never)?.frontmatter
				: null;
			frontmatter[filePath] = cache ? JSON.parse(JSON.stringify(cache)) : null;
		}
		return { folders: existingFolders, contents, frontmatter };
	}, [...FIXTURE_FOLDERS], FIXTURE_FILES);
}

describe('Taxonomy Workbench — novice Explore, Choose, Review journey', function () {
	this.timeout(120_000);

	before(async function () {
		originalSettings = await browser.executeObsidian(async ({ app }, root, folders, files) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[] } & Record<string, unknown>;
					saveSettings(): Promise<void>;
				}> };
			}).plugins.plugins['folder-tag-sync'];
			const original = JSON.parse(JSON.stringify(plugin.settings));
			plugin.settings = { ...plugin.settings, rules: [] };
			await plugin.saveSettings();

			const existing = app.vault.getAbstractFileByPath(root);
			if (existing) await app.vault.delete(existing, true);
			for (const folder of folders) {
				if (!app.vault.getAbstractFileByPath(folder)) await app.vault.createFolder(folder);
			}
			for (const [filePath, content] of Object.entries(files)) {
				await app.vault.adapter.write(filePath, content);
			}
			await new Promise((resolve) => setTimeout(resolve, 700));
			return original;
		}, ROOT, [...FIXTURE_FOLDERS], FIXTURE_FILES);
		initialSnapshot = await fixtureSnapshot();
	});

	// Split into ordered, individually awaited steps for the same reason as
	// test/specs/support-bundle.e2e.ts: one teardown script that closed the UI,
	// restored settings and then deleted the fixture could hold the renderer past
	// WebDriver's 30s `execute/sync` script timeout. WebDriver retries a timed-out
	// script, so the whole body ran again -- and the second pass hit `vault.delete`
	// on a folder the first pass had already removed (stale cached TFolder ->
	// ENOENT). Deleting the fixture *before* the user's settings come back also
	// stops the restored rules from reacting to the deletion.
	after(async function () {
		// 1. Close only this spec's UI.
		await browser.executeObsidian(({ app }) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const setting = (app as unknown as { setting?: { close?(): void } }).setting;
			setting?.close?.();
		});

		// 2. Remove exactly this spec's marker-owned scratch fixture, idempotently.
		//    On a retry the vault cache can still hand back a TFolder for a
		//    directory the first attempt already deleted, so existence is verified
		//    through the adapter first. Only the specific "the owned fixture is
		//    already gone" condition is tolerated; every other error propagates.
		const removal = await browser.executeObsidian(async ({ app }, root) => {
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(root))) return 'already-absent';
			const existing = app.vault.getAbstractFileByPath(root);
			if (existing) {
				await app.vault.delete(existing, true);
			} else {
				// On disk but missing from the metadata cache.
				await adapter.rmdir(root, true);
			}
			return 'removed';
		}, ROOT);
		expect(['removed', 'already-absent']).toContain(removal);

		await browser.waitUntil(
			async () => browser.executeObsidian(
				async ({ app }, root) => !(await app.vault.adapter.exists(root)),
				ROOT,
			),
			{ timeout: 10_000, timeoutMsg: `Novice journey fixture ${ROOT} was not removed` },
		);

		// 3. Only now put the user's own settings back, and await the write.
		await browser.executeObsidian(async ({ app }, settings) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { settings: unknown; saveSettings(): Promise<void> }> };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings = settings;
			await plugin.saveSettings();
		}, originalSettings);
	});

	it('requires an explicit Ready-system continuation, saves disabled drafts, and focuses the exact Settings row', async function () {
		const command = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { executeCommandById(id: string): boolean };
			}).commands;
			return commands.executeCommandById('folder-tag-sync:taxonomy-workbench-open-map');
		});
		expect(command).toBe(true);
		await waitForSurface('map');

		const discovered = await browser.executeObsidian((_context, root) => {
			const cards = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'));
			const anchor = (card: HTMLButtonElement) =>
				card.querySelector<HTMLElement>('[data-dtf-semantic-path="system-occurrence-anchor"]')?.getAttribute('aria-label') ?? '';
			const ready = cards.find((card) => card.dataset.dtfSystemStatus === 'actionable'
				&& anchor(card).includes('Recognized here: Work')
				&& anchor(card).includes(`Parent context: ${root}`));
			const possible = cards.find((card) => card.dataset.dtfSystemStatus !== 'actionable'
				&& anchor(card).includes('Recognized here: Home')
				&& anchor(card).includes(`Parent context: ${root}`));
			const state = (document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]') as unknown as {
				dataset: DOMStringMap;
			}).dataset;
			return {
				readyKey: ready?.dataset.dtfSystemOccurrenceKey ?? '',
				possibleKey: possible?.dataset.dtfSystemOccurrenceKey ?? '',
				surface: state.dtfWorkbenchCurrentSurface ?? null,
				hasRetiredToggle: document.querySelector('[data-dtf-show-incomplete-systems="1"]') !== null,
			};
		}, ROOT);
		expect(discovered.surface).toBe('map');
		expect(discovered.readyKey).not.toBe('');
		expect(discovered.possibleKey).not.toBe('');
		expect(discovered.hasRetiredToggle).toBe(false);
		readyOccurrenceKey = discovered.readyKey;
		possibleOccurrenceKey = discovered.possibleKey;

		const beforeFocus = await browser.executeObsidian(({ app }) => {
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				scope: { selectedPaths: string[] };
			};
			return [...state.scope.selectedPaths];
		});
		await browser.executeObsidian((_context, key) => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'))
				.find((card) => card.dataset.dtfSystemOccurrenceKey === key)?.click();
		}, readyOccurrenceKey);
		await browser.waitUntil(async () => browser.executeObsidian((_context, key) => {
			const selected = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'))
				.find((card) => card.dataset.dtfSystemOccurrenceKey === key);
			return selected?.getAttribute('aria-selected') === 'true'
				&& selected.nextElementSibling?.matches('[data-dtf-selected-system-evidence="1"]') === true
					&& document.querySelector('[data-dtf-map-primary-action]')?.textContent?.trim()
						=== 'Choose where this organizational system applies'
					&& document.querySelector('[data-dtf-selected-system-detail="1"]') === null
					&& document.querySelector('[data-dtf-choose-selected-system-scope="1"]') === null
					&& document.querySelector('[data-dtf-show-selected-system-in-vault="1"]') === null;
		}, readyOccurrenceKey), {
			timeout: 5_000,
			timeoutMsg: 'Ready organizational system focus did not expose adjacent evidence and the Explore continuation',
		});
		const afterFocus = await browser.executeObsidian(({ app }, key) => {
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				selectedSystemInstanceKey: string | null;
				scope: { selectedPaths: string[] };
			};
			return {
				selected: state.selectedSystemInstanceKey,
				selectedPaths: [...state.scope.selectedPaths],
				evidenceText: document.querySelector('[data-dtf-system-occurrence-key][aria-selected="true"] + [data-dtf-selected-system-evidence="1"]')?.textContent ?? '',
					hasAdjacentEvidence: document.querySelector('[data-dtf-system-occurrence-key][aria-selected="true"] + [data-dtf-selected-system-evidence="1"]') !== null,
					primaryActionText: document.querySelector('[data-dtf-map-primary-action]')?.textContent?.trim() ?? '',
					hasOldControls: document.querySelector('[data-dtf-selected-system-detail="1"], [data-dtf-choose-selected-system-scope="1"], [data-dtf-show-selected-system-in-vault="1"]') !== null,
				possibleCannotContinue: Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-system-occurrence-key]'))
					.find((card) => card.dataset.dtfSystemOccurrenceKey === key)?.dataset.dtfSystemStatus !== 'actionable',
			};
		}, possibleOccurrenceKey);
		expect(afterFocus.selected).toBe(readyOccurrenceKey);
		expect(afterFocus.selectedPaths).toEqual(beforeFocus);
		expect(afterFocus.hasAdjacentEvidence).toBe(true);
			expect(afterFocus.evidenceText).toContain('Why Folder Tag Sync recognized this organizational system');
			expect(afterFocus.primaryActionText).toBe('Choose where this organizational system applies');
			expect(afterFocus.hasOldControls).toBe(false);
		expect(afterFocus.possibleCannotContinue).toBe(true);

		await browser.executeObsidian(() => {
			document.querySelector<HTMLButtonElement>('[data-dtf-map-primary-action]')?.click();
		});
		await waitForSurface('scope');
		const scope = await browser.executeObsidian(({ app }, readyAnchor) => {
			const state = app.workspace.getLeavesOfType('taxonomy-workbench-map')[0]?.view.getState() as unknown as {
				scope: { selectedPaths: string[] };
			};
			const row = document.querySelector<HTMLElement>(`[data-dtf-scope-folder-path="${CSS.escape(readyAnchor)}"]`);
			const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			const action = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-scope="1"] button'))
				.find((button) => /^Review proposed rules for \d+ organizational systems?$/.test(button.textContent ?? ''));
			return {
				selectedPaths: [...state.scope.selectedPaths],
				rowChecked: checkbox?.checked ?? false,
				rowActionable: row?.dataset.dtfScopeActionable ?? null,
				instruction: document.querySelector('[data-dtf-workbench-scope="1"]')?.textContent ?? '',
				actionText: action?.textContent ?? '',
				actionDisabled: action?.disabled ?? true,
			};
		}, READY_ANCHOR);
		expect(scope.selectedPaths).toEqual([READY_ANCHOR]);
		expect(scope.rowChecked).toBe(true);
		expect(scope.rowActionable).toBe('true');
		expect(scope.instruction).toContain('Select the highest folder');
		expect(scope.instruction).toContain('What happens next');
		expect(scope.actionText).toMatch(/^Review proposed rules for \d+ organizational systems?$/);
		expect(scope.actionDisabled).toBe(false);

		await browser.executeObsidian(() => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-scope="1"] button'))
				.find((button) => /^Review proposed rules for \d+ organizational systems?$/.test(button.textContent ?? ''))?.click();
		});
		await waitForSurface('candidates');
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelectorAll('[data-dtf-candidate-row="1"]').length > 0,
		), { timeout: 10_000, timeoutMsg: 'No proposed rules were generated from the chosen Ready organizational system' });

		const proposals = await browser.executeObsidian((_context, readyKey, possibleKey) => {
			const rows = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'));
			const boxes = rows.map((row) => row.querySelector<HTMLInputElement>('input[type="checkbox"]'));
			const groups = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-candidate-occurrence-key]'));
			const save = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-candidates="1"] button'))
				.find((button) => /^Save \d+ draft rules?$/.test(button.textContent ?? ''));
			return {
				rowCount: rows.length,
				allSelected: boxes.every((box) => box?.checked === true),
				allProposed: rows.every((row) => row.querySelector('.dtf-candidate-rule-kind')?.textContent === 'Proposed rule'),
				hasExamples: rows.some((row) => (row.textContent ?? '').includes('Examples: folder → tag')),
				hasReadyGroup: groups.some((group) => group.dataset.dtfCandidateOccurrenceKey === readyKey),
				hasPossibleGroup: groups.some((group) => group.dataset.dtfCandidateOccurrenceKey === possibleKey),
				saveText: save?.textContent ?? '',
				saveDisabled: save?.disabled ?? true,
				safety: document.querySelector('[data-dtf-workbench-candidates="1"]')?.textContent ?? '',
			};
		}, readyOccurrenceKey, possibleOccurrenceKey);
		expect(proposals.rowCount).toBeGreaterThan(0);
		expect(proposals.allSelected).toBe(true);
		expect(proposals.allProposed).toBe(true);
		expect(proposals.hasExamples).toBe(true);
		expect(proposals.hasReadyGroup).toBe(true);
		expect(proposals.hasPossibleGroup).toBe(false);
		expect(proposals.saveText).toMatch(/^Save \d+ draft rules?$/);
		expect(proposals.saveDisabled).toBe(false);
		expect(proposals.safety).toContain('Saving does not run sync or change files, folders, tags, or frontmatter');

		await browser.executeObsidian(() => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-candidates="1"] button'))
				.find((button) => /^Save \d+ draft rules?$/.test(button.textContent ?? ''))?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			(document.querySelector('[data-dtf-workbench-candidates="1"]')?.textContent ?? '')
				.includes('Save disabled draft rules?'),
		), { timeout: 5_000, timeoutMsg: 'Disabled-draft confirmation did not appear' });
		await browser.executeObsidian(() => {
			Array.from(document.querySelectorAll<HTMLButtonElement>('[data-dtf-workbench-candidates="1"] button'))
				.find((button) => /^Save \d+ disabled drafts?$/.test(button.textContent ?? ''))?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-review-saved-draft]') !== null,
		), { timeout: 15_000, timeoutMsg: 'Saved-draft Settings handoff did not appear' });

		const installed = await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { settings: { rules: Array<{ id: string; enabled: boolean }> } }> };
			}).plugins.plugins['folder-tag-sync'];
			const handoff = document.querySelector<HTMLButtonElement>('[data-dtf-review-saved-draft]');
			return {
				rules: plugin.settings.rules.map((rule) => ({ id: rule.id, enabled: rule.enabled })),
				firstId: handoff?.dataset.dtfReviewSavedDraft ?? '',
				handoffCount: document.querySelectorAll('[data-dtf-review-saved-draft]').length,
				handoffText: handoff?.textContent ?? '',
			};
		});
		expect(installed.rules.length).toBeGreaterThan(0);
		expect(installed.rules.every((rule) => rule.enabled === false)).toBe(true);
		expect(installed.firstId).toBe(installed.rules[0].id);
		expect(installed.handoffCount).toBe(1);
		expect(installed.handoffText).toMatch(/^Review (?:first )?saved draft in Settings$/);
		firstAddedRuleId = installed.firstId;
		expect(await fixtureSnapshot()).toEqual(initialSnapshot);

		const settingsOpened = await browser.executeObsidian(({ app }) => {
			const button = document.querySelector<HTMLButtonElement>('[data-dtf-review-saved-draft]');
			button?.click();
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { focusRuleId?: string }> };
			}).plugins.plugins['folder-tag-sync'];
			return {
				clicked: Boolean(button),
				pendingFocus: plugin.focusRuleId ?? null,
			};
		});
		expect(settingsOpened.clicked).toBe(true);

		// The Settings highlight the product actually applies is a bounded pulse:
		// SettingsTab.consumeFocusRule (src/ui/SettingsTab.ts:62-82) defers ~50ms
		// past `display()` before it scrolls, focuses and sets
		// `data-dtf-rule-focus="active"`, then removes that marker 2200ms later.
		//
		// Waiting only for the row to *exist* straddles both edges of that window:
		// an early poll can see the freshly rendered row before the deferred
		// callback has run, and on a slow poll the read can land after the pulse
		// has already expired. Reading the marker in a *second* round trip repeats
		// the same hazard even when the wait itself succeeded, which is how this
		// assertion observed `null`.
		//
		// So synchronise on the marker the product genuinely sets, and take the
		// whole observation inside the same in-page evaluation, which runs as one
		// task and therefore cannot straddle the pulse. Same contract as
		// test/specs/scan-and-snap.e2e.ts:803. The assertions below are unchanged:
		// exact rule identity, exact Settings tab, no adjacent row highlighted,
		// real geometry, and the pending handoff consumed.
		type SettingsFocusObservation = {
			rowPresent: boolean;
			activeTabId: string | null;
			containerConnected: boolean;
			focusedId: string;
			active: string | null;
			adjacentActive: boolean;
			targetVisible: boolean;
			fullyVisible: boolean;
			centered: boolean;
			pendingFocusCleared: boolean;
		};
		let focused!: SettingsFocusObservation;
		await browser.waitUntil(async () => {
			focused = await browser.executeObsidian(({ app }, ruleId) => {
				const setting = (app as unknown as {
					setting?: { activeTab?: { id?: string; containerEl?: HTMLElement } };
				}).setting;
				const container = setting?.activeTab?.containerEl;
				const rows = Array.from(container?.querySelectorAll<HTMLElement>('[data-dtf-rule-id]') ?? []);
				const row = rows.find((candidate) => candidate.dataset.dtfRuleId === ruleId);
				const rect = row?.getBoundingClientRect();
				const plugin = (app as unknown as {
					plugins: { plugins: Record<string, { focusRuleId?: string }> };
				}).plugins.plugins['folder-tag-sync'];
				return {
					rowPresent: Boolean(row),
					activeTabId: setting?.activeTab?.id ?? null,
					containerConnected: container?.isConnected ?? false,
					focusedId: row?.dataset.dtfRuleId ?? '',
					active: row?.dataset.dtfRuleFocus ?? null,
					adjacentActive: rows.filter((candidate) => candidate !== row)
						.some((candidate) => candidate.dataset.dtfRuleFocus === 'active'),
					targetVisible: Boolean(row?.offsetParent && rect && rect.width > 0 && rect.height > 0),
					fullyVisible: Boolean(rect && rect.top >= 0 && rect.bottom <= window.innerHeight),
					centered: Boolean(rect
						&& Math.abs((rect.top + rect.bottom) / 2 - window.innerHeight / 2) < window.innerHeight * 0.4),
					pendingFocusCleared: plugin.focusRuleId === undefined,
				};
			}, firstAddedRuleId);
			return focused.rowPresent && focused.active === 'active';
		}, {
			timeout: 8_000,
			timeoutMsg: 'Exact first saved draft row was never observed focused in Settings '
				+ `(pending focus at handoff: ${settingsOpened.pendingFocus ?? 'none'})`,
		});
		expect(focused.activeTabId).toBe('folder-tag-sync');
		expect(focused.containerConnected).toBe(true);
		expect(focused.focusedId).toBe(firstAddedRuleId);
		expect(focused.active).toBe('active');
		expect(focused.adjacentActive).toBe(false);
		expect(focused.targetVisible).toBe(true);
		expect(focused.fullyVisible).toBe(true);
		expect(focused.centered).toBe(true);
		expect(focused.pendingFocusCleared).toBe(true);
		expect(await fixtureSnapshot()).toEqual(initialSnapshot);
	});
});
