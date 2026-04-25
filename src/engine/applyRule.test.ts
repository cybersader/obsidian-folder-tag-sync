/**
 * Integration tests: derived rule + applyRuleForward / applyRuleInverse
 * produce the right tags and folders end-to-end.
 *
 * This is the proof that the typed model **actually drives sync** — not
 * just produces strings that happen to look right. We feed each transfer
 * op's typed spec through `deriveRule`, then through the same pipeline the
 * sync engines call (`applyRuleForward` for folder→tag, `applyRuleInverse`
 * for tag→folder), and verify the emitted tags / folders.
 *
 * The "preserve N levels, stack the rest" compound case (the user's
 * documented use case) lives here and is now covered end-to-end, not just
 * at the type level.
 */

import { describe, expect, test } from 'bun:test';
import { deriveRule } from './derive';
import { applyRuleForward, applyRuleInverse } from './applyTransfer';
import type { TypedRuleSpec } from '../types/typed';

const baseOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

function specWith(overrides: Partial<TypedRuleSpec>): TypedRuleSpec {
	return {
		id: 'test',
		name: 'Test',
		priority: 10,
		direction: 'bidirectional',
		enabled: true,
		folder: { axes: ['work'], scheme: 'hierarchical', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'unique' },
		tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' },
		transfer: { op: 'identity' },
		inverseTransfer: { op: 'identity' },
		folderEntry: 'Capture/Clips',
		tagEntry: '-clip',
		options: baseOptions,
		...overrides,
	};
}

// ─── identity ─────────────────────────────────────────────────────────────

describe('integration: identity', () => {
	const rule = deriveRule(specWith({}));

	test('forward — full path becomes tag', () => {
		const r = applyRuleForward('Capture/Clips/Web/React', rule);
		expect(r.tags).toEqual(['#-clip/web/react']);
		expect(r.lossy).toBe(false);
	});

	test('inverse — tag becomes full folder', () => {
		const r = applyRuleInverse('#-clip/web/react', rule);
		// kebab-case stays kebab on inverse since folder transforms apply (Title Case
		// normally, but for identity rules we get whatever transforms are derived)
		expect(r.folder).toBeTruthy();
		expect(r.folder).toContain('Capture/Clips/');
	});

	test('forward — non-matching path emits no tags', () => {
		const r = applyRuleForward('SomeOther/Folder', rule);
		expect(r.tags).toEqual([]);
	});
});

// ─── truncation: drop ─────────────────────────────────────────────────────

describe('integration: truncation drop (depth 2)', () => {
	const rule = deriveRule(
		specWith({
			transfer: { op: 'truncation', depth: 2, tailHandling: 'drop' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'drop' },
		}),
	);

	test('forward — depth-cap is enforced by the regex; deeper paths emit zero tags', () => {
		// Pattern matches paths up to 2 deep; deeper rejected.
		const ok = applyRuleForward('Capture/Clips/Web/React', rule);
		expect(ok.tags).toEqual(['#-clip/web/react']);

		const tooDeep = applyRuleForward('Capture/Clips/Web/React/Hooks/Detail', rule);
		expect(tooDeep.tags).toEqual([]); // pattern doesn't match, no rule application
	});

	test('forward — depth=1 still works', () => {
		const r = applyRuleForward('Capture/Clips/Web', rule);
		expect(r.tags).toEqual(['#-clip/web']);
	});
});

// ─── truncation: aggregate (the user's compound case) ────────────────────

describe('integration: truncation aggregate (depth 2, separator -) — the user\'s documented case', () => {
	const rule = deriveRule(
		specWith({
			transfer: { op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' },
		}),
	);

	test("forward — 'preserve 2 levels, stack everything deeper'", () => {
		// File at: Capture/Clips/Web/Tutorials/React/Hooks/intro.md
		// Folder path: Capture/Clips/Web/Tutorials/React/Hooks
		const r = applyRuleForward('Capture/Clips/Web/Tutorials/React/Hooks', rule);
		// Depth 2 preserved (Web, Tutorials), tail aggregated (React-Hooks).
		// Then kebab-case on each segment: web, tutorials, react-hooks.
		expect(r.tags).toEqual(['#-clip/web/tutorials/react-hooks']);
		expect(r.lossy).toBe(true); // aggregation is non-bijective
	});

	test('forward — at exactly depth 2, no aggregation needed', () => {
		const r = applyRuleForward('Capture/Clips/Web/Tutorials', rule);
		expect(r.tags).toEqual(['#-clip/web/tutorials']);
	});

	test('forward — three-level path aggregates the third', () => {
		const r = applyRuleForward('Capture/Clips/Web/Tutorials/React', rule);
		expect(r.tags).toEqual(['#-clip/web/tutorials/react']);
		// Depth budget is 2; everything beyond level 2 (so level 3 onward) goes
		// into one aggregated segment. Here the tail is just "React" alone.
	});
});

// ─── truncation: flatten ─────────────────────────────────────────────────

describe('integration: truncation flatten (depth 2)', () => {
	const rule = deriveRule(
		specWith({
			transfer: { op: 'truncation', depth: 2, tailHandling: 'flatten' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'flatten' },
		}),
	);

	test('forward — keeps depth-2 head + leaf, drops middle', () => {
		const r = applyRuleForward('Capture/Clips/Web/Tutorials/React/Hooks', rule);
		expect(r.tags).toEqual(['#-clip/web/tutorials/hooks']);
		// "React" (the middle segment between depth 2 and the leaf) is dropped.
	});
});

// ─── marker-only ──────────────────────────────────────────────────────────

describe('integration: marker-only', () => {
	const rule = deriveRule(
		specWith({
			folderEntry: 'Capture/Inbox',
			tagEntry: '-inbox',
			folder: { axes: ['capture'], scheme: 'container-only', naming: 'word', subdivisionDepth: 0, siblingUniformity: 'unique' },
			tag: { axis: 'capture', coordination: 'flat-keyword', prefixMarker: '-', authority: 'tag-authoritative' },
			transfer: { op: 'marker-only', marker: '-inbox' },
			inverseTransfer: { op: 'marker-only', marker: '-inbox' },
		}),
	);

	test('forward — every path under the entry emits the same marker', () => {
		const a = applyRuleForward('Capture/Inbox', rule);
		const b = applyRuleForward('Capture/Inbox/today', rule);
		const c = applyRuleForward('Capture/Inbox/some/nested/note', rule);
		expect(a.tags).toEqual(['#-inbox']);
		expect(b.tags).toEqual(['#-inbox']);
		expect(c.tags).toEqual(['#-inbox']);
	});

	test('forward — marker is NOT re-cased through the transform pipeline', () => {
		// `-inbox` stays `-inbox`. If the tag transform pipeline ran, the dash
		// + lowercase wouldn't survive a Title Case transform — so this is a
		// regression-protection test.
		const r = applyRuleForward('Capture/Inbox/today', rule);
		expect(r.tags[0]).toBe('#-inbox');
	});

	test('forward — non-matching path emits zero tags', () => {
		const r = applyRuleForward('Output/Main', rule);
		expect(r.tags).toEqual([]);
	});
});

// ─── promotion-to-root ────────────────────────────────────────────────────

describe('integration: promotion-to-root', () => {
	const rule = deriveRule(
		specWith({
			transfer: { op: 'promotion-to-root' },
			inverseTransfer: { op: 'promotion-to-root' },
		}),
	);

	test('forward — only first segment makes the tag', () => {
		const r = applyRuleForward('Capture/Clips/Web/React/Hooks', rule);
		expect(r.tags).toEqual(['#-clip/web']);
		expect(r.lossy).toBe(true);
	});
});

// ─── flattening-to-leaf ───────────────────────────────────────────────────

describe('integration: flattening-to-leaf', () => {
	const rule = deriveRule(
		specWith({
			transfer: { op: 'flattening-to-leaf' },
			inverseTransfer: { op: 'flattening-to-leaf' },
		}),
	);

	test('forward — only leaf segment makes the tag', () => {
		const r = applyRuleForward('Capture/Clips/Web/React/Hooks', rule);
		expect(r.tags).toEqual(['#-clip/hooks']);
		expect(r.lossy).toBe(true);
	});
});

// ─── aggregation ──────────────────────────────────────────────────────────

describe('integration: aggregation', () => {
	const rule = deriveRule(
		specWith({
			transfer: { op: 'aggregation', separator: '-' },
			inverseTransfer: { op: 'aggregation', separator: '-' },
		}),
	);

	test('forward — entire path joined into one tag segment', () => {
		const r = applyRuleForward('Capture/Clips/Web/React/Hooks', rule);
		expect(r.tags).toEqual(['#-clip/web-react-hooks']);
		expect(r.lossy).toBe(true);
	});
});

// ─── post-coordination ───────────────────────────────────────────────────

describe('integration: post-coordination', () => {
	const rule = deriveRule(
		specWith({
			folderEntry: 'Research',
			tagEntry: '',
			tag: { axis: 'relation', coordination: 'post-coordinated', prefixMarker: null, authority: 'tag-authoritative' },
			transfer: { op: 'post-coordination' },
			inverseTransfer: { op: 'post-coordination' },
		}),
	);

	test('forward — N segments → N independent flat tags', () => {
		const r = applyRuleForward('Research/Attention/2024-Q4', rule);
		expect(r.tags.length).toBe(2);
		expect(r.tags).toContain('#attention');
		expect(r.tags).toContain('#2024-q4');
		expect(r.lossy).toBe(true); // hierarchy gone
	});
});

// ─── opaque ───────────────────────────────────────────────────────────────

describe('integration: opaque', () => {
	const rule = deriveRule(
		specWith({
			folderEntry: 'Attachments',
			folder: { axes: ['system'], scheme: 'container-only', naming: 'word', subdivisionDepth: 0, siblingUniformity: 'unique' },
			transfer: { op: 'opaque' },
			inverseTransfer: { op: 'opaque' },
		}),
	);

	test('forward — folder under opaque entry emits zero tags', () => {
		const r = applyRuleForward('Attachments/image.png', rule);
		expect(r.tags).toEqual([]);
	});
});

// ─── inverse direction (tag→folder) coverage ─────────────────────────────

describe('integration: inverse — tag→folder', () => {
	test('identity: tag becomes folder path symmetrically', () => {
		const rule = deriveRule(
			specWith({
				folderEntry: 'Output/Main',
				tagEntry: '_',
				transfer: { op: 'identity' },
				inverseTransfer: { op: 'identity' },
			}),
		);
		const r = applyRuleInverse('#_/essays/on-attention', rule);
		expect(r.folder).toBeTruthy();
		expect(r.folder).toContain('Output/Main');
	});

	test('opaque inverse: tag → null folder', () => {
		const rule = deriveRule(
			specWith({
				folderEntry: 'Attachments',
				tagEntry: '',
				transfer: { op: 'opaque' },
				inverseTransfer: { op: 'opaque' },
			}),
		);
		const r = applyRuleInverse('#anything', rule);
		expect(r.folder).toBeNull();
	});
});

// ─── Backwards compat: legacy rule with no `transfer` field ───────────────

describe('legacy compatibility: rules without typed transfer behave as identity', () => {
	test('forward', () => {
		const legacyRule = {
			id: 'legacy',
			name: 'legacy',
			enabled: true,
			priority: 10,
			direction: 'bidirectional' as const,
			folderPattern: '^Projects/',
			folderEntryPoint: 'Projects',
			folderTransforms: { caseTransform: 'Title Case' as const },
			tagPattern: '^projects/',
			tagEntryPoint: 'projects',
			tagTransforms: { caseTransform: 'kebab-case' as const },
			options: baseOptions,
			// NO transfer, inverseTransfer, folder, tag, etc.
		};
		const r = applyRuleForward('Projects/Q4-Roadmap/kickoff', legacyRule);
		expect(r.tags).toEqual(['#projects/q4-roadmap/kickoff']);
		expect(r.lossy).toBe(false);
	});
});
