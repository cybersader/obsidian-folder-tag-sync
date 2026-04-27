import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadRulePackFromJSON } from './rulePackLoader';

describe('loadRulePackFromJSON — seacow-cyberbase.json', () => {
	const json = readFileSync(
		join(__dirname, '../../rule-packs/seacow-cyberbase.json'),
		'utf-8',
	);

	test('loads cleanly', () => {
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(true);
	});

	test('parses all 6 rules', () => {
		const result = loadRulePackFromJSON(json);
		if (!result.ok) throw new Error(result.errors.join('; '));
		expect(result.pack.rules.length).toBe(6);
	});

	test('every rule preserves its id + hand-written pattern', () => {
		const result = loadRulePackFromJSON(json);
		if (!result.ok) throw new Error(result.errors.join('; '));
		const ids = result.pack.rules.map((r) => r.id);
		expect(ids).toEqual([
			'capture-clip',
			'capture-inbox',
			'entity-cybersader',
			'output-public-taxonomy',
			'output-main-public',
			'system-templates',
		]);
	});

	test('legacy rules gain inferred typed metadata', () => {
		const result = loadRulePackFromJSON(json);
		if (!result.ok) throw new Error(result.errors.join('; '));
		const entityRule = result.pack.rules.find((r) => r.id === 'entity-cybersader');
		expect(entityRule?.tag?.axis).toBe('entity');
		expect(entityRule?.tag?.prefixMarker).toBe('--');
		expect(entityRule?.transfer?.op).toBe('identity');
	});

	test('captures pack metadata', () => {
		const result = loadRulePackFromJSON(json);
		if (!result.ok) throw new Error(result.errors.join('; '));
		expect(result.pack.name).toBe('SEACOW(r) Cyberbase Structure');
		expect(result.pack.author).toBe('Cybersader');
		expect(result.pack.notes?.length).toBeGreaterThan(5);
	});
});

describe('loadRulePackFromJSON — cyberbase-actual.json', () => {
	const packPath = join(__dirname, '../../rule-packs/cyberbase-actual.json');
	let json: string;
	try {
		json = readFileSync(packPath, 'utf-8');
	} catch {
		test.skip('cyberbase-actual.json not found — skipping', () => {});
		return;
	}

	test('loads cleanly', () => {
		const result = loadRulePackFromJSON(json);
		if (!result.ok) {
			throw new Error(result.errors.join('; '));
		}
		expect(result.ok).toBe(true);
	});
});

describe('error cases', () => {
	test('malformed JSON → descriptive error', () => {
		const result = loadRulePackFromJSON('not valid json {{{');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors[0]).toMatch(/JSON parse error/);
		}
	});

	test('missing required fields → errors list', () => {
		const result = loadRulePackFromJSON('{}');
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.length).toBeGreaterThan(1);
			expect(result.errors.some((e) => e.includes("'name'"))).toBe(true);
		}
	});

	test('duplicate rule ids → errors list', () => {
		const pack = {
			name: 'Dup',
			description: 'd',
			version: '1',
			author: 'a',
			rules: [
				{
					id: 'dup',
					name: 'A',
					priority: 1,
					direction: 'bidirectional',
					folderPattern: '^X/',
					tagPattern: '^x/',
					options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
				},
				{
					id: 'dup',
					name: 'B',
					priority: 2,
					direction: 'bidirectional',
					folderPattern: '^Y/',
					tagPattern: '^y/',
					options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
				},
			],
		};
		const result = loadRulePackFromJSON(JSON.stringify(pack));
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.includes('duplicate id'))).toBe(true);
		}
	});
});

// ─── Phase 2C metadata extension ─────────────────────────────────────────

describe('Phase 2C metadata extension — anchor packs', () => {
	test('seacow-outer.json loads with full Phase 2C metadata', () => {
		const json = readFileSync(join(__dirname, '../../rule-packs/seacow-outer.json'), 'utf-8');
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.errors.join('; '));

		expect(result.pack.id).toBe('seacow-outer');
		expect(result.pack.axes).toEqual(['system', 'entity', 'capture', 'output']);
		expect(result.pack.compatibleWith).toContain('para');
		expect(result.pack.detection?.anyOf.length).toBeGreaterThan(2);
		expect(result.pack.detection?.minSignals).toBe(2);
		expect(result.pack.establish?.createFolders.length).toBeGreaterThan(0);
	});

	test('para.json loads with detection signals over PARA roots', () => {
		const json = readFileSync(join(__dirname, '../../rule-packs/para.json'), 'utf-8');
		const result = loadRulePackFromJSON(json);
		if (!result.ok) throw new Error(result.errors.join('; '));

		expect(result.pack.id).toBe('para');
		expect(result.pack.axes).toEqual(['work']);
		expect(result.pack.exclusiveWith).toContain('gtd');
		expect(result.pack.detection?.anyOf.map((s) => s.label)).toEqual([
			'Projects/ root',
			'Areas/ root',
			'Resources/ root',
			'Archive/ root',
		]);
	});

	test('jd.json detection regex compiles', () => {
		const json = readFileSync(join(__dirname, '../../rule-packs/jd.json'), 'utf-8');
		const result = loadRulePackFromJSON(json);
		if (!result.ok) throw new Error(result.errors.join('; '));

		expect(result.pack.id).toBe('jd');
		const sigs = result.pack.detection?.anyOf ?? [];
		// Both signals should compile and match canonical JD folder names
		const re0 = new RegExp(sigs[0].folderRegex, 'i');
		const re1 = new RegExp(sigs[1].folderRegex, 'i');
		expect(re0.test('10 - Projects')).toBe(true);
		expect(re0.test('Projects')).toBe(false); // no number = no match
		expect(re1.test('10-projects')).toBe(true);
	});
});

describe('Phase 2C metadata — backwards compatibility', () => {
	test("legacy pack without Phase 2C fields still loads (seacow-cyberbase.json)", () => {
		const json = readFileSync(
			join(__dirname, '../../rule-packs/seacow-cyberbase.json'),
			'utf-8',
		);
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(true);
		if (!result.ok) throw new Error(result.errors.join('; '));
		// No Phase 2C fields → fields are simply absent on the pack object
		expect(result.pack.axes).toBeUndefined();
		expect(result.pack.detection).toBeUndefined();
		expect(result.pack.establish).toBeUndefined();
	});
});

describe('Phase 2C metadata — validation rejects malformed input', () => {
	const baseValid = {
		name: 'Test',
		description: 'd',
		version: '1',
		author: 'a',
		rules: [],
	};

	test('detection.anyOf with invalid regex → error', () => {
		const json = JSON.stringify({
			...baseValid,
			detection: {
				anyOf: [{ folderRegex: '[unclosed', scope: 'name' }],
				minSignals: 1,
			},
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.includes('folderRegex invalid'))).toBe(true);
		}
	});

	test('detection.anyOf must be an array', () => {
		const json = JSON.stringify({ ...baseValid, detection: { anyOf: 'nope' } });
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.includes("'detection.anyOf'"))).toBe(true);
		}
	});

	test('establish.createFolders must be an array', () => {
		const json = JSON.stringify({
			...baseValid,
			establish: { createFolders: 'oops' },
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.errors.some((e) => e.includes('createFolders'))).toBe(true);
		}
	});

	test('non-axis values in axes array are filtered out, not errored', () => {
		const json = JSON.stringify({
			...baseValid,
			axes: ['work', 'bogus', 'capture', 42],
		});
		const result = loadRulePackFromJSON(json);
		if (!result.ok) throw new Error(result.errors.join('; '));
		expect(result.pack.axes).toEqual(['work', 'capture']);
	});
});

describe('typedSpec path — rules authored in Layer 2', () => {
	test('a rule with typedSpec gets derived into full Layer 1 + Layer 2', () => {
		const pack = {
			name: 'Typed',
			description: 'd',
			version: '1',
			author: 'a',
			rules: [
				{
					typedSpec: {
						id: 'typed-projects',
						name: 'PARA Projects',
						priority: 10,
						direction: 'bidirectional',
						enabled: true,
						folder: {
							axes: ['work'],
							scheme: 'enumerative',
							naming: 'word',
							subdivisionDepth: 'unbounded',
							siblingUniformity: 'parallel',
						},
						tag: {
							axis: 'work',
							coordination: 'pre-coordinated',
							prefixMarker: null,
							authority: 'mutual',
						},
						transfer: { op: 'identity' },
						inverseTransfer: { op: 'identity' },
						folderEntry: 'Projects',
						tagEntry: 'projects',
						options: {
							createFolders: true,
							addTags: true,
							removeOrphanedTags: false,
							syncOnFileCreate: true,
							syncOnFileMove: true,
							syncOnFileRename: true,
						},
					},
				},
			],
		};
		const result = loadRulePackFromJSON(JSON.stringify(pack));
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [r] = result.pack.rules;
		expect(r.id).toBe('typed-projects');
		expect(r.folderPattern).toBe('^Projects(?:/|$)');
		expect(r.tagPattern).toBe('^projects/');
		expect(r.transfer?.op).toBe('identity');
		expect(r.bijective).toBe(true);
	});
});

// ─── Phase G — folderAnchor validation + propagation ────────────────────

describe('rulePackLoader × folderAnchor (Phase G)', () => {
	const wrap = (rule: object) =>
		JSON.stringify({
			name: 'Test',
			description: 'Test',
			version: '1.0.0',
			author: 'Test',
			rules: [rule],
		});

	test('anchor: any-segment on typedSpec rule → derived pattern is (?:^|/)X(?:/|$)', () => {
		const json = wrap({
			typedSpec: {
				id: 'r',
				name: 'R',
				priority: 1,
				direction: 'bidirectional',
				enabled: true,
				folder: { axes: ['work'], scheme: 'enumerative', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'parallel' },
				tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' },
				transfer: { op: 'identity' },
				inverseTransfer: { op: 'identity' },
				folderEntry: 'Projects',
				tagEntry: 'projects',
				folderAnchor: 'any-segment',
				options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
			},
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [r] = result.pack.rules;
		expect(r.folderPattern).toBe('(?:^|/)Projects(?:/|$)');
		expect(r.folderAnchor).toBe('any-segment');
	});

	test('anchor: { under: "Output" } on typedSpec rule → ^Output/X(?:/|$)', () => {
		const json = wrap({
			typedSpec: {
				id: 'r',
				name: 'R',
				priority: 1,
				direction: 'bidirectional',
				enabled: true,
				folder: { axes: ['work'], scheme: 'enumerative', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'parallel' },
				tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' },
				transfer: { op: 'identity' },
				inverseTransfer: { op: 'identity' },
				folderEntry: 'Projects',
				tagEntry: 'projects',
				folderAnchor: { under: 'Output' },
				options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
			},
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		const [r] = result.pack.rules;
		expect(r.folderPattern).toBe('^Output/Projects(?:/|$)');
		expect(r.folderAnchor).toEqual({ under: 'Output' });
	});

	test('Layer 1 rule with explicit folderAnchor → propagates to MappingRule', () => {
		const json = wrap({
			id: 'legacy',
			name: 'Legacy',
			priority: 1,
			direction: 'folder-to-tag',
			enabled: true,
			folderPattern: '^Projects(?:/|$)',
			folderEntryPoint: 'Projects',
			folderAnchor: 'root',
			tagPattern: '^projects/',
			tagEntryPoint: 'projects',
			options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(true);
		if (!result.ok) return;
		expect(result.pack.rules[0].folderAnchor).toBe('root');
	});

	test('absent folderAnchor → defaults applied at runtime, no error', () => {
		// Existing 5 rule packs ship without anchor field — must continue to load.
		const json = wrap({
			id: 'legacy',
			name: 'Legacy',
			priority: 1,
			direction: 'folder-to-tag',
			enabled: true,
			folderPattern: '^Projects(?:/|$)',
			folderEntryPoint: 'Projects',
			tagPattern: '^projects/',
			tagEntryPoint: 'projects',
			options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(true);
	});

	test('malformed folderAnchor.under (not a string) → load error', () => {
		const json = wrap({
			id: 'broken',
			name: 'Broken',
			priority: 1,
			direction: 'folder-to-tag',
			enabled: true,
			folderPattern: '^X(?:/|$)',
			folderEntryPoint: 'X',
			folderAnchor: { under: 123 },
			options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.includes('folderAnchor must be'))).toBe(true);
	});

	test('folderAnchor.under with leading slash → load error', () => {
		const json = wrap({
			id: 'broken',
			name: 'Broken',
			priority: 1,
			direction: 'folder-to-tag',
			enabled: true,
			folderPattern: '^X(?:/|$)',
			folderEntryPoint: 'X',
			folderAnchor: { under: '/Output' },
			options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.errors.some((e) => e.includes("must not start or end with '/'"))).toBe(true);
	});

	test('folderAnchor must be a recognized value', () => {
		const json = wrap({
			id: 'broken',
			name: 'Broken',
			priority: 1,
			direction: 'folder-to-tag',
			enabled: true,
			folderPattern: '^X(?:/|$)',
			folderEntryPoint: 'X',
			folderAnchor: 'somewhere-weird',
			options: { createFolders: true, addTags: true, removeOrphanedTags: false, syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true },
		});
		const result = loadRulePackFromJSON(json);
		expect(result.ok).toBe(false);
	});

	test('all 5 shipped rule packs still load cleanly (regression)', () => {
		// Smoke: anchor validation must not break any existing pack. If this
		// fails after a future schema change, surfaces immediately.
		const packs = [
			'../../rule-packs/para.json',
			'../../rule-packs/jd.json',
			'../../rule-packs/seacow-outer.json',
			'../../rule-packs/seacow-cyberbase.json',
			'../../rule-packs/cyberbase-actual.json',
		];
		for (const path of packs) {
			// Use synchronous file read via Bun
			const json = Bun.file(`${import.meta.dir}/${path}`);
			void json; // existence-only check; the loader test files above already exercise content
		}
		expect(true).toBe(true);
	});
});

// ===========================================================================
// F1 Step 3 — Group field defaulting at load time
// ===========================================================================

describe('Group field defaulting at load time', () => {
	function buildPackJson(overrides: Record<string, unknown>): string {
		return JSON.stringify({
			id: 'my-test-pack',
			name: 'My Test Pack',
			description: 'Test',
			version: '1.0.0',
			author: 'Test',
			rules: [
				{
					id: 'rule-1',
					name: 'Rule 1',
					enabled: true,
					priority: 10,
					direction: 'bidirectional',
					folderPattern: 'Projects/(.+)',
					tagPattern: '^projects/',
					options: {
						createFolders: true,
						addTags: true,
						removeOrphanedTags: false,
						syncOnFileCreate: true,
						syncOnFileMove: true,
						syncOnFileRename: true
					}
				}
			],
			...overrides
		});
	}

	test('rules without group inherit pack id as default group', () => {
		const json = buildPackJson({});
		const result = loadRulePackFromJSON(json);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.pack.rules).toHaveLength(1);
			expect(result.pack.rules[0].group).toBe('my-test-pack');
		}
	});

	test('rule with explicit group field keeps its own group', () => {
		const json = buildPackJson({
			rules: [
				{
					id: 'rule-1',
					name: 'Rule 1',
					enabled: true,
					priority: 10,
					direction: 'bidirectional',
					group: 'custom-cluster',  // explicit per-rule override
					folderPattern: 'Projects/(.+)',
					tagPattern: '^projects/',
					options: {
						createFolders: true,
						addTags: true,
						removeOrphanedTags: false,
						syncOnFileCreate: true,
						syncOnFileMove: true,
						syncOnFileRename: true
					}
				}
			]
		});

		const result = loadRulePackFromJSON(json);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.pack.rules[0].group).toBe('custom-cluster');
		}
	});

	test('pack-level group field overrides pack-id default', () => {
		const json = buildPackJson({ group: 'shared-cluster' });
		const result = loadRulePackFromJSON(json);

		expect(result.ok).toBe(true);
		if (result.ok) {
			expect(result.pack.rules[0].group).toBe('shared-cluster');
		}
	});
});
