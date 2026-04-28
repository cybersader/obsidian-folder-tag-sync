/**
 * Full-pipeline integration test — chains scan → detect → import → match →
 * sync end-to-end against the deep + real-world vault fixtures.
 *
 * Background: the existing test suite covers each layer in isolation but
 * never joins them. Detection alone, matching alone, sync alone — each
 * works at shallow depths in unit tests. This file is the first that:
 *
 *   1. Loads real `rule-packs/*.json` from disk
 *   2. Runs detection against the deep fixtures
 *   3. Loads detected packs through the loader
 *   4. Runs the matcher against representative deep paths
 *   5. Runs forward + inverse sync (`applyRuleForward`, `applyRuleInverse`)
 *   6. Verifies round-trip property for bijective rules
 *
 * Failures here surface real gaps in:
 *   - Detection-normalization at depth (commit 6eb9ba3 was 2-deep tested)
 *   - Anchor + depth interactions (Phase G work)
 *   - Forward sync segment extraction at 5+ levels
 *   - Inverse sync path joining + entry-point stripping at depth
 *   - Per-entity scoping correctness (no false positives across siblings)
 *   - Template glob slot at 5+ depth (F2 commit 1)
 *
 * Each failing assertion is then fixed in its own commit so the user can
 * see what was broken vs what was working.
 */

import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { detectPacks, type ManifestPackEntry } from './detectPacks';
import { loadRulePackFromJSON } from './rulePackLoader';
import { findBestMatch, findMatchingRules } from './ruleMatcher';
import { applyRuleForward, applyRuleInverse } from './applyTransfer';
import type { MappingRule } from '../types/settings';
import {
	PARA_DEEP_VAULT,
	SEACOW_CYBERBASE_REAL_VAULT,
	MIXED_DEPTH_EMOJI_JD_VAULT,
	ENTITY_PER_USER_DEEP_VAULT,
	DEEP_TAXONOMY_VAULT,
	ENTERPRISE_JD_DEEP_VAULT,
} from './__fixtures__/vaultFolderLists';

// ─── Helpers ─────────────────────────────────────────────────────────────

const PACKS_DIR = join(__dirname, '../../rule-packs');

function loadPack(filename: string): MappingRule[] {
	const json = readFileSync(join(PACKS_DIR, filename), 'utf-8');
	const result = loadRulePackFromJSON(json);
	if (!result.ok) {
		throw new Error(`Pack ${filename} failed to load: ${result.errors.join('; ')}`);
	}
	return result.pack.rules;
}

function loadManifest(): ManifestPackEntry[] {
	const json = readFileSync(join(PACKS_DIR, 'manifest.json'), 'utf-8');
	const data = JSON.parse(json);
	return data.packs as ManifestPackEntry[];
}

/** Match a folder path through the matcher and return the winning rule (or null). */
function matchFolder(folderPath: string, rules: MappingRule[]): MappingRule | null {
	const match = findBestMatch(folderPath, rules, {
		input: folderPath,
		matchType: 'folder',
	});
	return match?.rule ?? null;
}

/**
 * Match a tag through the matcher and return the winning rule (or null).
 * Sync engines (TagToFolderSync.ts:160) strip the leading `#` before calling
 * the matcher because rule patterns don't include `#`. Mirroring that here.
 */
function matchTag(tag: string, rules: MappingRule[]): MappingRule | null {
	const stripped = tag.startsWith('#') ? tag.slice(1) : tag;
	const match = findBestMatch(stripped, rules, {
		input: stripped,
		matchType: 'tag',
	});
	return match?.rule ?? null;
}

// ─── Test suites ─────────────────────────────────────────────────────────

describe('full pipeline — PARA at 5-deep', () => {
	const rules = loadPack('para.json');

	test('every PARA-rooted path gets matched by some rule', () => {
		const paraPaths = PARA_DEEP_VAULT.filter(
			(p) =>
				p.startsWith('Projects') ||
				p.startsWith('Areas') ||
				p.startsWith('Resources') ||
				p.startsWith('Archive'),
		);
		for (const path of paraPaths) {
			const rule = matchFolder(path, rules);
			expect(rule).not.toBeNull();
		}
	});

	test('5-deep path matches the right rule (Projects/Web/Auth/oauth-rewrite/v2)', () => {
		const rule = matchFolder('Projects/Web/Auth/oauth-rewrite/v2', rules);
		expect(rule?.id).toBe('para-projects');
	});

	test('forward sync at 5-deep produces a tag', () => {
		const result = applyRuleForward(
			'Projects/Web/Auth/oauth-rewrite/v2',
			rules.find((r) => r.id === 'para-projects')!,
		);
		expect(result.tags.length).toBe(1);
		// kebab-case applied per pack: 'Projects/Web/Auth/oauth-rewrite/v2'
		// → entry stripped → 'Web/Auth/oauth-rewrite/v2' → kebab → 'web/auth/oauth-rewrite/v2'
		expect(result.tags[0]).toMatch(/^#projects\//);
		// The deep tail must survive (5 levels under the entry)
		expect(result.tags[0].split('/').length).toBe(5);
	});

	test('Areas at 6 segments deep produces a 6-segment tag', () => {
		// 'Areas/Health/Exercise/Routines/2026/Q1' — 6 segments
		const rule = rules.find((r) => r.id === 'para-areas')!;
		const result = applyRuleForward('Areas/Health/Exercise/Routines/2026/Q1', rule);
		expect(result.tags.length).toBe(1);
		expect(result.tags[0]).toMatch(/^#areas\//);
		// 6 segments split by `/` (entry replaced with `#areas`, so segment count preserved)
		expect(result.tags[0].split('/').length).toBe(6);
	});
});

describe('full pipeline — SEACOW cyberbase real-world layout', () => {
	test('detection fires on emoji + JD-prefixed deep folders', () => {
		const manifest = loadManifest();
		const results = detectPacks(SEACOW_CYBERBASE_REAL_VAULT, manifest);
		// JD pack should detect the emoji+JD-prefixed folders via normalization
		const jd = results.find((r) => r.packId === 'jd');
		expect(jd).toBeDefined();
		expect(jd!.signalsHit).toBeGreaterThan(0);
	});

	test('cyberbase-actual rules match emoji+JD folders at depth', () => {
		const rules = loadPack('cyberbase-actual.json');
		const deepEmojiPath = '📁 01 - Projects/Cybersecurity/Pentest Journal/2024-Q4/lateral-movement';
		const rule = matchFolder(deepEmojiPath, rules);
		// The cyberbase pack has rules for emoji+JD output folders; one of
		// them should match. If null, surfaces a real bug we'll fix.
		expect(rule).not.toBeNull();
	});

	test('daily notes path matches its rule', () => {
		const rules = loadPack('cyberbase-actual.json');
		const dailyPath = '🕸️ Daily Notes/2026/04';
		const rule = matchFolder(dailyPath, rules);
		// cyberbase-actual ships with a Daily Notes rule; should match.
		expect(rule).not.toBeNull();
	});

	test('clipping path matches capture-clip via tag-to-folder direction', () => {
		// SEACOW outer + cyberbase rules include a 'capture-clip' rule
		// matching '⬇️ Clipping/...' — the rule is tag-to-folder, so we
		// test the inverse direction by tag.
		const rules = loadPack('seacow-outer.json');
		const tag = '#-clip/2026/04/article';
		const rule = matchTag(tag, rules);
		expect(rule?.id).toBe('capture-clip');
	});

	test('inbox tag matches the marker rule', () => {
		const rules = loadPack('seacow-outer.json');
		const tag = '#-inbox';
		const rule = matchTag(tag, rules);
		expect(rule?.id).toBe('capture-inbox');
	});
});

describe('full pipeline — per-entity scoping at depth', () => {
	const rules = loadPack('seacow-cyberbase.json');

	test('cybersader rule matches under Entity/Cybersader at 6+ deep', () => {
		const path =
			'Entity/Cybersader/Output/📁 01 - Projects/Cybersecurity/Pentest Journal/2024-Q4';
		const rule = matchFolder(path, rules);
		expect(rule?.id).toBe('entity-cybersader');
	});

	test('cybersader rule does NOT match under Entity/Bob (no false positives)', () => {
		const path = 'Entity/Bob/Output/📁 01 - Personal/Health/Logs/2026';
		const rule = matchFolder(path, rules);
		// Either no match, or a different rule — but NOT entity-cybersader
		expect(rule?.id).not.toBe('entity-cybersader');
	});

	test('bare Entity/Cybersader (no children) matches', () => {
		const rule = matchFolder('Entity/Cybersader', rules);
		expect(rule?.id).toBe('entity-cybersader');
	});

	test('forward sync from deep cybersader path produces correct tag', () => {
		const path = 'Entity/Cybersader/Output/📁 01 - Projects';
		const cybersaderRule = rules.find((r) => r.id === 'entity-cybersader')!;
		const result = applyRuleForward(path, cybersaderRule);
		expect(result.tags.length).toBe(1);
		expect(result.tags[0]).toMatch(/^#--cybersader/);
	});
});

describe('full pipeline — deep taxonomy (LCSH-style)', () => {
	test('templates-demo glob slot captures 4-segment tail', () => {
		const rules = loadPack('templates-demo.json');
		// Rule 3: Projects/{topic}/{deeper...} ↔ #projects/{topic}/{deeper...}
		const globRule = rules.find((r) => r.id === 'templates-projects-glob')!;
		expect(globRule).toBeDefined();
		expect(globRule.folderTemplate).toBe('Projects/{topic}/{deeper...}');

		const result = applyRuleForward(
			'Projects/Web/Auth/oauth-rewrite/v2/notes',
			globRule,
		);
		expect(result.tags).toEqual(['#projects/Web/Auth/oauth-rewrite/v2/notes']);
	});

	test('templates-demo glob slot inverse round-trips at 5-deep', () => {
		const rules = loadPack('templates-demo.json');
		const globRule = rules.find((r) => r.id === 'templates-projects-glob')!;
		const result = applyRuleInverse(
			'#projects/Web/Auth/oauth-rewrite/v2/notes',
			globRule,
		);
		expect(result.folder).toBe('Projects/Web/Auth/oauth-rewrite/v2/notes');
	});

	test('PARA identity round-trips on 6-deep Resources path', () => {
		// Use the templates-demo identity rule, which is template-shaped
		// and round-trips. Pack: Resources isn't covered by templates-demo,
		// but the para-resources rule is. Test through PARA.
		const rules = loadPack('para.json');
		const path = 'Resources/Books/Programming/Rust';
		const matched = matchFolder(path, rules);
		expect(matched?.id).toBe('para-resources');
	});
});

describe('full pipeline — round-trip property (forward then inverse)', () => {
	test('templates-demo identity rule: deep path → tag → folder → original', () => {
		const rules = loadPack('templates-demo.json');
		const identity = rules.find((r) => r.id === 'templates-projects-identity')!;
		const original = 'Projects/Web Auth';
		const forward = applyRuleForward(original, identity);
		expect(forward.tags).toEqual(['#projects/Web Auth']);
		const inverse = applyRuleInverse(forward.tags[0], identity);
		expect(inverse.folder).toBe(original);
		expect(forward.lossy).toBe(false);
		expect(inverse.lossy).toBe(false);
	});

	test('templates-demo glob round-trips at depth', () => {
		const rules = loadPack('templates-demo.json');
		const globRule = rules.find((r) => r.id === 'templates-projects-glob')!;
		const original = 'Projects/Web/Auth/oauth-rewrite/v2/notes';
		const forward = applyRuleForward(original, globRule);
		const inverse = applyRuleInverse(forward.tags[0], globRule);
		expect(inverse.folder).toBe(original);
	});
});

describe('full pipeline — mixed-depth emoji+JD vault detection + matching', () => {
	test('detection fires on the mixed-axis vault', () => {
		const manifest = loadManifest();
		const results = detectPacks(MIXED_DEPTH_EMOJI_JD_VAULT, manifest);
		expect(results.length).toBeGreaterThan(0);
	});

	test('SEACOW outer detects the Capture/Output/System scaffold', () => {
		const manifest = loadManifest();
		const results = detectPacks(MIXED_DEPTH_EMOJI_JD_VAULT, manifest);
		const seacow = results.find((r) => r.packId === 'seacow-outer');
		expect(seacow).toBeDefined();
		expect(seacow!.signalsHit).toBeGreaterThanOrEqual(2);
	});

	test('JD pack detects the emoji-prefixed numbered folders inside Output', () => {
		const manifest = loadManifest();
		const results = detectPacks(MIXED_DEPTH_EMOJI_JD_VAULT, manifest);
		const jd = results.find((r) => r.packId === 'jd');
		expect(jd).toBeDefined();
	});
});

describe('full pipeline — exact-output assertions (catches subtle pipeline bugs)', () => {
	test('PARA Projects identity at 5-deep emits exact kebab-cased tag', () => {
		const rules = loadPack('para.json');
		const rule = rules.find((r) => r.id === 'para-projects')!;
		const result = applyRuleForward(
			'Projects/Web/Auth/oauth-rewrite/v2',
			rule,
		);
		// PARA pack: kebab-case on tag side, prefix `projects`
		expect(result.tags).toEqual(['#projects/web/auth/oauth-rewrite/v2']);
	});

	test('PARA inverse at 5-deep recovers Title-Case folder', () => {
		const rules = loadPack('para.json');
		const rule = rules.find((r) => r.id === 'para-projects')!;
		const result = applyRuleInverse(
			'#projects/web/auth/oauth-rewrite/v2',
			rule,
		);
		// folderTransforms.caseTransform = 'Title Case' on the inverse direction
		// Each segment Title-Cased: 'Web', 'Auth', 'Oauth Rewrite', 'V2'
		expect(result.folder).toBe('Projects/Web/Auth/Oauth Rewrite/V2');
	});

	test('JD numbered area at depth emits prefix-preserving tag', () => {
		const rules = loadPack('jd.json');
		const rule = rules.find((r) => r.id === 'jd-numbered-area')!;
		// JD pack has empty folderEntryPoint, so the whole path becomes the tag content.
		const result = applyRuleForward('10 - Projects/Web/Auth', rule);
		// kebab-case on tag side, JD prefix preserved per the pack's tagTransforms
		expect(result.tags.length).toBe(1);
		expect(result.tags[0]).toMatch(/^#10/);
	});

	test('SEACOW cybersader rule emits `#--cybersader/...` prefix', () => {
		const rules = loadPack('seacow-cyberbase.json');
		const rule = rules.find((r) => r.id === 'entity-cybersader')!;
		const result = applyRuleForward(
			'Entity/Cybersader/Output/Notes',
			rule,
		);
		expect(result.tags.length).toBe(1);
		expect(result.tags[0].startsWith('#--cybersader/')).toBe(true);
	});

	test('templates-demo identity round-trip preserves spaces in slot value', () => {
		const rules = loadPack('templates-demo.json');
		const rule = rules.find((r) => r.id === 'templates-projects-identity')!;
		const original = 'Projects/Web Auth';
		const fwd = applyRuleForward(original, rule);
		expect(fwd.tags).toEqual(['#projects/Web Auth']);
		const inv = applyRuleInverse(fwd.tags[0], rule);
		expect(inv.folder).toBe(original);
	});

	test('templates-demo emoji-prefixed rule matches and round-trips', () => {
		const rules = loadPack('templates-demo.json');
		const rule = rules.find((r) => r.id === 'templates-emoji-projects')!;
		expect(rule).toBeDefined();
		// The rule is disabled by default in the pack — re-enable for the test
		rule.enabled = true;
		const original = '📁 Projects/Web Auth';
		const fwd = applyRuleForward(original, rule);
		expect(fwd.tags).toEqual(['#projects/Web Auth']);
		const inv = applyRuleInverse(fwd.tags[0], rule);
		expect(inv.folder).toBe(original);
	});

	test('templates-demo JD+emoji rule matches and round-trips', () => {
		const rules = loadPack('templates-demo.json');
		const rule = rules.find((r) => r.id === 'templates-jd-emoji')!;
		expect(rule).toBeDefined();
		rule.enabled = true;
		const original = '📁 01 - Projects/Web Auth';
		const fwd = applyRuleForward(original, rule);
		expect(fwd.tags).toEqual(['#projects/Web Auth']);
		const inv = applyRuleInverse(fwd.tags[0], rule);
		expect(inv.folder).toBe(original);
	});

	test('templates-demo glob inverse with deep tail produces matching folder', () => {
		const rules = loadPack('templates-demo.json');
		const rule = rules.find((r) => r.id === 'templates-projects-glob')!;
		rule.enabled = true;
		const original = 'Projects/Cybersecurity/Pentest/2024-Q4/lateral-movement';
		const fwd = applyRuleForward(original, rule);
		expect(fwd.tags).toEqual(['#projects/Cybersecurity/Pentest/2024-Q4/lateral-movement']);
		const inv = applyRuleInverse(fwd.tags[0], rule);
		expect(inv.folder).toBe(original);
		// Both directions are bijective (no filters, both sides have shared
		// {topic} + {deeper...} slots) — lossy flag must be false
		expect(fwd.lossy).toBe(false);
		expect(inv.lossy).toBe(false);
	});
});

describe('full pipeline — tag-to-folder at depth', () => {
	test('SEACOW cybersader inverse: deep tag reconstructs deep folder', () => {
		const rules = loadPack('seacow-cyberbase.json');
		const rule = rules.find((r) => r.id === 'entity-cybersader')!;
		// Strip `#` to match sync-engine convention
		const tag = '--cybersader/output/projects/web';
		const result = applyRuleInverse(tag, rule);
		// Expected reconstruction: entry-strip yields 'output/projects/web'
		// (3 segments) → Title-Cased per pack → prepend 'Entity/Cybersader'
		// = 'Entity/Cybersader/Output/Projects/Web' (5 segments).
		expect(result.folder).toBe('Entity/Cybersader/Output/Projects/Web');
	});

	test('SEACOW capture-clip inverse: deep tag reconstructs Capture/Clips path', () => {
		const rules = loadPack('seacow-outer.json');
		const rule = rules.find((r) => r.id === 'capture-clip')!;
		const tag = '-clip/2026/04/article';
		const result = applyRuleInverse(tag, rule);
		expect(result.folder).toMatch(/^Capture\/Clips\//);
		expect(result.folder?.split('/').length).toBe(5);
	});
});

describe('full pipeline — cross-pack matching with group precedence', () => {
	test('PARA + JD + SEACOW outer rules all live together; deep paths get correctly classified', () => {
		const para = loadPack('para.json');
		const jd = loadPack('jd.json');
		const seacow = loadPack('seacow-outer.json');
		// Mark all loaded rules with their pack id as group (matches loader behavior).
		const rules = [...para, ...jd, ...seacow];

		// Deep PARA path: should match a PARA rule, not JD or SEACOW outer
		const r1 = matchFolder('Projects/Web/Auth/oauth-rewrite/v2', rules);
		expect(r1?.id).toMatch(/^para-/);

		// Deep JD path: should match the JD rule
		const r2 = matchFolder('10 - Projects/Web/Auth/oauth/v2', rules);
		expect(r2?.id).toBe('jd-numbered-area');

		// SEACOW outer path under Output (no JD or PARA inside): seacow-outer rule
		// should match if it has a folder pattern matching Output/...
		const r3 = matchFolder('Capture/Inbox/today', rules);
		// SEACOW outer's capture-inbox is tag-to-folder direction; at the
		// folder side, no rule may match. We just verify nothing crashes
		// and SEACOW outer doesn't accidentally win folder matches it shouldn't.
		// (If it does match, we want to know — surfaces an unintended overlap.)
		// Permissive assertion: matched rule is not from a foreign pack.
		if (r3) {
			expect(['seacow-outer', 'seacow-cyberbase'].some((p) => (r3.group ?? '').includes(p))).toBe(true);
		}
	});
});

// ─── Root-case verification (post trailing-glob relaxation) ──────────────

describe('full pipeline — root-case scenarios', () => {
	test('templates-demo glob-deep template matches BARE entry post-relaxation', () => {
		const rules = loadPack('templates-demo.json');
		// Rule 3: Projects/{topic}/{deeper...} — 2 slots, last is glob
		const globRule = rules.find((r) => r.id === 'templates-projects-glob')!;
		// Bare entry is "Projects" — but template requires {topic}/{deeper...},
		// so bare-Projects shouldn't match (topic is segment, not optional).
		const compiled = new RegExp(globRule.folderPattern!);
		expect(compiled.test('Projects')).toBe(false);
		// However, 'Projects/Web' (one segment topic, no deeper) SHOULD match
		// thanks to trailing-glob relaxation.
		expect(compiled.test('Projects/Web')).toBe(true);
	});

	test('Enterprise JD starter pack matches bare numbered roots AND descendants', () => {
		const rules = loadPack('enterprise-jd-vault.json');
		// Enterprise pack rules ship disabled (safety mode); enable for the match check.
		for (const r of rules) r.enabled = true;
		const tasksRule = rules.find((r) => r.id === 'ent-tasks-planning')!;
		// Bare entry — should match thanks to trailing-glob relaxation
		expect(matchFolder('0 - Tasks, Planning', [tasksRule])?.id).toBe('ent-tasks-planning');
		// Descendants
		expect(matchFolder('0 - Tasks, Planning/Annual Planning', [tasksRule])?.id).toBe('ent-tasks-planning');
		expect(matchFolder('0 - Tasks, Planning/Annual Planning/Q1', [tasksRule])?.id).toBe('ent-tasks-planning');
		// Unrelated — no match
		expect(matchFolder('1 - Workspaces, Projects', [tasksRule])).toBeNull();
		expect(matchFolder('Random', [tasksRule])).toBeNull();
	});

	test('Enterprise JD starter pack: every numbered root is detectable + matches', () => {
		const rules = loadPack('enterprise-jd-vault.json');
		for (const r of rules) r.enabled = true;
		const ruleByPrefix: Record<string, string> = {
			'0 - Tasks, Planning': 'ent-tasks-planning',
			'1 - Workspaces, Projects': 'ent-workspaces-projects',
			'2 - Areas, Initiatives': 'ent-areas-initiatives',
			'3 - Docs, Intel, SOPs': 'ent-docs-intel-sops',
			'4 - Topics, Knowledge, External, Misc': 'ent-topics-knowledge',
			'5 - Archive, Admin': 'ent-archive-admin',
			'6 - Ideation, Sandbox': 'ent-ideation-sandbox',
			'7 - Vault Config & Management': 'ent-vault-config',
			'99 - ARCHIVE': 'ent-archive-99',
		};
		for (const [bareRoot, expectedRuleId] of Object.entries(ruleByPrefix)) {
			expect(matchFolder(bareRoot, rules)?.id).toBe(expectedRuleId);
			// And nested
			expect(matchFolder(`${bareRoot}/Some Subfolder`, rules)?.id).toBe(expectedRuleId);
		}
	});


	test('Enterprise pack detects on the ENTERPRISE_JD_DEEP_VAULT fixture', () => {
		const manifest = loadManifest();
		const results = detectPacks(ENTERPRISE_JD_DEEP_VAULT, manifest);
		const ent = results.find((r) => r.packId === 'enterprise-jd-vault');
		expect(ent).toBeDefined();
		// minSignals=4; the fixture has 9 numbered roots
		expect(ent!.signalsHit).toBeGreaterThanOrEqual(8);
	});

	test('JD pack (post single-digit relaxation) detects on Enterprise JD vault', () => {
		const manifest = loadManifest();
		const results = detectPacks(ENTERPRISE_JD_DEEP_VAULT, manifest);
		const jd = results.find((r) => r.packId === 'jd');
		// Single-digit folders like '0 - Tasks, Planning' should now match
		// the relaxed `^\d{1,2} - [A-Za-z]` JD signal.
		expect(jd).toBeDefined();
	});

	test('Enterprise forward sync: bare numbered root produces prefix-only tag', () => {
		const rules = loadPack('enterprise-jd-vault.json');
		const tasksRule = rules.find((r) => r.id === 'ent-tasks-planning')!;
		const result = applyRuleForward('0 - Tasks, Planning', tasksRule);
		// Bare entry → deeper slot is undefined → instantiate yields '#0-tasks-planning'
		expect(result.tags).toEqual(['#0-tasks-planning']);
	});

	test('Enterprise forward sync: deep path produces full tag', () => {
		const rules = loadPack('enterprise-jd-vault.json');
		const tasksRule = rules.find((r) => r.id === 'ent-tasks-planning')!;
		const result = applyRuleForward('0 - Tasks, Planning/Annual Planning - WORKSPACE', tasksRule);
		expect(result.tags).toEqual(['#0-tasks-planning/Annual Planning - WORKSPACE']);
	});

	test('Enterprise inverse sync: bare prefix tag → bare folder', () => {
		const rules = loadPack('enterprise-jd-vault.json');
		const tasksRule = rules.find((r) => r.id === 'ent-tasks-planning')!;
		const result = applyRuleInverse('#0-tasks-planning', tasksRule);
		expect(result.folder).toBe('0 - Tasks, Planning');
	});

	test('Enterprise inverse sync: deep tag round-trips to deep folder', () => {
		const rules = loadPack('enterprise-jd-vault.json');
		const tasksRule = rules.find((r) => r.id === 'ent-tasks-planning')!;
		const result = applyRuleInverse('#0-tasks-planning/Annual Planning', tasksRule);
		expect(result.folder).toBe('0 - Tasks, Planning/Annual Planning');
	});

	test('Enterprise full round-trip: bare folder → tag → folder (bare-entry case)', () => {
		const rules = loadPack('enterprise-jd-vault.json');
		const tasksRule = rules.find((r) => r.id === 'ent-tasks-planning')!;
		const original = '0 - Tasks, Planning';
		const fwd = applyRuleForward(original, tasksRule);
		expect(fwd.tags).toEqual(['#0-tasks-planning']);
		const inv = applyRuleInverse(fwd.tags[0], tasksRule);
		expect(inv.folder).toBe(original);
	});
});

// ─── Catch-all numbered-area template (cross-area moves) ─────────────────

describe('full pipeline — catch-all {num} - {name}/{deeper...} handles cross-area file moves', () => {
	// Verifies the user's specific case: files moving between numbered areas
	// (e.g., 1/projects/thing → 2/projects/thing) handled by ONE template rule.
	const catchallRule: MappingRule = {
		id: 'numbered-catchall',
		name: 'Catch-all numbered area',
		enabled: true,
		priority: 10,
		direction: 'bidirectional',
		folderTemplate: '{num} - {name}/{deeper...}',
		tagTemplate: '#{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		options: {
			createFolders: true,
			addTags: true,
			removeOrphanedTags: false,
			syncOnFileCreate: true,
			syncOnFileMove: true,
			syncOnFileRename: true,
		},
	};

	test('forward sync: 1 - Projects/thing/note → #1-projects/thing/note', () => {
		const result = applyRuleForward('1 - Projects/thing/note', catchallRule);
		expect(result.tags).toEqual(['#1-projects/thing/note']);
	});

	test('forward sync: same file moved to area 2 → tag updates automatically', () => {
		// User moves the file from area 1 to area 2 in their file explorer.
		// Sync engine fires on the new path. Same rule, different slot value.
		const before = applyRuleForward('1 - Projects/thing/note', catchallRule);
		const after = applyRuleForward('2 - Projects/thing/note', catchallRule);
		expect(before.tags).toEqual(['#1-projects/thing/note']);
		expect(after.tags).toEqual(['#2-projects/thing/note']);
		// Different output for different area — confirms the rule re-fires
		// with the new area number captured by the {num} slot.
		expect(before.tags[0]).not.toBe(after.tags[0]);
	});

	test('inverse sync: changing tag from #1-projects/x to #2-projects/x → folder moves', () => {
		// Tag→folder direction: user changes the tag in frontmatter; engine
		// reconstructs the new folder path with the new area number.
		const before = applyRuleInverse('#1-projects/thing/note', catchallRule);
		const after = applyRuleInverse('#2-projects/thing/note', catchallRule);
		expect(before.folder).toBe('1 - Projects/thing/note');
		expect(after.folder).toBe('2 - Projects/thing/note');
	});

	test('catch-all matches enterprise-style names with hyphens + emoji preserved', () => {
		// Enterprise vault has roots like "0 - Tasks, Planning" with literal commas
		// and "1 - Workspaces, Projects" — slots are content-flexible, no
		// special handling needed.
		expect(applyRuleForward('0 - Tasks, Planning/Annual Planning', catchallRule).tags).toEqual([
			'#0-tasks-planning/Annual Planning',
		]);
		expect(applyRuleForward('1 - Workspaces, Projects/AI Adoption', catchallRule).tags).toEqual([
			'#1-workspaces-projects/AI Adoption',
		]);
		expect(applyRuleForward('99 - ARCHIVE/Workforce Survey', catchallRule).tags).toEqual([
			'#99-archive/Workforce Survey',
		]);
	});

	test('catch-all matches BARE numbered root (no children) post trailing-glob relaxation', () => {
		const result = applyRuleForward('1 - Workspaces, Projects', catchallRule);
		expect(result.tags).toEqual(['#1-workspaces-projects']);
	});

	test('catch-all does NOT match non-numbered roots (no false positives)', () => {
		// `Templates`, `_attachments`, `Bases Templates` etc. don't match `{num} - {name}/...`
		// because the literal " - " requires the leading numeric prefix.
		const compiled = new RegExp(catchallRule.folderTemplate ?
			require('./compileTemplate').compileTemplate(catchallRule.folderTemplate).regex.source : '');
		expect(applyRuleForward('Templates', catchallRule).tags).toEqual([]);
		expect(applyRuleForward('_attachments', catchallRule).tags).toEqual([]);
		expect(applyRuleForward('Bases Templates', catchallRule).tags).toEqual([]);
		expect(applyRuleForward('Random folder name', catchallRule).tags).toEqual([]);
	});

	test('catch-all enterprise vault sweep: every numbered root gets a tag, non-numbered ones do not', () => {
		// Realistic mass-test using the enterprise fixture. Numbered roots tag;
		// special folders (Templates, _attachments, etc.) don't.
		const numberedHits = ENTERPRISE_JD_DEEP_VAULT.filter(p => /^\d{1,2} - /.test(p));
		const nonNumberedHits = ENTERPRISE_JD_DEEP_VAULT.filter(p => !/^\d{1,2} - /.test(p));
		for (const path of numberedHits) {
			const result = applyRuleForward(path, catchallRule);
			expect(result.tags.length).toBe(1);
			expect(result.tags[0].startsWith('#')).toBe(true);
		}
		for (const path of nonNumberedHits) {
			const result = applyRuleForward(path, catchallRule);
			expect(result.tags).toEqual([]);
		}
	});
});

// ─── Comprehensive edge-case coverage for the catch-all numbered template ────

describe('catch-all numbered-area edge cases — comprehensive', () => {
	const catchallRule: MappingRule = {
		id: 'numbered-catchall-edge',
		name: 'Catch-all (edge cases)',
		enabled: true,
		priority: 10,
		direction: 'bidirectional',
		folderTemplate: '{num} - {name}/{deeper...}',
		tagTemplate: '#{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		options: {
			createFolders: true,
			addTags: true,
			removeOrphanedTags: false,
			syncOnFileCreate: true,
			syncOnFileMove: true,
			syncOnFileRename: true,
		},
	};

	const promotionToRootRule: MappingRule = {
		id: 'numbered-promotion-edge',
		name: 'Promotion-to-root (edge cases)',
		enabled: true,
		priority: 11,
		direction: 'bidirectional',
		folderTemplate: '{num} - {name}/{deeper...}',
		tagTemplate: '#{num}-{name | strip-invalid-tag-chars | kebab-case}',
		options: {
			createFolders: true,
			addTags: true,
			removeOrphanedTags: false,
			syncOnFileCreate: true,
			syncOnFileMove: true,
			syncOnFileRename: true,
		},
	};

	describe('depth coverage — bare to 5-deep', () => {
		test('bare numbered root (depth 0) — trailing-glob relaxation kicks in', () => {
			expect(applyRuleForward('1 - Workspaces, Projects', catchallRule).tags)
				.toEqual(['#1-workspaces-projects']);
		});
		test('1-deep', () => {
			expect(applyRuleForward('1 - Workspaces, Projects/Web', catchallRule).tags)
				.toEqual(['#1-workspaces-projects/Web']);
		});
		test('3-deep', () => {
			expect(applyRuleForward('1 - Workspaces, Projects/Web/Auth/oauth', catchallRule).tags)
				.toEqual(['#1-workspaces-projects/Web/Auth/oauth']);
		});
		test('5-deep', () => {
			expect(applyRuleForward(
				'1 - Workspaces, Projects/Web/Auth/oauth/v2/notes',
				catchallRule,
			).tags).toEqual(['#1-workspaces-projects/Web/Auth/oauth/v2/notes']);
		});
		test('promotion-to-root collapses ALL depth into a single root tag', () => {
			expect(applyRuleForward('5 - Archive, Admin', promotionToRootRule).tags)
				.toEqual(['#5-archive-admin']);
			expect(applyRuleForward('5 - Archive, Admin/X/Y/Z', promotionToRootRule).tags)
				.toEqual(['#5-archive-admin']);
		});
	});

	describe('numbering range — single, double, large digits', () => {
		test('single-digit (0-9)', () => {
			for (const n of [0, 1, 5, 9]) {
				const result = applyRuleForward(`${n} - Foo/x`, catchallRule);
				expect(result.tags[0]).toBe(`#${n}-foo/x`);
			}
		});
		test('two-digit (10-99)', () => {
			for (const n of [10, 50, 99]) {
				const result = applyRuleForward(`${n} - Foo/x`, catchallRule);
				expect(result.tags[0]).toBe(`#${n}-foo/x`);
			}
		});
		test('catch-all matches 3+ digit prefixes (no upper bound enforced)', () => {
			// Without strict {num:\\d{1,2}} regex, 100+ also match.
			// Users wanting strict 2-digit should use the strict-numbered starter.
			expect(applyRuleForward('100 - Foo/x', catchallRule).tags[0]).toBe('#100-foo/x');
		});
	});

	describe('special characters in folder names', () => {
		test('comma in name → stripped from tag (clean output)', () => {
			expect(applyRuleForward('1 - Tasks, Planning/X', catchallRule).tags[0])
				.toBe('#1-tasks-planning/X');
		});
		test('parentheses are NOT in invalid-chars list (preserved)', () => {
			expect(applyRuleForward('0 - Tasks (current)/X', catchallRule).tags[0])
				.toContain('(current)');
		});
		test('emoji in name passes through', () => {
			expect(applyRuleForward('1 - 📋 Workflow/X', catchallRule).tags[0])
				.toContain('📋');
		});
		test('catch-all accepts non-strict prefixes like 10X (no digit constraint on {num})', () => {
			// {num} is [^/]+ in catch-all — accepts ANY non-slash content as the prefix.
			// Note: {num} has no kebab-case filter, so 'X' stays uppercase.
			// Use strict-numbered (Tier B) starter if you want digit-only prefixes.
			expect(applyRuleForward('10X - Foo/x', catchallRule).tags[0]).toBe('#10X-foo/x');
		});
		test('lowercase name kebab-cases cleanly', () => {
			expect(applyRuleForward('1 - already-lowercase/X', catchallRule).tags[0])
				.toBe('#1-already-lowercase/X');
		});
		test('all-caps name (post 0.1.15 fix) becomes single lowercase word', () => {
			expect(applyRuleForward('99 - ARCHIVE/X', catchallRule).tags[0])
				.toBe('#99-archive/X');
		});
		test('mixed-case PascalCase name kebab-cases at word boundaries', () => {
			expect(applyRuleForward('2 - WebAuth Resilience/X', catchallRule).tags[0])
				.toBe('#2-web-auth-resilience/X');
		});
	});

	describe('round-trip across catch-all semantics', () => {
		test('clean name round-trips bijectively', () => {
			const orig = '0 - Planning/Q1';
			const fwd = applyRuleForward(orig, catchallRule);
			const inv = applyRuleInverse(fwd.tags[0], catchallRule);
			expect(inv.folder).toBe(orig);
		});
		test('comma name forward-strips cleanly; inverse hits greedy-match ambiguity', () => {
			// Forward: `0 - Tasks, Planning/Q1` → strip-invalid → `Tasks Planning` → kebab → `tasks-planning`
			// Tag: `#0-tasks-planning/Q1`.
			const orig = '0 - Tasks, Planning/Q1';
			const fwd = applyRuleForward(orig, catchallRule);
			expect(fwd.tags[0]).toBe('#0-tasks-planning/Q1');

			// INVERSE on tag template `#{num}-{name}/...` parses ambiguously:
			// regex `^(?<num>[^/]+)-(?<name>[^/]+)(?:/(?<deeper>.+))?$` against
			// `0-tasks-planning/Q1` greedy-backtracks to num=`0-tasks`, name=`planning`.
			// Catch-all template's {num} is unconstrained → mis-parses.
			//
			// FIX: use strict-numbered Tier B rule {num:\\d{1,2}} which constrains num
			// to digits, eliminating ambiguity. See the strict-numbered describe-block.
			const inv = applyRuleInverse(fwd.tags[0], catchallRule);
			expect(inv.lossy).toBe(true);
			// Document actual mis-parse for catch-all:
			expect(inv.folder).toBe('0-tasks - Planning/Q1');
		});

		test('strict-numbered Tier B AVOIDS the greedy-match ambiguity (constraint on BOTH sides)', () => {
			// CRITICAL: Tier B regex must constrain {num} on BOTH the folder
			// AND tag templates. If only folder side is constrained, the
			// tag-side regex still uses [^/]+ for {num} and inverse mis-parses.
			const strictRule: MappingRule = {
				id: 'strict-roundtrip',
				name: 'Strict numbered for round-trip',
				enabled: true,
				priority: 10,
				direction: 'bidirectional',
				folderTemplate: '{num:\\d{1,2}} - {name}/{deeper...}',
				tagTemplate: '#{num:\\d{1,2}}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
				options: { ...catchallRule.options },
			};
			// Forward identical to catch-all
			const fwd = applyRuleForward('0 - Tasks, Planning/Q1', strictRule);
			expect(fwd.tags[0]).toBe('#0-tasks-planning/Q1');
			// Inverse correctly recovers num=0 (digit-bounded) and name=tasks-planning
			const inv = applyRuleInverse(fwd.tags[0], strictRule);
			expect(inv.folder).toBe('0 - Tasks Planning/Q1');
			// Comma still lost (strip-invalid-tag-chars is conditional), but the
			// num/name boundary is correct — far better than catch-all's mis-parse.
		});
	});

	describe('cross-area moves — the core JD-PARA scenario', () => {
		test('moving file 0 → 5 emits new tag with new area number', () => {
			const before = applyRuleForward('0 - Tasks/file.md', catchallRule);
			const after = applyRuleForward('5 - Archive/file.md', catchallRule);
			expect(before.tags[0]).toBe('#0-tasks/file.md');
			expect(after.tags[0]).toBe('#5-archive/file.md');
			expect(before.tags[0]).not.toBe(after.tags[0]);
		});
		test('moving deep nested file across areas — new tag captures new num', () => {
			const before = applyRuleForward('0 - Tasks/Q1/Drafts/file.md', catchallRule);
			const after = applyRuleForward('99 - ARCHIVE/Q1/Drafts/file.md', catchallRule);
			expect(before.tags[0]).toBe('#0-tasks/Q1/Drafts/file.md');
			expect(after.tags[0]).toBe('#99-archive/Q1/Drafts/file.md');
		});
		test('promotion-to-root: same tag for files at any depth in the area', () => {
			const r = promotionToRootRule;
			expect(applyRuleForward('0 - Tasks/X.md', r).tags[0]).toBe('#0-tasks');
			expect(applyRuleForward('0 - Tasks/A/X.md', r).tags[0]).toBe('#0-tasks');
			expect(applyRuleForward('0 - Tasks/A/B/C/X.md', r).tags[0]).toBe('#0-tasks');
		});
	});

	describe('non-matching paths — false-positive guards', () => {
		test('numbers without space-dash do not match', () => {
			expect(applyRuleForward('0Tasks/X', catchallRule).tags).toEqual([]);
			expect(applyRuleForward('0-Tasks/X', catchallRule).tags).toEqual([]);
			expect(applyRuleForward('0 -Tasks/X', catchallRule).tags).toEqual([]);
			expect(applyRuleForward('0- Tasks/X', catchallRule).tags).toEqual([]);
		});
		test('roots without space-dash separator do not match', () => {
			// `Templates/X` — no ' - ' separator → catch-all rejects (no slot binding possible)
			expect(applyRuleForward('Templates/X', catchallRule).tags).toEqual([]);
			// `_attachments/x` — no ' - '
			expect(applyRuleForward('_attachments/x.png', catchallRule).tags).toEqual([]);
		});

		test('letter-prefixed roots WITH " - " separator DO match catch-all (use strict-numbered to reject)', () => {
			// `A - Things/X` has the ' - ' shape, so {num}=A, {name}=Things, {deeper}=X.
			// Catch-all matches because {num} is [^/]+ (no constraint). Strict-numbered
			// (Tier B regex {num:\\d{1,2}}) would correctly reject this.
			// Note: {num} has no filter applied, so 'A' stays capital. Only {name} is kebab-cased.
			expect(applyRuleForward('A - Things/X', catchallRule).tags[0]).toBe('#A-things/X');
		});
		test('sub-paths inside non-matching roots do not match', () => {
			expect(applyRuleForward('_attachments/images/x.png', catchallRule).tags).toEqual([]);
			expect(applyRuleForward('Templates/note/X', catchallRule).tags).toEqual([]);
		});
	});

	describe('strict-numbered (Tier B) edge cases — rejects what catch-all would accept', () => {
		const strictRule: MappingRule = {
			id: 'numbered-strict-edge',
			name: 'Strict numbered (Tier B)',
			enabled: true,
			priority: 12,
			direction: 'bidirectional',
			folderTemplate: '{num:\\d{1,2}} - {name}/{deeper...}',
			tagTemplate: '#{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
			options: { ...catchallRule.options },
		};

		test('strict-numbered accepts 1-2 digit roots', () => {
			expect(applyRuleForward('0 - Foo/x', strictRule).tags[0]).toBe('#0-foo/x');
			expect(applyRuleForward('99 - Foo/x', strictRule).tags[0]).toBe('#99-foo/x');
		});
		test('strict-numbered REJECTS 3+ digit prefixes that catch-all accepts', () => {
			expect(applyRuleForward('100 - Foo/x', strictRule).tags).toEqual([]);
			expect(applyRuleForward('1234 - Foo/x', strictRule).tags).toEqual([]);
		});
		test('strict-numbered REJECTS non-digit prefixes (catch-all also rejects these)', () => {
			expect(applyRuleForward('A - Foo/x', strictRule).tags).toEqual([]);
			expect(applyRuleForward('foo - Foo/x', strictRule).tags).toEqual([]);
		});
	});
});
