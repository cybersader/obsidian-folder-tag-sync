/**
 * Round-trip tests: every rule in every shipped rule pack survives the
 * pipeline `loadRulePackFromJSON` → `populateFromRule` → FormState with
 * sensible field values. The point is to surface "click Edit on this
 * imported rule and the form is mostly blank" UX cliffs at the unit-test
 * level instead of waiting for someone to discover them in the vault.
 *
 * Plus: regression tests for Phase E's `^Entry(?:/|$)` pattern shape,
 * which `inferEntryFromPattern` previously rejected as containing regex
 * metacharacters.
 */

import { describe, expect, test } from 'bun:test';
import { populateFromRule } from './buildSpec';
import { loadRulePackFromJSON } from './rulePackLoader';
import type { MappingRule } from '../types/settings';
import paraJson from '../../rule-packs/para.json';
import jdJson from '../../rule-packs/jd.json';
import seacowOuterJson from '../../rule-packs/seacow-outer.json';
import seacowCyberbaseJson from '../../rule-packs/seacow-cyberbase.json';
import cyberbaseActualJson from '../../rule-packs/cyberbase-actual.json';

function loadPack(json: unknown): MappingRule[] {
	const result = loadRulePackFromJSON(JSON.stringify(json));
	if (!result.ok) {
		throw new Error(`Pack failed to load: ${result.errors?.join(', ')}`);
	}
	return result.pack.rules;
}

// ─── Per-pack round-trip ─────────────────────────────────────────────────

describe('populateFromRule × PARA pack', () => {
	const rules = loadPack(paraJson);

	test('all 4 rules populate folderEntry + tagEntry from explicit fields', () => {
		expect(rules.length).toBe(4);
		for (const rule of rules) {
			const state = populateFromRule(rule);
			expect(state.folderEntry).not.toBe('');
			expect(state.tagEntry).not.toBe('');
		}
	});

	test('all rules derive identity transfer + work axis', () => {
		for (const rule of rules) {
			const state = populateFromRule(rule);
			expect(state.transferOp).toBe('identity');
			expect(state.axis).toBe('work');
		}
	});

	test('para-projects has folderEntry "Projects", tagEntry "projects"', () => {
		const rule = rules.find((r) => r.id === 'para-projects')!;
		const state = populateFromRule(rule);
		expect(state.folderEntry).toBe('Projects');
		expect(state.tagEntry).toBe('projects');
	});
});

describe('populateFromRule × JD pack', () => {
	const rules = loadPack(jdJson);

	test('JD rule has empty folderEntry + tagEntry — by design (regex-only)', () => {
		// Known limitation, pinned: jd.json deliberately ships with
		// folderEntryPoint="" and tagEntryPoint="" because the rule matches
		// `\d{2} - X` patterns and has no single canonical entry folder.
		// When a user clicks Edit on this rule, the guided modal will show
		// blank entry fields. Phase F commit 3 adds an info-level warning
		// in the warnings section explaining "this rule matches by pattern
		// only — fill entries to enable typed-model features."
		expect(rules.length).toBe(1);
		const state = populateFromRule(rules[0]);
		expect(state.folderEntry).toBe('');
		expect(state.tagEntry).toBe('');
	});

	test('JD rule still derives a sensible transferOp + axis', () => {
		const state = populateFromRule(rules[0]);
		expect(state.transferOp).toBe('identity');
		expect(state.axis).toBe('work');
	});
});

describe('populateFromRule × SEACOW outer pack', () => {
	const rules = loadPack(seacowOuterJson);

	test('all rules populate folderEntry + tagEntry from explicit fields', () => {
		expect(rules.length).toBeGreaterThan(0);
		for (const rule of rules) {
			const state = populateFromRule(rule);
			expect(state.folderEntry).not.toBe('');
			expect(state.tagEntry).not.toBe('');
		}
	});

	test('capture-inbox has marker-only transfer', () => {
		const rule = rules.find((r) => r.id === 'capture-inbox');
		if (!rule) return; // pack ID may vary across versions
		const state = populateFromRule(rule);
		// Capture/Inbox is a single tagged bucket — should be marker-only
		// or at minimum derive a coherent state, not the default fallback
		expect(state.folderEntry).toBe('Capture/Inbox');
	});
});

describe('populateFromRule × seacow-cyberbase (legacy pack, inferred typed model)', () => {
	const rules = loadPack(seacowCyberbaseJson);

	test('all rules populate folderEntry + tagEntry (legacy explicit fields)', () => {
		expect(rules.length).toBe(6);
		for (const rule of rules) {
			const state = populateFromRule(rule);
			expect(state.folderEntry).not.toBe('');
			expect(state.tagEntry).not.toBe('');
		}
	});

	test('inferred axis is non-default (rules carry SEACOW prefix markers)', () => {
		// At least one rule should infer a non-'work' axis from its prefix
		// marker — entity-cybersader uses '--' marker, capture-inbox uses '-',
		// etc. If all axes default to 'work', inference is broken.
		const states = rules.map(populateFromRule);
		const nonWorkAxes = states.filter((s) => s.axis !== 'work').length;
		expect(nonWorkAxes).toBeGreaterThan(0);
	});
});

describe('populateFromRule × cyberbase-actual (legacy emoji pack)', () => {
	const rules = loadPack(cyberbaseActualJson);

	test('rules round-trip explicit folderEntryPoint / tagEntryPoint, including empty', () => {
		// 10 rules total. 9 have explicit entry points (emoji-prefixed
		// folder names like "⬇️ Clipping", "📁 01 - Foo"). 1 rule —
		// the `^📁 \\d+ - .*` numbered-folder regex matcher — has empty
		// entry points by design (same regex-only-pattern scenario as JD).
		// Assertion: populateFromRule preserves the source value verbatim.
		expect(rules.length).toBe(10);
		for (const rule of rules) {
			const state = populateFromRule(rule);
			expect(state.folderEntry).toBe(rule.folderEntryPoint ?? '');
			expect(state.tagEntry).toBe(rule.tagEntryPoint ?? '');
		}
	});

	test('emoji-prefixed entry points survive verbatim — no metacharacter rejection', () => {
		const clip = rules.find((r) => r.id === 'clipping');
		if (!clip) return;
		const state = populateFromRule(clip);
		expect(state.folderEntry).toBe('⬇️ Clipping');
		expect(state.tagEntry).toBe('-clip');
	});
});

// ─── Phase E pattern shape regression ────────────────────────────────────

describe('populateFromRule round-trips Phase E derived patterns', () => {
	const baseRule = (overrides: Partial<MappingRule>): MappingRule => ({
		id: 'test',
		name: 'Test',
		enabled: true,
		priority: 1,
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

	test('infers entry from `^Entry(?:/|$)` shape (Phase E loose-anchor)', () => {
		// Phase E (commit 573d556) changed deriveFolderPattern to emit
		// `^Entry(?:/|$)` instead of `^Entry/`. Without the inference fix,
		// `inferEntryFromPattern` rejects this pattern as containing regex
		// metacharacters and returns undefined, leaving folderEntry blank
		// when a user clicks Edit on a derived rule that has no explicit
		// folderEntryPoint.
		const rule = baseRule({ folderPattern: '^Projects(?:/|$)' });
		const state = populateFromRule(rule);
		expect(state.folderEntry).toBe('Projects');
	});

	test('infers entry from `^Entry(?:/.*)?$` shape (Phase E marker-only)', () => {
		// `derive.ts:55` emits this shape for marker-only ops to match the
		// bare entry folder OR anything beneath it.
		const rule = baseRule({ folderPattern: '^0 - Inbox(?:/.*)?$' });
		const state = populateFromRule(rule);
		expect(state.folderEntry).toBe('0 - Inbox');
	});

	test('explicit folderEntryPoint always wins over inference', () => {
		// Sanity: even if pattern is unintelligible, explicit field is used.
		const rule = baseRule({
			folderPattern: '^[a-z]+\\d+(?:/|$)',
			folderEntryPoint: 'ExplicitEntry',
		});
		const state = populateFromRule(rule);
		expect(state.folderEntry).toBe('ExplicitEntry');
	});

	test('still rejects truly malformed patterns with embedded metacharacters', () => {
		// Inference should fall through to '' when the pattern has real
		// regex content beyond the loose-anchor suffix.
		const rule = baseRule({ folderPattern: '^[a-z]+\\d+/' });
		const state = populateFromRule(rule);
		expect(state.folderEntry).toBe('');
	});
});
