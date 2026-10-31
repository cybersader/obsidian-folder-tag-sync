import { describe, expect, mock, test } from 'bun:test';
import type { App } from 'obsidian';
import type { MappingRule } from '../types/settings';
import { GuidedNotePreviewRunner, type PreviewConfiguration } from './guidedNotePreviewRunner';
import { createGuidedPreviewReadPort } from './guidedPreviewReadPort';

const draft: MappingRule = { id: 'draft', name: 'Draft', enabled: false, priority: 1, direction: 'folder-to-tag',
	folderPattern: '^Work', options: { createFolders: false, addTags: true, removeOrphanedTags: false,
		syncOnFileCreate: false, syncOnFileMove: false, syncOnFileRename: false } };
function harness(count = 1) {
	let config: PreviewConfiguration = { draft: structuredClone(draft), rules: [], precedence: [], formFingerprint: 'one' };
	const files = Array.from({ length: count }, (_, i) => ({ path: `Work/${i}.md`, folder: 'Work', stamp: '1' }));
	files.push({ path: 'Private/unrelated.md', folder: 'Private', stamp: '1' });
	const bodies = new Map(files.map((f) => [f.path, '---\ntags: [manual]\nsecret-property: hidden\n---\nprivate body']));
	const forbidden = Object.fromEntries(['modify', 'create', 'delete', 'rename', 'process', 'processFrontMatter', 'saveData', 'saveSettings', 'onSave', 'info', 'warn', 'error', 'fetch', 'requestUrl'].map((name) => [name, mock(() => { throw new Error(`Forbidden ${name}`); })]));
	const refs = new Map<object, { kind: string; callback: (...args: unknown[]) => void }>();
	const on = (kind: string, callback: (...args: unknown[]) => void) => { const ref = {}; refs.set(ref, { kind, callback }); return ref; };
	const offref = mock((ref: object) => { refs.delete(ref); });
	const native = (path: string) => {
		const f = files.find((item) => item.path === path);
		return f ? { path, extension: 'md', parent: { path: f.folder }, get stat() { return { mtime: f.stamp, size: 10 }; } } : null;
	};
	const read = mock(async (f: { path: string }) => bodies.get(f.path)!);
	const getMarkdownFiles = mock(() => files.map((f) => native(f.path)!));
	const getFileCache = mock((_file: { path: string }) => ({ frontmatter: { tags: ['manual'] } }));
	// Dangerous APIs live on the actual App used by the actual production adapter,
	// not on a disconnected host that never reaches a closure.
	const app = { vault: { ...forbidden, read, getMarkdownFiles, getAbstractFileByPath: native, on, offref },
		metadataCache: { getFileCache, on, offref }, fileManager: { processFrontMatter: forbidden.processFrontMatter },
		plugins: { plugins: { 'folder-tag-sync': { settings: config, ...forbidden, logger: forbidden } } },
		...forbidden,
	} as unknown as App;
	const port = createGuidedPreviewReadPort(app, () => config);
	const changed = mock(() => {});
	const runner = new GuidedNotePreviewRunner(port, changed);
	const emit = (kind: string, path: string, old?: string) => {
		const file = native(path) ?? { path, parent: { path: path.split('/').slice(0, -1).join('/') }, extension: 'md' };
		for (const { kind: eventKind, callback } of refs.values()) if (kind === eventKind) callback(file, old);
	};
	return { runner, read, port, files, bodies, forbidden, offref, refs, changed, getMarkdownFiles, getFileCache,
		get config() { return config; }, set config(value: PreviewConfiguration) { config = value; }, emit,
		event: (path: string | null) => path === null ? emit('create', 'Work/new.md') : emit('changed', path) };
}

describe('actual App adaptation and async preview no-write boundary', () => {
	test('real adapter reads only relevant notes; no writer/save/logger/global network call; no retained body/property', async () => {
		const h = harness(26); const before = structuredClone(h.config);
		const originalFetch = globalThis.fetch;
		globalThis.fetch = h.forbidden.fetch as unknown as typeof fetch;
		try {
			await h.runner.run();
			expect(h.runner.result?.status).toBe('complete'); expect(h.runner.result?.examined).toBe(26); expect(h.runner.result?.skipped).toBe(1);
			expect(h.read.mock.calls.some(([f]) => f.path.includes('Private'))).toBe(false);
			expect(JSON.stringify(h.runner.result)).not.toContain('private body'); expect(JSON.stringify(h.runner.result)).not.toContain('secret-property');
			for (const api of Object.values(h.forbidden)) expect(api).not.toHaveBeenCalled();
			expect(h.config).toEqual(before);
		} finally { globalThis.fetch = originalFetch; h.runner.dispose(); }
		expect(h.refs.size).toBe(0); expect(h.offref).toHaveBeenCalledTimes(5);
	});
	test('enumerates vault once; batches do not re-enumerate or reread the entire scope cache', async () => {
		const h = harness(101); await h.runner.run();
		expect(h.getMarkdownFiles).toHaveBeenCalledTimes(1);
		// Snapshot, each note's cache input + freshness check, and one controlled completion check.
		expect(h.getFileCache.mock.calls.length).toBeLessThanOrEqual(101 * 4);
		h.runner.checkFreshness(); expect(h.getMarkdownFiles).toHaveBeenCalledTimes(1);
		expect(h.getFileCache.mock.calls.some(([f]) => (f as { path: string }).path.includes('Private'))).toBe(false);
	});
	test('new and renamed matching notes invalidate; unrelated content/new paths do not', async () => {
		const h = harness(); await h.runner.run();
		h.emit('modify', 'Private/unrelated.md'); h.files[1].stamp = '2'; h.runner.checkFreshness();
		h.emit('create', 'Private/new.md'); expect(h.runner.result?.status).toBe('complete');
		h.emit('create', 'Work/new.md'); expect(h.runner.result?.status).toBe('stale');
		await h.runner.run(); h.emit('rename', 'Private/moved.md', 'Work/0.md'); expect(h.runner.result?.status).toBe('stale');
	});
	test('new note in edited rule former coverage cannot be missed', async () => {
		const h = harness(); h.config.rules = [{ ...draft, folderPattern: '^Old' }];
		await h.runner.run(); h.emit('create', 'Old/new.md'); expect(h.runner.result?.status).toBe('stale');
	});
	test('cancelled in-flight read cannot render or advance counts', async () => {
		const h = harness(); let resolve!: (value: string) => void;
		h.port.read = () => new Promise((r) => { resolve = r; });
		const pending = h.runner.run(); h.runner.cancel(); resolve('body'); await pending;
		expect(h.runner.result?.status).toBe('cancelled'); expect(h.runner.result?.examined).toBe(0);
	});
	test('stale work finishing after a new run cannot overwrite it', async () => {
		const h = harness(); let resolve!: (value: string) => void;
		h.port.read = () => new Promise((r) => { resolve = r; });
		const old = h.runner.run(); h.runner.invalidate(); h.port.read = async () => '---\ntags: [Work]\n---\nnew';
		await h.runner.run(); const next = h.runner.result;
		resolve('---\ntags: [old]\n---\nold'); await old;
		expect(h.runner.result).toBe(next); expect(next?.rows[0].state).toBe('unchanged');
	});
	for (const field of ['form', 'rules', 'precedence', 'file', 'metadata'] as const) {
		test(`completion detects stale ${field} without automatic rescan`, async () => {
			const h = harness(); let resolve!: (value: string) => void;
			h.port.read = () => new Promise((r) => { resolve = r; }); const pending = h.runner.run();
			if (field === 'form') h.config.formFingerprint = 'two';
			if (field === 'rules') h.config.rules = [{ ...draft, id: 'other' }];
			if (field === 'precedence') h.config.precedence = ['x'];
			if (field === 'file') h.files[0].stamp = '2';
			if (field === 'metadata') h.port.cacheTags = () => ['changed'];
			resolve('body'); await pending; expect(h.runner.result?.status).toBe('stale');
		});
	}
	test('events invalidate affected notes; repeat refresh captures current form', async () => {
		const h = harness(); await h.runner.run(); h.event('Private/unrelated.md');
		expect(h.runner.result?.status).toBe('complete'); h.event('Work/0.md');
		expect(h.runner.result?.status).toBe('stale'); await h.runner.run(); expect(h.runner.result?.status).toBe('complete');
	});
	test('focus freshness detects settings changes', async () => {
		const h = harness(); await h.runner.run(); h.config.draft.enabled = true; h.runner.checkFreshness(); expect(h.runner.result?.status).toBe('stale');
	});
	test('close unsubscribes and drops results; late reads and events do nothing', async () => {
		const h = harness(); let resolve!: (value: string) => void;
		h.port.read = () => new Promise((r) => { resolve = r; }); const pending = h.runner.run();
		h.runner.dispose(); const calls = h.changed.mock.calls.length; resolve('body'); await pending; h.event(null);
		expect(h.runner.result).toBeNull(); expect(h.changed).toHaveBeenCalledTimes(calls); expect(h.refs.size).toBe(0);
	});
	test('read errors count without leaking exception content', async () => {
		const h = harness(); h.port.read = async () => { throw new Error('private body'); }; await h.runner.run();
		expect(h.runner.result?.failed).toBe(1); expect(h.runner.result?.rows[0].state).toBe('unreadable'); expect(JSON.stringify(h.runner.result)).not.toContain('private body');
	});
	test('reverse-only draft reads zero files', async () => {
		const h = harness(); h.config.draft.direction = 'tag-to-folder'; await h.runner.run(); expect(h.read).not.toHaveBeenCalled(); expect(h.runner.result?.message).toContain('movement');
	});
});
