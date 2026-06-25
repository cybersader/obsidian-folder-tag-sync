import { browser, expect } from '@wdio/globals';
// Runtime-bound globals (importing from 'mocha' fails — bindings populate after tsx loads the spec).
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

/**
 * E2E regression for GitHub issue #1 — duplicate/corrupted folder tags.
 *
 * Proves, in a REAL Obsidian instance against real vault.read/modify +
 * metadataCache, that the folder→tag sync is IDEMPOTENT: syncing the same
 * file twice (the create→type→re-sync scenario) does NOT duplicate the tag
 * or corrupt the YAML. Also exercises the pre-existing-inline-scalar case
 * the reporter hit. The unit + integration suites cover the parser shapes;
 * this proves the wiring end-to-end where the bug actually manifested.
 */

const FOLDER = 'IdemTest';

// Minimal valid bidirectional rule matching the IdemTest/ folder.
const RULE = {
	id: 'e2e-idem-rule',
	name: 'E2E idempotency rule',
	enabled: true,
	priority: 5,
	direction: 'folder-to-tag',
	folderPattern: '^IdemTest(?:/|$)',
	folderEntryPoint: 'IdemTest',
	folderTransforms: { caseTransform: 'kebab-case', emojiHandling: 'keep' },
	tagPattern: '^idemtest',
	tagEntryPoint: 'idemtest',
	tagTransforms: { caseTransform: 'kebab-case', emojiHandling: 'keep' },
	options: {
		createFolders: true, addTags: true, removeOrphanedTags: false,
		syncOnFileCreate: true, syncOnFileMove: true, syncOnFileRename: true,
	},
};

describe('folder→tag sync — idempotency (issue #1)', function () {
	this.timeout(60_000);

	before(async function () {
		await browser.executeObsidian(async ({ app }, rule, folder) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { rules: unknown[] }; saveSettings: () => Promise<void> } > } }).plugins.plugins['folder-tag-sync'];
			// Stash + inject our rule
			(globalThis as unknown as { __idemPrevRules?: unknown[] }).__idemPrevRules = plugin.settings.rules;
			plugin.settings.rules = [rule];
			await plugin.saveSettings();
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(folder))) await adapter.mkdir(folder);
			await new Promise((r) => setTimeout(r, 300));
		}, RULE, FOLDER);
	});

	after(async function () {
		await browser.executeObsidian(async ({ app }, folder) => {
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { settings: { rules: unknown[] }; saveSettings: () => Promise<void> } > } }).plugins.plugins['folder-tag-sync'];
			const prev = (globalThis as unknown as { __idemPrevRules?: unknown[] }).__idemPrevRules;
			if (prev) { plugin.settings.rules = prev; await plugin.saveSettings(); }
			const adapter = app.vault.adapter;
			if (await adapter.exists(folder)) await adapter.rmdir(folder, true);
		}, FOLDER);
	});

	it('syncing a fresh note twice does not duplicate or corrupt the tag', async function () {
		const result = await browser.executeObsidian(async ({ app }, folder) => {
			const TFileCtor = (app.vault.getMarkdownFiles()[0] as unknown as { constructor: unknown }).constructor;
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { syncFolderToTags: (f: unknown) => Promise<unknown> } > } }).plugins.plugins['folder-tag-sync'];
			const path = `${folder}/fresh.md`;
			const adapter = app.vault.adapter;
			await adapter.write(path, '');
			await new Promise((r) => setTimeout(r, 400)); // let the index register the file
			const file = app.vault.getAbstractFileByPath(path);
			if (!file || !(file instanceof (TFileCtor as new () => unknown))) return { ok: false, reason: 'file not indexed' };

			await plugin.syncFolderToTags(file);
			const afterFirst = await adapter.read(path);
			// Simulate "typing in the body"
			await adapter.write(path, afterFirst + '\nSome body text typed by the user.\n');
			await new Promise((r) => setTimeout(r, 200));
			const file2 = app.vault.getAbstractFileByPath(path);
			await plugin.syncFolderToTags(file2);
			const afterSecond = await adapter.read(path);
			return { ok: true, afterFirst, afterSecond };
		}, FOLDER);

		expect(result.ok).toBe(true);
		const { afterFirst, afterSecond } = result as { afterFirst: string; afterSecond: string };

		// First sync added at least one tag
		expect(/tags:/.test(afterFirst)).toBe(true);

		// No corruption signatures after the second sync:
		// exactly one frontmatter block
		expect((afterSecond.match(/^---$/gm) || []).length).toBe(2);
		// exactly one tags: key
		expect((afterSecond.match(/^tags:/gm) || []).length).toBe(1);
		// no glued-duplicate ("- x- x") and no dangling flow-array bracket
		expect(/-\s\S+-\s\S/.test(afterSecond)).toBe(false);
		expect(afterSecond.includes(']')).toBe(false);

		// Idempotent: the tag list is unchanged between the two syncs
		const tagsOf = (s: string) => (s.match(/^\s*-\s+(\S+)/gm) || []).map((l) => l.trim());
		expect(tagsOf(afterSecond)).toEqual(tagsOf(afterFirst));
	});

	it('a pre-existing inline-scalar tag does not duplicate on sync', async function () {
		const result = await browser.executeObsidian(async ({ app }, folder) => {
			const TFileCtor = (app.vault.getMarkdownFiles()[0] as unknown as { constructor: unknown }).constructor;
			const plugin = (app as unknown as { plugins: { plugins: Record<string, { syncFolderToTags: (f: unknown) => Promise<unknown> } > } }).plugins.plugins['folder-tag-sync'];
			const path = `${folder}/scalar.md`;
			const adapter = app.vault.adapter;
			// Pre-existing INLINE SCALAR tag matching what the rule would emit
			await adapter.write(path, '---\ntags: idemtest\n---\nbody\n');
			await new Promise((r) => setTimeout(r, 400));
			const file = app.vault.getAbstractFileByPath(path);
			if (!file || !(file instanceof (TFileCtor as new () => unknown))) return { ok: false };
			await plugin.syncFolderToTags(file);
			return { ok: true, content: await adapter.read(path) };
		}, FOLDER);

		expect(result.ok).toBe(true);
		const content = (result as { content: string }).content;
		// still one frontmatter, one tags key, no glue
		expect((content.match(/^---$/gm) || []).length).toBe(2);
		expect((content.match(/^tags:/gm) || []).length).toBe(1);
		expect(/idemtest\S*idemtest/.test(content)).toBe(false);
	});
});
