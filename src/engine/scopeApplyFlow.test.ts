/**
 * Integration tests for the apply-with-scope flow that DetectVaultModal
 * runs when the user clicks "Apply" with selected folders. Exercises the
 * end-to-end engine path: detect → cross-pack hit map → minimal cover →
 * scoped pack plan → scoped rules.
 *
 * These tests don't touch Obsidian — they just simulate the data flow
 * with a synthetic vault folder list and a hand-rolled detection result.
 * The wdio E2E spec exercises the same flow through the real plugin UI;
 * this suite catches regressions faster.
 */

import { describe, expect, test } from 'bun:test';
import { detectPacks, type ManifestPackEntry } from './detectPacks';
import { collectCrossPackHits, buildAnnotatedTree } from './detectionTree';
import { minimalScopeCover, scopeRules } from './scopeRules';
import { compileTemplate } from './compileTemplate';
import type { MappingRule } from '../types/settings';

// Realistic JD pack manifest entry with detection signals
const jdPack: ManifestPackEntry = {
	id: 'jd',
	name: 'Johnny Decimal',
	axes: ['JD'],
	detection: {
		anyOf: [
			{ folderRegex: '^\\d+\\s*-\\s*[A-Za-z]', label: 'numbered folder', scope: 'name' },
		],
		minSignals: 1,
	},
};

const baseRule: MappingRule = {
	id: 'jd-numbered',
	name: 'JD numbered folder',
	enabled: true,
	priority: 10,
	direction: 'folder-to-tag',
	folderTemplate: '{num} - {name}/{deeper...}',
	tagTemplate: '#{num}-{name | kebab-case}/{deeper...}',
	folderPattern: compileTemplate('{num} - {name}/{deeper...}').regex.source,
	tagPattern: compileTemplate('#{num}-{name | kebab-case}/{deeper...}').regex.source,
	folderEntryPoint: '',
	options: {
		createFolders: true,
		addTags: true,
		removeOrphanedTags: false,
		syncOnFileCreate: true,
		syncOnFileMove: true,
		syncOnFileRename: true,
	},
};

const NESTED_VAULT = [
	'01 - Projects',
	'01 - Projects/Cybersader',
	'01 - Projects/Cybersader/01 - Active',
	'01 - Projects/Cybersader/02 - Archive',
	'01 - Projects/Cybersader/03 - Reference',
	'02 - Areas',
	'02 - Areas/Health',
	'03 - Resources',
	'Templates',
];

describe('scope apply flow — nested JD-in-SEACOW vault', () => {
	test('detection finds JD signals at root + nested anchors', () => {
		const results = detectPacks(NESTED_VAULT, [jdPack]);
		expect(results.length).toBe(1);
		// JD signal `^\d+\s*-` matches: 01-Projects, 01-Active, 02-Archive,
		// 03-Reference, 02-Areas, 03-Resources = 6 hits
		expect(results[0].matchedSignals[0].exampleMatches.length).toBeGreaterThan(0);
	});

	test('cross-pack hit map collects all 6 JD matches', () => {
		const results = detectPacks(NESTED_VAULT, [jdPack]);
		const hitMap = collectCrossPackHits(NESTED_VAULT, results, new Map([['jd', 'JD']]));
		expect(hitMap.hitsByPath.size).toBe(6); // All JD-numbered folders
		// Specifically the nested JD folders should be present
		expect(hitMap.hitsByPath.has('01 - Projects/Cybersader/01 - Active')).toBe(true);
		expect(hitMap.hitsByPath.has('01 - Projects/Cybersader/02 - Archive')).toBe(true);
		// And the root-level JD folders
		expect(hitMap.hitsByPath.has('01 - Projects')).toBe(true);
		expect(hitMap.hitsByPath.has('02 - Areas')).toBe(true);
		expect(hitMap.hitsByPath.has('03 - Resources')).toBe(true);
	});

	test('annotated tree elides Templates branch', () => {
		const results = detectPacks(NESTED_VAULT, [jdPack]);
		const hitMap = collectCrossPackHits(NESTED_VAULT, results, new Map([['jd', 'JD']]));
		const tree = buildAnnotatedTree(NESTED_VAULT, hitMap);
		expect(tree.root.children.has('Templates')).toBe(false);
		expect(tree.root.elidedChildCount).toBeGreaterThanOrEqual(1); // Templates
	});

	test('selecting only nested JD branch scopes rules to that path', () => {
		// User selects ONLY `01 - Projects/Cybersader` (not the outer
		// numbered folders). Cover stays as just that path. Rules from
		// the JD pack get scoped to that path so they only fire under it.
		const selected = ['01 - Projects/Cybersader'];
		const cover = minimalScopeCover(selected);
		expect(cover).toEqual(['01 - Projects/Cybersader']);

		const scoped = scopeRules([baseRule], cover[0]);
		expect(scoped.length).toBe(1);
		expect(scoped[0].folderEntryPoint).toBe('01 - Projects/Cybersader');
		expect(scoped[0].folderTemplate).toBe('01 - Projects/Cybersader/{num} - {name}/{deeper...}');
		// id has scope-slug suffix — distinguishes from a same-pack rule scoped elsewhere
		expect(scoped[0].id).toBe('jd-numbered__01-projects-cybersader');
	});

	test('selecting both root + nested folds nested into root scope', () => {
		// Selecting Projects AND Projects/Cybersader → cover reduces to
		// Projects. The user's inner selection is "absorbed" — JD rules
		// scoped to Projects already cover everything beneath.
		const selected = ['01 - Projects', '01 - Projects/Cybersader'];
		const cover = minimalScopeCover(selected);
		expect(cover).toEqual(['01 - Projects']);
	});

	test('selecting non-overlapping branches yields independent scopes', () => {
		// 01-Projects/Cybersader/01-Active and 02-Areas are independent.
		// Cover keeps both. Apply produces TWO scoped rule sets.
		const selected = ['01 - Projects/Cybersader/01 - Active', '02 - Areas'];
		const cover = minimalScopeCover(selected);
		expect(cover.sort()).toEqual([
			'01 - Projects/Cybersader/01 - Active',
			'02 - Areas',
		]);

		const allScoped: MappingRule[] = [];
		for (const scope of cover) {
			allScoped.push(...scopeRules([baseRule], scope));
		}
		expect(allScoped.length).toBe(2);
		expect(allScoped[0].folderEntryPoint).not.toBe(allScoped[1].folderEntryPoint);
		expect(allScoped[0].id).not.toBe(allScoped[1].id);
	});

	test('scoped rule patterns actually match folders inside their scope', () => {
		// Sanity: after scoping, the rewritten folderPattern should match
		// something inside the scope and NOT match folders outside.
		const scoped = scopeRules([baseRule], '01 - Projects/Cybersader');
		const pattern = scoped[0].folderPattern!;
		const regex = new RegExp(pattern);
		// Inside the scope: matches
		expect(regex.test('01 - Projects/Cybersader/01 - Active')).toBe(true);
		// Outside the scope: doesn't match (would have been a false positive
		// without scoping)
		expect(regex.test('02 - Areas/01 - Sub')).toBe(false);
		expect(regex.test('Random/Folder')).toBe(false);
	});
});

describe('scope apply flow — single-JD vault (no nesting)', () => {
	const SIMPLE = ['01 - Projects', '02 - Areas', 'Templates'];

	test('selecting all top-level hits produces vault-root-equivalent scopes', () => {
		const selected = ['01 - Projects', '02 - Areas'];
		const cover = minimalScopeCover(selected);
		// Both kept; neither is ancestor of other
		expect(cover.sort()).toEqual(['01 - Projects', '02 - Areas']);

		// Each is its own scope — JD rules end up scoped to each folder.
		// User intent: "JD numbering inside Projects, JD numbering inside Areas"
		// — this works for shallow JD where the *children* of these folders
		// would be numbered. (For top-level JD where Projects ITSELF is the
		// numbered folder, the rule pattern matches the folder name; scope
		// is the parent, vault root → empty selection in our cover.)
		expect(cover.length).toBe(2);
	});

	test('detect + select-all + apply produces N scopes for N independent hits', () => {
		const results = detectPacks(SIMPLE, [jdPack]);
		const hitMap = collectCrossPackHits(SIMPLE, results, new Map([['jd', 'JD']]));
		const allHitFolders = [...hitMap.hitsByPath.keys()];
		const cover = minimalScopeCover(allHitFolders);
		// Only top-level hits, no nesting → cover = same as input
		expect(cover.sort()).toEqual(allHitFolders.sort());
	});
});
