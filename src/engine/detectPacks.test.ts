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
