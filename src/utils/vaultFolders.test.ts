import { describe, expect, test } from 'bun:test';
import {
	collectVaultFolderPaths,
	type VaultEntryLike,
	type VaultFolderLike,
} from './vaultFolders';

function folder(path: string, children: VaultEntryLike[] = []): VaultFolderLike {
	return { path, children };
}

function file(path: string): VaultEntryLike {
	return { path };
}

describe('collectVaultFolderPaths', () => {
	test('omits the synthetic root and file leaves from an empty vault', () => {
		const root = folder('', [file('root-note.md')]);
		expect(collectVaultFolderPaths(root)).toEqual([]);
	});

	test('collects a complete deep folder hierarchy without recursion limits', () => {
		const root = folder('');
		let parent = root;
		const expected: string[] = [];
		for (let depth = 1; depth <= 2_000; depth++) {
			const path = `${parent.path ? parent.path + '/' : ''}level-${String(depth).padStart(4, '0')}`;
			const child = folder(path, [file(`${path}/note-${depth}.md`)]);
			(parent.children as VaultEntryLike[]).push(child);
			parent = child;
			expected.push(path);
		}

		expect(collectVaultFolderPaths(root)).toEqual(expected);
	});

	test('preserves Unicode names while sorting and de-duplicating deterministically', () => {
		const repeated = folder('βeta');
		const root = folder('/', [
			folder('東京', [folder('東京/資料')]),
			folder('Alpha'),
			repeated,
			repeated,
			folder('📁 Projects'),
			file('Alpha/private.md'),
		]);

		expect(collectVaultFolderPaths(root)).toEqual([
			'Alpha',
			'βeta',
			'東京',
			'東京/資料',
			'📁 Projects',
		]);
	});

	test('normalizes separator direction and leading or trailing root separators', () => {
		const root = folder('', [
			folder('/Projects/', [folder('Projects\\Web\\')]),
		]);
		expect(collectVaultFolderPaths(root)).toEqual(['Projects', 'Projects/Web']);
	});
});
