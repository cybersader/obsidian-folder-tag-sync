/**
 * Integration tests for FolderToTagSync.syncFile / previewVault (issue #1).
 *
 * These exercise the full read → decide → write path with a fake Obsidian
 * `App` (vault + metadataCache). They prove the actual bug fix end-to-end:
 *
 *   - a second sync of an already-tagged file adds NOTHING (idempotency — the
 *     reported corruption);
 *   - a corrupted file is not made worse, and self-heals to a clean block when
 *     a write does occur;
 *   - the metadata-cache fallback covers shapes the line parser can't read;
 *   - inline body tags (`cache.tags`) are never promoted into the property;
 *   - previewVault stops reporting phantom additions.
 *
 * `obsidian` has no runtime (its package `main` is empty), so we mock it and
 * dynamically import the engine after the mock is registered.
 */

import { describe, expect, test, beforeAll, mock } from 'bun:test';

mock.module('obsidian', () => ({
	Notice: class {
		constructor(_message?: string) {}
	},
	TFile: class {},
	App: class {},
}));

// Loaded after the mock above is registered.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let FolderToTagSync: any;

beforeAll(async () => {
	({ FolderToTagSync } = await import('./FolderToTagSync'));
});

// ─── Test harness ──────────────────────────────────────────────────────────

interface VaultState {
	content: string;
	modified: string[];
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	cache: any;
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
	files: any[];
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeFile(path: string): any {
	const segs = path.split('/');
	return {
		path,
		name: segs[segs.length - 1],
		extension: 'md',
		parent: { path: segs.slice(0, -1).join('/') },
	};
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function makeApp(state: VaultState): any {
	return {
		vault: {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			read: async (_f: any) => state.content,
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			modify: async (_f: any, content: string) => {
				state.modified.push(content);
				state.content = content;
			},
			getMarkdownFiles: () => state.files,
			getAbstractFileByPath: () => null,
		},
		metadataCache: {
			// eslint-disable-next-line @typescript-eslint/no-explicit-any
			getFileCache: (_f: any) => state.cache,
		},
	};
}

const logger = {
	info: async () => {},
	warn: async () => {},
	error: async () => {},
	// eslint-disable-next-line @typescript-eslint/no-explicit-any
} as any;

// A forward rule: any folder under `work/...` → identity tag (folder path as-is).
const RULE = {
	id: 'r1',
	name: 'Work',
	enabled: true,
	priority: 1,
	direction: 'bidirectional',
	folderPattern: '^work',
	options: {
		createFolders: false,
		addTags: true,
		removeOrphanedTags: false,
		syncOnFileCreate: true,
		syncOnFileMove: false,
		syncOnFileRename: true,
	},
};

function makeSettings() {
	return {
		rules: [RULE],
		options: { showNotifications: false },
	};
}

const FOLDER_TAG = '#work/projects/my-project';
const FILE = makeFile('work/projects/my-project/Note.md');

// ─── Tests ───────────────────────────────────────────────────────────────────

describe('syncFile — idempotency (issue #1 regression)', () => {
	test('a file already carrying its folder tag adds nothing, writes nothing — twice', async () => {
		const state: VaultState = {
			content: '---\ntags:\n  - work/projects/my-project\n---\nbody\n',
			modified: [],
			cache: { frontmatter: { tags: ['work/projects/my-project'] } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const r1 = await sync.syncFile(FILE);
		const r2 = await sync.syncFile(FILE);

		expect(r1.tagsAdded).toEqual([]);
		expect(r2.tagsAdded).toEqual([]);
		// The bug: a second sync used to re-add the tag and corrupt the YAML.
		expect(state.modified.length).toBe(0);
		expect(state.content).toContain('tags:\n  - work/projects/my-project');
		expect(state.content).not.toContain('my-project- ');
		expect(state.content).not.toContain('my-projectwork');
	});

	test('an ALREADY-corrupted file is not made worse (no second tags block / no re-glue)', async () => {
		const state: VaultState = {
			content:
				'---\ntags:\n  - work/projects/my-project- work/projects/my-project\n---\nbody\n',
			modified: [],
			cache: { frontmatter: { tags: ['work/projects/my-project'] } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const result = await sync.syncFile(FILE);

		// The healed read sees the tag already present → nothing to add → no write.
		expect(result.tagsAdded).toEqual([]);
		expect(state.modified.length).toBe(0);
		// And only ONE tags: key remains (no appended duplicate block).
		expect((state.content.match(/^tags:/gm) ?? []).length).toBe(1);
	});

	test('a corrupted file self-heals to a clean block when a write IS triggered', async () => {
		// Frontmatter has a glued tag `old- old`; the folder contributes a NEW
		// tag, so a write happens — and the written block is clean + healed.
		const state: VaultState = {
			content: '---\ntags:\n  - old- old\n---\nbody\n',
			modified: [],
			cache: { frontmatter: { tags: ['old'] } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const result = await sync.syncFile(FILE);

		expect(result.tagsAdded).toEqual([FOLDER_TAG]);
		expect(state.modified.length).toBe(1);
		const written = state.modified[0];
		expect(written).toContain('tags:\n  - old\n  - work/projects/my-project');
		expect(written).not.toContain('old- old');
		expect((written.match(/^tags:/gm) ?? []).length).toBe(1);
	});
});

describe('syncFile — metadata-cache fallback', () => {
	test('parser returns [] for a multiline flow array but the cache has the tag → no duplicate add', async () => {
		const state: VaultState = {
			content: '---\ntags: [\n  work/projects/my-project\n]\n---\nbody\n',
			modified: [],
			cache: { frontmatter: { tags: ['work/projects/my-project'] } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const result = await sync.syncFile(FILE);

		expect(result.tagsAdded).toEqual([]);
		expect(state.modified.length).toBe(0);
	});

	test('inline body tags (cache.tags) are NOT counted as existing nor promoted into the property', async () => {
		// No frontmatter tags; the body has an inline `#work/projects/my-project`.
		const state: VaultState = {
			content: '---\ntitle: Hi\n---\nbody #work/projects/my-project\n',
			modified: [],
			cache: {
				frontmatter: { title: 'Hi' },
				tags: [{ tag: '#work/projects/my-project' }],
			},
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const result = await sync.syncFile(FILE);

		// cache.tags must NOT suppress the add — the property tag gets written.
		expect(result.tagsAdded).toEqual([FOLDER_TAG]);
		expect(state.modified.length).toBe(1);
		expect(state.modified[0]).toContain('title: Hi');
		expect(state.modified[0]).toContain('tags:\n  - work/projects/my-project');
	});
});

describe('syncFile — CRLF / BOM produce ONE frontmatter block (hole 3)', () => {
	test('CRLF file: parses one block, adds tag, writes exactly two fences', async () => {
		const state: VaultState = {
			content: '---\r\ntags:\r\n  - alpha\r\n---\r\nbody\r\n',
			modified: [],
			cache: { frontmatter: { tags: ['alpha'] } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const result = await sync.syncFile(FILE);

		// alpha is already present; the folder contributes a NEW tag → one write.
		expect(result.tagsAdded).toEqual([FOLDER_TAG]);
		expect(state.modified.length).toBe(1);
		const written = state.modified[0];
		// Exactly TWO `---` fences — NOT a second prepended frontmatter block.
		expect((written.match(/^---$/gm) ?? []).length).toBe(2);
		// Original tag preserved, new tag appended, single clean block.
		expect(written).toContain('tags:\n  - alpha\n  - work/projects/my-project');
		expect(written).not.toContain('\r');
	});

	test('BOM-prefixed file: parses one block, adds tag, writes exactly two fences', async () => {
		const BOM = String.fromCharCode(0xfeff);
		const state: VaultState = {
			content: `${BOM}---\ntags:\n  - alpha\n---\nbody\n`,
			modified: [],
			cache: { frontmatter: { tags: ['alpha'] } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const result = await sync.syncFile(FILE);

		expect(result.tagsAdded).toEqual([FOLDER_TAG]);
		expect(state.modified.length).toBe(1);
		const written = state.modified[0];
		expect((written.match(/^---$/gm) ?? []).length).toBe(2);
		expect(written).toContain('tags:\n  - alpha\n  - work/projects/my-project');
	});
});

describe('previewVault — no phantom additions', () => {
	test('a file already carrying its folder tag reports zero tagsToAdd', async () => {
		const state: VaultState = {
			content: '---\ntags:\n  - work/projects/my-project\n---\nbody\n',
			modified: [],
			cache: { frontmatter: { tags: ['work/projects/my-project'] } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const preview = await sync.previewVault();

		expect(preview.filesAffected).toBe(0);
		expect(preview.filesUnchanged).toBe(1);
		expect(preview.totalTagsToAdd).toBe(0);
	});

	test('a file missing its folder tag reports exactly one addition', async () => {
		const state: VaultState = {
			content: '---\ntitle: Hi\n---\nbody\n',
			modified: [],
			cache: { frontmatter: { title: 'Hi' } },
			files: [FILE],
		};
		const sync = new FolderToTagSync(makeApp(state), makeSettings(), logger);

		const preview = await sync.previewVault();

		expect(preview.filesAffected).toBe(1);
		expect(preview.totalTagsToAdd).toBe(1);
		expect(preview.items[0].tagsToAdd).toEqual([FOLDER_TAG]);
	});
});
