import { describe, expect, test } from 'bun:test';
import { detectionOccurrenceKey } from '../engine/detectPacks';
import type { DetectionSignal } from '../engine/rulePackLoader';
import type { MappingRule } from '../types/settings';
import type { VaultEntryLike, VaultFolderLike } from '../utils/vaultFolders';
import type {
	BundledRulePackGetResult,
	BundledRulePackRepositoryError,
} from './BundledRulePackRepository';
import {
	WorkbenchSession,
	WorkbenchSessionCancelledError,
	collectWorkbenchSessionSnapshot,
	isWorkbenchSessionCancelledError,
	type WorkbenchManifest,
	type WorkbenchRulePackRepository,
} from './WorkbenchSession';
import {
	createDefaultWorkbenchState,
	validateWorkbenchState,
} from './workbenchState';

function options(): MappingRule['options'] {
	return {
		createFolders: true,
		addTags: true,
		removeOrphanedTags: false,
		syncOnFileCreate: true,
		syncOnFileMove: true,
		syncOnFileRename: true,
	};
}

function rule(id: string, folderPattern: string, tagEntryPoint: string): MappingRule {
	return {
		id,
		name: `${id} name`,
		enabled: true,
		priority: 10,
		direction: 'folder-to-tag',
		folderPattern,
		folderEntryPoint: '',
		tagEntryPoint,
		options: options(),
	};
}

function folder(path: string, children: VaultEntryLike[] = []): VaultFolderLike {
	return { path, children };
}

function rootFromPaths(paths: string[]): VaultFolderLike {
	const root = folder('');
	const folders = new Map<string, VaultFolderLike>([['', root]]);
	for (const path of [...paths].sort((a, b) => a.split('/').length - b.split('/').length)) {
		const segments = path.split('/');
		let parentPath = '';
		for (const segment of segments) {
			const currentPath = parentPath ? `${parentPath}/${segment}` : segment;
			if (!folders.has(currentPath)) {
				const current = folder(currentPath);
				folders.set(currentPath, current);
				(folders.get(parentPath)!.children as VaultEntryLike[]).push(current);
			}
			parentPath = currentPath;
		}
	}
	return root;
}

function manifestEntry(
	id: string,
	name: string,
	anyOf: DetectionSignal[],
	minSignals = 1,
	extra: { scopedUnder?: string; exclusiveWith?: string[] } = {},
) {
	return {
		id,
		name,
		detection: {
			anyOf,
			minSignals,
			scopedUnder: extra.scopedUnder,
		},
		exclusiveWith: extra.exclusiveWith,
	};
}

const TEST_MANIFEST: WorkbenchManifest = {
	packs: [
		manifestEntry(
			'alpha',
			'Alpha system',
			[{ folderRegex: '^Projects$', scope: 'name', label: 'Projects' }],
			1,
			{ exclusiveWith: ['beta'] },
		),
		manifestEntry(
			'beta',
			'Beta system',
			[{ folderRegex: '^Areas$', scope: 'name', label: 'Areas' }],
		),
		manifestEntry(
			'weak',
			'Weak system',
			[
				{ folderRegex: '^Projects$', scope: 'name' },
				{ folderRegex: '^Missing$', scope: 'name' },
			],
			2,
		),
		manifestEntry(
			'child',
			'Child system',
			[{ folderRegex: '^Nested$', scope: 'name' }],
			1,
			{ scopedUnder: 'missing-parent' },
		),
	],
};

class RecordingRepository implements WorkbenchRulePackRepository {
	readonly requested: string[] = [];
	readonly rulesById: Map<string, MappingRule[]>;
	readonly errorsById: Map<string, BundledRulePackRepositoryError>;

	constructor(
		rulesById: Map<string, MappingRule[]>,
		errorsById = new Map<string, BundledRulePackRepositoryError>(),
	) {
		this.rulesById = rulesById;
		this.errorsById = errorsById;
	}

	get(id: string): BundledRulePackGetResult {
		this.requested.push(id);
		const error = this.errorsById.get(id);
		if (error) return { ok: false, error };
		const rules = this.rulesById.get(id);
		if (!rules) {
			return {
				ok: false,
				error: {
					code: 'missing-id',
					message: `Missing ${id}`,
					packId: id,
					details: [],
					availableIds: [...this.rulesById.keys()],
				},
			};
		}
		return {
			ok: true,
			id,
			pack: {
				id,
				name: `${id} pack`,
				description: `${id} test pack`,
				version: '1.0.0',
				author: 'test',
				rules,
			},
		};
	}
}

function baseRepository(): RecordingRepository {
	return new RecordingRepository(new Map([
		['alpha', [rule('alpha-projects', '^Projects(?:/|$)', 'projects')]],
		['beta', [rule('beta-areas', '^Areas(?:/|$)', 'areas')]],
	]));
}

function candidateState(source: 'scope-selection' | 'detected-instances', selectedPaths: string[] = []) {
	return validateWorkbenchState({
		...createDefaultWorkbenchState(),
		surface: 'candidates',
		scope: { selectedPaths, signalFilter: null },
		candidates: { source, sort: 'noise', selectedKeys: null },
	});
}

describe('WorkbenchSession snapshot', () => {
	test('returns surfaced/below/suppressed partitions, installed views, conflicts, names, and exact stats', async () => {
		const installed = [
			rule('installed-specific', '^Projects(?:/|$)', 'installed'),
			rule('installed-broad', '^Projects(?:/.*)?$', 'broad'),
		];
		const snapshot = await collectWorkbenchSessionSnapshot({
			root: rootFromPaths(['Projects', 'Projects/Web', 'Areas', 'Nested']),
			settings: { rules: installed },
			manifest: TEST_MANIFEST,
			repository: baseRepository(),
			sourceRevision: 7,
		}, createDefaultWorkbenchState(), { yieldControl: async () => {} });

		expect(snapshot.sourceRevision).toBe(7);
		expect(snapshot.folderPaths).toEqual(['Areas', 'Nested', 'Projects', 'Projects/Web']);
		expect(snapshot.surfacedResults.map((result) => result.packId)).toEqual(['alpha', 'beta']);
		expect(snapshot.belowThresholdResults.map((result) => result.packId)).toEqual(['weak']);
		expect(snapshot.suppressedResults.map((result) => result.packId)).toEqual(['child']);
		expect(snapshot.hitMap.hitsByPath.has('Projects')).toBe(true);
		expect(snapshot.hitMap.hitsByPath.has('Nested')).toBe(false);
		expect(snapshot.allEvidenceHitsByPath.has('Nested')).toBe(true);
		expect(snapshot.actionableHitsByPath.has('Nested')).toBe(false);
		expect(snapshot.occurrenceStats).toEqual({
			totalCount: 4,
			actionableCount: 2,
			incompleteCount: 1,
			suppressedCount: 1,
			visibleCount: 4,
		});
		expect(snapshot.organizationalSystems.cards).toHaveLength(4);
		expect(snapshot.organizationalSystems.candidateGroups).toEqual([]);
		expect(snapshot.conflicts).toEqual([{
			packA: 'alpha',
			packB: 'beta',
			anchorPath: '',
			occurrenceAKey: detectionOccurrenceKey('alpha', ''),
			occurrenceBKey: detectionOccurrenceKey('beta', ''),
		}]);
		expect(snapshot.packNamesById.get('alpha')).toBe('Alpha system');
		expect(snapshot.ruleNamesById.get('installed-specific')).toBe('installed-specific name');
		expect(snapshot.folderRuleView.get('Projects')?.conflict).toBe(true);
		expect(snapshot.candidatePlan).toBeNull();
		expect(snapshot.stats).toEqual({
			folderCount: 4,
			detectionResultCount: 4,
			surfacedPackCount: 2,
			belowThresholdPackCount: 1,
			suppressedPackCount: 1,
			matchedFolderCount: 2,
			matchedSignalCount: 2,
			exclusivityConflictCount: 1,
			installedRuleCount: 2,
			enabledRuleCount: 2,
			coveredFolderCount: 2,
			installedConflictFolderCount: 2,
			candidateCount: 0,
			touchingCandidateCount: 0,
			candidateConflictCount: 0,
			candidateExistingCollisionCount: 0,
		});
	});

	test('clears a selected incomplete occurrence when the local preference hides it', async () => {
		const state = createDefaultWorkbenchState();
		state.selectedSystemInstanceKey = detectionOccurrenceKey('weak', '');
		state.preferences.showIncompleteSystems = false;

		const snapshot = await collectWorkbenchSessionSnapshot({
			root: rootFromPaths(['Projects', 'Areas', 'Nested']),
			settings: { rules: [] },
			manifest: TEST_MANIFEST,
			repository: baseRepository(),
		}, state, { yieldControl: async () => {} });

		expect(snapshot.state.selectedSystemInstanceKey).toBeNull();
		expect(snapshot.occurrenceStats).toMatchObject({
			totalCount: 4,
			incompleteCount: 1,
			visibleCount: 3,
		});
		expect(snapshot.organizationalSystems.cards.some((card) =>
			card.occurrenceKey === detectionOccurrenceKey('weak', '')
			&& card.status === 'incomplete')).toBe(true);
	});

	test('scope-selection candidates use explicit selected scopes and load only packs hit under them', async () => {
		const repository = baseRepository();
		const snapshot = await new WorkbenchSession({
			root: rootFromPaths(['Projects', 'Work', 'Work/Projects', 'Areas']),
			settings: { rules: [] },
			manifest: TEST_MANIFEST,
			repository,
		}).collect(candidateState('scope-selection', ['Work']), { yieldControl: async () => {} });

		expect(repository.requested).toEqual(['alpha']);
		expect(snapshot.candidateScopePlan).toEqual({
			scopePaths: ['Work'],
			deployments: [{
				packId: 'alpha',
				anchorPath: 'Work',
				occurrenceKey: detectionOccurrenceKey('alpha', 'Work'),
			}],
		});
		expect(snapshot.candidatePlan?.candidates).toHaveLength(1);
		expect(snapshot.candidatePlan?.candidates[0].anchorPath).toBe('Work');
		expect(snapshot.candidatePlan?.candidates[0].rule.id).toBe('alpha-projects__work');
	});

	test('detected-instance candidates use current detection instances and only surfaced pack ids', async () => {
		const repository = baseRepository();
		const snapshot = await collectWorkbenchSessionSnapshot({
			root: rootFromPaths(['Projects', 'Work', 'Work/Projects', 'Areas', 'Nested']),
			settings: { rules: [] },
			manifest: TEST_MANIFEST,
			repository,
		}, candidateState('detected-instances'), { yieldControl: async () => {} });

		expect(repository.requested).toEqual(['alpha', 'beta']);
		expect(snapshot.candidateScopePlan).toBeNull();
		expect(snapshot.candidatePlan?.candidates.map((candidate) => [
			candidate.sourcePackId,
			candidate.anchorPath,
		])).toEqual([
			['beta', ''],
			['alpha', ''],
			['alpha', 'Work'],
		]);
		expect(snapshot.loadedPackErrors).toEqual([]);
		expect(snapshot.organizationalSystems.candidateGroups).toHaveLength(3);
		for (const group of snapshot.organizationalSystems.candidateGroups) {
			expect(group.rows.length).toBeGreaterThan(0);
			expect(group.rows.every((row) => row.occurrenceKey === group.occurrenceKey)).toBe(true);
		}
		expect(new Set(
			snapshot.organizationalSystems.candidateGroups.map((group) => group.occurrenceKey),
		)).toEqual(new Set([
			detectionOccurrenceKey('alpha', ''),
			detectionOccurrenceKey('alpha', 'Work'),
			detectionOccurrenceKey('beta', ''),
		]));
	});

	test('candidate selection resolves null to all keys while preserving explicit [] as none', async () => {
		const input = {
			root: rootFromPaths(['Projects']),
			settings: { rules: [] },
			manifest: TEST_MANIFEST,
			repository: baseRepository(),
		};
		const all = await collectWorkbenchSessionSnapshot(
			input,
			candidateState('detected-instances'),
			{ yieldControl: async () => {} },
		);
		const noneState = candidateState('detected-instances');
		noneState.candidates.selectedKeys = [];
		const none = await collectWorkbenchSessionSnapshot(
			{ ...input, repository: baseRepository() },
			noneState,
			{ yieldControl: async () => {} },
		);

		expect(all.selectedCandidateKeys).toEqual(
			all.candidatePlan?.candidates.map((candidate) => candidate.key),
		);
		expect(none.selectedCandidateKeys).toEqual([]);
		expect(none.state.candidates.selectedKeys).toEqual([]);
	});

	test('reports requested bundled-pack failures without loading unrelated weak/suppressed packs', async () => {
		const error: BundledRulePackRepositoryError = {
			code: 'invalid-pack',
			message: 'Alpha failed validation',
			packId: 'alpha',
			details: ['bad rule'],
			availableIds: ['alpha'],
		};
		const repository = new RecordingRepository(new Map(), new Map([['alpha', error]]));
		const snapshot = await collectWorkbenchSessionSnapshot({
			root: rootFromPaths(['Projects', 'Nested']),
			settings: { rules: [] },
			manifest: TEST_MANIFEST,
			repository,
		}, candidateState('detected-instances'), { yieldControl: async () => {} });

		expect(repository.requested).toEqual(['alpha']);
		expect(snapshot.loadedPackErrors).toEqual([error]);
		expect(snapshot.candidatePlan?.candidates).toEqual([]);
	});

	test('uses the bundled repository/catalog without calling a vault filesystem adapter', async () => {
		let adapterReads = 0;
		const app = {
			vault: {
				getRoot: () => rootFromPaths(['Projects', 'Areas']),
				adapter: {
					read: async () => {
						adapterReads++;
						throw new Error('filesystem access forbidden');
					},
				},
			},
		};
		const snapshot = await collectWorkbenchSessionSnapshot({
			app,
			settings: { rules: [] },
		}, candidateState('detected-instances'), { yieldControl: async () => {} });

		expect(adapterReads).toBe(0);
		expect(snapshot.candidatePlan?.summary.distinctSourcePacks).toContain('para');
		expect(snapshot.loadedPackErrors).toEqual([]);
	});
});

describe('WorkbenchSession collection boundaries', () => {
	test('throws a recognizable cancellation error when a generation is superseded at a yield', async () => {
		let cancelled = false;
		const collection = collectWorkbenchSessionSnapshot({
			root: rootFromPaths(['Projects', 'Projects/Web']),
			settings: { rules: [] },
			manifest: TEST_MANIFEST,
			repository: baseRepository(),
		}, createDefaultWorkbenchState(), {
			isCancelled: () => cancelled,
			yieldControl: async () => {
				cancelled = true;
			},
		});

		await expect(collection).rejects.toBeInstanceOf(WorkbenchSessionCancelledError);
		try {
			await collection;
		} catch (error) {
			expect(isWorkbenchSessionCancelledError(error)).toBe(true);
			expect((error as WorkbenchSessionCancelledError).code).toBe('WORKBENCH_SESSION_CANCELLED');
		}
	});

	test('clones settings/rules before yielding so mid-scan mutation cannot change the snapshot', async () => {
		const sourceRule = rule('stable-rule', '^Projects(?:/|$)', 'projects');
		const settings = { rules: [sourceRule], groupPrecedence: ['stable'] };
		let mutated = false;
		const snapshot = await collectWorkbenchSessionSnapshot({
			root: rootFromPaths(['Projects', 'Projects/Web']),
			settings,
			manifest: TEST_MANIFEST,
			repository: baseRepository(),
		}, createDefaultWorkbenchState(), {
			chunkSize: 1,
			yieldControl: async () => {
				if (mutated) return;
				mutated = true;
				sourceRule.enabled = false;
				sourceRule.name = 'mutated name';
				settings.rules.push(rule('late-rule', '^Projects', 'late'));
				settings.groupPrecedence.push('late');
			},
		});

		expect(mutated).toBe(true);
		expect(snapshot.stats.installedRuleCount).toBe(1);
		expect(snapshot.stats.enabledRuleCount).toBe(1);
		expect(snapshot.stats.coveredFolderCount).toBe(2);
		expect(snapshot.ruleNamesById.get('stable-rule')).toBe('stable-rule name');
		expect(snapshot.ruleNamesById.has('late-rule')).toBe(false);
	});
});
