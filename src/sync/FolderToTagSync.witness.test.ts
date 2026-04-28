/**
 * Tests for the F3 frontmatter witness — verifies the YAML block format,
 * parse round-trip, and orphan-cleanup integration. Pure unit tests on the
 * standalone helpers (no Obsidian dep).
 */

import { describe, expect, test } from 'bun:test';
import { injectWitness, parseWitness } from './frontmatterWitness';

describe('F3 — frontmatter witness inject + parse', () => {
	const witness = {
		origin: '0 - Tasks, Planning/Q1/note.md',
		ruleId: 'ent-tasks-planning',
		tags: ['0-tasks-planning/Q1/note.md'],
		timestamp: '2026-04-28T12:00:00.000Z',
	};

	test('injects fts: block into empty frontmatter', () => {
		const out = injectWitness('', witness);
		expect(out).toContain('fts:');
		expect(out).toContain(`origin: "${witness.origin}"`);
		expect(out).toContain(`ruleId: "${witness.ruleId}"`);
		expect(out).toContain(`tags:`);
		expect(out).toContain(`- "${witness.tags[0]}"`);
	});

	test('appends fts: block to non-empty frontmatter without fts:', () => {
		const fm = 'title: My Note\ntags:\n  - existing-tag';
		const out = injectWitness(fm, witness);
		expect(out).toContain('title: My Note');
		expect(out).toContain('existing-tag');
		expect(out).toContain('fts:');
	});

	test('replaces existing fts: block instead of duplicating', () => {
		const initial = injectWitness('', witness);
		const updatedWitness = { ...witness, origin: 'NEW PATH' };
		const out = injectWitness(initial, updatedWitness);
		expect(out).toContain(`origin: "NEW PATH"`);
		// Should NOT contain the original origin
		expect(out).not.toContain(`origin: "${witness.origin}"`);
		// Only one `fts:` block
		expect(out.match(/^fts:/gm)?.length).toBe(1);
	});

	test('round-trip: inject then parse recovers the witness data', () => {
		const fm = injectWitness('title: X', witness);
		const parsed = parseWitness(fm);
		expect(parsed).not.toBeNull();
		expect(parsed!.origin).toBe(witness.origin);
		expect(parsed!.ruleId).toBe(witness.ruleId);
		expect(parsed!.tags).toEqual(witness.tags);
	});

	test('parses witness with multi-tag list', () => {
		const w = {
			...witness,
			tags: ['0-tasks-planning/X', 'related/topic'],
		};
		const fm = injectWitness('', w);
		const parsed = parseWitness(fm);
		expect(parsed!.tags).toEqual(['0-tasks-planning/X', 'related/topic']);
	});

	test('returns null when no fts: block present', () => {
		expect(parseWitness('')).toBeNull();
		expect(parseWitness('title: just a regular note')).toBeNull();
		expect(parseWitness('tags:\n  - just-a-tag')).toBeNull();
	});

	test('handles quotes inside origin path (escape pass-through)', () => {
		const w = { ...witness, origin: 'path with "quotes"' };
		const fm = injectWitness('', w);
		const parsed = parseWitness(fm);
		expect(parsed!.origin).toBe('path with "quotes"');
	});
});

describe('F3 — witness preserves frontmatter structure', () => {
	test('does not break adjacent tags: block', () => {
		const fm = 'tags:\n  - existing\n  - other';
		const out = injectWitness(fm, {
			origin: 'X',
			ruleId: 'r',
			tags: ['witness-tag'],
			timestamp: 't',
		});
		// tags: section preserved
		expect(out).toContain('- existing');
		expect(out).toContain('- other');
		// fts: appended
		expect(out).toContain('fts:');
	});

	test('multiple updates do not corrupt the block', () => {
		let fm = injectWitness('title: test', {
			origin: 'A', ruleId: 'r', tags: ['x'], timestamp: 't1',
		});
		fm = injectWitness(fm, {
			origin: 'B', ruleId: 'r', tags: ['y'], timestamp: 't2',
		});
		fm = injectWitness(fm, {
			origin: 'C', ruleId: 'r', tags: ['z'], timestamp: 't3',
		});
		const parsed = parseWitness(fm);
		expect(parsed!.origin).toBe('C');
		expect(parsed!.tags).toEqual(['z']);
		// Single fts: block, not three
		expect(fm.match(/^fts:/gm)?.length).toBe(1);
	});
});
