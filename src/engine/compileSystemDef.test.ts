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
import type { SystemDef } from './orgsys';
import { compileSystemDef, composedGroupPrecedence, resolveMountAnchors } from './compileSystemDef';
import { loadRulePackFromJSON } from './rulePackLoader';
import { findBestMatch, calculateMatchConfidence } from './ruleMatcher';
import { applyRuleForward, applyRuleInverse } from './applyTransfer';
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

/** Folder → emitted tags via the real matcher + forward runtime. `precedence`
 * (optional) is the cross-group order — composed packs pass deeper-anchor groups
 * first so nested mounts out-rank the host system. */
function forwardTags(folderPath: string, rules: MappingRule[], precedence?: string[]): string[] {
	const match = findBestMatch(
		folderPath,
		rules,
		{ input: folderPath, matchType: 'folder', direction: 'folder-to-tag' },
		precedence,
	);
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

// ════════════════════════════════════════════════════════════════════════════
// Phase 1 — COMPOSITION (mounts / at-glob / extends / rebind / disable)
// ════════════════════════════════════════════════════════════════════════════

/** A registry with the atomic systems (jd, para) the composed defs snap in. */
function buildRegistry(): Map<string, SystemDef> {
	return new Map<string, SystemDef>([
		['jd', parseOrgsys(readFileSync(join(PACKS, 'jd.orgsys'), 'utf-8'))],
		['para', parseOrgsys(readFileSync(join(PACKS, 'para.orgsys'), 'utf-8'))],
	]);
}

/**
 * The composed def under test: an entity/namespace system (folder
 * `Entity/{owner}`, tag `#--{owner}`, identity, deepen) with the JD system
 * mounted under every per-entity Output folder. This is the composition the
 * old format couldn't express — it has to GENERATE the hand-written
 * `seacow-tpl-entity-output-jd` rule from the entity system plus a JD mount at
 * the `Entity` / `*` / `Output` glob.
 */
const ENTITY_JD_COMPOSED = `
system: seacow
title: SEACOW
axes: [entity]
defaults:
  direction: bidirectional
  folderCase: Title Case
  tagCase: kebab-case
slots:
  - id: owner
    folder: "Entity/{owner}"
    tag: "#--{owner}"
    transfer: identity
    deepen: true
mounts:
  - snap: jd
    at: Entity/*/Output
`;

/** Synthetic vault folders: two per-entity Output folders (+ noise). */
const SYNTH_VAULT = [
	'Entity',
	'Entity/Cybersader',
	'Entity/Cybersader/Output',
	'Entity/Cybersader/Input',
	'Entity/Acme',
	'Entity/Acme/Output',
	'Capture/Inbox',
];

// ─── at-glob resolution ─────────────────────────────────────────────────────

describe('resolveMountAnchors — at-glob resolution', () => {
	test('`*` at the end matches one segment under the literal prefix', () => {
		expect(
			resolveMountAnchors('Entity/*', ['Entity/A', 'Entity/B', 'Other/C', 'Entity/A/Deep']),
		).toEqual(['Entity/A', 'Entity/B']);
	});

	test('`*` in the middle (Entity/*/Output) collects every matching entity', () => {
		expect(resolveMountAnchors('Entity/*/Output', SYNTH_VAULT)).toEqual([
			'Entity/Acme/Output',
			'Entity/Cybersader/Output',
		]);
	});

	test('`*` at the start matches the leading segment', () => {
		expect(resolveMountAnchors('*/Output', ['A/Output', 'B/Output', 'A/Input'])).toEqual([
			'A/Output',
			'B/Output',
		]);
	});

	test('multiple `*` each bind exactly one segment', () => {
		expect(
			resolveMountAnchors('*/*/Output', ['A/B/Output', 'C/D/Output', 'A/Output', 'A/B/C/Output']),
		).toEqual(['A/B/Output', 'C/D/Output']);
	});

	test('a glob that matches nothing yields zero anchors', () => {
		expect(resolveMountAnchors('Entity/*/Nope', SYNTH_VAULT)).toEqual([]);
	});

	test('a glob with no vaultFolders resolves lazily to zero anchors', () => {
		expect(resolveMountAnchors('Entity/*/Output')).toEqual([]);
		expect(resolveMountAnchors('Entity/*/Output', [])).toEqual([]);
	});

	test('a literal path is always exactly one anchor (no vault needed)', () => {
		expect(resolveMountAnchors('Knowledge/Output')).toEqual(['Knowledge/Output']);
		// Literal anchors are explicit — not filtered by vault existence.
		expect(resolveMountAnchors('Nonexistent/Path', ['Other'])).toEqual(['Nonexistent/Path']);
	});
});

// ─── Golden behavioral equivalence — composed JD mount vs hand-written SEACOW ─

describe('composition golden — entity + mount(jd at Entity/*/Output)', () => {
	const pack = compileSystemDef(parseOrgsys(ENTITY_JD_COMPOSED), {
		registry: buildRegistry(),
		vaultFolders: SYNTH_VAULT,
	});
	const precedence = composedGroupPrecedence(pack);

	// The hand-written rule the composition must reproduce. seacow-templates.json
	// ships its rules DISABLED (review-before-enable); enable them so the matcher
	// considers them, exactly as it would once the user turns the pack on.
	const seacowLoad = loadRulePackFromJSON(readFileSync(join(PACKS, 'seacow-templates.json'), 'utf-8'));
	if (!seacowLoad.ok) throw new Error('failed to load seacow-templates.json');
	const handWritten = seacowLoad.pack.rules.map((r) => ({ ...r, enabled: true }));

	const GOLDEN_PATH = 'Entity/Cybersader/Output/01 - Projects';

	test('compiled composed rules emit the SAME tag the hand-written SEACOW rule emits', () => {
		const fromComposed = forwardTags(GOLDEN_PATH, pack.rules, precedence);
		const fromHandWritten = forwardTags(GOLDEN_PATH, handWritten);
		// The hand-written `seacow-tpl-entity-output-jd` emits this nested tag.
		expect(fromHandWritten).toEqual(['#--cybersader/01-projects']);
		// The composed pack reproduces it exactly — entity namespace + JD body.
		expect(fromComposed).toEqual(fromHandWritten);
		expect(fromComposed).toEqual(['#--cybersader/01-projects']);
	});

	test('the second entity (Acme) gets its own namespaced nested emission', () => {
		expect(forwardTags('Entity/Acme/Output/01 - Projects', pack.rules, precedence)).toEqual([
			'#--acme/01-projects',
		]);
	});

	test('one anchor per matching entity — 2 here (Cybersader, Acme)', () => {
		const mountGroups = new Set(
			pack.rules.map((r) => r.group).filter((g): g is string => !!g && g.includes('@Entity/')),
		);
		// M3: groups carry the snapped system (`host@snap@anchor`).
		expect(mountGroups).toEqual(
			new Set(['seacow@jd@Entity/Cybersader/Output', 'seacow@jd@Entity/Acme/Output']),
		);
		// JD compiles to one rule, so exactly one mounted rule per anchor.
		expect(pack.rules.filter((r) => r.group?.includes('@Entity/'))).toHaveLength(2);
	});

	test('zero anchors when the vault has no Entity/*/Output folder', () => {
		const noOutput = compileSystemDef(parseOrgsys(ENTITY_JD_COMPOSED), {
			registry: buildRegistry(),
			vaultFolders: ['Entity', 'Entity/Cybersader', 'Entity/Cybersader/Input'],
		});
		// Only the base entity rule survives — no mounts placed.
		expect(noOutput.rules.every((r) => !r.group?.includes('@Entity/'))).toBe(true);
		expect(noOutput.rules).toHaveLength(1);
		expect(noOutput.rules[0].group).toBe('seacow@root');
	});

	test('a glob mount with no vaultFolders places nothing (lazy)', () => {
		const noVault = compileSystemDef(parseOrgsys(ENTITY_JD_COMPOSED), { registry: buildRegistry() });
		expect(noVault.rules).toHaveLength(1); // base entity rule only
		expect(noVault.rules[0].group).toBe('seacow@root');
	});

	test('deeper nested rules out-rank shallower ones (matcher picks the mount)', () => {
		// Both the base entity rule AND the JD mount match the golden path; the
		// deeper mount must win.
		const match = findBestMatch(
			GOLDEN_PATH,
			pack.rules,
			{ input: GOLDEN_PATH, matchType: 'folder', direction: 'folder-to-tag' },
			precedence,
		);
		expect(match?.rule.group).toBe('seacow@jd@Entity/Cybersader/Output');

		// …and the specificity matcher independently agrees: the deep mount's
		// folder pattern scores higher than the shallow host rule's.
		const deep = pack.rules.find((r) => r.group === 'seacow@jd@Entity/Cybersader/Output')!;
		const shallow = pack.rules.find((r) => r.group === 'seacow@root')!;
		expect(calculateMatchConfidence(GOLDEN_PATH, deep.folderPattern!, deep.folderAnchor)).toBeGreaterThan(
			calculateMatchConfidence(GOLDEN_PATH, shallow.folderPattern!, shallow.folderAnchor),
		);

		// Group precedence lists the deeper anchor ahead of the host root.
		expect(precedence.indexOf('seacow@jd@Entity/Cybersader/Output')).toBeLessThan(
			precedence.indexOf('seacow@root'),
		);
	});

	test('mounted rules carry the per-anchor group and depth-adjusted priority', () => {
		const deep = pack.rules.find((r) => r.group === 'seacow@jd@Entity/Cybersader/Output')!;
		// JD base priority 10, anchor depth 3 → 10 - 3 = 7 (deeper ⇒ lower ⇒ wins ties).
		expect(deep.priority).toBe(7);
	});
});

// ─── Literal-path mount (folder-only scope, no inherited tag namespace) ──────

describe('compileSystemDef — literal-path mount', () => {
	const LITERAL_MOUNT = `
system: lit
mounts:
  - snap: jd
    at: Knowledge/Output
`;
	const pack = compileSystemDef(parseOrgsys(LITERAL_MOUNT), { registry: buildRegistry() });

	test('a literal mount resolves to exactly one anchor', () => {
		expect(pack.rules).toHaveLength(1);
		expect(pack.rules[0].group).toBe('lit@jd@Knowledge/Output');
	});

	test('the mounted folder template is scoped under the literal anchor', () => {
		expect(pack.rules[0].folderTemplate).toBe('Knowledge/Output/{n:\\d{1,2}} - {name}/{deeper...}');
	});

	test('the tag face is unchanged — a literal mount inherits no namespace', () => {
		// No host slot binds at a literal anchor, so the JD body emits bare.
		expect(forwardTags('Knowledge/Output/01 - Projects', pack.rules)).toEqual(['#01-projects']);
	});
});

// ─── rebind + disable (parametric slot-value surgery on the snapped system) ──

describe('compileSystemDef — mount rebind + disable', () => {
	const REBIND_DISABLE = `
system: comp
mounts:
  - snap: para
    at: Work
    rebind:
      Projects: Initiatives
    disable:
      - Archive
`;
	const pack = compileSystemDef(parseOrgsys(REBIND_DISABLE), { registry: buildRegistry() });

	test('rebind renames a parametric value (Projects → Initiatives)', () => {
		expect(pack.rules.some((r) => r.id.startsWith('para-initiatives'))).toBe(true);
		expect(pack.rules.every((r) => !r.id.startsWith('para-projects'))).toBe(true);
	});

	test('disable drops a parametric value (Archive)', () => {
		expect(pack.rules.every((r) => !r.id.startsWith('para-archive'))).toBe(true);
		// PARA had 4 buckets; one renamed, one dropped → 3 mounted rules remain.
		expect(pack.rules).toHaveLength(3);
	});

	test('every mounted rule is stamped the per-anchor composed group', () => {
		expect(pack.rules.every((r) => r.group === 'comp@para@Work')).toBe(true);
	});

	test('disable can drop a whole slot by id', () => {
		const dropSlot = `
system: comp
mounts:
  - snap: para
    at: Work
    disable:
      - bucket
`;
		const dropped = compileSystemDef(parseOrgsys(dropSlot), { registry: buildRegistry() });
		// PARA's only slot is `bucket`; dropping it leaves no mounted rules.
		expect(dropped.rules).toHaveLength(0);
	});
});

// ─── extends (inherit axes + defaults from a base system) ───────────────────

describe('compileSystemDef — extends inheritance', () => {
	const BASE = `
system: base
axes: [entity]
defaults:
  direction: folder-to-tag
  tagCase: snake_case
slots:
  - id: anchor
    folder: Anchor
    tag: "#anchor"
`;

	function registryWithBase(): Map<string, SystemDef> {
		const reg = buildRegistry();
		reg.set('base', parseOrgsys(BASE));
		return reg;
	}

	test('child inherits axes + defaults when it declares none', () => {
		const child = `
system: child
extends: base
slots:
  - id: x
    folder: X
    tag: "#x"
`;
		const pack = compileSystemDef(parseOrgsys(child), { registry: registryWithBase() });
		expect(pack.axes).toEqual(['entity']); // inherited
		expect(pack.rules[0].direction).toBe('folder-to-tag'); // inherited default
	});

	test('child fields override the inherited base', () => {
		const child = `
system: child
extends: base
axes: [output]
defaults:
  direction: bidirectional
slots:
  - id: x
    folder: X
    tag: "#x"
`;
		const pack = compileSystemDef(parseOrgsys(child), { registry: registryWithBase() });
		expect(pack.axes).toEqual(['output']); // child wins
		expect(pack.rules[0].direction).toBe('bidirectional'); // child wins
	});

	test('extends with no registry is a no-op (the child compiles on its own)', () => {
		const child = `
system: child
extends: base
slots:
  - id: x
    folder: X
    tag: "#x"
`;
		const pack = compileSystemDef(parseOrgsys(child));
		// No inheritance available; child keeps its own (defaulted) shape.
		expect(pack.rules).toHaveLength(1);
		expect(pack.axes).toBeUndefined();
	});
});

// ─── Parser: mounts + extends ───────────────────────────────────────────────

describe('parseOrgsys — mounts + extends', () => {
	test('parses a mount with snap + at', () => {
		const def = parseOrgsys(`
system: c
mounts:
  - snap: jd
    at: Entity/*/Output
`);
		expect(def.mounts).toEqual([{ snap: 'jd', at: 'Entity/*/Output' }]);
	});

	test('parses rebind (mapping) and disable (sequence)', () => {
		const def = parseOrgsys(`
system: c
mounts:
  - snap: para
    at: Work
    rebind:
      Projects: Initiatives
      Areas: Domains
    disable:
      - Archive
      - Resources
`);
		expect(def.mounts).toEqual([
			{
				snap: 'para',
				at: 'Work',
				rebind: { Projects: 'Initiatives', Areas: 'Domains' },
				disable: ['Archive', 'Resources'],
			},
		]);
	});

	test('parses extends and allows a mounts-only definition (no slots)', () => {
		const def = parseOrgsys(`
system: c
extends: base
mounts:
  - snap: jd
    at: Output
`);
		expect(def.extends).toBe('base');
		expect(def.slots).toEqual([]);
		expect(def.mounts).toHaveLength(1);
	});

	test('throws when neither slots nor mounts are present', () => {
		expect(() => parseOrgsys('system: t')).toThrow(OrgsysParseError);
	});

	test('throws on a mount missing snap or at', () => {
		expect(() => parseOrgsys('system: c\nmounts:\n  - at: Output')).toThrow(OrgsysParseError);
		expect(() => parseOrgsys('system: c\nmounts:\n  - snap: jd')).toThrow(OrgsysParseError);
	});
});

// ════════════════════════════════════════════════════════════════════════════
// Phase 1 — adversarial-review holes (glob normalization, tag-scope on a
// decorated path, mount cycles, literal-mount entry point, anchor/group dedup,
// multi-level extends, missing-snap warning).
// ════════════════════════════════════════════════════════════════════════════

/** Folder → emitted tag(s), choosing the rule via the composed precedence. */
function composedForward(path: string, pack: { rules: MappingRule[] }): string[] {
	const precedence = composedGroupPrecedence(pack as RulePack);
	return forwardTags(path, pack.rules, precedence);
}

// ─── FIX 1 — glob resolver normalizes emoji/JD per segment, returns raw ──────

describe('resolveMountAnchors — emoji/JD-decorated folders (FIX 1)', () => {
	test('a literal glob segment matches a decorated folder segment; raw path returned', () => {
		const anchors = resolveMountAnchors('Entity/*/Output', [
			'Entity/Cybersader/📁 01 - Output',
			'Entity/Acme/Output',
		]);
		// BOTH match (decorated + plain), each returned as its RAW on-disk path.
		expect(anchors).toContain('Entity/Cybersader/📁 01 - Output');
		expect(anchors).toContain('Entity/Acme/Output');
		expect(anchors).toHaveLength(2);
	});

	test('a JD-prefixed `*`-bound segment still matches the literal tail', () => {
		expect(resolveMountAnchors('Entity/*/Output', ['Entity/📁 01 - Cybersader/Output'])).toEqual([
			'Entity/📁 01 - Cybersader/Output',
		]);
	});
});

// ─── FIX 2 — tag namespace derived from the NORMALIZED host path ─────────────

describe('composition — decorated entity host (FIX 2)', () => {
	const DECORATED = `
system: seacow
axes: [entity]
defaults:
  direction: bidirectional
  folderCase: Title Case
  tagCase: kebab-case
slots:
  - id: owner
    folder: "Entity/{owner}"
    tag: "#--{owner}"
    transfer: identity
    deepen: true
mounts:
  - snap: jd
    at: Entity/*/Output
`;
	const decoratedVault = [
		'Entity',
		'Entity/📁 01 - Cybersader',
		'Entity/📁 01 - Cybersader/Output',
	];
	const pack = compileSystemDef(parseOrgsys(DECORATED), {
		registry: buildRegistry(),
		vaultFolders: decoratedVault,
	});

	test('the namespace is clean (#--cybersader), not the garbled decorated form', () => {
		expect(composedForward('Entity/📁 01 - Cybersader/Output/01 - Projects', pack)).toEqual([
			'#--cybersader/01-projects',
		]);
	});

	test('the mount still resolved against the decorated vault folder', () => {
		expect(pack.rules.some((r) => r.group?.includes('@Entity/📁 01 - Cybersader/Output'))).toBe(true);
	});
});

// ─── FIX 3 — mount cycles compile (warn) instead of stack-overflowing ───────

describe('composition — mount cycle guard (FIX 3)', () => {
	test('a self-snap compiles without throwing and records a warning', () => {
		const SELF = `
system: a
slots:
  - id: x
    folder: X
    tag: "#x"
mounts:
  - snap: a
    at: Self
`;
		const reg = new Map<string, SystemDef>();
		reg.set('a', parseOrgsys(SELF));
		let pack!: RulePack;
		expect(() => {
			pack = compileSystemDef(parseOrgsys(SELF), { registry: reg });
		}).not.toThrow();
		// Only the base slot rule survives; the self-mount is skipped + warned.
		expect(pack.rules).toHaveLength(1);
		expect(pack.warnings?.some((w) => w.toLowerCase().includes('cycle'))).toBe(true);
	});

	test('an A↔B cycle compiles without throwing', () => {
		const A = `
system: a
slots:
  - id: x
    folder: X
    tag: "#x"
mounts:
  - snap: b
    at: ToB
`;
		const B = `
system: b
slots:
  - id: y
    folder: Y
    tag: "#y"
mounts:
  - snap: a
    at: ToA
`;
		const reg = new Map<string, SystemDef>();
		reg.set('a', parseOrgsys(A));
		reg.set('b', parseOrgsys(B));
		let pack!: RulePack;
		expect(() => {
			pack = compileSystemDef(parseOrgsys(A), { registry: reg });
		}).not.toThrow();
		// A's base rule + B's base rule (mounted at ToB); B's re-mount of A is the
		// cycle and is skipped.
		expect(pack.warnings?.some((w) => w.toLowerCase().includes('cycle'))).toBe(true);
	});
});

// ─── FIX 4 — literal/typed mount preserves the bucket entry (no doubling) ────

describe('composition — literal PARA mount entry point (FIX 4)', () => {
	const PARA_AT_WORK = `
system: comp
mounts:
  - snap: para
    at: Work
`;
	const pack = compileSystemDef(parseOrgsys(PARA_AT_WORK), { registry: buildRegistry() });

	test('forward: Work/Projects/Sub emits #projects/sub, not #projects/projects/sub', () => {
		expect(composedForward('Work/Projects/Sub', pack)).toEqual(['#projects/sub']);
	});

	test('inverse: #projects/sub round-trips back to Work/Projects/Sub', () => {
		// The matcher gates the tag side on `^projects/` (no `#`); select that
		// rule and confirm its inverse recovers the full folder path.
		const m = findBestMatch(
			'projects/sub',
			pack.rules,
			{ input: 'projects/sub', matchType: 'tag', direction: 'tag-to-folder' },
			composedGroupPrecedence(pack),
		);
		expect(m).not.toBeNull();
		expect(applyRuleInverse('#projects/sub', m!.rule).folder).toBe('Work/Projects/Sub');
	});
});

// ─── M2 — anchor / rule-id dedup across overlapping mounts ───────────────────

describe('composition — anchor + rule-id dedup (M2)', () => {
	test('two identical mounts of the same snap at the same anchor do not duplicate ids', () => {
		const DOUBLE = `
system: comp
mounts:
  - snap: jd
    at: Work
  - snap: jd
    at: Work
`;
		const pack = compileSystemDef(parseOrgsys(DOUBLE), { registry: buildRegistry() });
		const ids = pack.rules.map((r) => r.id);
		expect(new Set(ids).size).toBe(ids.length); // no duplicate ids
		expect(pack.rules).toHaveLength(1); // jd → 1 rule, the second mount is deduped
	});
});

// ─── M3 — group includes the snap id (two snaps at one anchor stay distinct) ──

describe('composition — group carries the snap id (M3)', () => {
	test('two different snaps at the same anchor get distinct groups', () => {
		const TWO_SNAPS = `
system: comp
mounts:
  - snap: jd
    at: Work
  - snap: para
    at: Work
`;
		const pack = compileSystemDef(parseOrgsys(TWO_SNAPS), { registry: buildRegistry() });
		const groups = new Set(pack.rules.map((r) => r.group));
		expect(groups.has('comp@jd@Work')).toBe(true);
		expect(groups.has('comp@para@Work')).toBe(true);
	});
});

// ─── M4 — multi-level extends (A → B → C inherits C's fields) ────────────────

describe('compileSystemDef — multi-level extends (M4)', () => {
	test('A extends B extends C inherits C axes + defaults', () => {
		const C = `
system: cbase
axes: [entity]
defaults:
  direction: folder-to-tag
  tagCase: snake_case
slots:
  - id: c
    folder: C
    tag: "#c"
`;
		const B = `
system: bmid
extends: cbase
slots:
  - id: b
    folder: B
    tag: "#b"
`;
		const A = `
system: atop
extends: bmid
slots:
  - id: a
    folder: A
    tag: "#a"
`;
		const reg = new Map<string, SystemDef>();
		reg.set('cbase', parseOrgsys(C));
		reg.set('bmid', parseOrgsys(B));
		const pack = compileSystemDef(parseOrgsys(A), { registry: reg });
		expect(pack.axes).toEqual(['entity']); // inherited two levels up from C
		expect(pack.rules[0].direction).toBe('folder-to-tag'); // inherited C default
	});

	test('an extends cycle (A → B → A) compiles without throwing and warns', () => {
		const A = `system: a\nextends: b\nslots:\n  - id: x\n    folder: X\n    tag: "#x"`;
		const B = `system: b\nextends: a\nslots:\n  - id: y\n    folder: Y\n    tag: "#y"`;
		const reg = new Map<string, SystemDef>();
		reg.set('a', parseOrgsys(A));
		reg.set('b', parseOrgsys(B));
		let pack!: RulePack;
		expect(() => {
			pack = compileSystemDef(parseOrgsys(A), { registry: reg });
		}).not.toThrow();
		expect(pack.warnings?.some((w) => w.toLowerCase().includes('extends'))).toBe(true);
	});
});

// ─── L3 — a mount referencing an unknown snap surfaces a warning ─────────────

describe('composition — missing snap warning (L3)', () => {
	test('an unknown snap id is skipped with a warning, not silently dropped', () => {
		const UNKNOWN = `
system: comp
mounts:
  - snap: doesnotexist
    at: Work
`;
		const pack = compileSystemDef(parseOrgsys(UNKNOWN), { registry: buildRegistry() });
		expect(pack.rules).toHaveLength(0);
		expect(pack.warnings?.some((w) => w.includes('doesnotexist'))).toBe(true);
	});
});
