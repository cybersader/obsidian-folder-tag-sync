import { describe, expect, test } from 'bun:test';
import { compileTemplate } from '../engine/compileTemplate';
import { detectPacks, type ManifestPackEntry } from '../engine/detectPacks';
import { collectCrossPackHits } from '../engine/detectionTree';
import { computeFolderRuleView } from '../engine/folderRuleView';
import type {
	DynamicTagsFoldersSettings,
	MappingRule,
} from '../types/settings';
import type { VaultEntryLike, VaultFolderLike } from '../utils/vaultFolders';
import {
	collectSupportSnapshot,
	collectSupportSnapshotAsync,
	type SupportSnapshot,
} from './collectSupportSnapshot';
import {
	buildSupportBundle,
	renderFullFolderTree,
} from './supportBundle';

const baseOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

function folder(path: string, children: VaultEntryLike[] = []): VaultFolderLike {
	return { path, children };
}

function file(path: string): VaultEntryLike {
	return { path };
}

function projectsRule(): MappingRule {
	const folderTemplate = 'Secret Projects/{client...}';
	const tagTemplate = '#private/{client...}';
	return {
		id: 'secret-rule',
		name: 'Secret client rule',
		description: 'Maps Secret Projects to private client tags',
		group: 'secret-group',
		enabled: true,
		priority: 10,
		direction: 'bidirectional',
		folderTemplate,
		tagTemplate,
		folderPattern: compileTemplate(folderTemplate).regex.source,
		tagPattern: compileTemplate(tagTemplate).regex.source,
		folderEntryPoint: 'Secret Projects',
		tagEntryPoint: '#private',
		folderTransforms: {
			caseTransform: 'none',
			customTransforms: [{ pattern: 'Secret', replacement: 'Private', flags: 'g' }],
		},
		tagTransforms: { caseTransform: 'kebab-case' },
		options: baseOptions,
	};
}

const PACK: ManifestPackEntry = {
	id: 'private-pack',
	name: 'Private pack',
	detection: {
		anyOf: [{ folderRegex: '^Secret Projects$', scope: 'name', label: 'Projects root' }],
		minSignals: 1,
	},
};

function settings(): DynamicTagsFoldersSettings {
	return {
		rules: [projectsRule()],
		groupPrecedence: ['secret-group'],
		options: {
			syncOnSave: false,
			syncOnFileClose: false,
			syncOnCreate: true,
			syncOnRename: true,
			showNotifications: true,
			previewChanges: true,
			debugMode: true,
			handleFolderNotes: false,
			moveAttachments: false,
			defaultFolderForUntagged: 'Secret Projects/Client α',
		},
	};
}

function snapshot(debugEntries: unknown[] = []): SupportSnapshot {
	const root = folder('', [
		folder('Secret Projects', [
			folder('Secret Projects/Client α', [
				folder('Secret Projects/Client α/Research'),
				file('Secret Projects/Client α/private-note.md'),
			]),
		]),
		folder('Archive'),
		file('root-secret.md'),
	]);
	return collectSupportSnapshot({
		app: {
			vault: {
				getRoot: () => root,
				getMarkdownFiles: () => [{}, {}],
			},
		},
		settings: settings(),
		pluginManifest: {
			id: 'folder-tag-sync',
			name: 'Folder Tag Sync',
			version: '9.8.7',
			minAppVersion: '1.8.0',
		},
		platform: {
			kind: 'desktop',
			os: 'windows',
			isDesktopApp: true,
			isMobileApp: false,
		},
		packManifest: [PACK],
		debugEntries,
	});
}

describe('renderFullFolderTree', () => {
	test('renders an empty vault as the literal root only', () => {
		expect(renderFullFolderTree([])).toBe('<vault-root>');
	});

	test('renders deep, Unicode paths in deterministic sorted order', () => {
		expect(renderFullFolderTree([
			'βeta/二',
			'Alpha/Zed',
			'Alpha/Ångström',
			'βeta',
			'Alpha',
			'Alpha/Zed',
		])).toBe([
			'<vault-root>',
			'├── Alpha',
			'│   ├── Zed',
			'│   └── Ångström',
			'└── βeta',
			'    └── 二',
		].join('\n'));
	});

	test('escapes control characters so a segment cannot inject tree lines', () => {
		const tree = renderFullFolderTree(['Safe/line\nbreak', 'Safe/tab\tname']);
		expect(tree).toContain('line\\u000abreak');
		expect(tree).toContain('tab\\u0009name');
		expect(tree).not.toContain('line\nbreak');
	});
});

describe('collectSupportSnapshot', () => {
	test('collects complete settings, vault counts, and diagnostics from production engines', () => {
		const collected = snapshot();
		const folders = collected.vault.folderPaths;
		const directDetection = detectPacks(folders, [PACK]);
		const directHits = collectCrossPackHits(
			folders,
			directDetection,
			new Map([[PACK.id, PACK.name]]),
		);
		const directRuleView = computeFolderRuleView(
			folders,
			collected.configuration.rules,
			collected.configuration.groupPrecedence,
		);

		expect(collected.runtime.manifest.version).toBe('9.8.7');
		expect(collected.runtime.platform).toEqual({
			kind: 'desktop',
			os: 'windows',
			isDesktopApp: true,
			isMobileApp: false,
		});
		expect(collected.configuration).toEqual(settings());
		expect(collected.vault.folderPaths).toEqual([
			'Archive',
			'Secret Projects',
			'Secret Projects/Client α',
			'Secret Projects/Client α/Research',
		]);
		expect(collected.vault.markdownFileCount).toBe(2);
		expect(collected.diagnostics.detection.summary.resultCount).toBe(directDetection.length);
		expect(collected.diagnostics.detection.summary.matchedFolderCount).toBe(directHits.hitsByPath.size);

		const directCovered = [...directRuleView.values()]
			.filter((entry) => entry.winnerRuleId !== null).length;
		const directConflicts = [...directRuleView.values()]
			.filter((entry) => entry.conflict).length;
		expect(collected.diagnostics.installedRules.summary.coveredFolderCount).toBe(directCovered);
		expect(collected.diagnostics.installedRules.summary.conflictFolderCount).toBe(directConflicts);
		const ruleSummary = collected.diagnostics.installedRules.summary;
		expect(ruleSummary.folderDetailsIncluded).toBe(ruleSummary.coveredFolderCount);
		expect(ruleSummary.folderDetailsOmittedByLimit).toBe(0);
		expect(ruleSummary.folderDetailsOmittedUncovered)
			.toBe(4 - ruleSummary.coveredFolderCount);
		expect(collected.diagnostics.installedRules.details.folders
			.every((folder) => folder.winnerRuleId !== null || folder.matchingRuleIds.length > 0))
			.toBe(true);
	});

	test('emits no per-folder rule rows for a vault with no installed rules', () => {
		const ruleFreeSettings = settings();
		ruleFreeSettings.rules = [];
		const root = folder('', Array.from(
			{ length: 1_700 },
			(_, index) => folder(`Branch-${String(index).padStart(4, '0')}`),
		));

		const collected = collectSupportSnapshot({
			app: { vault: { getRoot: () => root, getMarkdownFiles: () => [] } },
			settings: ruleFreeSettings,
			pluginManifest: { version: '1.0.0' },
			platform: { kind: 'unknown' },
			packManifest: [],
		});
		const diagnostics = collected.diagnostics.installedRules;

		expect(collected.vault.folderPaths).toHaveLength(1_700);
		expect(diagnostics.details.folders).toEqual([]);
		expect(diagnostics.summary).toMatchObject({
			installedRuleCount: 0,
			coveredFolderCount: 0,
			uncoveredFolderCount: 1_700,
			folderDetailsIncluded: 0,
			folderDetailsOmittedUncovered: 1_700,
			folderDetailsOmittedByLimit: 0,
		});

		// The rule-free bundle must stay dominated by the tree, not by null rows.
		const built = buildSupportBundle(collected, { generatedAt: '2026-07-24T00:00:00.000Z' });
		expect(built.ok).toBe(true);
		if (built.ok) expect(built.byteLength).toBeLessThan(120_000);
	});

	test('keeps exact aggregates while capping detail for a 10,000-folder, many-rule vault', () => {
		const branchRule = projectsRule();
		branchRule.id = 'branch-rule';
		branchRule.name = 'Branch rule';
		branchRule.direction = 'folder-to-tag';
		branchRule.folderPattern = '^Branch-\\d+$';
		const largeSettings = settings();
		largeSettings.rules = Array.from({ length: 25 }, (_, index) => ({
			...branchRule,
			id: `branch-rule-${String(index).padStart(2, '0')}`,
			name: `Branch rule ${index}`,
			priority: index,
		}));
		const root = folder('', Array.from(
			{ length: 10_000 },
			(_, index) => folder(`Branch-${String(index).padStart(5, '0')}`),
		));
		const broadPack: ManifestPackEntry = {
			id: 'broad-pack',
			name: 'Broad pack',
			detection: {
				anyOf: [{ folderRegex: '^Branch-\\d+$', scope: 'name', label: 'Branch' }],
				minSignals: 1,
			},
		};

		const collected = collectSupportSnapshot({
			app: { vault: { getRoot: () => root, getMarkdownFiles: () => [] } },
			settings: largeSettings,
			pluginManifest: { version: '1.0.0' },
			platform: { kind: 'unknown' },
			packManifest: [broadPack],
		});
		const diagnostics = collected.diagnostics.installedRules;

		expect(diagnostics.summary.coveredFolderCount).toBe(10_000);
		expect(diagnostics.summary.uncoveredFolderCount).toBe(0);
		expect(diagnostics.summary.conflictFolderCount).toBe(10_000);
		expect(diagnostics.summary.enabledForwardRuleCount).toBe(25);
		expect(diagnostics.summary.folderDetailsIncluded).toBe(2_000);
		expect(diagnostics.summary.folderDetailsOmittedByLimit).toBe(8_000);
		expect(diagnostics.summary.folderDetailsOmittedUncovered).toBe(0);
		expect(diagnostics.details.folders).toHaveLength(2_000);
		expect(diagnostics.details.folders[0].matchingRuleIds).toHaveLength(25);
		expect(diagnostics.details.folders.at(-1)?.folderPath).toBe('Branch-01999');
		expect(collected.diagnostics.detection.summary).toMatchObject({
			matchedFolderCount: 10_000,
			folderDetailsIncluded: 2_000,
			folderDetailsOmitted: 8_000,
		});
		expect(collected.diagnostics.detection.details.hitsByFolder).toHaveLength(2_000);
		expect(collected.diagnostics.detection.details.hitsByFolder.at(-1)?.folderPath)
			.toBe('Branch-01999');
		expect(diagnostics.details.rules[0]).toMatchObject({
			ruleId: 'branch-rule-00',
			winningFolderCount: 10_000,
			matchingFolderCount: 10_000,
			conflictFolderCount: 10_000,
		});
		expect(diagnostics.details.rules.at(-1)).toMatchObject({
			ruleId: 'branch-rule-24',
			winningFolderCount: 0,
			matchingFolderCount: 10_000,
			conflictFolderCount: 10_000,
		});
	});

	test('async collection yields in bounded chunks and snapshots settings before yielding', async () => {
		const originalSettings = settings();
		const root = folder('', Array.from(
			{ length: 450 },
			(_, index) => folder(`Secret Projects/Client-${String(index).padStart(3, '0')}`),
		));
		let yieldCount = 0;

		const collected = await collectSupportSnapshotAsync({
			app: { vault: { getRoot: () => root, getMarkdownFiles: () => [] } },
			settings: originalSettings,
			pluginManifest: { version: '1.0.0' },
			platform: { kind: 'unknown' },
			packManifest: [],
		}, {
			chunkSize: 100,
			yieldControl: async () => {
				yieldCount++;
				originalSettings.rules[0].name = 'Mutated while collecting';
			},
		});

		expect(yieldCount).toBe(4);
		expect(collected.configuration.rules[0].name).toBe('Secret client rule');
		expect(collected.diagnostics.installedRules.summary.coveredFolderCount).toBe(450);
		expect(collected.diagnostics.installedRules.summary.folderDetailsIncluded).toBe(450);
	});

	test('async collection stops after a superseding generation cancels it', async () => {
		const root = folder('', Array.from(
			{ length: 250 },
			(_, index) => folder(`Folder-${String(index).padStart(3, '0')}`),
		));
		let cancelled = false;
		const collection = collectSupportSnapshotAsync({
			app: { vault: { getRoot: () => root, getMarkdownFiles: () => [] } },
			settings: settings(),
			pluginManifest: { version: '1.0.0' },
			platform: { kind: 'unknown' },
			packManifest: [],
		}, {
			chunkSize: 100,
			isCancelled: () => cancelled,
			yieldControl: async () => {
				cancelled = true;
			},
		});

		await expect(collection).rejects.toThrow('Support bundle collection cancelled');
	});

	test('deep-clones settings and parsed debug entries', () => {
		const originalSettings = settings();
		const debugEntries = [{ level: 'info', data: { folderPath: 'Secret Projects' } }];
		const root = folder('', [folder('Secret Projects')]);
		const collected = collectSupportSnapshot({
			app: { vault: { getRoot: () => root, getMarkdownFiles: () => [] } },
			settings: originalSettings,
			pluginManifest: { version: '1.0.0' },
			platform: { kind: 'unknown' },
			packManifest: [PACK],
			debugEntries,
		});

		collected.configuration.rules[0].name = 'Changed clone';
		(collected.debugEntries[0] as { data: { folderPath: string } }).data.folderPath = 'Changed clone';
		expect(originalSettings.rules[0].name).toBe('Secret client rule');
		expect((debugEntries[0] as { data: { folderPath: string } }).data.folderPath)
			.toBe('Secret Projects');
	});
});

describe('buildSupportBundle', () => {
	test('uses stable sections and is byte-for-byte deterministic when generatedAt is supplied', () => {
		const collected = snapshot([{ level: 'info', message: 'Ready' }]);
		const options = { generatedAt: '2026-07-23T12:34:56.000Z' } as const;
		const first = buildSupportBundle(collected, options);
		const second = buildSupportBundle(collected, options);
		expect(first.ok).toBe(true);
		expect(second).toEqual(first);
		if (!first.ok) return;

		expect(first.text).toContain('FOLDER TAG SYNC SUPPORT BUNDLE v1');
		expect(first.text).toContain('=== PRIVACY ===');
		expect(first.text).toContain('=== RUNTIME JSON ===');
		expect(first.text).toContain('=== CONFIGURATION JSON ===');
		expect(first.text).toContain('=== DIAGNOSTICS JSON ===');
		expect(first.text).toContain('=== FULL FOLDER TREE ===');
		expect(first.text).toContain('=== SANITIZED DEBUG JSONL ===');
		expect(first.text).toContain('"generatedAt": "2026-07-23T12:34:56.000Z"');
	});

	test('final-scrubs privacy sentinels from readable output', () => {
		const vaultName = 'Top Secret Vault';
		const windowsPath = 'C:\\Users\\Alice\\Top Secret Vault\\private-note.md';
		const posixPath = '/home/alice/Top Secret Vault/private-note.md';
		const fileUrl = 'file:///C:/Users/Alice/Top%20Secret%20Vault/private-note.md';
		const collected = snapshot([{
			level: 'error',
			message: `Vault ${vaultName}; ${windowsPath}; ${posixPath}; ${fileUrl}; private-note.md`,
			noteLeaf: 'private-note.md',
			vaultName,
			content: 'SECRET_CONTENT_SENTINEL',
			frontmatter: { client: 'SECRET_FRONTMATTER_SENTINEL' },
			frontmatterTags: ['#SECRET_FRONTMATTER_TAG_SENTINEL'],
			inlineTags: ['#SECRET_INLINE_TAG_SENTINEL'],
			normalizedTags: ['#SECRET_NORMALIZED_TAG_SENTINEL'],
			stack: `SECRET_STACK_SENTINEL at ${windowsPath}`,
		}]);
		(collected.runtime.manifest as Record<string, unknown>).installPath = windowsPath;

		const result = buildSupportBundle(collected, {
			generatedAt: '2026-07-23T00:00:00.000Z',
			privacyContext: { forbiddenValues: [vaultName] },
		});
		expect(result.ok).toBe(true);
		if (!result.ok) return;

		for (const sentinel of [
			vaultName,
			windowsPath,
			posixPath,
			fileUrl,
			'private-note.md',
			'SECRET_CONTENT_SENTINEL',
			'SECRET_FRONTMATTER_SENTINEL',
			'SECRET_FRONTMATTER_TAG_SENTINEL',
			'SECRET_INLINE_TAG_SENTINEL',
			'SECRET_NORMALIZED_TAG_SENTINEL',
			'SECRET_STACK_SENTINEL',
		]) {
			expect(result.text).not.toContain(sentinel);
		}
		expect(result.text).toContain('<redacted-note-leaf>');
		expect(result.text).toContain('<redacted-content>');
		expect(result.text).toContain('<redacted-frontmatter>');
		expect(result.text).toContain('<redacted-note-tags>');
		expect(result.text).toContain('<redacted-stack>');
	});

	test('can build readable, anonymized, then identical readable output from one snapshot', () => {
		const collected = snapshot([{ message: 'Secret Projects uses #private/client' }]);
		const options = { generatedAt: '2026-07-23T00:00:00.000Z' } as const;
		const readableBefore = buildSupportBundle(collected, options);
		const anonymized = buildSupportBundle(collected, { ...options, mode: 'anonymized' });
		const readableAfter = buildSupportBundle(collected, options);

		expect(readableBefore.ok).toBe(true);
		expect(anonymized.ok).toBe(true);
		expect(readableAfter).toEqual(readableBefore);
		if (!readableBefore.ok || !anonymized.ok) return;
		expect(readableBefore.text).toContain('Secret Projects');
		expect(anonymized.text).not.toContain('Secret Projects');
		expect(anonymized.text).toContain('folder-');
	});

	test('drops logs before detailed diagnostics when the bundle exceeds the limit', () => {
		const collected = snapshot([{ message: 'x'.repeat(30_000) }]);
		const baseline = buildSupportBundle(collected, {
			generatedAt: '2026-07-23T00:00:00.000Z',
			maxBytes: 1_000_000,
		});
		expect(baseline.ok).toBe(true);
		if (!baseline.ok) return;

		const withoutRoomForLogs = buildSupportBundle(collected, {
			generatedAt: '2026-07-23T00:00:00.000Z',
			maxBytes: baseline.byteLength - 10_000,
		});
		expect(withoutRoomForLogs.ok).toBe(true);
		if (!withoutRoomForLogs.ok) return;
		expect(withoutRoomForLogs.omitted.debugEntries).toBe(true);
		expect(withoutRoomForLogs.omitted.detailedDiagnostics).toBe(false);
		expect(withoutRoomForLogs.text).toContain('<omitted by size policy>');
		expect(withoutRoomForLogs.text).toContain('"hitsByFolder"');
	});

	test('drops detailed diagnostics second and returns typed too-large when the full tree alone cannot fit', () => {
		const manyFolders = Array.from(
			{ length: 300 },
			(_, index) => `Branch-${String(index).padStart(3, '0')}/${'deep-segment-'.repeat(4)}${index}`,
		);
		const collected = snapshot([{ message: 'log'.repeat(5_000) }]);
		collected.vault.folderPaths = manyFolders;
		collected.diagnostics.detection.details.hitsByFolder = manyFolders.map((folderPath) => ({
			folderPath,
			hits: [{
				packId: 'private-pack',
				signalLabel: 'Large detail',
				signalRegex: '^Large$',
				scope: 'path',
			}],
		}));

		const compact = buildSupportBundle(collected, {
			generatedAt: '2026-07-23T00:00:00.000Z',
			maxBytes: 80_000,
		});
		expect(compact.ok).toBe(true);
		if (compact.ok) {
			expect(compact.omitted.debugEntries).toBe(true);
			expect(compact.omitted.detailedDiagnostics).toBe(true);
			expect(compact.text).not.toContain('"hitsByFolder"');
			expect(compact.text).toContain(manyFolders.at(-1)!.split('/')[1]);
		}

		const tooLarge = buildSupportBundle(collected, {
			generatedAt: '2026-07-23T00:00:00.000Z',
			maxBytes: 500,
		});
		expect(tooLarge).toMatchObject({
			ok: false,
			reason: 'too-large',
			maxBytes: 500,
			omitted: { debugEntries: true, detailedDiagnostics: true },
		});
		if (!tooLarge.ok) expect(tooLarge.requiredBytes).toBeGreaterThan(tooLarge.maxBytes);
	});
});
