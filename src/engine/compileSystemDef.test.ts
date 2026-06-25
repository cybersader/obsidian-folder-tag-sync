/**
 * Golden equivalence test for the `.orgsys` format + `compileSystemDef`.
 *
 * The crux is BEHAVIORAL equivalence, not structural deep-equal: the option
 * blocks and Layer-2 metadata differ between a compiled rule and a
 * hand-written one. Instead we prove that, for a set of sample folder paths,
 * `findBestMatch` + `applyRuleForward` emit the SAME tags from:
 *   - rules A: para.orgsys → compileSystemDef
 *   - rules B: para.json   → loadRulePackFromJSON
 * (and the same for jd.orgsys vs jd.json).
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';

import { parseOrgsys, parseYamlSubset, OrgsysParseError } from './orgsys';
import { compileSystemDef } from './compileSystemDef';
import { loadRulePackFromJSON } from './rulePackLoader';
import { findBestMatch } from './ruleMatcher';
import { applyRuleForward } from './applyTransfer';
import { isTemplateRule } from './applyTemplate';
import type { MappingRule } from '../types/settings';

const PACKS = join(__dirname, '../../rule-packs');

function loadOrgsysRules(basename: string): MappingRule[] {
	const def = parseOrgsys(readFileSync(join(PACKS, basename), 'utf-8'));
	return compileSystemDef(def).rules;
}

function loadJsonRules(basename: string): MappingRule[] {
	const result = loadRulePackFromJSON(readFileSync(join(PACKS, basename), 'utf-8'));
	if (!result.ok) throw new Error(`failed to load ${basename}: ${result.errors.join('; ')}`);
	return result.pack.rules;
}

/** Folder → emitted tags via the real matcher + forward runtime. */
function forwardTags(folderPath: string, rules: MappingRule[]): string[] {
	const match = findBestMatch(folderPath, rules, {
		input: folderPath,
		matchType: 'folder',
		direction: 'folder-to-tag',
	});
	if (!match) return [];
	return applyRuleForward(folderPath, match.rule).tags;
}

// ─── Parser unit tests ─────────────────────────────────────────────────────

describe('parseOrgsys — parser', () => {
	test('reads system-level fields', () => {
		const def = parseOrgsys(`
system: para
title: PARA
version: 1.0.0
axes: [work]
anchor:
  default: root
  relocatable: false
defaults:
  direction: bidirectional
  folderCase: Title Case
  tagCase: kebab-case
  emoji: keep
slots:
  - id: bucket
    folder: "{bucket}"
    tag: "#{bucket}"
    values: [Projects, Areas]
`);
		expect(def.system).toBe('para');
		expect(def.title).toBe('PARA');
		expect(def.version).toBe('1.0.0');
		expect(def.axes).toEqual(['work']);
		expect(def.anchor).toEqual({ default: 'root', relocatable: false });
		expect(def.defaults).toEqual({
			direction: 'bidirectional',
			folderCase: 'Title Case',
			tagCase: 'kebab-case',
			emoji: 'keep',
		});
	});

	test('reads a literal slot', () => {
		const def = parseOrgsys(`
system: t
slots:
  - id: notes
    folder: Notes
    tag: "#notes"
    deepen: true
`);
		expect(def.slots).toHaveLength(1);
		expect(def.slots[0]).toEqual({ id: 'notes', folder: 'Notes', tag: '#notes', deepen: true });
	});

	test('reads a parametric slot with values', () => {
		const def = parseOrgsys(`
system: t
slots:
  - id: bucket
    folder: "{bucket}"
    tag: "#{bucket}"
    values: [Projects, Areas, Resources, Archive]
`);
		expect(def.slots[0].values).toEqual(['Projects', 'Areas', 'Resources', 'Archive']);
	});

	test('reads a Path-Lens pattern slot, unescaping the inline regex', () => {
		const def = parseOrgsys(`
system: jd
slots:
  - id: area
    folder: "{n:\\\\d{1,2}} - {name}"
    tag: "#{n}-{name}"
`);
		// YAML double-quote: "\\d" → "\d" — what compileTemplate needs.
		expect(def.slots[0].folder).toBe('{n:\\d{1,2}} - {name}');
	});

	test('keeps `#` inside a quoted tag face (not a comment)', () => {
		const m = parseYamlSubset(`tag: "#{bucket}"  # trailing comment`) as Record<string, string>;
		expect(m.tag).toBe('#{bucket}');
	});

	test('throws on missing system', () => {
		expect(() => parseOrgsys('title: nope\nslots:\n  - id: a\n    folder: A\n    tag: "#a"')).toThrow(
			OrgsysParseError,
		);
	});

	test('throws on missing slots', () => {
		expect(() => parseOrgsys('system: t')).toThrow(OrgsysParseError);
	});
});

// ─── compileSystemDef structural assertions (PARA) ─────────────────────────

describe('compileSystemDef — PARA shape', () => {
	const pack = compileSystemDef(parseOrgsys(readFileSync(join(PACKS, 'para.orgsys'), 'utf-8')));

	test('one parametric slot expands to exactly 4 rules', () => {
		expect(pack.rules).toHaveLength(4);
	});

	test('derived detection.anyOf covers Projects/Areas/Resources/Archive', () => {
		const regexes = pack.detection!.anyOf.map((s) => s.folderRegex);
		expect(regexes).toEqual(['^Projects$', '^Areas$', '^Resources$', '^Archive$']);
	});

	test('derived establish.createFolders lists the four buckets', () => {
		expect(pack.establish!.createFolders).toEqual(['Projects/', 'Areas/', 'Resources/', 'Archive/']);
	});

	test('every rule is stamped group "para@root"', () => {
		expect(pack.rules.every((r) => r.group === 'para@root')).toBe(true);
	});

	test('PARA rules lower to typed (non-template) rules', () => {
		expect(pack.rules.every((r) => !isTemplateRule(r))).toBe(true);
	});
});

// ─── Golden behavioral equivalence — PARA ──────────────────────────────────

describe('golden equivalence — para.orgsys vs para.json', () => {
	const A = loadOrgsysRules('para.orgsys');
	const B = loadJsonRules('para.json');

	const cases: Array<[string, string[]]> = [
		['Projects', ['#projects']],
		['Projects/Web/Auth', ['#projects/web/auth']],
		['Areas/Health', ['#areas/health']],
		['Resources', ['#resources']],
		['Archive/2023', ['#archive/2023']],
	];

	for (const [path, expected] of cases) {
		test(`"${path}" emits the same tags from both`, () => {
			const fromA = forwardTags(path, A);
			const fromB = forwardTags(path, B);
			expect(fromA).toEqual(fromB);
			expect(fromA).toEqual(expected); // and they are the expected, non-trivial tags
		});
	}
});

// ─── Golden behavioral equivalence — JD ────────────────────────────────────

describe('golden equivalence — jd.orgsys vs jd.json', () => {
	const A = loadOrgsysRules('jd.orgsys');
	const B = loadJsonRules('jd.json');

	const cases: Array<[string, string[]]> = [
		['10 - Projects', ['#10-projects']],
		['10 - Projects/sub', ['#10-projects/sub']],
		['2 - Notes', ['#2-notes']],
	];

	for (const [path, expected] of cases) {
		test(`"${path}" emits the same tags from both`, () => {
			const fromA = forwardTags(path, A);
			const fromB = forwardTags(path, B);
			expect(fromA).toEqual(fromB);
			expect(fromA).toEqual(expected);
		});
	}

	test('jd.orgsys lowers to a Path-Lens template rule', () => {
		expect(A).toHaveLength(1);
		expect(isTemplateRule(A[0])).toBe(true);
	});
});

// ─── Compile edge cases ────────────────────────────────────────────────────

describe('compileSystemDef — edge cases', () => {
	test('a slot with no `values` compiles to a single rule', () => {
		const pack = compileSystemDef(
			parseOrgsys(`
system: t
slots:
  - id: notes
    folder: Notes
    tag: "#notes"
`),
		);
		expect(pack.rules).toHaveLength(1);
		expect(forwardTags('Notes', pack.rules)).toEqual(['#notes']);
		expect(forwardTags('Notes/Deep/Thing', pack.rules)).toEqual(['#notes/deep/thing']);
	});

	test('deepen: true preserves the deeper tail', () => {
		const pack = compileSystemDef(
			parseOrgsys(`
system: t
slots:
  - id: notes
    folder: Notes
    tag: "#notes"
    deepen: true
`),
		);
		expect(forwardTags('Notes/Sub', pack.rules)).toEqual(['#notes/sub']);
	});

	test('deepen: false matches only the bare entry folder', () => {
		const pack = compileSystemDef(
			parseOrgsys(`
system: t
slots:
  - id: notes
    folder: Notes
    tag: "#notes"
    deepen: false
`),
		);
		// Bare entry still emits its tag…
		expect(forwardTags('Notes', pack.rules)).toEqual(['#notes']);
		// …but a deeper path no longer matches the slot.
		expect(forwardTags('Notes/Sub', pack.rules)).toEqual([]);
	});

	test('transfer: marker lowers to a marker-only op', () => {
		const pack = compileSystemDef(
			parseOrgsys(`
system: t
slots:
  - id: inbox
    folder: Inbox
    tag: "#-inbox"
    transfer: marker
`),
		);
		expect(pack.rules[0].transfer).toEqual({ op: 'marker-only', marker: '-inbox' });
		// Any path under the marker folder emits the fixed marker tag.
		expect(forwardTags('Inbox', pack.rules)).toEqual(['#-inbox']);
		expect(forwardTags('Inbox/anything/deep', pack.rules)).toEqual(['#-inbox']);
	});
});
