import { describe, expect, mock, test } from 'bun:test';
import type { App, TFile } from 'obsidian';
import type { DynamicTagsFoldersSettings, MappingRule } from '../types/settings';
import type { DebugLogger } from '../utils/debug';
import { splitForwardFrontmatter } from './forwardTagDelta';
import { parseFrontmatterTags } from './frontmatterTags';
import { injectWitness, parseWitness } from './frontmatterWitness';

mock.module('obsidian', () => ({ Notice: class {}, TFile: class {}, App: class {} }));
const { FolderToTagSync } = await import('./FolderToTagSync');
const base: MappingRule = { id: 'parity', name: 'Parity', enabled: true, priority: 1, direction: 'folder-to-tag', folderPattern: '^Work',
	options: { createFolders: false, addTags: true, removeOrphanedTags: true, frontmatterMemory: true,
		syncOnFileCreate: false, syncOnFileMove: false, syncOnFileRename: false } };

describe('extracted delta parity with actual syncFile writer', () => {
	for (const [name, frontmatter, cache] of [
		['preserves unrelated', 'tags: [manual]', ['manual']],
		['cache only suppresses duplicate', 'tags: [manual]', ['manual', 'Work']],
		['cache mismatch plus actual write', 'tags: [manual]', ['manual', 'stale']],
		['unsupported disk shape', 'tags:\n- manual', ['manual']],
		['legacy witness removes manual too', injectWitness('tags: [manual, old]', { origin: 'Old', ruleId: 'different', tags: ['manual', 'old'], timestamp: 'old' }), ['manual', 'old']],
		['already present early return', 'tags: [Work]', ['Work']],
	] as const) test(name, async () => {
		let content = `---\n${frontmatter}\n---\nbody`;
		const modify = mock(async (_file: unknown, next: string) => { content = next; });
		const app = { vault: { read: async () => content, modify }, metadataCache: { getFileCache: () => ({ frontmatter: { tags: cache } }) } } as unknown as App;
		const logger = { info: async () => {}, warn: async () => {}, error: async () => {} } as unknown as DebugLogger;
		const settings = { rules: [base], options: { showNotifications: false } } as unknown as DynamicTagsFoldersSettings;
		// Independent pinned expectations: never calculate expected output through the extracted helper.
		const pinned: Record<string, { added: string[]; removed: string[]; final: string[]; writes: number; witness: string[] | null }> = {
			'preserves unrelated': { added: ['#Work'], removed: [], final: ['#manual', '#Work'], writes: 1, witness: ['manual', 'Work'] },
			'cache only suppresses duplicate': { added: [], removed: [], final: ['#manual'], writes: 0, witness: null },
			'cache mismatch plus actual write': { added: ['#Work'], removed: [], final: ['#manual', '#Work'], writes: 1, witness: ['manual', 'Work'] },
			'unsupported disk shape': { added: ['#Work'], removed: [], final: ['#Work'], writes: 1, witness: ['Work'] },
			'legacy witness removes manual too': { added: ['#Work'], removed: ['#manual', '#old'], final: ['#Work'], writes: 1, witness: ['Work'] },
			'already present early return': { added: [], removed: [], final: ['#Work'], writes: 0, witness: null },
		};
		const expected = pinned[name];
		const result = await new FolderToTagSync(app, settings, logger).syncFile({ path: 'Work/n.md', parent: { path: 'Work' } } as unknown as TFile);
		expect(result.tagsAdded).toEqual(expected.added); expect(result.tagsRemoved).toEqual(expected.removed);
		expect(modify).toHaveBeenCalledTimes(expected.writes);
		const final = splitForwardFrontmatter(content).frontmatter;
		expect(parseFrontmatterTags(final)).toEqual(expected.final);
		expect(parseWitness(final)?.tags ?? null).toEqual(expected.witness);
	});
	test('empty output avoids reads, writes and orphan removal in actual writer', async () => {
		const read = mock(async () => 'private'); const modify = mock(async () => {});
		const app = { vault: { read, modify } } as unknown as App;
		const logger = { info: async () => {}, warn: async () => {}, error: async () => {} } as unknown as DebugLogger;
		const settings = { rules: [{ ...base, transfer: { op: 'opaque' } }], options: { showNotifications: false } } as unknown as DynamicTagsFoldersSettings;
		const result = await new FolderToTagSync(app, settings, logger).syncFile({ path: 'Work/n.md', parent: { path: 'Work' } } as unknown as TFile);
		expect(result.tagsRemoved).toEqual([]); expect(read).not.toHaveBeenCalled(); expect(modify).not.toHaveBeenCalled();
	});
});
