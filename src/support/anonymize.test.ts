import { describe, expect, test } from 'bun:test';
import { compileTemplate } from '../engine/compileTemplate';
import type { ManifestPackEntry } from '../engine/detectPacks';
import type { DynamicTagsFoldersSettings, MappingRule } from '../types/settings';
import type { VaultEntryLike, VaultFolderLike } from '../utils/vaultFolders';
import { anonymizeSupportSnapshot } from './anonymize';
import { collectSupportSnapshot } from './collectSupportSnapshot';

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

function makeRule(): MappingRule {
	const folderTemplate = 'Workspace/Clients/{client...}';
	const tagTemplate = '#customer/{client...}';
	return {
		id: 'acme-client-rule',
		name: 'Acme client rule',
		description: 'Maps Acme client folders',
		group: 'client-taxonomy',
		enabled: true,
		priority: 4,
		direction: 'bidirectional',
		folderTemplate,
		tagTemplate,
		folderPattern: compileTemplate(folderTemplate).regex.source,
		tagPattern: compileTemplate(tagTemplate).regex.source,
		folderEntryPoint: 'Workspace/Clients',
		folderAnchor: { under: 'Workspace' },
		tagEntryPoint: '#customer',
		folderTransforms: {
			caseTransform: 'none',
			customTransforms: [{ pattern: '^Acme$', replacement: 'ACME', flags: 'i' }],
		},
		tagTransforms: { caseTransform: 'kebab-case' },
		transfer: { op: 'marker-only', marker: '#customer' },
		inverseTransfer: { op: 'identity' },
		cardinality: 'many:1',
		bijective: false,
		options: baseOptions,
	};
}

function makeSettings(): DynamicTagsFoldersSettings {
	return {
		rules: [makeRule()],
		groupPrecedence: ['client-taxonomy'],
		options: {
			syncOnSave: false,
			syncOnFileClose: false,
			syncOnCreate: true,
			syncOnRename: true,
			showNotifications: true,
			previewChanges: false,
			debugMode: true,
			handleFolderNotes: false,
			moveAttachments: false,
			defaultFolderForUntagged: 'Workspace/Clients/Acme',
		},
	};
}

const PACK: ManifestPackEntry = {
	id: 'customer-pack',
	name: 'Customer pack',
	detection: {
		anyOf: [{ folderRegex: '^Clients$', scope: 'leafName', label: 'Client root' }],
		minSignals: 1,
	},
};

function makeSnapshot() {
	const root = folder('', [
		folder('Workspace', [
			folder('Workspace/Clients', [folder('Workspace/Clients/Acme')]),
		]),
	]);
	return collectSupportSnapshot({
		app: { vault: { getRoot: () => root, getMarkdownFiles: () => [{}] } },
		settings: makeSettings(),
		pluginManifest: {
			id: 'folder-tag-sync',
			name: 'Folder Tag Sync',
			version: '1.2.3',
		},
		platform: { kind: 'desktop', os: 'linux', isDesktopApp: true },
		packManifest: [PACK],
		debugEntries: [{
			level: 'info',
			message: 'Acme client rule matched Workspace/Clients/Acme and emitted #customer/Acme',
			ruleId: 'acme-client-rule',
			folderPath: 'Workspace/Clients/Acme',
			tags: ['#customer/Acme'],
			pattern: '^Acme$',
		}],
	});
}

describe('anonymizeSupportSnapshot', () => {
	test('uses stable category aliases across configuration, tree, diagnostics, and logs', () => {
		const source = makeSnapshot();
		const anonymized = anonymizeSupportSnapshot(source);
		const rule = anonymized.configuration.rules[0];
		const folderDetail = anonymized.diagnostics.installedRules.details.folders
			.find((entry) => entry.folderPath === anonymized.vault.folderPaths.at(-1))!;
		const debug = anonymized.debugEntries[0] as {
			message: string;
			ruleId: string;
			folderPath: string;
			tags: string[];
			pattern: string;
		};

		expect(rule.id).toBe('rule-001');
		expect(rule.name).toBe('rule-001');
		expect(rule.group).toBe('group-001');
		expect(anonymized.configuration.groupPrecedence).toEqual(['group-001']);
		expect(rule.folderPattern).toMatch(/^regex-\d{3}$/);
		expect(rule.tagPattern).toMatch(/^regex-\d{3}$/);
		expect(rule.folderTemplate).toMatch(/^template-\d{3}$/);
		expect(rule.tagTemplate).toMatch(/^template-\d{3}$/);
		expect(rule.folderTransforms?.customTransforms?.[0].replacement).toBe('literal-001');
		expect(rule.direction).toBe('bidirectional');
		expect(rule.folderTransforms?.caseTransform).toBe('none');
		expect(rule.cardinality).toBe('many:1');
		expect(rule.enabled).toBe(true);

		expect(debug.ruleId).toBe(rule.id);
		expect(debug.folderPath).toBe(anonymized.vault.folderPaths.at(-1));
		expect(debug.tags[0]).toBe(folderDetail.emittedTags[0]);
		expect(debug.pattern).toMatch(/^regex-\d{3}$/);
		expect(debug.message).toContain(rule.id);
		expect(debug.message).toContain(debug.folderPath);
		expect(debug.message).toContain(debug.tags[0]);
		expect(folderDetail.winnerRuleId).toBe(rule.id);
		expect(anonymized.diagnostics.installedRules.details.rules[0].ruleId).toBe(rule.id);
	});

	test('preserves versions, pack ids, counts, enums, booleans, and object structure', () => {
		const anonymized = anonymizeSupportSnapshot(makeSnapshot());
		expect(anonymized.runtime.manifest.version).toBe('1.2.3');
		expect(anonymized.runtime.platform.os).toBe('linux');
		expect(anonymized.runtime.platform.isDesktopApp).toBe(true);
		expect(anonymized.diagnostics.detection.summary.surfacedPackIds).toEqual(['customer-pack']);
		expect(anonymized.diagnostics.detection.details.results[0].packId).toBe('customer-pack');
		expect(anonymized.vault.markdownFileCount).toBe(1);
		expect(anonymized.configuration.rules[0].options).toEqual(baseOptions);
	});

	test('anonymizes aggregation and truncation separators in both transfer directions', () => {
		const source = makeSnapshot();
		source.configuration.rules[0].transfer = {
			op: 'aggregation',
			separator: 'PRIVATE_AGGREGATION_SEPARATOR',
		};
		source.configuration.rules[0].inverseTransfer = {
			op: 'truncation',
			depth: 2,
			tailHandling: 'aggregate',
			separator: 'PRIVATE_TRUNCATION_SEPARATOR',
		};

		const anonymized = anonymizeSupportSnapshot(source);
		const transfer = anonymized.configuration.rules[0].transfer;
		const inverse = anonymized.configuration.rules[0].inverseTransfer;

		expect(transfer).toMatchObject({ op: 'aggregation' });
		expect(inverse).toMatchObject({ op: 'truncation', tailHandling: 'aggregate' });
		if (transfer?.op === 'aggregation') {
			expect(transfer.separator).toMatch(/^literal-\d{3}$/);
		}
		if (inverse?.op === 'truncation') {
			expect(inverse.separator).toMatch(/^literal-\d{3}$/);
		}
		const text = JSON.stringify(anonymized);
		expect(text).not.toContain('PRIVATE_AGGREGATION_SEPARATOR');
		expect(text).not.toContain('PRIVATE_TRUNCATION_SEPARATOR');
	});

	test('is deterministic and does not mutate settings or the source snapshot', () => {
		const source = makeSnapshot();
		const before = JSON.stringify(source);
		const first = anonymizeSupportSnapshot(source);
		const second = anonymizeSupportSnapshot(source);

		expect(second).toEqual(first);
		expect(JSON.stringify(source)).toBe(before);
		expect(source.configuration.rules[0].id).toBe('acme-client-rule');
		expect(source.vault.folderPaths).toContain('Workspace/Clients/Acme');
	});

	test('removes every private fixture literal without emitting a legend', () => {
		const anonymizedText = JSON.stringify(anonymizeSupportSnapshot(makeSnapshot()));
		for (const privateValue of [
			'acme-client-rule',
			'Acme client rule',
			'client-taxonomy',
			'Workspace/Clients/Acme',
			'#customer/Acme',
			'Workspace/Clients/{client...}',
			'#customer/{client...}',
			'^Acme$',
			'ACME',
		]) {
			expect(anonymizedText).not.toContain(privateValue);
		}
		expect(anonymizedText.toLowerCase()).not.toContain('legend');
	});
});
