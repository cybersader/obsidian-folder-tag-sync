import { describe, expect, test } from 'bun:test';
import { previewRule } from './rulePreview';
import { deriveRule } from './derive';
import type { TypedRuleSpec } from '../types/typed';

const baseOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

function spec(overrides: Partial<TypedRuleSpec>): TypedRuleSpec {
	return {
		id: 'test',
		name: 'test',
		priority: 10,
		direction: 'bidirectional',
		enabled: true,
		folder: { axes: ['work'], scheme: 'hierarchical', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'unique' },
		tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' },
		transfer: { op: 'identity' },
		inverseTransfer: { op: 'identity' },
		folderEntry: 'Projects',
		tagEntry: 'projects',
		options: baseOptions,
		...overrides,
	};
}

const SAMPLE_VAULT = [
	'Projects/Q4-Roadmap',
	'Projects/Launch',
	'Projects/Research',
	'Areas/Health',
	'Areas/Finance',
	'Resources/Tools',
	'Archive/2023',
	'Capture/Inbox',
	'Capture/Clips/Web',
	'Capture/Clips/Web/React',
];

describe('previewRule — identity', () => {
	const rule = deriveRule(spec({}));

	test('reports matches and emitted tags', () => {
		const p = previewRule(rule, SAMPLE_VAULT);
		expect(p.matchCount).toBe(3);
		expect(p.matchedFolders).toEqual([
			'Projects/Launch',
			'Projects/Q4-Roadmap',
			'Projects/Research',
		]);
		expect(p.emittedTags).toEqual([
			'#projects/launch',
			'#projects/q4-roadmap',
			'#projects/research',
		]);
	});

	test('samples cap at maxSamples', () => {
		const p = previewRule(rule, SAMPLE_VAULT, { maxSamples: 2 });
		expect(p.samples.length).toBe(2);
		expect(p.matchedFolders.length).toBe(3); // matchedFolders is uncapped
	});

	test('non-matching vault → 0 matches', () => {
		const p = previewRule(rule, ['Other/Tree', 'Stuff/Here']);
		expect(p.matchCount).toBe(0);
		expect(p.emittedTags).toEqual([]);
	});
});

describe('previewRule — marker-only', () => {
	const rule = deriveRule(
		spec({
			folderEntry: 'Capture/Inbox',
			tagEntry: '-inbox',
			folder: { axes: ['capture'], scheme: 'container-only', naming: 'word', subdivisionDepth: 0, siblingUniformity: 'unique' },
			tag: { axis: 'capture', coordination: 'flat-keyword', prefixMarker: '-', authority: 'tag-authoritative' },
			transfer: { op: 'marker-only', marker: '-inbox' },
			inverseTransfer: { op: 'marker-only', marker: '-inbox' },
		}),
	);

	test('matches the entry folder + every subfolder, all emit the same marker', () => {
		const p = previewRule(rule, [
			'Capture/Inbox',
			'Capture/Inbox/today',
			'Capture/Inbox/sub/deeper',
			'Other/Tree',
		]);
		expect(p.matchCount).toBe(3);
		expect(p.emittedTags).toEqual(['#-inbox']);
	});
});

describe('previewRule — opaque (no emission, by design)', () => {
	const rule = deriveRule(
		spec({
			folderEntry: 'Attachments',
			tagEntry: '',
			tag: { axis: 'system', coordination: 'flat-keyword', prefixMarker: null, authority: 'tag-authoritative' },
			transfer: { op: 'opaque' },
			inverseTransfer: { op: 'opaque' },
		}),
	);

	test('opaque rule reports rule-applicability (matchCount > 0) even though emittedTags is empty', () => {
		// matchCount semantic: "this rule applies to N folders". For opaque,
		// the rule applies (gates folders for filing purposes) but emits no
		// tag. opaqueByDesign distinguishes "intentionally produces nothing"
		// from "misconfigured pattern matches nothing".
		const p = previewRule(rule, [
			'Attachments/screenshots',
			'Attachments/diagrams',
			'Other/Tree',
		]);
		expect(p.matchCount).toBe(2); // both Attachments/* folders
		expect(p.emittedTags).toEqual([]);
		expect(p.opaqueByDesign).toBe(true);
	});

	test('non-opaque rule with 0 matches: opaqueByDesign false (likely misconfigured)', () => {
		const identityRule = deriveRule(spec({ folderEntry: 'NoSuchFolder' }));
		const p = previewRule(identityRule, ['Other/Tree']);
		expect(p.matchCount).toBe(0);
		expect(p.opaqueByDesign).toBe(false);
	});
});

describe('previewRule — truncation aggregate (the user\'s compound case)', () => {
	const rule = deriveRule(
		spec({
			folderEntry: 'Capture/Clips',
			tagEntry: '-clip',
			folder: { axes: ['capture'], scheme: 'hierarchical', naming: 'word', subdivisionDepth: 2, siblingUniformity: 'unique' },
			tag: { axis: 'capture', coordination: 'pre-coordinated', prefixMarker: '-', authority: 'tag-authoritative' },
			transfer: { op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' },
		}),
	);

	test('preview shows "stack the tail" behavior for deep paths', () => {
		const p = previewRule(rule, [
			'Capture/Clips/Web',
			'Capture/Clips/Web/Tutorials',
			'Capture/Clips/Web/Tutorials/React/Hooks',
		]);
		// All 3 match; the deepest one stacks the tail
		expect(p.matchCount).toBe(3);
		expect(p.emittedTags).toContain('#-clip/web');
		expect(p.emittedTags).toContain('#-clip/web/tutorials');
		expect(p.emittedTags).toContain('#-clip/web/tutorials/react-hooks');
	});
});

describe('previewRule — post-coordination produces multiple tags per folder', () => {
	const rule = deriveRule(
		spec({
			folderEntry: 'Research',
			tagEntry: '',
			folder: { axes: ['work'], scheme: 'faceted', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'unique' },
			tag: { axis: 'relation', coordination: 'post-coordinated', prefixMarker: null, authority: 'tag-authoritative' },
			transfer: { op: 'post-coordination' },
			inverseTransfer: { op: 'flattening-to-leaf' },
		}),
	);

	test('each matched folder contributes N tags', () => {
		const p = previewRule(rule, [
			'Research/Cognition/Kahneman/2024',
			'Research/Robotics/Karpathy/2023',
		]);
		expect(p.matchCount).toBe(2);
		// Each folder produces 3 facet-tags
		expect(p.emittedTags).toContain('#cognition');
		expect(p.emittedTags).toContain('#kahneman');
		expect(p.emittedTags).toContain('#2024');
		expect(p.emittedTags).toContain('#robotics');
		expect(p.emittedTags).toContain('#karpathy');
		expect(p.emittedTags).toContain('#2023');
		expect(p.samples[0].tags.length).toBe(3); // first folder, 3 tags
	});
});

describe('previewRule — invalid regex resilience', () => {
	test('returns invalidRegex instead of throwing on broken folderPattern', () => {
		const rule = deriveRule(spec({}));
		// Stomp the derived folderPattern with an unparseable regex
		const broken = { ...rule, folderPattern: '[invalid(' };

		// Must not throw — this is a UI-facing operation; a config mistake
		// should never crash the panel.
		const p = previewRule(broken, SAMPLE_VAULT);

		expect(p.invalidRegex).toBeDefined();
		expect(p.invalidRegex?.which).toBe('folder');
		expect(p.invalidRegex?.error.toLowerCase()).toContain('invalid');
		expect(p.matchCount).toBe(0);
		expect(p.matchedFolders).toEqual([]);
		expect(p.samples).toEqual([]);
		expect(p.emittedTags).toEqual([]);
	});

	test('valid rule does not set invalidRegex', () => {
		const rule = deriveRule(spec({}));
		const p = previewRule(rule, SAMPLE_VAULT);
		expect(p.invalidRegex).toBeUndefined();
	});

	test('invalid regex on opaque rule still surfaces (rather than masking the issue)', () => {
		const rule = deriveRule(
			spec({ transfer: { op: 'opaque' }, inverseTransfer: { op: 'opaque' } }),
		);
		const broken = { ...rule, folderPattern: '*invalid' };
		const p = previewRule(broken, SAMPLE_VAULT);
		expect(p.invalidRegex).toBeDefined();
		expect(p.matchCount).toBe(0);
	});

	test('opaqueByDesign reflects rule shape even when regex is invalid', () => {
		const rule = deriveRule(
			spec({ transfer: { op: 'opaque' }, inverseTransfer: { op: 'opaque' } }),
		);
		const broken = { ...rule, folderPattern: '[invalid(' };
		const p = previewRule(broken, SAMPLE_VAULT);
		expect(p.opaqueByDesign).toBe(true);
	});
});
