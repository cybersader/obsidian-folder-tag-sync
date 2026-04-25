import { describe, expect, test } from 'bun:test';
import {
	collectFolderSources,
	collectTagSources,
	rankSuggestions,
} from './entryPathHelpers';

describe('collectFolderSources', () => {
	test('returns folders sorted alphabetically', () => {
		expect(collectFolderSources(['Zebra', 'Apple', 'Mango'])).toEqual([
			'Apple',
			'Mango',
			'Zebra',
		]);
	});

	test('preserves nested paths', () => {
		expect(collectFolderSources(['a/b', 'a', 'a/c'])).toEqual(['a', 'a/b', 'a/c']);
	});
});

describe('collectTagSources', () => {
	test('expands hierarchical tags into all prefix variants', () => {
		const sources = collectTagSources({
			'#-clip/web/react': 5,
			'#-inbox': 12,
		});
		expect(sources).toContain('-clip');
		expect(sources).toContain('-clip/web');
		expect(sources).toContain('-clip/web/react');
		expect(sources).toContain('-inbox');
	});

	test('dedupes overlapping prefixes', () => {
		const sources = collectTagSources({
			'#a/b/c': 1,
			'#a/b': 2,
			'#a/b/d': 3,
		});
		expect(sources.filter((s) => s === 'a').length).toBe(1);
		expect(sources.filter((s) => s === 'a/b').length).toBe(1);
		expect(sources).toContain('a/b/c');
		expect(sources).toContain('a/b/d');
	});

	test('sorts shortest first so entry-points beat descendants', () => {
		const sources = collectTagSources({
			'#-clip/web/react/hooks': 1,
			'#--cybersader/projects': 2,
			'#-inbox': 3,
		});
		expect(sources[0].length).toBeLessThanOrEqual(sources[sources.length - 1].length);
	});

	test('strips leading # and ignores empty tag entries', () => {
		const sources = collectTagSources({
			'#valid': 1,
			'#': 2,
		});
		expect(sources).toContain('valid');
		expect(sources).not.toContain('');
	});

	test('handles tags without leading hash', () => {
		const sources = collectTagSources({ 'no-hash': 1 });
		expect(sources).toContain('no-hash');
	});
});

describe('rankSuggestions', () => {
	const FOLDERS = ['Capture', 'Capture/Inbox', 'BackupCapture', 'OutputCapture/Sub', 'Other'];

	test('prefix matches rank above substring matches', () => {
		const r = rankSuggestions('Cap', FOLDERS);
		expect(r[0]).toBe('Capture');
		expect(r[1]).toBe('Capture/Inbox');
		expect(r).toContain('BackupCapture');
		expect(r).toContain('OutputCapture/Sub');
		expect(r).not.toContain('Other');
	});

	test('case-insensitive', () => {
		const r = rankSuggestions('CAPTURE', FOLDERS);
		expect(r).toContain('Capture');
	});

	test('empty query → first N items', () => {
		const r = rankSuggestions('', FOLDERS);
		expect(r).toEqual(FOLDERS);
	});

	test('no match → empty', () => {
		const r = rankSuggestions('zzz', FOLDERS);
		expect(r).toEqual([]);
	});

	test('cap respected — large source list', () => {
		const big = Array.from({ length: 100 }, (_, i) => `Item${i}`);
		const r = rankSuggestions('item', big);
		expect(r.length).toBe(30);
	});

	test('whitespace-only query → entire list', () => {
		const r = rankSuggestions('   ', FOLDERS);
		expect(r).toEqual(FOLDERS);
	});
});
