/**
 * Acceptance tests for deriveRule().
 *
 * The core proof of Phase 2: given typed specs for the 6 canonical
 * seacow-cyberbase.json rules, derivation produces the same
 * folderEntryPoint, tagEntryPoint, folderPattern/tagPattern, and transform
 * configs that the hand-authored rules carry today. If this passes, a user
 * can author their rule pack in typed form and the plugin will drive sync
 * identically to hand-written regex.
 *
 * Plus a dedicated test group for `truncation.tailHandling` covering the
 * "preserve N deep, stack the rest" compound case the user asked about.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import {
	deriveRule,
	deriveFolderPattern,
	deriveTagPattern,
	deriveFolderTransforms,
	deriveTagTransforms,
	deriveCardinality,
	deriveBijective,
	escapeRegex,
} from './derive';
import type { TypedRuleSpec } from '../types/typed';

// ─── Shared helpers ───────────────────────────────────────────────────────

const baseOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

function stripUndefined<T extends Record<string, unknown>>(obj: T): Partial<T> {
	const out: Record<string, unknown> = {};
	for (const [k, v] of Object.entries(obj)) {
		if (v !== undefined) out[k] = v;
	}
	return out as Partial<T>;
}

// ─── Acceptance: 6 SEACOW rules ──────────────────────────────────────────

describe('acceptance: derive matches hand-written seacow-cyberbase.json', () => {
	const packPath = join(__dirname, '../../rule-packs/seacow-cyberbase.json');
	const pack = JSON.parse(readFileSync(packPath, 'utf-8')) as {
		rules: Array<{
			id: string;
			tagPattern?: string;
			tagEntryPoint?: string;
			folderPattern?: string;
			folderEntryPoint?: string;
			tagTransforms?: Record<string, unknown>;
			folderTransforms?: Record<string, unknown>;
			direction: string;
		}>;
	};

	// Typed specs for each rule — what a user would author in Layer 2.
	const specs: Record<string, TypedRuleSpec> = {
		'capture-clip': {
			id: 'capture-clip',
			name: 'CAPTURE: Clip folder sync',
			priority: 1,
			direction: 'tag-to-folder',
			enabled: true,
			folder: {
				axes: ['capture'],
				scheme: 'hierarchical',
				naming: 'word',
				subdivisionDepth: 2,
				siblingUniformity: 'unique',
			},
			tag: { axis: 'capture', coordination: 'pre-coordinated', prefixMarker: '-', authority: 'tag-authoritative' },
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
			folderEntry: 'Capture/Clips',
			tagEntry: '-clip',
			options: baseOptions,
		},
		'capture-inbox': {
			id: 'capture-inbox',
			name: 'CAPTURE: Inbox flat tag',
			priority: 2,
			direction: 'tag-to-folder',
			enabled: true,
			folder: {
				axes: ['capture'],
				scheme: 'container-only',
				naming: 'word',
				subdivisionDepth: 0,
				siblingUniformity: 'unique',
			},
			tag: { axis: 'capture', coordination: 'flat-keyword', prefixMarker: '-', authority: 'tag-authoritative' },
			transfer: { op: 'marker-only', marker: '-inbox' },
			inverseTransfer: { op: 'marker-only', marker: '-inbox' },
			folderEntry: 'Capture/Inbox',
			tagEntry: '-inbox',
			options: baseOptions,
		},
		'entity-cybersader': {
			id: 'entity-cybersader',
			name: 'ENTITY: Cybersader work structure',
			priority: 3,
			direction: 'bidirectional',
			enabled: true,
			folder: {
				axes: ['entity', 'work'],
				scheme: 'authority-root',
				naming: 'word',
				subdivisionDepth: 'unbounded',
				siblingUniformity: 'parallel',
			},
			tag: { axis: 'entity', coordination: 'pre-coordinated', prefixMarker: '--', authority: 'mutual' },
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
			folderEntry: 'Entity/Cybersader',
			tagEntry: '--cybersader',
			options: baseOptions,
		},
		'output-public-taxonomy': {
			id: 'output-public-taxonomy',
			name: 'OUTPUT: Public Taxonomy structure',
			priority: 4,
			direction: 'bidirectional',
			enabled: true,
			folder: {
				axes: ['output'],
				scheme: 'hierarchical',
				naming: 'word',
				subdivisionDepth: 'unbounded',
				siblingUniformity: 'unique',
			},
			tag: { axis: 'output', coordination: 'pre-coordinated', prefixMarker: '_', authority: 'mutual' },
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
			folderEntry: 'Output/Public',
			tagEntry: '_publicTaxonomy',
			options: baseOptions,
		},
		'output-main-public': {
			id: 'output-main-public',
			name: 'OUTPUT: Main public facing (_/)',
			priority: 5,
			direction: 'bidirectional',
			enabled: true,
			folder: {
				axes: ['output'],
				scheme: 'hierarchical',
				naming: 'word',
				subdivisionDepth: 'unbounded',
				siblingUniformity: 'unique',
			},
			tag: { axis: 'output', coordination: 'pre-coordinated', prefixMarker: '_', authority: 'mutual' },
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
			folderEntry: 'Output/Main',
			tagEntry: '_',
			transformOverrides: {
				folderTransforms: { numberPrefixHandling: 'strip' },
				tagTransforms: { numberPrefixHandling: 'strip' },
			},
			options: baseOptions,
		},
		'system-templates': {
			id: 'system-templates',
			name: 'SYSTEM: Templates and config',
			priority: 6,
			direction: 'bidirectional',
			enabled: true,
			folder: {
				axes: ['system'],
				scheme: 'container-only',
				naming: 'word',
				subdivisionDepth: 'unbounded',
				siblingUniformity: 'unique',
			},
			tag: { axis: 'system', coordination: 'pre-coordinated', prefixMarker: '/', authority: 'mutual' },
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
			folderEntry: 'System',
			tagEntry: '/',
			transformOverrides: {
				// System rules keep caseTransform minimal — no emoji or number fields in the hand-written pack
				folderTransforms: { emojiHandling: undefined, numberPrefixHandling: undefined },
				tagTransforms: { emojiHandling: undefined, numberPrefixHandling: undefined },
			},
			options: baseOptions,
		},
	};

	for (const handRule of pack.rules) {
		const spec = specs[handRule.id];
		if (!spec) continue;

		describe(handRule.id, () => {
			const derived = deriveRule(spec);

			test('entry points match', () => {
				expect(derived.folderEntryPoint).toBe(handRule.folderEntryPoint ?? undefined);
				expect(derived.tagEntryPoint).toBe(handRule.tagEntryPoint ?? undefined);
			});

			if (handRule.tagPattern !== undefined) {
				test('tagPattern matches', () => {
					expect(derived.tagPattern).toBe(handRule.tagPattern);
				});
			}

			if (handRule.folderPattern !== undefined) {
				test('folderPattern matches', () => {
					expect(derived.folderPattern).toBe(handRule.folderPattern);
				});
			}

			test('folderTransforms contains every hand-written field with matching values', () => {
				if (!handRule.folderTransforms) return;
				for (const [k, v] of Object.entries(handRule.folderTransforms)) {
					expect(
						(derived.folderTransforms as unknown as Record<string, unknown>)[k],
					).toBe(v as never);
				}
			});

			test('tagTransforms contains every hand-written field with matching values', () => {
				if (!handRule.tagTransforms) return;
				for (const [k, v] of Object.entries(handRule.tagTransforms)) {
					expect(
						(derived.tagTransforms as unknown as Record<string, unknown>)[k],
					).toBe(v as never);
				}
			});
		});
	}
});

// ─── Truncation tailHandling — compound case ──────────────────────────────

describe('truncation.tailHandling (the "stack the tail" compound case)', () => {
	const baseSpec: Omit<TypedRuleSpec, 'transfer' | 'inverseTransfer'> = {
		id: 'clip-depth2',
		name: 'clip-depth2',
		priority: 10,
		direction: 'tag-to-folder',
		enabled: true,
		folder: {
			axes: ['capture'],
			scheme: 'hierarchical',
			naming: 'word',
			subdivisionDepth: 2,
			siblingUniformity: 'unique',
		},
		tag: { axis: 'capture', coordination: 'pre-coordinated', prefixMarker: '-', authority: 'tag-authoritative' },
		folderEntry: 'Capture/Clips',
		tagEntry: '-clip',
		options: baseOptions,
	};

	test("tailHandling: 'drop' produces a depth-capped pattern that rejects deeper paths", () => {
		const spec: TypedRuleSpec = {
			...baseSpec,
			transfer: { op: 'truncation', depth: 2, tailHandling: 'drop' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'drop' },
		};
		const pat = deriveTagPattern(spec);
		const re = new RegExp(pat);
		expect(re.test('-clip/web')).toBe(true);
		expect(re.test('-clip/web/react')).toBe(true);
		expect(re.test('-clip/web/react/hooks')).toBe(false); // rejected — depth exceeded
		expect(re.test('-clip/')).toBe(false); // needs at least one segment
	});

	test("tailHandling: 'aggregate' produces a loose pattern (tail handled in transform, not regex)", () => {
		const spec: TypedRuleSpec = {
			...baseSpec,
			transfer: { op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' },
		};
		const pat = deriveTagPattern(spec);
		expect(pat).toBe('^-clip/');
		expect(deriveBijective(spec.transfer, spec.inverseTransfer)).toBe(false); // aggregation is lossy
	});

	test("tailHandling: 'flatten' is lossy", () => {
		const spec: TypedRuleSpec = {
			...baseSpec,
			transfer: { op: 'truncation', depth: 2, tailHandling: 'flatten' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'flatten' },
		};
		expect(deriveBijective(spec.transfer, spec.inverseTransfer)).toBe(false);
	});

	test("tailHandling: 'drop' is bijective (no info loss)", () => {
		const spec: TypedRuleSpec = {
			...baseSpec,
			transfer: { op: 'truncation', depth: 2, tailHandling: 'drop' },
			inverseTransfer: { op: 'truncation', depth: 2, tailHandling: 'drop' },
		};
		expect(deriveBijective(spec.transfer, spec.inverseTransfer)).toBe(true);
	});
});

// ─── Unit: individual derivation functions ───────────────────────────────

describe('escapeRegex', () => {
	test('escapes regex metacharacters', () => {
		expect(escapeRegex('Capture/Clips')).toBe('Capture/Clips');
		expect(escapeRegex('-clip')).toBe('-clip');
		expect(escapeRegex('a.b*c')).toBe('a\\.b\\*c');
		expect(escapeRegex('(foo)')).toBe('\\(foo\\)');
	});
});

describe('deriveCardinality', () => {
	test('identity → 1:1', () => {
		expect(deriveCardinality({ op: 'identity' })).toBe('1:1');
	});
	test('marker-only → many:1', () => {
		expect(deriveCardinality({ op: 'marker-only', marker: 'x' })).toBe('many:1');
	});
	test('truncation drop → 1:1', () => {
		expect(deriveCardinality({ op: 'truncation', depth: 2, tailHandling: 'drop' })).toBe('1:1');
	});
	test('truncation aggregate → many:1', () => {
		expect(
			deriveCardinality({ op: 'truncation', depth: 2, tailHandling: 'aggregate', separator: '-' }),
		).toBe('many:1');
	});
	test('post-coordination → 1:many', () => {
		expect(deriveCardinality({ op: 'post-coordination' })).toBe('1:many');
	});
});

// ─── PARA + JD + ZK: coverage of identity, marker-only, and naming variations ──

describe('additional framework rules (PARA/JD/ZK shapes)', () => {
	test('PARA: Projects bucket → bidirectional identity', () => {
		const spec: TypedRuleSpec = {
			id: 'para-projects',
			name: 'PARA: Projects',
			priority: 10,
			direction: 'bidirectional',
			enabled: true,
			folder: { axes: ['work'], scheme: 'enumerative', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'parallel' },
			tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' },
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
			folderEntry: 'Projects',
			tagEntry: 'projects',
			options: baseOptions,
		};
		const r = deriveRule(spec);
		expect(r.folderPattern).toBe('^Projects(?:/|$)');
		expect(r.tagPattern).toBe('^projects/');
		expect(r.folder?.axes).toEqual(['work']);
		expect(r.bijective).toBe(true);
		expect(r.cardinality).toBe('1:1');
	});

	test('ZK: Inbox bucket → marker-only', () => {
		const spec: TypedRuleSpec = {
			id: 'zk-inbox',
			name: 'ZK: Inbox',
			priority: 10,
			direction: 'bidirectional',
			enabled: true,
			folder: { axes: ['capture'], scheme: 'container-only', naming: 'ordinal', subdivisionDepth: 0, siblingUniformity: 'parallel' },
			tag: { axis: 'capture', coordination: 'flat-keyword', prefixMarker: null, authority: 'tag-authoritative' },
			transfer: { op: 'marker-only', marker: 'zk-inbox' },
			inverseTransfer: { op: 'marker-only', marker: 'zk-inbox' },
			folderEntry: '0 - Inbox',
			tagEntry: 'zk-inbox',
			options: baseOptions,
		};
		const r = deriveRule(spec);
		expect(r.tagPattern).toBe('^zk-inbox$');
		expect(r.folderPattern).toBe('^0 - Inbox(?:/.*)?$');
		expect(r.cardinality).toBe('many:1');
		expect(r.bijective).toBe(false);
	});

	test('JD: numeric-prefix folder → identity with numberPrefixHandling: keep', () => {
		const spec: TypedRuleSpec = {
			id: 'jd-projects',
			name: 'JD: 10-Projects',
			priority: 10,
			direction: 'bidirectional',
			enabled: true,
			folder: { axes: ['work'], scheme: 'enumerative', naming: 'ordinal', subdivisionDepth: 2, siblingUniformity: 'parallel' },
			tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' },
			transfer: { op: 'identity' },
			inverseTransfer: { op: 'identity' },
			folderEntry: '10 - Projects',
			tagEntry: '10-projects',
			options: baseOptions,
		};
		const r = deriveRule(spec);
		expect(r.folderPattern).toBe('^10 - Projects(?:/|$)');
		expect(r.tagPattern).toBe('^10-projects/');
		expect(r.folderTransforms?.numberPrefixHandling).toBe('keep');
	});
});
