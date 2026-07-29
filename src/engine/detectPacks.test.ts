import { describe, expect, test } from 'bun:test';
import {
	detectPacks,
	detectionOccurrenceKey,
	findExclusivityConflicts,
	isSurfacedDetection,
	partitionDetectionOccurrences,
	partitionDetectionResults,
	type DetectionResult,
	type ManifestPackEntry,
} from './detectPacks';

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
		anyOf: [{ folderRegex: '^\\d{2} - [A-Za-z]', scope: 'name', role: 'numbered-folder' }],
		minSignals: 2,
		occurrence: { countBy: 'folders', minEvidence: 2 },
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

// ─── Explicit result partitioning ────────────────────────────────────────

describe('partitionDetectionResults', () => {
	test('partitions surfaced, below-threshold, and suppressed results explicitly', () => {
		const folders = ['Projects', 'Work/Projects', 'Work/Areas'];
		const partialPara: ManifestPackEntry = {
			...PARA,
			detection: {
				anyOf: [
					{ folderRegex: '^Projects$', scope: 'name' },
					{ folderRegex: '^Resources$', scope: 'name' },
				],
				minSignals: 2,
			},
		};
		const results = detectPacks(folders, [partialPara, PARA_SCOPED_UNDER_SEACOW]);
		const partition = partitionDetectionResults(results);

		expect(partition.surfaced).toEqual([]);
		expect(partition.belowThreshold.map((r) => r.packId)).toEqual(['para']);
		expect(partition.suppressed.map((r) => r.packId)).toEqual(['para-in-seacow']);
		expect(partition.actionable).toEqual(partition.surfaced);
	});

	test('occurrence status is authoritative for detected values', () => {
		const surfaced = detectPacks(['Projects', 'Areas'], [PARA])[0];
		const suppressed = detectPacks(
			['Work/Projects', 'Work/Areas'],
			[PARA_SCOPED_UNDER_SEACOW],
		)[0];

		expect(isSurfacedDetection(surfaced)).toBe(true);
		expect(isSurfacedDetection({ ...surfaced, score: 0.999 })).toBe(true);
		expect(isSurfacedDetection(suppressed)).toBe(false);
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

	test('reports native exclusivity only for co-located actionable occurrences', () => {
		const para: ManifestPackEntry & { exclusiveWith?: string[] } = {
			...PARA,
			exclusiveWith: ['gtd'],
			detection: {
				...PARA.detection!,
				occurrence: { countBy: 'roles', minEvidence: 2 },
			},
		};
		const gtd: ManifestPackEntry & { exclusiveWith?: string[] } = {
			...GTD_EXCLUSIVE,
			detection: {
				...GTD_EXCLUSIVE.detection!,
				minSignals: 2,
				occurrence: { countBy: 'roles', minEvidence: 2 },
			},
		};
		const folders = [
			'Teams/Acme/Projects',
			'Teams/Acme/Areas',
			'Teams/Acme/Inbox',
			'Teams/Acme/Next Actions',
			'Teams/Beta/Projects',
			'Teams/Beta/Areas',
			'Teams/Gamma/Inbox',
			'Teams/Gamma/Next Actions',
		];
		const results = detectPacks(folders, [para, gtd]);
		const conflicts = findExclusivityConflicts(results, [para, gtd]);

		expect(conflicts).toEqual([{
			packA: 'para',
			packB: 'gtd',
			anchorPath: 'Teams/Acme',
			occurrenceAKey: detectionOccurrenceKey('para', 'Teams/Acme'),
			occurrenceBKey: detectionOccurrenceKey('gtd', 'Teams/Acme'),
		}]);
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
import enterpriseJdJson from '../../rule-packs/enterprise-jd-vault.json';
import {
	PARA_VAULT,
	PARA_VAULT_LOWERCASE,
	JD_VAULT,
	SEACOW_VAULT,
	CYBERBASE_VAULT,
	MULTI_SYSTEM_VAULT,
	ENTERPRISE_JD_DEEP_VAULT,
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
const ENTERPRISE_JD_REAL: ManifestPackEntry = {
	id: enterpriseJdJson.id,
	name: enterpriseJdJson.name,
	axes: enterpriseJdJson.axes,
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	detection: enterpriseJdJson.detection as any,
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

	test('JD vault counts repeated sibling folders even when one regex variant hits', () => {
		const results = detectPacks(JD_VAULT, [JD_REAL]);
		const jd = results.find((r) => r.packId === 'jd');
		expect(jd).toBeDefined();
		expect(jd!.signalsHit).toBe(1); // compatibility summary still counts signal definitions
		expect(jd!.score).toBe(2); // 4 numbered sibling folders / minEvidence 2
		expect(jd!.occurrences?.[0].countBy).toBe('folders');
		expect(jd!.occurrences?.[0].evidenceCount).toBe(4);
		expect(jd!.occurrences?.[0].status).toBe('actionable');
	});

	test('JD vault with both naming variants counts unique folders, not overlapping evidence', () => {
		const mixedJD = [...JD_VAULT, '50-archive', '60-references'];
		const results = detectPacks(mixedJD, [JD_REAL]);
		const jd = results.find((r) => r.packId === 'jd');
		expect(jd).toBeDefined();
		expect(jd!.signalsHit).toBe(2);
		expect(jd!.occurrences?.[0].evidenceCount).toBe(6);
		expect(jd!.score).toBe(3);
	});

	test('SEACOW vault → roots seed while detail paths attach as support', () => {
		const results = detectPacks(SEACOW_VAULT, ALL_REAL_PACKS);
		const seacow = results.find((r) => r.packId === 'seacow-outer');
		expect(seacow).toBeDefined();
		expect(seacow!.score).toBe(3); // 4 member roles + 2 attached support roles / minEvidence 2
		expect(seacow!.signalsHit).toBe(6); // compatibility summary includes support signals
		expect(seacow!.occurrences).toHaveLength(1);
		expect(seacow!.occurrences?.[0].evidenceCount).toBe(6);
		expect(seacow!.occurrences?.[0].supportPaths).toEqual([
			'Capture/Clips',
			'Capture/Inbox',
			'Output/Main',
			'Output/Public',
		]);

		expect(results.find((r) => r.packId === 'para')).toBeUndefined();
		expect(results.find((r) => r.packId === 'jd')).toBeUndefined();
	});

	test('SEACOW detail paths alone remain diagnostic and do not seed an occurrence', () => {
		const [seacow] = detectPacks(['Capture/Inbox', 'Output/Public'], [SEACOW_REAL]);
		expect(seacow).toBeDefined();
		expect(seacow.signalsHit).toBe(2);
		expect(seacow.rawEvidence?.every((evidence) => evidence.relation === 'support')).toBe(true);
		expect(seacow.occurrences).toEqual([]);
		expect(isSurfacedDetection(seacow)).toBe(false);
	});

	test('enterprise JD metadata requires four local root roles', () => {
		const [enterprise] = detectPacks(ENTERPRISE_JD_DEEP_VAULT, [ENTERPRISE_JD_REAL]);
		expect(enterprise.packId).toBe('enterprise-jd-vault');
		expect(enterprise.occurrences).toHaveLength(1);
		expect(enterprise.occurrences?.[0].countBy).toBe('roles');
		expect(enterprise.occurrences?.[0].minEvidence).toBe(4);
		expect(enterprise.occurrences?.[0].evidenceCount).toBe(9);
		expect(enterprise.occurrences?.[0].status).toBe('actionable');
	});

	test('Multi-system vault (PARA + JD coexisting) → both surface, no exclusivity declared', () => {
		const results = detectPacks(MULTI_SYSTEM_VAULT, ALL_REAL_PACKS);
		const para = results.find((r) => r.packId === 'para');
		const jd = results.find((r) => r.packId === 'jd');
		expect(para).toBeDefined();
		expect(para!.score).toBeGreaterThanOrEqual(1);
		expect(jd).toBeDefined();
		expect(jd!.score).toBeGreaterThanOrEqual(1);

		// Confirm PARA and JD don't declare exclusivity against each other
		const conflicts = findExclusivityConflicts(results, ALL_REAL_PACKS);
		expect(conflicts).toEqual([]);
	});

	test('Cyberbase vault (emoji-prefix folders) → user-specific packs stay invisible; JD detects via emoji-only-strip', () => {
		// cyberbase-actual.json + seacow-cyberbase.json deliberately ship
		// without detection metadata (user-specific packs, not generic org
		// systems worth auto-detecting). Pinned: those packs stay invisible.
		//
		// JD pack DOES correctly detect emoji+JD folders (📁 01 - Foo) via
		// the layered normalization in matchesNormalized — emoji-only-strip
		// preserves the JD prefix so `^\d{2} - ...` matches. This is the
		// right behavior: a user with `📁 01 - Foo`-style folders IS using
		// JD-shaped naming whether decorated or not. PARA + SEACOW outer
		// stay invisible because the fixture has no `Projects`/`Capture`-
		// shaped names even after decoration is stripped.
		const results = detectPacks(CYBERBASE_VAULT, ALL_REAL_PACKS);
		expect(results.find((r) => r.packId === 'cyberbase-actual')).toBeUndefined();
		expect(results.find((r) => r.packId === 'seacow-cyberbase')).toBeUndefined();
		expect(results.find((r) => r.packId === 'para')).toBeUndefined();
		expect(results.find((r) => r.packId === 'seacow-outer')).toBeUndefined();
		// JD now detects (correctly) via emoji-only-strip path
		expect(results.find((r) => r.packId === 'jd')).toBeDefined();
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

// ─── Emoji + JD-prefix normalization (user-reported bug fix) ────────────

describe('detectPacks — emoji + JD-prefix tolerance', () => {
	const PARA_PACK: ManifestPackEntry = {
		id: 'para',
		name: 'PARA',
		detection: {
			anyOf: [
				{ folderRegex: '^Projects$', scope: 'name', label: 'Projects' },
				{ folderRegex: '^Areas$', scope: 'name', label: 'Areas' },
				{ folderRegex: '^Resources$', scope: 'name', label: 'Resources' },
				{ folderRegex: '^Archive$', scope: 'name', label: 'Archive' },
			],
			minSignals: 2,
		},
	};

	const JD_PACK: ManifestPackEntry = {
		id: 'jd',
		name: 'Johnny Decimal',
		detection: {
			anyOf: [
				{ folderRegex: '^\\d{2}-\\d{2}\\s', scope: 'name', label: 'JD area' },
			],
			minSignals: 1,
		},
	};

	test('emoji-prefixed PARA folders detected (📁 Projects, 📁 Areas)', () => {
		const folders = ['📁 Projects', '📁 Areas', 'random'];
		const results = detectPacks(folders, [PARA_PACK]);
		expect(results.length).toBeGreaterThan(0);
		const para = results.find((r) => r.packId === 'para');
		expect(para?.signalsHit).toBe(2);
	});

	test('JD-prefixed PARA folders detected (01 - Projects, 02 - Areas)', () => {
		const folders = ['01 - Projects', '02 - Areas'];
		const results = detectPacks(folders, [PARA_PACK]);
		const para = results.find((r) => r.packId === 'para');
		expect(para?.signalsHit).toBe(2);
	});

	test('emoji + JD combined (📁 01 - Projects, 📁 02 - Areas)', () => {
		const folders = ['📁 01 - Projects', '📁 02 - Areas'];
		const results = detectPacks(folders, [PARA_PACK]);
		const para = results.find((r) => r.packId === 'para');
		expect(para?.signalsHit).toBe(2);
	});

	test('clean folders still match (no normalization needed)', () => {
		const folders = ['Projects', 'Areas'];
		const results = detectPacks(folders, [PARA_PACK]);
		const para = results.find((r) => r.packId === 'para');
		expect(para?.signalsHit).toBe(2);
	});

	test('JD pack detection still works on raw JD-prefixed names', () => {
		const folders = ['21-29 Work', '11-19 Personal'];
		const results = detectPacks(folders, [JD_PACK]);
		expect(results.length).toBe(1);
		expect(results[0].packId).toBe('jd');
		expect(results[0].signalsHit).toBe(1);
	});

	test('false-positive guard: emoji-prefixed unrelated folder does not match PARA', () => {
		const folders = ['📁 Notes', '📁 Daily'];
		const results = detectPacks(folders, [PARA_PACK]);
		expect(results).toEqual([]);
	});
});

// ─── Occurrence-local detection foundation ──────────────────────────────

describe('detectPacks — occurrence-local evidence and scoring', () => {
	const ROLE_LOCAL_PACK: ManifestPackEntry = {
		id: 'role-local',
		name: 'Role local',
		detection: {
			anyOf: [
				{ folderRegex: '^Projects$', role: 'projects' },
				{ folderRegex: '^Areas$', role: 'areas' },
				{ folderRegex: '^Resources$', role: 'resources' },
			],
			minSignals: 2,
			occurrence: { countBy: 'roles', minEvidence: 2 },
		},
	};

	test('does not combine incomplete role evidence from unrelated anchors', () => {
		const [result] = detectPacks(
			['Clients/Acme/Projects', 'Clients/Beta/Areas'],
			[ROLE_LOCAL_PACK],
		);

		expect(result.score).toBe(0.5);
		expect(result.signalsHit).toBe(2); // compatibility summary: two definitions hit globally
		expect(result.occurrences?.map((occurrence) => ({
			anchor: occurrence.anchorPath,
			status: occurrence.status,
			evidenceCount: occurrence.evidenceCount,
			missingRoles: occurrence.missingRoles,
		}))).toEqual([
			{
				anchor: 'Clients/Acme',
				status: 'incomplete',
				evidenceCount: 1,
				missingRoles: ['areas', 'resources'],
			},
			{
				anchor: 'Clients/Beta',
				status: 'incomplete',
				evidenceCount: 1,
				missingRoles: ['projects', 'resources'],
			},
		]);
		expect(isSurfacedDetection(result)).toBe(false);
	});

	test('real PARA evidence split across parents never combines into an actionable pack', () => {
		const [result] = detectPacks(
			['Clients/Acme/Projects', 'Clients/Beta/Areas'],
			[PARA_REAL],
		);

		expect(result.signalsHit).toBe(2);
		expect(result.occurrences?.map((occurrence) => [
			occurrence.anchorPath,
			occurrence.status,
			occurrence.evidenceCount,
		])).toEqual([
			['Clients/Acme', 'incomplete', 1],
			['Clients/Beta', 'incomplete', 1],
		]);
		expect(isSurfacedDetection(result)).toBe(false);
	});

	test('keeps complete root and nested occurrences separate from an incomplete sibling', () => {
		const [result] = detectPacks([
			'Projects',
			'Areas',
			'Teams/Acme/Projects',
			'Teams/Acme/Areas',
			'Teams/Beta/Projects',
		], [ROLE_LOCAL_PACK]);

		expect(result.occurrences?.map((occurrence) => ({
			anchorPath: occurrence.anchorPath,
			status: occurrence.status,
			evidenceCount: occurrence.evidenceCount,
		}))).toEqual([
			{ anchorPath: '', status: 'actionable', evidenceCount: 2 },
			{ anchorPath: 'Teams/Acme', status: 'actionable', evidenceCount: 2 },
			{ anchorPath: 'Teams/Beta', status: 'incomplete', evidenceCount: 1 },
		]);
	});

	test('deduplicates alternative signal definitions that represent one semantic role', () => {
		const alternativeRoles: ManifestPackEntry = {
			id: 'alternative-roles',
			name: 'Alternative roles',
			detection: {
				anyOf: [
					{ folderRegex: '^Projects$', role: 'projects' },
					{ folderRegex: '^(Projects|Project Work)$', role: 'projects' },
					{ folderRegex: '^Areas$', role: 'areas' },
				],
				occurrence: { countBy: 'roles', minEvidence: 2 },
			},
		};
		const [result] = detectPacks(['Projects', 'Areas'], [alternativeRoles]);
		const [occurrence] = result.occurrences!;

		expect(occurrence.evidence).toHaveLength(3);
		expect(occurrence.evidenceCount).toBe(2);
		expect(occurrence.score).toBe(1);
		expect(occurrence.status).toBe('actionable');
	});

	test('counts repeated member folders when occurrence policy is folders', () => {
		const folderCounted: ManifestPackEntry = {
			id: 'folder-counted',
			name: 'Folder counted',
			detection: {
				anyOf: [
					{ folderRegex: '^\\d{2} - [A-Za-z]', role: 'numbered-folder' },
					{ folderRegex: '^\\d{2} - Projects$', role: 'numbered-folder' },
				],
				minSignals: 2,
				occurrence: { countBy: 'folders', minEvidence: 2 },
			},
		};
		const [result] = detectPacks(['10 - Projects', '20 - Areas'], [folderCounted]);
		const [occurrence] = result.occurrences!;

		expect(occurrence.status).toBe('actionable');
		expect(occurrence.evidenceCount).toBe(2);
		expect(occurrence.score).toBe(1);
		expect(occurrence.evidence).toHaveLength(3); // Projects matches both alternatives
		expect(occurrence.memberPaths).toEqual(['10 - Projects', '20 - Areas']);
	});

	test('retains all raw evidence while summary examples stay capped', () => {
		const fullEvidencePack: ManifestPackEntry = {
			id: 'full-evidence',
			name: 'Full evidence',
			detection: {
				anyOf: [{ folderRegex: '^Item-', role: 'item' }],
				occurrence: { countBy: 'folders', minEvidence: 2 },
			},
		};
		const folders = ['Item-1', 'Item-2', 'Item-3', 'Item-4', 'Item-5'];
		const [result] = detectPacks(folders, [fullEvidencePack]);

		expect(result.matchedSignals[0].exampleMatches).toEqual(folders.slice(0, 3));
		expect(result.rawEvidence?.map((evidence) => evidence.folderPath)).toEqual(folders);
		expect(result.occurrences?.[0].evidence).toHaveLength(5);
	});

	test('uses collision-safe occurrence keys that remain stable as evidence grows', () => {
		expect(detectionOccurrenceKey('a:b', 'c')).not.toBe(
			detectionOccurrenceKey('a', 'b:c'),
		);
		expect(detectionOccurrenceKey('pack', '/Clients//Acme/')).toBe(
			detectionOccurrenceKey('pack', 'Clients/Acme'),
		);

		const first = detectPacks(['Projects'], [ROLE_LOCAL_PACK])[0].occurrences![0];
		const grown = detectPacks(['Projects', 'Areas'], [ROLE_LOCAL_PACK])[0].occurrences![0];
		expect(first.key).toBe(grown.key);
	});
});

describe('detectPacks — member-seeded and support-attached occurrences', () => {
	const SUPPORTED_PACK: ManifestPackEntry = {
		id: 'supported',
		name: 'Supported system',
		detection: {
			anyOf: [
				{ folderRegex: '(?:^|/)Capture$', scope: 'path', role: 'capture' },
				{ folderRegex: '(?:^|/)Output$', scope: 'path', role: 'output' },
				{
					folderRegex: '(?:^|/)Capture/Inbox$',
					scope: 'path',
					role: 'inbox-support',
					relation: 'support',
				},
			],
			occurrence: { countBy: 'roles', minEvidence: 2 },
		},
	};

	test('support evidence attaches to the nearest member-seeded occurrence and contributes locally', () => {
		const [result] = detectPacks([
			'Capture',
			'Output',
			'Capture/Inbox',
			'Clients/Acme/Capture',
			'Clients/Acme/Output',
			'Clients/Acme/Capture/Inbox',
		], [SUPPORTED_PACK]);

		expect(result.occurrences).toHaveLength(2);
		const root = result.occurrences!.find((occurrence) => occurrence.anchorPath === '')!;
		const nested = result.occurrences!.find(
			(occurrence) => occurrence.anchorPath === 'Clients/Acme',
		)!;
		expect(root.status).toBe('actionable');
		expect(root.evidenceCount).toBe(3);
		expect(root.supportPaths).toEqual(['Capture/Inbox']);
		expect(nested.status).toBe('actionable');
		expect(nested.evidenceCount).toBe(3);
		expect(nested.supportPaths).toEqual(['Clients/Acme/Capture/Inbox']);
	});

	test('attached support can satisfy a local threshold but cannot seed an occurrence alone', () => {
		const [result] = detectPacks(['Capture', 'Capture/Inbox'], [SUPPORTED_PACK]);
		expect(result.occurrences).toHaveLength(1);
		expect(result.occurrences?.[0]).toMatchObject({
			anchorPath: '',
			status: 'actionable',
			evidenceCount: 2,
			memberPaths: ['Capture'],
			supportPaths: ['Capture/Inbox'],
		});
	});

	test('support-only evidence is retained diagnostically but never seeds an occurrence', () => {
		const [result] = detectPacks(['Capture/Inbox'], [SUPPORTED_PACK]);
		expect(result.occurrences).toEqual([]);
		expect(result.rawEvidence).toHaveLength(1);
		expect(result.rawEvidence?.[0].relation).toBe('support');
		expect(isSurfacedDetection(result)).toBe(false);
	});
});

describe('detectPacks — occurrence-local scopedUnder', () => {
	const PARENT: ManifestPackEntry = {
		id: 'parent',
		name: 'Parent',
		detection: {
			anyOf: [
				{ folderRegex: '^System$', role: 'system' },
				{ folderRegex: '^Output$', role: 'output' },
			],
			occurrence: { countBy: 'roles', minEvidence: 2 },
		},
	};
	const CHILD: ManifestPackEntry = {
		id: 'child',
		name: 'Child',
		detection: {
			anyOf: [
				{ folderRegex: '^Projects$', role: 'projects' },
				{ folderRegex: '^Areas$', role: 'areas' },
			],
			occurrence: { countBy: 'roles', minEvidence: 2 },
			scopedUnder: 'parent',
		},
	};

	test('authorizes a child only from the nearest actionable local parent occurrence', () => {
		const results = detectPacks([
			'Teams/Acme/System',
			'Teams/Acme/Output',
			'Teams/Acme/Work/Projects',
			'Teams/Acme/Work/Areas',
			'Teams/Beta/Work/Projects',
			'Teams/Beta/Work/Areas',
		], [PARENT, CHILD]);
		const child = results.find((result) => result.packId === 'child')!;
		const acme = child.occurrences!.find(
			(occurrence) => occurrence.anchorPath === 'Teams/Acme/Work',
		)!;
		const beta = child.occurrences!.find(
			(occurrence) => occurrence.anchorPath === 'Teams/Beta/Work',
		)!;

		expect(acme.status).toBe('actionable');
		expect(acme.parentOccurrenceKey).toBe(
			detectionOccurrenceKey('parent', 'Teams/Acme'),
		);
		expect(beta.status).toBe('suppressed');
		expect(beta.suppressionReason).toBe('missing-local-parent');
		expect(child.suppressedByMissingParent).toBeFalsy(); // pack still has one actionable occurrence
		expect(isSurfacedDetection(child)).toBe(true);
	});

	test('does not let an incomplete local parent authorize a child', () => {
		const results = detectPacks([
			'Teams/Acme/System',
			'Teams/Acme/Work/Projects',
			'Teams/Acme/Work/Areas',
		], [PARENT, CHILD]);
		const child = results.find((result) => result.packId === 'child')!;
		expect(child.occurrences?.[0].status).toBe('suppressed');
	});

	test('pack-global mode is an explicit compatibility escape hatch', () => {
		const globalChild: ManifestPackEntry = {
			...CHILD,
			id: 'global-child',
			detection: {
				...CHILD.detection!,
				scopedUnderMode: 'pack-global',
			},
		};
		const results = detectPacks([
			'Teams/Acme/System',
			'Teams/Acme/Output',
			'Teams/Beta/Work/Projects',
			'Teams/Beta/Work/Areas',
		], [PARENT, globalChild]);
		const child = results.find((result) => result.packId === 'global-child')!;

		expect(child.occurrences?.[0].status).toBe('actionable');
		expect(child.occurrences?.[0].parentOccurrenceKey).toBeUndefined();
	});
});

describe('detectPacks — occurrence partitions and legacy result fallback', () => {
	test('partitions occurrence statuses independently of the pack summary', () => {
		const pack: ManifestPackEntry = {
			id: 'mixed',
			name: 'Mixed',
			detection: {
				anyOf: [
					{ folderRegex: '^Projects$', role: 'projects' },
					{ folderRegex: '^Areas$', role: 'areas' },
				],
				occurrence: { minEvidence: 2 },
			},
		};
		const results = detectPacks([
			'Projects',
			'Areas',
			'Clients/Acme/Projects',
		], [pack]);
		const partition = partitionDetectionOccurrences(results);

		expect(partition.actionable.map((occurrence) => occurrence.anchorPath)).toEqual(['']);
		expect(partition.incomplete.map((occurrence) => occurrence.anchorPath)).toEqual([
			'Clients/Acme',
		]);
		expect(partition.suppressed).toEqual([]);
	});

	test('hand-built legacy DetectionResult values keep the old pack-level interpretation', () => {
		const legacy: DetectionResult = {
			packId: 'legacy',
			score: 1,
			signalsHit: 1,
			minSignals: 1,
			matchedSignals: [],
		};
		const suppressedLegacy: DetectionResult = {
			...legacy,
			packId: 'legacy-suppressed',
			suppressedByMissingParent: true,
		};

		expect(isSurfacedDetection(legacy)).toBe(true);
		expect(isSurfacedDetection(suppressedLegacy)).toBe(false);
		const partition = partitionDetectionResults([legacy, suppressedLegacy]);
		expect(partition.surfaced).toEqual([legacy]);
		expect(partition.suppressed).toEqual([suppressedLegacy]);
	});

	test('occurrence status is authoritative when occurrences are present', () => {
		const result: DetectionResult = {
			packId: 'new-shape',
			score: 3,
			signalsHit: 3,
			minSignals: 1,
			matchedSignals: [],
			occurrences: [{
				key: detectionOccurrenceKey('new-shape', ''),
				packId: 'new-shape',
				packName: 'New shape',
				anchorPath: '',
				status: 'incomplete',
				score: 0.5,
				evidenceCount: 1,
				minEvidence: 2,
				countBy: 'roles',
				evidence: [],
				memberPaths: [],
				supportPaths: [],
				missingRoles: ['other'],
			}],
		};

		expect(isSurfacedDetection(result)).toBe(false);
		expect(partitionDetectionResults([result]).belowThreshold).toEqual([result]);
	});
});
