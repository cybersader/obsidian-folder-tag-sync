import { describe, expect, test } from 'bun:test';
import type { MappingRule } from '../types/settings';
import { buildRuleInstallPlan } from './ruleInstallPlan';

function rule(id: string, enabled = true, name = id): MappingRule {
	return {
		id,
		name,
		enabled,
		priority: 10,
		direction: 'bidirectional',
		folderAnchor: { under: 'Work' },
		folderPattern: '^Work(?:/|$)',
		folderTransforms: {
			caseTransform: 'Title Case',
			customTransforms: [{ pattern: '\\s+', replacement: '-', flags: 'g' }],
		},
		tagPattern: '^work(?:/|$)',
		tagTransforms: {
			caseTransform: 'kebab-case',
			customTransforms: [{ pattern: '_', replacement: '-' }],
		},
		options: {
			createFolders: true,
			addTags: true,
			removeOrphanedTags: false,
			syncOnFileCreate: true,
			syncOnFileMove: true,
			syncOnFileRename: true,
		},
		folder: {
			axes: ['entity', 'work'],
			scheme: 'authority-root',
			naming: 'word',
			subdivisionDepth: 'unbounded',
			siblingUniformity: 'unique',
		},
		tag: {
			axis: 'work',
			coordination: 'pre-coordinated',
			prefixMarker: '',
			authority: 'mutual',
		},
		transfer: { op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' },
		inverseTransfer: { op: 'identity' },
	};
}

describe('buildRuleInstallPlan', () => {
	test('returns an exact empty plan for an empty selection', () => {
		const plan = buildRuleInstallPlan([], [rule('existing')]);

		expect(plan).toEqual({
			requestedCount: 0,
			uniqueCount: 0,
			addedRules: [],
			addedRuleIds: [],
			skippedExistingIds: [],
			skippedDuplicateIds: [],
			skippedDuplicateCount: 0,
			needsPersistence: false,
		});
	});

	test('collapses duplicate selected IDs first-wins in selection order', () => {
		const firstA = rule('a', true, 'First A');
		const secondA = rule('a', false, 'Second A');
		const thirdA = rule('a', true, 'Third A');
		const b = rule('b', true, 'B');

		const plan = buildRuleInstallPlan([firstA, b, secondA, thirdA], []);

		expect(plan.requestedCount).toBe(4);
		expect(plan.uniqueCount).toBe(2);
		expect(plan.addedRuleIds).toEqual(['a', 'b']);
		expect(plan.addedRules.map((candidate) => candidate.name)).toEqual(['First A', 'B']);
		expect(plan.skippedDuplicateIds).toEqual(['a', 'a']);
		expect(plan.skippedDuplicateCount).toBe(2);
		expect(plan.skippedExistingIds).toEqual([]);
		expect(plan.needsPersistence).toBe(true);
	});

	test('skips already-installed IDs regardless of source or installed enabled state', () => {
		const existingEnabled = rule('installed-on', true);
		const existingDisabled = rule('installed-off', false);
		const selectedEnabled = rule('installed-on', true, 'replacement-on');
		const selectedDisabled = rule('installed-off', false, 'replacement-off');
		const newEnabled = rule('new-on', true);
		const newDisabled = rule('new-off', false);

		const plan = buildRuleInstallPlan(
			[selectedEnabled, selectedDisabled, newEnabled, newDisabled],
			[existingEnabled, existingDisabled],
		);

		expect(plan.requestedCount).toBe(4);
		expect(plan.uniqueCount).toBe(4);
		expect(plan.skippedExistingIds).toEqual(['installed-on', 'installed-off']);
		expect(plan.skippedDuplicateIds).toEqual([]);
		expect(plan.skippedDuplicateCount).toBe(0);
		expect(plan.addedRuleIds).toEqual(['new-on', 'new-off']);
		expect(plan.addedRules.map((candidate) => candidate.enabled)).toEqual([false, false]);
		expect(plan.needsPersistence).toBe(true);

		// Installed states are the caller's state and must never be normalized.
		expect(existingEnabled.enabled).toBe(true);
		expect(existingDisabled.enabled).toBe(false);
	});

	test('an existing first occurrence still owns duplicate collapse', () => {
		const plan = buildRuleInstallPlan(
			[rule('existing', true), rule('existing', false), rule('new', true)],
			[rule('existing', false)],
		);

		expect(plan.uniqueCount).toBe(2);
		expect(plan.skippedExistingIds).toEqual(['existing']);
		expect(plan.skippedDuplicateIds).toEqual(['existing']);
		expect(plan.skippedDuplicateCount).toBe(1);
		expect(plan.addedRuleIds).toEqual(['new']);
	});

	test('does not request persistence when every unique ID already exists', () => {
		const plan = buildRuleInstallPlan(
			[rule('a'), rule('a'), rule('b', false)],
			[rule('a', false), rule('b', true)],
		);

		expect(plan.requestedCount).toBe(3);
		expect(plan.uniqueCount).toBe(2);
		expect(plan.addedRules).toEqual([]);
		expect(plan.addedRuleIds).toEqual([]);
		expect(plan.skippedExistingIds).toEqual(['a', 'b']);
		expect(plan.skippedDuplicateIds).toEqual(['a']);
		expect(plan.skippedDuplicateCount).toBe(1);
		expect(plan.needsPersistence).toBe(false);
	});

	test('returns fully detached disabled copies and never mutates either input', () => {
		const candidate = rule('candidate', true);
		const existing = rule('existing', true);
		const candidateBefore = structuredClone(candidate);
		const existingBefore = structuredClone(existing);
		const selected = Object.freeze([candidate]);
		const installed = Object.freeze([existing]);

		const plan = buildRuleInstallPlan(selected, installed);
		const added = plan.addedRules[0];

		expect(candidate).toEqual(candidateBefore);
		expect(existing).toEqual(existingBefore);
		expect(added).not.toBe(candidate);
		expect(added.enabled).toBe(false);
		expect(added.options).not.toBe(candidate.options);
		expect(added.folderAnchor).not.toBe(candidate.folderAnchor);
		expect(added.folderTransforms).not.toBe(candidate.folderTransforms);
		expect(added.folderTransforms?.customTransforms).not.toBe(candidate.folderTransforms?.customTransforms);
		expect(added.folderTransforms?.customTransforms?.[0]).not.toBe(candidate.folderTransforms?.customTransforms?.[0]);
		expect(added.tagTransforms).not.toBe(candidate.tagTransforms);
		expect(added.tagTransforms?.customTransforms?.[0]).not.toBe(candidate.tagTransforms?.customTransforms?.[0]);
		expect(added.folder).not.toBe(candidate.folder);
		expect(added.folder?.axes).not.toBe(candidate.folder?.axes);
		expect(added.tag).not.toBe(candidate.tag);
		expect(added.transfer).not.toBe(candidate.transfer);
		expect(added.inverseTransfer).not.toBe(candidate.inverseTransfer);

		added.options.addTags = false;
		added.folder!.axes[0] = 'capture';
		added.folderTransforms!.customTransforms![0].replacement = '_';
		expect(candidate).toEqual(candidateBefore);
		expect(existing).toEqual(existingBefore);
	});
});
