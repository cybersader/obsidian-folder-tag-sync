import { describe, expect, it } from 'bun:test';
import {
	buildSpec,
	buildTransferOp,
	defaultFormState,
	detectWarnings,
	entriesPopulated,
	isFormValid,
	populateFromRule,
	type FormState,
} from './buildSpec';
import type { MappingRule } from '../types/settings';

const baseState = (overrides: Partial<FormState> = {}): FormState => ({
	...defaultFormState(),
	id: 'rule-test',
	name: 'Test rule',
	folderEntry: 'Projects',
	tagEntry: 'projects',
	...overrides,
});

describe('buildTransferOp', () => {
	it('identity → no extra fields', () => {
		const op = buildTransferOp(baseState({ transferOp: 'identity' }));
		expect(op).toEqual({ op: 'identity' });
	});

	it('truncation → carries depth, tailHandling, separator', () => {
		const op = buildTransferOp(
			baseState({
				transferOp: 'truncation',
				truncationDepth: 3,
				truncationTailHandling: 'aggregate',
				truncationSeparator: '_',
			}),
		);
		expect(op).toEqual({
			op: 'truncation',
			depth: 3,
			tailHandling: 'aggregate',
			separator: '_',
		});
	});

	it('truncation → empty separator falls back to "-"', () => {
		const op = buildTransferOp(
			baseState({
				transferOp: 'truncation',
				truncationDepth: 2,
				truncationTailHandling: 'drop',
				truncationSeparator: '',
			}),
		);
		expect(op).toEqual({
			op: 'truncation',
			depth: 2,
			tailHandling: 'drop',
			separator: '-',
		});
	});

	it('marker-only → carries marker', () => {
		const op = buildTransferOp(
			baseState({ transferOp: 'marker-only', markerOnlyMarker: '-clip' }),
		);
		expect(op).toEqual({ op: 'marker-only', marker: '-clip' });
	});

	it('promotion-to-root → no extra fields', () => {
		const op = buildTransferOp(baseState({ transferOp: 'promotion-to-root' }));
		expect(op).toEqual({ op: 'promotion-to-root' });
	});

	it('flattening-to-leaf → no extra fields', () => {
		const op = buildTransferOp(baseState({ transferOp: 'flattening-to-leaf' }));
		expect(op).toEqual({ op: 'flattening-to-leaf' });
	});

	it('aggregation → carries separator', () => {
		const op = buildTransferOp(
			baseState({ transferOp: 'aggregation', aggregationSeparator: '|' }),
		);
		expect(op).toEqual({ op: 'aggregation', separator: '|' });
	});

	it('aggregation → empty separator falls back to "-"', () => {
		const op = buildTransferOp(
			baseState({ transferOp: 'aggregation', aggregationSeparator: '' }),
		);
		expect(op).toEqual({ op: 'aggregation', separator: '-' });
	});

	it('post-coordination → no extra fields', () => {
		const op = buildTransferOp(baseState({ transferOp: 'post-coordination' }));
		expect(op).toEqual({ op: 'post-coordination' });
	});

	it('opaque → no extra fields', () => {
		const op = buildTransferOp(baseState({ transferOp: 'opaque' }));
		expect(op).toEqual({ op: 'opaque' });
	});
});

describe('buildSpec', () => {
	it('produces full TypedRuleSpec from happy-path state', () => {
		const spec = buildSpec(
			baseState({
				name: 'Project capture',
				axis: 'work',
				direction: 'bidirectional',
				folderEntry: 'Projects',
				folderScheme: 'hierarchical',
				folderNaming: 'word',
				tagEntry: 'projects',
				tagCoordination: 'pre-coordinated',
				transferOp: 'identity',
			}),
		);
		expect(spec.id).toBe('rule-test');
		expect(spec.name).toBe('Project capture');
		expect(spec.folder).toEqual({
			axes: ['work'],
			scheme: 'hierarchical',
			naming: 'word',
			subdivisionDepth: 'unbounded',
			siblingUniformity: 'unique',
		});
		expect(spec.tag.axis).toBe('work');
		expect(spec.tag.coordination).toBe('pre-coordinated');
		expect(spec.tag.authority).toBe('mutual'); // bidirectional
		expect(spec.transfer).toEqual({ op: 'identity' });
		expect(spec.inverseTransfer).toEqual({ op: 'identity' });
		expect(spec.folderEntry).toBe('Projects');
		expect(spec.tagEntry).toBe('projects');
	});

	it('empty name falls back to placeholder', () => {
		const spec = buildSpec(baseState({ name: '' }));
		expect(spec.name).toBe('(unnamed rule)');
	});

	it('direction maps to authority correctly', () => {
		expect(buildSpec(baseState({ direction: 'bidirectional' })).tag.authority).toBe('mutual');
		expect(buildSpec(baseState({ direction: 'folder-to-tag' })).tag.authority).toBe(
			'folder-authoritative',
		);
		expect(buildSpec(baseState({ direction: 'tag-to-folder' })).tag.authority).toBe(
			'tag-authoritative',
		);
	});

	it('description omitted when empty', () => {
		const spec = buildSpec(baseState({ description: '' }));
		expect(spec.description).toBeUndefined();
	});

	it('inverseTransfer mirrors transfer', () => {
		const spec = buildSpec(
			baseState({
				transferOp: 'truncation',
				truncationDepth: 2,
				truncationTailHandling: 'drop',
				truncationSeparator: '-',
			}),
		);
		expect(spec.inverseTransfer).toEqual(spec.transfer);
	});
});

describe('entriesPopulated', () => {
	it('false when both empty', () => {
		expect(entriesPopulated(baseState({ folderEntry: '', tagEntry: '' }))).toBe(false);
	});
	it('false when folder empty', () => {
		expect(entriesPopulated(baseState({ folderEntry: '', tagEntry: 'tag' }))).toBe(false);
	});
	it('false when tag empty', () => {
		expect(entriesPopulated(baseState({ folderEntry: 'F', tagEntry: '' }))).toBe(false);
	});
	it('false when whitespace only', () => {
		expect(entriesPopulated(baseState({ folderEntry: '  ', tagEntry: '\t' }))).toBe(false);
	});
	it('true when both non-empty', () => {
		expect(entriesPopulated(baseState({ folderEntry: 'F', tagEntry: 't' }))).toBe(true);
	});
});

describe('isFormValid', () => {
	it('valid with name, folder entry, tag entry', () => {
		const result = isFormValid(baseState());
		expect(result.valid).toBe(true);
		expect(result.missing).toEqual([]);
	});
	it('reports missing name', () => {
		const result = isFormValid(baseState({ name: '' }));
		expect(result.valid).toBe(false);
		expect(result.missing).toContain('name');
	});
	it('reports all three missing fields', () => {
		const result = isFormValid(
			baseState({ name: '', folderEntry: '', tagEntry: '' }),
		);
		expect(result.valid).toBe(false);
		expect(result.missing.length).toBe(3);
	});
});

describe('detectWarnings', () => {
	it('flags marker-only + pre-coordinated as contradictory', () => {
		const warnings = detectWarnings(
			baseState({ transferOp: 'marker-only', tagCoordination: 'pre-coordinated' }),
		);
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings[0].field).toBe('tagCoordination');
		expect(warnings[0].message).toContain('marker-only');
		expect(warnings[0].fix).toBeDefined();
	});

	it('marker-only + flat-keyword is OK', () => {
		const warnings = detectWarnings(
			baseState({ transferOp: 'marker-only', tagCoordination: 'flat-keyword' }),
		);
		expect(warnings.find((w) => w.field === 'tagCoordination')).toBeUndefined();
	});

	it('flags post-coordination transfer paired with non-post-coordinated vocabulary', () => {
		const warnings = detectWarnings(
			baseState({ transferOp: 'post-coordination', tagCoordination: 'pre-coordinated' }),
		);
		expect(warnings.length).toBeGreaterThan(0);
		expect(warnings[0].message).toContain('post-coordination');
	});

	it('post-coordination + post-coordinated vocabulary is OK', () => {
		const warnings = detectWarnings(
			baseState({ transferOp: 'post-coordination', tagCoordination: 'post-coordinated' }),
		);
		expect(warnings.find((w) => w.message.includes('post-coordination'))).toBeUndefined();
	});

	it('flags tag entry missing prefix marker', () => {
		const warnings = detectWarnings(
			baseState({
				tagEntry: 'inbox',
				tagPrefixMarker: '-',
			}),
		);
		const w = warnings.find((x) => x.field === 'tagEntry');
		expect(w).toBeDefined();
		expect(w?.message).toContain('-');
		expect(w?.fix).toBeDefined();
	});

	it('does not flag when tag entry starts with prefix marker', () => {
		const warnings = detectWarnings(
			baseState({
				tagEntry: '-inbox',
				tagPrefixMarker: '-',
			}),
		);
		expect(warnings.find((x) => x.field === 'tagEntry')).toBeUndefined();
	});

	it('fix function mutates state correctly (marker-only contradiction)', () => {
		const state = baseState({
			transferOp: 'marker-only',
			tagCoordination: 'pre-coordinated',
		});
		const warnings = detectWarnings(state);
		expect(warnings.length).toBeGreaterThan(0);
		warnings[0].fix?.apply(state);
		expect(state.tagCoordination).toBe('flat-keyword');
	});

	it('fix function mutates state correctly (prepend marker)', () => {
		const state = baseState({ tagEntry: 'inbox', tagPrefixMarker: '-' });
		const warnings = detectWarnings(state);
		const fix = warnings.find((w) => w.field === 'tagEntry')?.fix;
		fix?.apply(state);
		expect(state.tagEntry).toBe('-inbox');
	});
});

describe('populateFromRule', () => {
	const baseRule = (overrides: Partial<MappingRule> = {}): MappingRule => ({
		id: 'r1',
		name: 'r1',
		enabled: true,
		priority: 100,
		direction: 'bidirectional',
		options: {
			createFolders: true,
			addTags: true,
			removeOrphanedTags: false,
			syncOnFileCreate: true,
			syncOnFileMove: true,
			syncOnFileRename: true,
		},
		...overrides,
	});

	it('uses typed (Layer 2) fields when present', () => {
		const state = populateFromRule(
			baseRule({
				folder: {
					axes: ['capture'],
					scheme: 'hierarchical',
					naming: 'word',
					subdivisionDepth: 'unbounded',
					siblingUniformity: 'unique',
				},
				tag: {
					axis: 'capture',
					coordination: 'flat-keyword',
					prefixMarker: '-',
					authority: 'mutual',
				},
				transfer: { op: 'marker-only', marker: '-clip' },
				folderEntryPoint: 'Capture/Clips',
				tagEntryPoint: '-clip',
			}),
		);
		expect(state.axis).toBe('capture');
		expect(state.transferOp).toBe('marker-only');
		expect(state.markerOnlyMarker).toBe('-clip');
		expect(state.tagCoordination).toBe('flat-keyword');
		expect(state.tagPrefixMarker).toBe('-');
	});

	it('falls back to inference for legacy regex rules', () => {
		// inferTypedModel returns identity for a bare folderEntryPoint+tagEntryPoint
		const state = populateFromRule(
			baseRule({
				folderPattern: '^Projects/(.+)$',
				folderEntryPoint: 'Projects',
				tagPattern: '^projects/(.+)$',
				tagEntryPoint: 'projects',
			}),
		);
		// folderEntry should be set even without typed fields
		expect(state.folderEntry).toBe('Projects');
		expect(state.tagEntry).toBe('projects');
	});

	it('preserves rule id, name, priority, direction, enabled', () => {
		const state = populateFromRule(
			baseRule({
				id: 'rule-42',
				name: 'My rule',
				priority: 5,
				direction: 'folder-to-tag',
				enabled: false,
			}),
		);
		expect(state.id).toBe('rule-42');
		expect(state.name).toBe('My rule');
		expect(state.priority).toBe(5);
		expect(state.direction).toBe('folder-to-tag');
		expect(state.enabled).toBe(false);
	});
});
