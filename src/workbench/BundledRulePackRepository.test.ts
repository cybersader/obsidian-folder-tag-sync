import { beforeAll, describe, expect, test } from 'bun:test';
import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	readdirSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import bundledCatalog from '../../rule-packs/catalog.json';
import { loadRulePackFromObject } from '../engine/rulePackLoader';
import { BundledRulePackRepository } from './BundledRulePackRepository';

const PROJECT_ROOT = join(import.meta.dir, '../..');
const PACKS_DIR = join(PROJECT_ROOT, 'rule-packs');
const BUILD_SCRIPT = join(PROJECT_ROOT, 'scripts/build-rule-pack-manifest.mjs');
const GENERATED_FILES = new Set(['manifest.json', 'catalog.json']);

interface ManifestShape {
	packCount: number;
	packs: Array<{ id: string; file: string }>;
}

function readGenerated<T>(filename: string): T {
	return JSON.parse(readFileSync(join(PACKS_DIR, filename), 'utf-8')) as T;
}

function runGenerator(): void {
	const result = Bun.spawnSync({
		cmd: ['node', BUILD_SCRIPT],
		cwd: PROJECT_ROOT,
		stdout: 'pipe',
		stderr: 'pipe',
	});
	if (result.exitCode !== 0) {
		throw new Error(result.stderr.toString() || result.stdout.toString());
	}
}

beforeAll(() => {
	// The second pass proves the first pass's generated catalog is not treated
	// as a source pack on subsequent builds.
	runGenerator();
	runGenerator();
});

describe('generated bundled rule-pack catalog', () => {
	test('manifest and catalog contain the same deterministic ids', () => {
		const manifest = readGenerated<ManifestShape>('manifest.json');
		const catalog = readGenerated<Record<string, unknown>>('catalog.json');
		const manifestIds = manifest.packs.map((pack) => pack.id);

		expect(Object.keys(catalog)).toEqual(manifestIds);
		expect(manifest.packCount).toBe(manifestIds.length);
	});

	test('catalog entries are exact copies of their source packs', () => {
		const manifest = readGenerated<ManifestShape>('manifest.json');
		const catalog = readGenerated<Record<string, unknown>>('catalog.json');

		for (const pack of manifest.packs) {
			const source = JSON.parse(readFileSync(join(PACKS_DIR, pack.file), 'utf-8')) as unknown;
			expect(catalog[pack.id]).toEqual(source);
		}
	});

	test('every raw catalog pack loads through the production object loader', () => {
		const catalog = readGenerated<Record<string, unknown>>('catalog.json');
		for (const [id, raw] of Object.entries(catalog)) {
			const result = loadRulePackFromObject(raw);
			if (!result.ok) {
				throw new Error(`${id}: ${result.errors.join('; ')}`);
			}
		}
	});

	test('generated files never recurse into the source-pack scan', () => {
		const manifest = readGenerated<ManifestShape>('manifest.json');
		const catalog = readGenerated<Record<string, unknown>>('catalog.json');
		const sourceFiles = readdirSync(PACKS_DIR)
			.filter((file) => file.endsWith('.json') && !GENERATED_FILES.has(file))
			.sort((a, b) => a.localeCompare(b));

		expect(manifest.packs.map((pack) => pack.file).sort()).toEqual(sourceFiles);
		expect(manifest.packs.some((pack) => GENERATED_FILES.has(pack.file))).toBe(false);
		expect(Object.keys(catalog)).not.toContain('manifest');
		expect(Object.keys(catalog)).not.toContain('catalog');
	});

	test('manifest build rejects invalid detection enums and thresholds', () => {
		const tempRoot = mkdtempSync(join(tmpdir(), 'fts-pack-build-'));
		try {
			const tempPacks = join(tempRoot, 'rule-packs');
			mkdirSync(tempPacks);
			writeFileSync(join(tempPacks, 'invalid.json'), JSON.stringify({
				id: 'invalid',
				name: 'Invalid',
				description: 'Invalid detection schema fixture',
				version: '1.0.0',
				author: 'Test',
				rules: [],
				detection: {
					anyOf: [{
						folderRegex: '^X$',
						scope: 'vault',
						relation: 'context',
					}],
					minSignals: 0,
					occurrence: { countBy: 'signals', minEvidence: 1.5 },
					scopedUnderMode: 'global',
				},
			}));

			const result = Bun.spawnSync({
				cmd: ['node', BUILD_SCRIPT],
				cwd: tempRoot,
				stdout: 'pipe',
				stderr: 'pipe',
			});
			const output = `${result.stdout.toString()}\n${result.stderr.toString()}`;
			expect(result.exitCode).not.toBe(0);
			expect(output).toContain('detection.minSignals must be a positive integer');
			expect(output).toContain('detection.occurrence.countBy must be one of');
			expect(output).toContain('detection.occurrence.minEvidence must be a positive integer');
			expect(output).toContain('detection.scopedUnderMode must be one of');
			expect(output).toContain('detection.anyOf[0].scope must be one of');
			expect(output).toContain('detection.anyOf[0].relation must be one of');
		} finally {
			rmSync(tempRoot, { recursive: true, force: true });
		}
	});
});

describe('BundledRulePackRepository', () => {
	test('lists valid packs in id order and reports no bundled validation errors', () => {
		const repository = new BundledRulePackRepository();
		const ids = repository.list().map((entry) => entry.id);

		expect(ids).toEqual(ids.slice().sort((a, b) => a.localeCompare(b)));
		expect(repository.getErrors()).toEqual([]);
	});

	test('caches immutable packs without mutating the raw catalog', () => {
		const rawCatalog = structuredClone(bundledCatalog) as Record<string, unknown>;
		const before = JSON.stringify(rawCatalog);
		const repository = new BundledRulePackRepository(rawCatalog);
		const [firstEntry] = repository.list();
		if (!firstEntry) throw new Error('Expected at least one bundled pack');

		const first = repository.get(firstEntry.id);
		const second = repository.get(firstEntry.id);
		if (!first.ok || !second.ok) throw new Error('Expected cached pack lookup to succeed');

		expect(first.pack).toBe(second.pack);
		expect(first.pack).toBe(firstEntry.pack);
		expect(Object.isFrozen(first.pack)).toBe(true);
		expect(Object.isFrozen(first.pack.rules)).toBe(true);
		expect(Object.isFrozen(first.pack.rules[0])).toBe(true);
		expect(JSON.stringify(rawCatalog)).toBe(before);
	});

	test('returns a structured error for a missing id', () => {
		const repository = new BundledRulePackRepository();
		const result = repository.get('does-not-exist');

		expect(result.ok).toBe(false);
		if (result.ok) return;
		expect(result.error.code).toBe('missing-id');
		expect(result.error.packId).toBe('does-not-exist');
		expect(result.error.availableIds).toEqual(repository.list().map((entry) => entry.id));
	});
});
