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
const LEGACY_COMMAND_ID = 'folder-tag-sync:scan-and-snap-draft-rules';
const WORKBENCH_VIEW_TYPE = 'taxonomy-workbench-map';

const FIXTURE_FOLDERS = [
	'01 - Projects',
	'01 - Projects/Cybersader',
	'01 - Projects/Cybersader/01 - Active',
	'01 - Projects/Cybersader/02 - Archive',
	'01 - Projects/Cybersader/03 - Reference',
	'02 - Areas',
	'02 - Areas/Health',
	'03 - Resources',
	'Projects',
	'Projects/Workbench',
	'Areas',
	'Resources',
	'Archive',
	'Capture',
	'Capture/Inbox',
	'Entity',
	'Output',
	'Output/Public',
	'System',
	'Templates',
] as const;

const FIXTURE_FILES: Record<string, string> = {
	'01 - Projects/Cybersader/01 - Active/alpha.md': [
		'---',
		'tags:',
		'  - hand-authored',
		'owner: e2e',
		'---',
		'# Alpha fixture',
		'',
		'This content must remain byte-for-byte unchanged.',
	].join('\n'),
	'02 - Areas/Health/health.md': [
		'---',
		'tags: [health/manual]',
		'status: reference',
		'---',
		'# Health fixture',
	].join('\n'),
	'Projects/Workbench/project.md': [
		'---',
		'tags: [project/manual]',
		'---',
		'# PARA fixture',
	].join('\n'),
	'Capture/Inbox/captured.md': [
		'---',
		'tags: [capture/manual]',
		'---',
		'# SEACOW fixture',
	].join('\n'),
	'Templates/template.md': [
		'---',
		'tags: [template/manual]',
		'---',
		'# Template fixture',
	].join('\n'),
};

const TOP_LEVEL_FIXTURES = [
	'01 - Projects',
	'02 - Areas',
	'03 - Resources',
	'Projects',
	'Areas',
	'Resources',
	'Archive',
	'Capture',
	'Entity',
	'Output',
	'System',
	'Templates',
] as const;

type FixtureSnapshot = {
	paths: string[];
	contents: Record<string, string>;
	frontmatter: Record<string, unknown>;
};

type ReleaseLayout = {
	files: string[];
	folders: string[];
};

let originalSettings: unknown = null;
let releaseLayout: ReleaseLayout = { files: [], folders: [] };
let initialFixtureSnapshot: FixtureSnapshot | null = null;
let selectedCandidateKey = '';
let installedRuleId = '';

async function snap(name: string): Promise<void> {
	await fs.mkdir(SCREENSHOT_DIR, { recursive: true });
	await browser.saveScreenshot(path.join(SCREENSHOT_DIR, `${name}.png`));
}

async function waitForCandidates(): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian(() => {
		const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
		const status = shell?.querySelector<HTMLElement>('[data-dtf-workbench-status]');
		const rows = shell?.querySelectorAll('[data-dtf-candidate-row="1"]').length ?? 0;
		return shell?.dataset.dtfWorkbenchCurrentSurface === 'candidates'
			&& status?.dataset.dtfWorkbenchStatus !== 'scanning'
			&& rows > 0;
	}), {
		timeout: 15_000,
		timeoutMsg: 'Workbench Candidates did not finish collecting',
	});
}

async function fixtureSnapshot(): Promise<FixtureSnapshot> {
	return browser.executeObsidian(async ({ app }, folders, files) => {
		const adapter = app.vault.adapter;
		const allPaths = new Set<string>();
		for (const folder of folders) {
			if (await adapter.exists(folder)) allPaths.add(folder);
		}
		for (const filePath of Object.keys(files)) {
			if (await adapter.exists(filePath)) allPaths.add(filePath);
		}

		const contents: Record<string, string> = {};
		const frontmatter: Record<string, unknown> = {};
		for (const filePath of Object.keys(files)) {
			contents[filePath] = await adapter.read(filePath);
			const abstract = app.vault.getAbstractFileByPath(filePath);
			const cached = abstract && 'extension' in abstract
				? app.metadataCache.getFileCache(abstract as never)?.frontmatter
				: null;
			frontmatter[filePath] = cached ? JSON.parse(JSON.stringify(cached)) : null;
		}

		return {
			paths: Array.from(allPaths).sort((a, b) => a.localeCompare(b)),
			contents,
			frontmatter,
		};
	}, [...FIXTURE_FOLDERS], FIXTURE_FILES);
}

function expectNondecreasing(values: number[]): void {
	for (let index = 1; index < values.length; index++) {
		expect(values[index]).toBeGreaterThanOrEqual(values[index - 1]);
	}
}

/**
 * Real-Obsidian coverage for the consolidated Workbench Candidates surface.
 *
 * The historical Scan & Snap command ID is a compatibility route now: it must
 * open Candidates in the persistent Workbench leaf, never the removed modal.
 * Candidates must come from the catalog embedded in main.js because the WDIO
 * install intentionally contains only the three community-release files.
 *
 * This suite also exercises the complete safe installation path. One candidate
 * is installed disabled, exact persistence accounting is asserted, fixture
 * notes remain untouched, the panel recollects automatically, reinstall is
 * idempotent, and only an explicit later enable makes the Map sense the rule.
 */
describe('Taxonomy Workbench Candidates — embedded catalog and safe install', function () {
	this.timeout(90_000);

	before(async function () {
		const setup = await browser.executeObsidian(async ({ app }, folders, files, topFolders) => {
			const plugin = (app as unknown as {
				plugins: {
					plugins: Record<string, {
						settings: { rules: unknown[] } & Record<string, unknown>;
						saveSettings: () => Promise<void>;
					}>;
				};
			}).plugins.plugins['folder-tag-sync'];
			const adapter = app.vault.adapter;
			const pluginDir = `${app.vault.configDir}/plugins/folder-tag-sync`;
			const listing = await adapter.list(pluginDir);
			const basename = (value: string) => value.split('/').pop() ?? value;

			const original = JSON.parse(JSON.stringify(plugin.settings));
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');

			// Start from no installed rules so every initial candidate is selectable.
			// Saving happens only after the release-layout proof is captured.
			plugin.settings = { ...plugin.settings, rules: [] };
			await plugin.saveSettings();

			// Remove stale residue from an interrupted prior run, then materialize the
			// canonical mixed fixture used by detection and candidate planning.
			for (const folder of topFolders) {
				if (await adapter.exists(folder)) await adapter.rmdir(folder, true);
			}
			for (const folder of folders) {
				if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
			}
			for (const [filePath, content] of Object.entries(files)) {
				await adapter.write(filePath, content);
			}
			await new Promise((resolve) => setTimeout(resolve, 900));

			return {
				original,
				layout: {
					// data.json and .hotreload are local runtime/dev state, not release
					// assets. The installable payload itself must remain exactly three files.
					files: listing.files
						.map(basename)
						.filter((name) => name !== 'data.json' && name !== '.hotreload')
						.sort((a, b) => a.localeCompare(b)),
					folders: listing.folders.map(basename).sort((a, b) => a.localeCompare(b)),
				},
			};
		}, [...FIXTURE_FOLDERS], FIXTURE_FILES, [...TOP_LEVEL_FIXTURES]);

		originalSettings = setup.original;
		releaseLayout = setup.layout;
		initialFixtureSnapshot = await fixtureSnapshot();
	});

	after(async function () {
		await browser.executeObsidian(async ({ app }, settings, topFolders) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			document.querySelectorAll('.menu, .modal-container').forEach((element) => element.remove());

			const plugin = (app as unknown as {
				plugins: {
					plugins: Record<string, {
						settings: unknown;
						saveSettings: () => Promise<void>;
					}>;
				};
			}).plugins.plugins['folder-tag-sync'];
			if (settings) {
				plugin.settings = settings;
				await plugin.saveSettings();
			}

			const adapter = app.vault.adapter;
			for (const folder of topFolders) {
				if (await adapter.exists(folder)) await adapter.rmdir(folder, true);
			}
		}, originalSettings, [...TOP_LEVEL_FIXTURES]);
	});

	it('runs the exact legacy command in a three-file release layout and opens Candidates without a modal', async function () {
		expect(releaseLayout.files).toEqual(['main.js', 'manifest.json', 'styles.css']);
		expect(releaseLayout.folders).toEqual([]);

		const command = await browser.executeObsidian(({ app }, commandId) => {
			const commands = (app as unknown as {
				commands: {
					commands: Record<string, unknown>;
					executeCommandById: (id: string) => boolean;
				};
			}).commands;
			return {
				registered: Object.prototype.hasOwnProperty.call(commands.commands, commandId),
				executed: commands.executeCommandById(commandId),
			};
		}, LEGACY_COMMAND_ID);
		expect(command.registered).toBe(true);
		expect(command.executed).toBe(true);

		await waitForCandidates();
		const route = await browser.executeObsidian(({ app }, viewType) => {
			const shell = document.querySelector<HTMLElement>('[data-dtf-workbench-shell="1"]');
			return {
				leafCount: app.workspace.getLeavesOfType(viewType).length,
				surface: shell?.dataset.dtfWorkbenchCurrentSurface ?? null,
				hasCandidates: Boolean(document.querySelector('[data-dtf-workbench-candidates="1"]')),
				hasLegacyModal: Boolean(
					document.querySelector('.dtf-scan-snap-modal')
					|| Array.from(document.querySelectorAll('.modal')).find((modal) =>
						/Scan & snap/i.test(modal.textContent ?? ''),
					),
				),
			};
		}, WORKBENCH_VIEW_TYPE);
		expect(route.leafCount).toBeGreaterThanOrEqual(1);
		expect(route.surface).toBe('candidates');
		expect(route.hasCandidates).toBe(true);
		expect(route.hasLegacyModal).toBe(false);
	});

	it('loads candidate rows from the embedded catalog with defaults, chips, emissions, and both triage sorts', async function () {
		const initial = await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			const rows = Array.from(panel?.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]') ?? []);
			const checkboxes = rows.map((row) => row.querySelector<HTMLInputElement>('input[type="checkbox"]'));
			const installButton = Array.from(panel?.querySelectorAll('button') ?? []).find((button) =>
				/^Add \d+ selected disabled draft/.test(button.textContent ?? ''),
			);
			const groupNoiseRanks = Array.from(
				panel?.querySelectorAll<HTMLElement>('[data-dtf-candidate-occurrence-key]') ?? [],
			).map((group) =>
				Array.from(group.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'))
					.map((row) => {
						const text = row.textContent ?? '';
						if (text.includes('Matches 0 folders')) return 0;
						if (!text.includes(' → #')) return 1;
						return 2;
					}),
			);
			const inverseRows = rows.filter((row) =>
				Boolean(row.querySelector('[data-dtf-coverage-unavailable="inverse-only"]')),
			);
			return {
				rowCount: rows.length,
				checkboxCount: checkboxes.filter(Boolean).length,
				allSelected: checkboxes.every((checkbox) => checkbox?.checked === true),
				allSelectable: checkboxes.every((checkbox) => checkbox?.disabled === false),
				coverageRows: rows.filter((row) => /(?:Matches \d+ folders?|Inverse only)/.test(row.textContent ?? '')).length,
				emissionRows: rows.filter((row) => (row.textContent ?? '').includes(' → #')).length,
				inverseRows: inverseRows.length,
				inverseConflictWarnings: inverseRows.filter((row) =>
					Boolean(row.querySelector('[data-dtf-conflict-unavailable="inverse-only"]')),
				).length,
				fabricatedInverseEmissions: inverseRows.filter((row) =>
					(row.textContent ?? '').includes(' → #'),
				).length,
				bijectivityRows: rows.filter((row) => /Round trip: (?:lossy|1:1|conditional)/.test(row.textContent ?? '')).length,
				selectedCount: Number((installButton?.textContent ?? '').match(/Add (\d+) selected/)?.[1] ?? -1),
				groupNoiseRanks,
				intro: panel?.querySelector('.dtf-workbench-surface-intro')?.textContent ?? null,
				groupKinds: Array.from(panel?.querySelectorAll<HTMLElement>('[data-dtf-candidate-group-header="1"]') ?? [])
					.map((header) => header.querySelector('.dtf-workbench-object-kind')?.textContent ?? null),
				groupHeaderHeights: Array.from(panel?.querySelectorAll<HTMLElement>('[data-dtf-candidate-group-header="1"]') ?? [])
					.map((header) => header.getBoundingClientRect().height),
				groupAnchorLabels: Array.from(panel?.querySelectorAll<HTMLElement>('[data-dtf-semantic-path="candidate-source-system-anchor"]') ?? [])
					.map((path) => path.getAttribute('aria-label') ?? ''),
				rowKinds: rows.map((row) => row.querySelector('.dtf-candidate-rule-kind')?.textContent ?? null),
				checkboxLabels: checkboxes.map((checkbox) => checkbox?.getAttribute('aria-label') ?? null),
				sampleHeadings: Array.from(panel?.querySelectorAll('.dtf-candidate-sample-heading') ?? [])
					.map((element) => element.textContent ?? ''),
			};
		});

		expect(initial.rowCount).toBeGreaterThan(0);
		expect(initial.checkboxCount).toBe(initial.rowCount);
		expect(initial.allSelected).toBe(true);
		expect(initial.allSelectable).toBe(true);
		expect(initial.selectedCount).toBe(initial.rowCount);
		expect(initial.coverageRows).toBe(initial.rowCount);
		expect(initial.emissionRows).toBeGreaterThan(0);
		expect(initial.inverseRows).toBeGreaterThan(0);
		expect(initial.inverseConflictWarnings).toBe(initial.inverseRows);
		expect(initial.fabricatedInverseEmissions).toBe(0);
		expect(initial.groupNoiseRanks.length).toBeGreaterThan(0);
		expect(initial.intro).toContain('disabled rule draft');
		expect(initial.groupKinds.every((kind) => kind === 'System occurrence')).toBe(true);
		expect(initial.groupHeaderHeights.every((height) => height <= 100)).toBe(true);
		expect(initial.groupAnchorLabels.every((label) => label.includes('System anchor:'))).toBe(true);
		expect(initial.rowKinds.every((kind) => kind === 'Candidate rule')).toBe(true);
		expect(initial.checkboxLabels.every((label) => label?.includes('disabled rule draft'))).toBe(true);
		expect(initial.sampleHeadings.every((heading) => heading === 'Examples: folder → tag')).toBe(true);
		for (const ranks of initial.groupNoiseRanks) expectNondecreasing(ranks);

		// Add one temporary, broad installed rule in memory so conflict sorting has
		// a real candidate-vs-installed collision to triage. Remove it again before
		// the safe-install path so persistence still starts from zero rules.
		await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { settings: { rules: unknown[] } }> };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings.rules = [{
				id: 'e2e-temporary-conflict',
				name: 'E2E temporary conflict',
				enabled: true,
				priority: 999,
				direction: 'folder-to-tag',
				folderPattern: '.*',
				folderEntryPoint: '',
				folderTransforms: { caseTransform: 'none', emojiHandling: 'keep' },
				tagEntryPoint: 'e2e-conflict',
				tagTransforms: { caseTransform: 'none', emojiHandling: 'keep' },
				options: {
					createFolders: false,
					addTags: true,
					removeOrphanedTags: false,
					syncOnFileCreate: false,
					syncOnFileMove: false,
					syncOnFileRename: false,
				},
			}];
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			Array.from(panel?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim() === 'Refresh')?.click();
		});
		await waitForCandidates();
		await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			Array.from(panel?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim() === 'Sort: conflicts first')?.click();
		});
		await browser.pause(350);

		const conflictRanks = await browser.executeObsidian(() =>
			Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-candidate-occurrence-key]'))
				.map((group) =>
					Array.from(group.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'))
						.map((row) => {
							const text = row.textContent ?? '';
							if (text.includes('Overlaps an existing rule')) return 0;
							if (text.includes('Overlaps another candidate')) return 1;
							return 2;
						}),
				),
		);
		for (const ranks of conflictRanks) expectNondecreasing(ranks);
		expect(conflictRanks.flat().some((rank) => rank === 0)).toBe(true);

		await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { settings: { rules: unknown[] } }> };
			}).plugins.plugins['folder-tag-sync'];
			plugin.settings.rules = [];
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			Array.from(panel?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim() === 'Refresh')?.click();
		});
		await waitForCandidates();
		await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			Array.from(panel?.querySelectorAll('button') ?? [])
				.find((button) => (button.textContent ?? '').trim() === 'Sort: low-signal first')?.click();
		});
		await browser.pause(350);
		await snap('workbench-candidates');
	});

	it('updates the selected count through select-all, select-none, and row toggles, then leaves one safe candidate', async function () {
		const counts = await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			if (!panel) return { total: -1, none: -1, all: -1, afterDeselect: -1, restored: -1, key: '' };
			const selectedCount = () => {
				const button = Array.from(panel.querySelectorAll('button')).find((candidate) =>
					/^Add \d+ selected disabled draft/.test(candidate.textContent ?? ''),
				);
				return Number((button?.textContent ?? '').match(/Add (\d+) selected/)?.[1] ?? 0);
			};
			const click = (label: string) => Array.from(panel.querySelectorAll('button'))
				.find((button) => (button.textContent ?? '').trim() === label)?.click();

			const total = panel.querySelectorAll('[data-dtf-candidate-row="1"]').length;
			click('Select none');
			const none = selectedCount();
			click('Select all');
			const all = selectedCount();

			const installable = Array.from(panel.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'))
				.find((row) => {
					const checkbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
					return checkbox && !checkbox.disabled && (row.textContent ?? '').includes(' → #');
				});
			const checkbox = installable?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			if (checkbox) {
				checkbox.checked = false;
				checkbox.dispatchEvent(new Event('change', { bubbles: true }));
			}
			const afterDeselect = selectedCount();
			if (checkbox) {
				checkbox.checked = true;
				checkbox.dispatchEvent(new Event('change', { bubbles: true }));
			}
			const restored = selectedCount();

			click('Select none');
			const oneRow = Array.from(panel.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'))
				.find((row) => {
					const candidateCheckbox = row.querySelector<HTMLInputElement>('input[type="checkbox"]');
					return candidateCheckbox
						&& !candidateCheckbox.disabled
						&& (row.textContent ?? '').includes(' → #')
						&& !row.textContent?.includes('Matches 0 folders');
				});
			const oneCheckbox = oneRow?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			if (oneCheckbox) {
				oneCheckbox.checked = true;
				oneCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
			}
			return {
				total,
				none,
				all,
				afterDeselect,
				restored,
				one: selectedCount(),
				key: oneRow?.dataset.dtfCandidateKey ?? '',
			};
		});

		expect(counts.none).toBe(0);
		expect(counts.all).toBe(counts.total);
		expect(counts.afterDeselect).toBe(counts.total - 1);
		expect(counts.restored).toBe(counts.total);
		expect(counts.one).toBe(1);
		expect(counts.key).not.toBe('');
		selectedCandidateKey = counts.key;
	});

	it('confirms the safe commit, persists one disabled rule, changes no fixture data, and recollects automatically', async function () {
		await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			const install = Array.from(panel?.querySelectorAll('button') ?? []).find((button) =>
				(button.textContent ?? '').trim() === 'Add 1 selected disabled draft',
			);
			install?.click();
		});

		const confirmation = await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			const text = panel?.textContent ?? '';
			return {
				title: text.includes('Confirm adding disabled drafts'),
				safety: text.includes('New drafts are added disabled. No files, folders, tags, or frontmatter will change.'),
				hasConfirm: Array.from(panel?.querySelectorAll('button') ?? [])
					.some((button) => (button.textContent ?? '').trim() === 'Confirm 1 disabled draft'),
			};
		});
		expect(confirmation.title).toBe(true);
		expect(confirmation.safety).toBe(true);
		expect(confirmation.hasConfirm).toBe(true);

		await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			const confirm = Array.from(panel?.querySelectorAll('button') ?? []).find((button) =>
				(button.textContent ?? '').trim() === 'Confirm 1 disabled draft',
			);
			confirm?.click();
		});

		const exactBanner = 'Disabled drafts added: 1 new, 0 already installed, 0 duplicate selections skipped.';
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const text = document.querySelector('[data-dtf-workbench-candidates="1"]')?.textContent ?? '';
			return text.includes('Disabled drafts added:') || text.includes('Adding disabled drafts failed:');
		}), {
			timeout: 15_000,
			timeoutMsg: 'Workbench installation did not reach a terminal result',
		});
		const resultSummary = await browser.executeObsidian(() => {
			const text = document.querySelector('[data-dtf-workbench-candidates="1"]')?.textContent ?? '';
			return text.match(/Disabled drafts added: \d+ new, \d+ already installed, \d+ duplicate selections? skipped\./)?.[0]
				?? text.match(/Adding disabled drafts failed:[^.]*\./)?.[0]
				?? null;
		});
		expect(resultSummary).toBe(exactBanner);

		const persisted = await browser.executeObsidian(async ({ app }, candidateKey) => {
			const plugin = (app as unknown as {
				plugins: {
					plugins: Record<string, { settings: { rules: Array<{ id: string; enabled: boolean }> } }>;
				};
			}).plugins.plugins['folder-tag-sync'];
			const rules = plugin.settings.rules;
			const dataPath = `${app.vault.configDir}/plugins/folder-tag-sync/data.json`;
			const raw = JSON.parse(await app.vault.adapter.read(dataPath)) as {
				rules?: Array<{ id: string; enabled: boolean }>;
			};
			const row = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'))
				.find((candidate) => candidate.dataset.dtfCandidateKey === candidateKey);
			const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			return {
				rules,
				persistedRules: raw.rules ?? [],
				automaticallyRecollected: Boolean(row),
				installedBadge: (row?.textContent ?? '').includes('Already installed'),
				nonSelectable: checkbox?.disabled === true && checkbox.checked === false,
				status: document.querySelector<HTMLElement>('[data-dtf-workbench-status]')?.dataset.dtfWorkbenchStatus ?? null,
			};
		}, selectedCandidateKey);

		expect(persisted.rules).toHaveLength(1);
		expect(persisted.rules[0].enabled).toBe(false);
		expect(persisted.persistedRules).toHaveLength(1);
		expect(persisted.persistedRules[0].id).toBe(persisted.rules[0].id);
		expect(persisted.persistedRules[0].enabled).toBe(false);
		expect(persisted.automaticallyRecollected).toBe(true);
		expect(persisted.installedBadge).toBe(true);
		expect(persisted.nonSelectable).toBe(true);
		expect(persisted.status).toBe('ready');
		installedRuleId = persisted.rules[0].id;

		const afterInstallFixture = await fixtureSnapshot();
		expect(afterInstallFixture).toEqual(initialFixtureSnapshot);
		await snap('workbench-candidates-post-install');
	});

	it('reinstall adds zero, skips the existing ID, and keeps the installed row non-selectable', async function () {
		const reinstall = await browser.executeObsidian(async ({ app }, ruleId, candidateKey) => {
			const plugin = (app as unknown as {
				plugins: {
					plugins: Record<string, {
						settings: { rules: Array<{ id: string }> };
						installWorkbenchRules: (rules: unknown[]) => Promise<{
							addedRuleIds: string[];
							skippedExistingIds: string[];
							skippedDuplicateCount: number;
							needsPersistence: boolean;
						}>;
					}>;
				};
			}).plugins.plugins['folder-tag-sync'];
			const rule = plugin.settings.rules.find((candidate) => candidate.id === ruleId);
			if (!rule) throw new Error(`Installed E2E rule ${ruleId} was not found`);
			const result = await plugin.installWorkbenchRules([rule]);
			const row = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'))
				.find((candidate) => candidate.dataset.dtfCandidateKey === candidateKey);
			const checkbox = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			return {
				addedRuleIds: result.addedRuleIds,
				skippedExistingIds: result.skippedExistingIds,
				skippedDuplicateCount: result.skippedDuplicateCount,
				needsPersistence: result.needsPersistence,
				ruleCount: plugin.settings.rules.length,
				rowDisabled: checkbox?.disabled === true,
			};
		}, installedRuleId, selectedCandidateKey);

		expect(reinstall.addedRuleIds).toEqual([]);
		expect(reinstall.skippedExistingIds).toEqual([installedRuleId]);
		expect(reinstall.skippedDuplicateCount).toBe(0);
		expect(reinstall.needsPersistence).toBe(false);
		expect(reinstall.ruleCount).toBe(1);
		expect(reinstall.rowDisabled).toBe(true);
	});

	it('only explicit enable plus save and refresh makes the installed rule active on the Map', async function () {
		const enabled = await browser.executeObsidian(async ({ app }, ruleId) => {
			const plugin = (app as unknown as {
				plugins: {
					plugins: Record<string, {
						settings: { rules: Array<{ id: string; enabled: boolean }> };
						saveSettings: () => Promise<void>;
					}>;
				};
			}).plugins.plugins['folder-tag-sync'];
			const rule = plugin.settings.rules.find((candidate) => candidate.id === ruleId);
			if (!rule) return false;
			rule.enabled = true;
			await plugin.saveSettings();
			return true;
		}, installedRuleId);
		expect(enabled).toBe(true);

		await browser.executeObsidian(() => {
			const panel = document.querySelector<HTMLElement>('[data-dtf-workbench-candidates="1"]');
			const refresh = Array.from(panel?.querySelectorAll('button') ?? []).find((button) =>
				(button.textContent ?? '').trim() === 'Refresh',
			);
			refresh?.click();
		});
		await waitForCandidates();

		await browser.executeObsidian(() => {
			const map = document.querySelector<HTMLButtonElement>('[data-dtf-workbench-surface-button="map"]');
			map?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() =>
			Boolean(document.querySelector('[data-dtf-workbench-map="1"]')),
		), {
			timeout: 10_000,
			timeoutMsg: 'Workbench Map did not render after enabling the installed rule',
		});

		const sensing = await browser.executeObsidian(async ({ app }, ruleId) => {
			const emissions = Array.from(document.querySelectorAll<HTMLElement>('[data-dtf-rule-emission="1"]'));
			const dataPath = `${app.vault.configDir}/plugins/folder-tag-sync/data.json`;
			const data = JSON.parse(await app.vault.adapter.read(dataPath)) as {
				rules?: Array<{ id: string; enabled: boolean }>;
			};
			return {
				emissionCount: emissions.length,
				emissionTexts: emissions.map((element) => element.textContent ?? ''),
				persistedEnabled: data.rules?.find((rule) => rule.id === ruleId)?.enabled ?? false,
			};
		}, installedRuleId);
		expect(sensing.persistedEnabled).toBe(true);
		expect(sensing.emissionCount).toBeGreaterThan(0);
		expect(sensing.emissionTexts.some((text) => text.includes('#'))).toBe(true);

		const afterEnableFixture = await fixtureSnapshot();
		expect(afterEnableFixture).toEqual(initialFixtureSnapshot);
		await snap('workbench-post-install-enabled-map');
	});
});
