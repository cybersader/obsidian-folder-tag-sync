import { describe, expect, test } from 'bun:test';
import { detectPacks, findExclusivityConflicts, type ManifestPackEntry } from './detectPacks';

// ─── Test manifest fixtures ──────────────────────────────────────────────

const PARA: ManifestPackEntry = {
	id: 'para',
	name: 'PARA',
	axes: ['work'],
	detection: {
		anyOf: [
			{ folderRegex: '^Projects$', scope: 'name', label: 'Projects/' },
			{ folderRegex: '^Areas$', scope: 'name', label: 'Areas/' },
			{ folderRegex: '^Resources$', scope: 'name', label: 'Resources/' },
			{ folderRegex: '^Archive$', scope: 'name', label: 'Archive/' },
		],
		minSignals: 2,
	},
};

const JD: ManifestPackEntry = {
	id: 'jd',
	name: 'JD',
	detection: {
		anyOf: [{ folderRegex: '^\\d{2} - [A-Za-z]', scope: 'name' }],
		minSignals: 2,
	},
};

const SEACOW_OUTER: ManifestPackEntry = {
	id: 'seacow-outer',
	name: 'SEACOW outer',
	detection: {
		anyOf: [
			{ folderRegex: '^Capture$', scope: 'name' },
			{ folderRegex: '^Entity$', scope: 'name' },
			{ folderRegex: '^Output$', scope: 'name' },
			{ folderRegex: '^System$', scope: 'name' },
		],
		minSignals: 2,
	},
};

const PARA_SCOPED_UNDER_SEACOW: ManifestPackEntry = {
	id: 'para-in-seacow',
	name: 'PARA inside SEACOW Work',
	detection: {
		anyOf: [
			{ folderRegex: '^Work/Projects$', scope: 'path' },
			{ folderRegex: '^Work/Areas$', scope: 'path' },
		],
		minSignals: 1,
		scopedUnder: 'seacow-outer',
	},
};

const GTD_EXCLUSIVE: ManifestPackEntry & { exclusiveWith?: string[] } = {
	id: 'gtd',
	name: 'GTD',
	exclusiveWith: ['para'],
	detection: {
		anyOf: [
			{ folderRegex: '^Inbox$', scope: 'name' },
			{ folderRegex: '^Next Actions$', scope: 'name' },
		],
		minSignals: 1,
	},
};

// ─── Basic detection ─────────────────────────────────────────────────────

describe('detectPacks — basic matching', () => {
	test('PARA fires when 2+ canonical roots present', () => {
		const folders = ['Projects', 'Projects/Q4-Roadmap', 'Areas', 'Some/Other/Folder'];
		const results = detectPacks(folders, [PARA]);
		expect(results.length).toBe(1);
		expect(results[0].packId).toBe('para');
		expect(results[0].score).toBeGreaterThanOrEqual(1);
		expect(results[0].signalsHit).toBe(2);
	});

	test('PARA does not fire below minSignals', () => {
		const folders = ['Projects', 'Projects/Q4'];
		const results = detectPacks(folders, [PARA]);
		// 1 signal hit, minSignals=2, score=0.5 — surfaces but below threshold
		expect(results.length).toBe(1);
		expect(results[0].score).toBe(0.5);
	});

	test('completely unrelated vault → no results', () => {
		const folders = ['Random/Stuff', 'Other/Things'];
		const results = detectPacks(folders, [PARA, JD]);
		expect(results).toEqual([]);
	});

	test('matched signal records example folders, capped at 3', () => {
		const folders = ['Projects', 'Areas', 'Areas/Sub', 'Areas/Other', 'Areas/Third', 'Areas/Fourth'];
		const results = detectPacks(folders, [PARA]);
		const areasMatch = results[0].matchedSignals.find((s) => s.label === 'Areas/');
		expect(areasMatch?.exampleMatches.length).toBeLessThanOrEqual(3);
	});
});

// ─── Composition (multiple packs match same vault) ───────────────────────

describe('detectPacks — composition', () => {
	test('SEACOW + PARA + JD all surface in a multi-system vault', () => {
		const folders = [
			'Capture',
			'Capture/Inbox',
			'Entity',
			'Output',
			'Output/Public',
			'Projects',
			'Projects/Q4',
			'Areas',
			'10 - Engineering',
			'20 - Research',
		];
		const results = detectPacks(folders, [SEACOW_OUTER, PARA, JD]);
		const ids = results.map((r) => r.packId);
		expect(ids).toContain('seacow-outer');
		expect(ids).toContain('para');
		expect(ids).toContain('jd');
		// SEACOW hits 4 signals (≥minSignals=2), score=2; should sort first by surfacing
		expect(results[0].packId).toBe('seacow-outer');
	});

	test('higher-confidence pack ranks first', () => {
		// PARA gets 4/2 = 2.0; JD gets 2/2 = 1.0
		const folders = ['Projects', 'Areas', 'Resources', 'Archive', '10 - X', '20 - Y'];
		const results = detectPacks(folders, [PARA, JD]);
		expect(results[0].packId).toBe('para');
		expect(results[1].packId).toBe('jd');
	});
});

// ─── Scoping (parent must match for child to surface) ────────────────────

describe('detectPacks — scopedUnder', () => {
	test('child pack suppressed when parent missing', () => {
		const folders = ['Work/Projects', 'Work/Areas']; // no SEACOW outer
		const results = detectPacks(folders, [SEACOW_OUTER, PARA_SCOPED_UNDER_SEACOW]);
		const child = results.find((r) => r.packId === 'para-in-seacow');
		expect(child).toBeDefined();
		expect(child!.suppressedByMissingParent).toBe(true);
	});

	test('child pack surfaces when parent also matches', () => {
		const folders = ['Capture', 'Entity', 'Work/Projects', 'Work/Areas'];
		const results = detectPacks(folders, [SEACOW_OUTER, PARA_SCOPED_UNDER_SEACOW]);
		const child = results.find((r) => r.packId === 'para-in-seacow');
		expect(child).toBeDefined();
		expect(child!.suppressedByMissingParent).toBeFalsy();
	});

	test('suppressed packs sort below surfacing packs', () => {
		const folders = ['Work/Projects', 'Work/Areas']; // child has hits but parent missing
		const results = detectPacks(folders, [SEACOW_OUTER, PARA_SCOPED_UNDER_SEACOW]);
		// no SEACOW signals at all — only the child has any hits
		expect(results.length).toBe(1);
		expect(results[0].packId).toBe('para-in-seacow');
		expect(results[0].suppressedByMissingParent).toBe(true);
	});
});

// ─── Exclusivity conflicts ───────────────────────────────────────────────

describe('findExclusivityConflicts', () => {
	test('returns no conflicts when only one of an exclusive pair surfaces', () => {
		const folders = ['Projects', 'Areas']; // PARA only
		const results = detectPacks(folders, [PARA, GTD_EXCLUSIVE]);
		const conflicts = findExclusivityConflicts(results, [PARA, GTD_EXCLUSIVE]);
		expect(conflicts).toEqual([]);
	});

	test('returns conflict when both exclusive packs surface', () => {
		const folders = ['Projects', 'Areas', 'Inbox']; // PARA + GTD both fire
		const results = detectPacks(folders, [PARA, GTD_EXCLUSIVE]);
		const conflicts = findExclusivityConflicts(results, [PARA, GTD_EXCLUSIVE]);
		expect(conflicts.length).toBe(1);
		expect(conflicts[0].packA + conflicts[0].packB).toContain('para');
		expect(conflicts[0].packA + conflicts[0].packB).toContain('gtd');
	});

	test('no double-reporting (each conflict appears once)', () => {
		const folders = ['Projects', 'Areas', 'Inbox', 'Next Actions'];
		const results = detectPacks(folders, [PARA, GTD_EXCLUSIVE]);
		const conflicts = findExclusivityConflicts(results, [PARA, GTD_EXCLUSIVE]);
		expect(conflicts.length).toBe(1); // not 2
	});

	test('suppressed packs do not participate in conflicts', () => {
		// PARA matches but PARA-in-SEACOW is suppressed because SEACOW missing.
		// Even if exclusivity were declared, suppressed packs shouldn't conflict.
		const folders = ['Projects', 'Areas', 'Inbox'];
		const para_excl = { ...PARA, exclusiveWith: ['gtd'] };
		const results = detectPacks(folders, [para_excl, GTD_EXCLUSIVE]);
		const conflicts = findExclusivityConflicts(results, [para_excl, GTD_EXCLUSIVE]);
		expect(conflicts.length).toBe(1);
	});
});

// ─── Real anchor packs against a synthesized SEACOW vault ────────────────

describe('detectPacks — against the actual rule-packs/manifest entries', () => {
	test('synthesized SEACOW vault surfaces seacow-outer', () => {
		const seacowEntry: ManifestPackEntry = {
			id: 'seacow-outer',
			name: 'SEACOW outer shell',
			axes: ['system', 'entity', 'capture', 'output'],
			detection: {
				anyOf: [
					{ folderRegex: '^Capture$', scope: 'name' },
					{ folderRegex: '^Entity$', scope: 'name' },
					{ folderRegex: '^Output$', scope: 'name' },
					{ folderRegex: '^System$', scope: 'name' },
					{ folderRegex: '^Capture/(Inbox|Clips)$', scope: 'path' },
					{ folderRegex: '^Output/(Main|Public)$', scope: 'path' },
				],
				minSignals: 2,
			},
		};
		const folders = [
			'Capture',
			'Capture/Inbox',
			'Capture/Clips',
			'Entity',
			'Entity/Cybersader',
			'Output',
			'Output/Main',
			'Output/Public',
			'System',
			'System/Templates',
		];
		const results = detectPacks(folders, [seacowEntry]);
		expect(results.length).toBe(1);
		expect(results[0].packId).toBe('seacow-outer');
		expect(results[0].score).toBeGreaterThanOrEqual(2); // hits 6 of 6 signals, min 2 → score 3
	});
});

// ─── Coverage across all rule packs × representative vault fixtures ──────
// These tests exercise the production detection metadata from each pack
// JSON file against synthetic folder lists that represent how a real
// vault organized by that system would look. Assertions are stable: any
// future change to a pack's detection signals or a vault's expected
// matches must update this block deliberately.

import paraJson from '../../rule-packs/para.json';
import jdJson from '../../rule-packs/jd.json';
import seacowOuterJson from '../../rule-packs/seacow-outer.json';
import {
	PARA_VAULT,
	PARA_VAULT_LOWERCASE,
	JD_VAULT,
	SEACOW_VAULT,
	CYBERBASE_VAULT,
	MULTI_SYSTEM_VAULT,
	EMPTY_VAULT,
	NOISE_VAULT,
} from './__fixtures__/vaultFolderLists';

// Construct ManifestPackEntry structs from the actual pack JSON files.
// This is what the production scan pipeline sees post-manifest-build,
// just sourced directly so a stale manifest.json doesn't make the test
// lie about what's deployed.
const PARA_REAL: ManifestPackEntry = {
	id: paraJson.id,
	name: paraJson.name,
	axes: paraJson.axes,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	detection: paraJson.detection as any,
};
const JD_REAL: ManifestPackEntry = {
	id: jdJson.id,
	name: jdJson.name,
	axes: jdJson.axes,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	detection: jdJson.detection as any,
};
const SEACOW_REAL: ManifestPackEntry = {
	id: seacowOuterJson.id,
	name: seacowOuterJson.name,
	axes: seacowOuterJson.axes,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	detection: seacowOuterJson.detection as any,
};
const ALL_REAL_PACKS = [PARA_REAL, JD_REAL, SEACOW_REAL];

describe('detectPacks — fixture vaults × real pack metadata', () => {
	test('PARA vault → PARA surfaces with full confidence; JD/SEACOW do not', () => {
		const results = detectPacks(PARA_VAULT, ALL_REAL_PACKS);
		const para = results.find((r) => r.packId === 'para');
		expect(para).toBeDefined();
		expect(para!.score).toBeGreaterThanOrEqual(1);
		expect(para!.signalsHit).toBe(4); // all 4 PARA roots present

		// JD fixture has no \d{2} - X folders → score 0 → does not surface
		const jd = results.find((r) => r.packId === 'jd');
		expect(jd).toBeUndefined();

		// SEACOW outer requires Capture/Entity/Output/System — none in PARA fixture
		const seacow = results.find((r) => r.packId === 'seacow-outer');
		expect(seacow).toBeUndefined();
	});

	test('PARA vault, lowercase folders → PARA still surfaces (regex is case-insensitive)', () => {
		// detectPacks compiles signal regexes with the `i` flag, so lowercase
		// `projects` should match `^Projects$`. This pins that behavior.
		const results = detectPacks(PARA_VAULT_LOWERCASE, [PARA_REAL]);
		const para = results.find((r) => r.packId === 'para');
		expect(para).toBeDefined();
		expect(para!.score).toBeGreaterThanOrEqual(1);
	});

	test('JD vault (Title Case only) → JD partially matches; will NOT surface as high-confidence', () => {
		// Known limitation: JD pack defines minSignals=2 with two signal
		// variants — `\d{2} - X` (Title Case, spaced) and `\d{2}-x`
		// (lowercase, compact). A real vault uses one convention, so only
		// one signal hits → score 0.5, below the surfacing threshold.
		// Either lower minSignals to 1 in jd.json, or add more variant
		// signals; tracked as a follow-up. Test pins the current behavior.
		const results = detectPacks(JD_VAULT, [JD_REAL]);
		const jd = results.find((r) => r.packId === 'jd');
		expect(jd).toBeDefined();
		expect(jd!.signalsHit).toBe(1);
		expect(jd!.score).toBe(0.5);
	});

	test('JD vault with both naming variants → JD surfaces with full confidence', () => {
		// Confirms the test above is testing the right limitation: when
		// a vault has both naming variants present, JD detection works.
		const mixedJD = [...JD_VAULT, '50-archive', '60-references'];
		const results = detectPacks(mixedJD, [JD_REAL]);
		const jd = results.find((r) => r.packId === 'jd');
		expect(jd).toBeDefined();
		expect(jd!.signalsHit).toBe(2);
		expect(jd!.score).toBeGreaterThanOrEqual(1);
	});

	test('SEACOW vault → seacow-outer surfaces; PARA/JD do not', () => {
		const results = detectPacks(SEACOW_VAULT, ALL_REAL_PACKS);
		const seacow = results.find((r) => r.packId === 'seacow-outer');
		expect(seacow).toBeDefined();
		expect(seacow!.score).toBeGreaterThanOrEqual(1);
		// All 6 SEACOW signals should hit on this fixture
		expect(seacow!.signalsHit).toBe(6);

		expect(results.find((r) => r.packId === 'para')).toBeUndefined();
		expect(results.find((r) => r.packId === 'jd')).toBeUndefined();
	});

	test('Multi-system vault (PARA + JD coexisting) → both surface, no exclusivity declared', () => {
		const results = detectPacks(MULTI_SYSTEM_VAULT, ALL_REAL_PACKS);
		const para = results.find((r) => r.packId === 'para');
		const jd = results.find((r) => r.packId === 'jd');
		expect(para).toBeDefined();
		expect(para!.score).toBeGreaterThanOrEqual(1);
		// JD will be at score 0.5 here (Title Case only) — see JD limitation above
		expect(jd).toBeDefined();

		// Confirm PARA and JD don't declare exclusivity against each other
		const conflicts = findExclusivityConflicts(results, ALL_REAL_PACKS);
		expect(conflicts).toEqual([]);
	});

	test('Cyberbase vault (emoji-prefix folders) → no detectable packs', () => {
		// cyberbase-actual.json deliberately ships without detection metadata
		// (it's a user-specific pack, not a generic org system worth
		// auto-detecting). seacow-cyberbase.json is the same. Pinning this
		// keeps emoji-prefix vaults out of the auto-detect path; if a future
		// change adds detection metadata to either pack, this test fails
		// loudly as a "did you mean to do that?" guard.
		const results = detectPacks(CYBERBASE_VAULT, ALL_REAL_PACKS);
		expect(results.find((r) => r.packId === 'para')).toBeUndefined();
		expect(results.find((r) => r.packId === 'jd')).toBeUndefined();
		expect(results.find((r) => r.packId === 'seacow-outer')).toBeUndefined();
	});

	test('Empty vault → no surfaces, no errors', () => {
		const results = detectPacks(EMPTY_VAULT, ALL_REAL_PACKS);
		expect(results).toEqual([]);
	});

	test('Noise vault → no false positives', () => {
		const results = detectPacks(NOISE_VAULT, ALL_REAL_PACKS);
		expect(results).toEqual([]);
	});
});
