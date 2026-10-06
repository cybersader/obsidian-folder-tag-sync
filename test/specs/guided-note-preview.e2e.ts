import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';

const ROOT = 'Guided Note Preview Owned Fixture';
const BRANCH = `${ROOT}/New`;
const MARKER = `${ROOT}/.owned`;
const MARKER_BYTES = 'guided-note-preview.e2e.ts\n';
const options = { createFolders: false, addTags: true, removeOrphanedTags: false, syncOnFileCreate: false, syncOnFileMove: false, syncOnFileRename: false };
const RULES = [
	{ id: 'guided-note-edit', name: 'Owned edited draft', enabled: false, priority: 100, direction: 'bidirectional',
		folderPattern: `^${ROOT}/Old`, folderEntryPoint: `${ROOT}/Old`, tagEntryPoint: 'old', group: 'legacy',
		folder: { axes: ['work'], scheme: 'hierarchical', naming: 'word', subdivisionDepth: 'unbounded', siblingUniformity: 'unique' },
		tag: { axis: 'work', coordination: 'pre-coordinated', prefixMarker: null, authority: 'mutual' }, transfer: { op: 'identity' },
		options: { ...options, frontmatterMemory: true } },
	{ id: 'guided-note-competitor', name: 'Owned winning competitor', enabled: true, priority: 1, direction: 'folder-to-tag', group: 'first',
		folderPattern: `^${BRANCH}/Competing$`, folderEntryPoint: `${BRANCH}/Competing`, tagEntryPoint: 'competitor',
		options: { ...options, removeOrphanedTags: true, frontmatterMemory: true } },
];
const FILES = {
	[MARKER]: MARKER_BYTES,
	[`${BRANCH}/Added/a.md`]: '---\ntags: [manual]\nprivate-property: never-displayed\n---\nprivate body never-displayed\n',
	[`${BRANCH}/Already/b.md`]: '---\ntags: [manual, preview/already]\n---\nbody\n',
	[`${BRANCH}/Competing/c.md`]: '---\ntags: [manual, old]\nfts:\n  origin: "Old"\n  ruleId: "other-rule"\n  tags:\n    - "old"\n    - "manual"\n---\nbody\n',
	[`${ROOT}/Old/former.md`]: '---\ntags: [old, manual]\n---\nbody\n',
	...Object.fromEntries(Array.from({ length: 27 }, (_, i) => [`${BRANCH}/Pages/page-${i}.md`, '---\ntags: [manual]\n---\nbody\n'])),
};

type PluginLike = { settings: Record<string, unknown>; saveSettings(): Promise<void> };
let harnessMainWindow = '';
async function selectOwnedModalWindow(): Promise<void> {
	for (const handle of await browser.getWindowHandles()) {
		await browser.switchToWindow(handle);
		if (!await browser.execute(() => !!document.querySelector('.dtf-guided-modal'))) continue;
		// The test service is installed on the main renderer. Reuse that read-only
		// harness context in its owned native Settings popout; no product mutation.
		await browser.execute(() => {
			const local = window as unknown as { wdioObsidianService?: unknown; opener?: { wdioObsidianService?: unknown } };
			if (!local.wdioObsidianService && local.opener?.wdioObsidianService) local.wdioObsidianService = local.opener.wdioObsidianService;
		});
		return;
	}
	throw new Error('Owned guided modal native window not found');
}
async function click(label: string, selector = '.dtf-note-preview-modal'): Promise<void> {
	expect(await browser.executeObsidian((_ctx, text, rootSelector) => {
		const root = ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector(rootSelector);
		const button = Array.from(root?.querySelectorAll<HTMLButtonElement>('button') ?? []).find((b) => b.textContent === text);
		if (!button || button.disabled) return false;
		button.click(); return true;
	}, label, selector)).toBe(true);
}
async function complete(): Promise<void> {
	await browser.waitUntil(async () => browser.executeObsidian(() =>
		((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('.dtf-note-preview-modal .modal-content')?.dataset.dtfNotePreviewStatus === 'complete'),
	{ timeout: 15000, timeoutMsg: 'Read-only note preview did not complete' });
}
async function openEditor(edit = false): Promise<void> {
	await browser.switchToWindow(harnessMainWindow);
	await browser.executeObsidian(({ app }, editMode) => {
		const setting = (app as unknown as { setting: { open(): void; openTabById(id: string): void; activeTab: { containerEl: HTMLElement } } }).setting;
		setting.open(); setting.openTabById('folder-tag-sync');
	}, edit);
	await browser.waitUntil(async () => browser.executeObsidian(({ app }) => {
		const container = (app as unknown as { setting: { activeTab?: { containerEl?: HTMLElement } } }).setting.activeTab?.containerEl;
		return !!container?.querySelector('.dtf-add-rule-button');
	}), { timeout: 10000, timeoutMsg: 'Plugin settings did not render' });
	expect(await browser.executeObsidian(({ app }, editMode) => {
		const container = (app as unknown as { setting: { activeTab: { containerEl: HTMLElement } } }).setting.activeTab.containerEl;
		(globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc = container.ownerDocument;
		const target = editMode ? container.querySelector<HTMLElement>('[data-dtf-rule-id="guided-note-edit"]') : container.querySelector<HTMLElement>('.dtf-add-rule-button');
		target?.click(); return !!target;
	}, edit)).toBe(true);
	console.log('Guided modal diagnostics', await browser.executeObsidian(({ app }) => {
		const doc = (globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document;
		const modal = doc.querySelector<HTMLElement>('.dtf-guided-modal');
		const chain: unknown[] = [];
		for (let el = modal; el; el = el.parentElement) { const s = doc.defaultView!.getComputedStyle(el); chain.push({ tag: el.tagName, cls: el.className, display: s.display, visibility: s.visibility, opacity: s.opacity, rect: el.getBoundingClientRect().toJSON() }); }
		return { sameDocument: doc === document, connected: modal?.isConnected, docUrl: doc.URL, activeDocumentUrl: (app.workspace as unknown as { containerEl: HTMLElement }).containerEl.ownerDocument.URL, actualModalCount: document.querySelectorAll('.modal').length, chain };
	}), 'captured windows', await browser.getWindowHandles());
	await selectOwnedModalWindow();
	await browser.waitUntil(async () => browser.executeObsidian(() => !!((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-guided-modal')));
}
async function fill(folder = BRANCH, name = 'Unsaved owned mapping'): Promise<void> {
	expect(await browser.executeObsidian((_ctx, folderPath, ruleName) => {
		const inputs = Array.from(((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelectorAll<HTMLInputElement>('.dtf-guided-modal input[type="text"]'));
		const set = (el: HTMLInputElement | undefined, value: string) => { if (!el) throw new Error('Required guided field missing'); el.value = value; el.dispatchEvent(new Event('input', { bubbles: true })); };
		set(inputs[0], ruleName); set(inputs.find((i) => i.placeholder.includes('Capture/Inbox')), folderPath);
		set(inputs.find((i) => i.placeholder === '-inbox'), 'preview');
		return !Array.from(((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelectorAll<HTMLButtonElement>('.dtf-guided-actions button')).find((b) => b.textContent === 'Preview note changes')?.disabled;
	}, folder, name)).toBe(true);
}

/** Each case owns only this isolated harness vault and restores settings in finally, including on assertion failures. */
async function fixture(run: (unchanged: () => Promise<void>) => Promise<void>): Promise<void> {
	harnessMainWindow = await browser.getWindowHandle();
	const saved = await browser.executeObsidian(async ({ app }, root, marker, markerBytes, files, rules) => {
		const adapter = app.vault.adapter;
		const base = (adapter as unknown as { getBasePath(): string }).getBasePath();
		if (base === '/home/cybersader/04 Vaults/plugin_development/folder-tag-sync-dev-vault' || !/\/basic-[^/]+$/.test(base)) throw new Error(`Not an isolated WDIO vault: ${base}`);
		const plugin = (app as unknown as { plugins: { plugins: Record<string, PluginLike> } }).plugins.plugins['folder-tag-sync'];
		const original = JSON.parse(JSON.stringify(plugin.settings));
		if (await adapter.exists(root)) {
			if (!(await adapter.exists(marker)) || await adapter.read(marker) !== markerBytes) throw new Error('Non-owned fixture root');
			await adapter.rmdir(root, true);
		}
		try {
			plugin.settings = { ...plugin.settings, rules, groupPrecedence: ['first', '__default__', 'legacy'] };
			await plugin.saveSettings();
			for (const [file, bytes] of Object.entries(files)) {
				const segments = file.split('/').slice(0, -1);
				for (let n = 1; n <= segments.length; n++) { const folder = segments.slice(0, n).join('/'); if (!(await adapter.exists(folder))) await adapter.mkdir(folder); }
				await adapter.write(file, bytes as string);
			}
		} catch (error) { plugin.settings = original; await plugin.saveSettings(); throw error; }
		return { original, theme: document.body.classList.contains('theme-light') ? 'light' : 'dark' };
	}, ROOT, MARKER, MARKER_BYTES, FILES, RULES);
	try {
		await browser.waitUntil(async () => browser.executeObsidian(({ app }, paths) => paths.every((p) => app.vault.getAbstractFileByPath(p)), Object.keys(FILES).filter((p) => p.endsWith('.md'))), { timeout: 15000 });
		await browser.waitUntil(async () => browser.executeObsidian(({ app }, note) => {
			const file = app.vault.getAbstractFileByPath(note);
			return file && app.metadataCache.getFileCache(file as never)?.frontmatter?.tags?.includes('manual');
		}, `${BRANCH}/Added/a.md`), { timeout: 15000 });
		const baseline = await snapshot();
		const unchanged = async () => expect(await snapshot()).toEqual(baseline);
		await run(unchanged);
	} catch (error) {
		console.error('Guided preview primary failure before owned cleanup', error);
		throw error;
	} finally {
		await browser.keys(['Escape']); await browser.keys(['Escape']);
		await browser.switchToWindow(harnessMainWindow);
		await browser.executeObsidian(({ app }) => {
			(app.vault as unknown as { __guidedNoteReadRestore?: () => void }).__guidedNoteReadRestore?.();
			(app as unknown as { setting: { close(): void } }).setting.close();
		});
		console.log('Guided preview cleanup: owned UI closed');
		try {
			await browser.executeObsidian(async ({ app }, root, marker, bytes) => {
				if (!await app.vault.adapter.exists(root)) return;
				if (!(await app.vault.adapter.exists(marker)) || await app.vault.adapter.read(marker) !== bytes) throw new Error('Refusing non-owned cleanup');
				await app.vault.adapter.rmdir(root, true);
			}, ROOT, MARKER, MARKER_BYTES);
			console.log('Guided preview cleanup: marker-owned root removed');
		} finally {
			await browser.executeObsidian(async ({ app }, original, theme) => {
				const plugin = (app as unknown as { plugins: { plugins: Record<string, PluginLike> } }).plugins.plugins['folder-tag-sync'];
				plugin.settings = original as Record<string, unknown>; await plugin.saveSettings();
				document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${theme}`);
			}, saved.original, saved.theme);
			console.log('Guided preview cleanup: original settings restored');
		}
	}
}
async function snapshot() {
	return browser.executeObsidian(async ({ app }, root, files) => {
		const settingsPath = '.obsidian/plugins/folder-tag-sync/data.json';
		const bytes: Record<string, string> = {};
		for (const file of Object.keys(files)) bytes[file] = await app.vault.adapter.read(file);
		const folders: string[] = []; const topology: string[] = [];
		const visit = async (p: string) => { const list = await app.vault.adapter.list(p); folders.push(...list.folders); topology.push(...list.files); for (const f of list.folders) await visit(f); };
		await visit(root);
		const plugin = (app as unknown as { plugins: { plugins: Record<string, PluginLike> } }).plugins.plugins['folder-tag-sync'];
		return { bytes, folders: folders.sort(), topology: topology.sort(), persisted: await app.vault.adapter.read(settingsPath), settings: JSON.parse(JSON.stringify(plugin.settings)) };
	}, ROOT, FILES);
}
async function row(path: string): Promise<string> {
	return browser.executeObsidian((_ctx, p) => Array.from(((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelectorAll<HTMLElement>('[data-dtf-note-path]')).find((el) => el.dataset.dtfNotePath === p)?.textContent ?? '', path);
}

describe('Guided unsaved note preview', function () {
	this.timeout(180000);
	it('shows actual tag deltas, no-change and competition without writes; retains form and isolates keys; wraps at 320px in both themes', async () => fixture(async (unchanged) => {
		await openEditor(); await fill(); await unchanged();
		await click('Preview note changes', '.dtf-guided-modal'); await complete(); await unchanged();
		await browser.executeObsidian(() => {
			const doc = (globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document;
			const summary = doc.querySelector<HTMLElement>('[data-dtf-note-path] summary')!;
			(globalThis as unknown as { __guidedNoteSummary?: HTMLElement }).__guidedNoteSummary = summary;
			summary.focus();
		});
		await browser.keys(['Enter']);
		expect(await browser.executeObsidian(() => (globalThis as unknown as { __guidedNoteSummary: HTMLElement }).__guidedNoteSummary.closest('details')?.open)).toBe(true);
		await browser.executeObsidian(() => {
			const doc = (globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document;
			Array.from(doc.querySelectorAll<HTMLButtonElement>('.dtf-note-preview-modal button')).find((b) => b.textContent === 'Show more (5 remaining)')!.focus();
		});
		await browser.keys(['Enter']);
		expect(await browser.executeObsidian(() => {
			const doc = (globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document;
			const summary = (globalThis as unknown as { __guidedNoteSummary: HTMLElement }).__guidedNoteSummary;
			return { retained: summary.isConnected && summary.closest('details')?.open, focus: doc.activeElement?.textContent };
		})).toEqual({ retained: true, focus: 'All notes shown' });
		expect(await row(`${BRANCH}/Added/a.md`)).toContain('Add: #preview/added');
		expect(await row(`${BRANCH}/Already/b.md`)).toContain('Already present — no changes');
		expect(await row(`${BRANCH}/Competing/c.md`)).toContain('Remove: #manual · #old');
		expect(await row(`${BRANCH}/Competing/c.md`)).toContain('Competing rule wins: Owned winning competitor');
		const text = await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal')?.textContent ?? '');
		expect(text).not.toContain('never-displayed'); expect(text).toContain('30 relevant');
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelectorAll('[data-dtf-note-path]').length)).toBe(30);
		await browser.executeObsidian(() => (((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal button') as HTMLElement)?.focus());
		await browser.keys(['Control', 'Enter']); await unchanged();
		expect(await browser.executeObsidian(() => !!((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal'))).toBe(true);
		for (const width of [820, 320]) for (const theme of ['light', 'dark']) {
			await browser.executeObsidian((_ctx, w, t) => {
				document.body.classList.remove('theme-light', 'theme-dark'); document.body.classList.add(`theme-${t}`);
				const modal = ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('.dtf-note-preview-modal')!; modal.style.width = `${w}px`; modal.style.maxWidth = `${w}px`;
				modal.querySelector<HTMLElement>('.modal-content')!.scrollTop = 0;
			}, width, theme);
			await fs.mkdir(path.resolve('test/screenshots'), { recursive: true });
			await browser.saveScreenshot(path.resolve(`test/screenshots/guided-note-preview-${width}-${theme}.png`));
			const geometry = await browser.executeObsidian(() => {
				const modal = ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('.dtf-note-preview-modal')!; const content = modal.querySelector<HTMLElement>('.modal-content')!;
				const firstAdd = Array.from(modal.querySelectorAll<HTMLElement>('[data-dtf-note-path] p')).find((p) => p.textContent?.startsWith('Add:'))!;
				const cancel = Array.from(modal.querySelectorAll<HTMLButtonElement>('button')).find((b) => b.textContent === 'Cancel scan')!;
				return { actualWindow: modal.ownerDocument === document && modal.isConnected && getComputedStyle(modal).visibility === 'visible' && getComputedStyle(modal).display !== 'none', cancelHidden: cancel.hidden && getComputedStyle(cancel).display === 'none' && cancel.getBoundingClientRect().height === 0, firstDeltaVisible: firstAdd.getBoundingClientRect().bottom <= content.getBoundingClientRect().bottom, width: modal.getBoundingClientRect().width, overflow: content.scrollWidth - content.clientWidth, controls: Array.from(modal.querySelectorAll('button')).every((b) => b.getBoundingClientRect().right <= modal.getBoundingClientRect().right + 1) };
			});
			expect(geometry.actualWindow).toBe(true); expect(geometry.cancelHidden).toBe(true); expect(geometry.firstDeltaVisible).toBe(true); expect(geometry.width).toBeLessThanOrEqual(width + 1); expect(geometry.overflow).toBeLessThanOrEqual(1); expect(geometry.controls).toBe(true); await unchanged();
			await browser.executeObsidian((_ctx, p) => {
				const doc = (globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document;
				Array.from(doc.querySelectorAll<HTMLElement>('[data-dtf-note-path]')).find((el) => el.dataset.dtfNotePath === p)!.scrollIntoView({ block: 'start' });
			}, `${BRANCH}/Added/a.md`);
			await browser.saveScreenshot(path.resolve(`test/screenshots/guided-note-preview-${width}-${theme}-delta.png`));
		}
		await browser.keys(['Escape']);
		await browser.waitUntil(async () => browser.executeObsidian(() => !((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal')));
		expect(await browser.executeObsidian(() => ({ child: !!((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal'), name: ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLInputElement>('.dtf-guided-modal input[type="text"]')?.value }))).toEqual({ child: false, name: 'Unsaved owned mapping' });
		await click('Preview note changes', '.dtf-guided-modal'); await complete();
		await browser.executeObsidian(() => (((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal button') as HTMLElement)?.focus());
		await browser.keys(['Enter']); // Back to editing, never Save.
		expect(await browser.executeObsidian(() => !!((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-guided-modal'))).toBe(true); await unchanged();
		await browser.keys(['Escape']); // Close retained editor before opening the edit journey.
		console.log('Guided preview: new rule and keyboard/visual journey complete');
		await openEditor(true); await fill(); await click('Preview note changes', '.dtf-guided-modal'); await complete();
		await click('Show more (6 remaining)');
		expect(await row(`${ROOT}/Old/former.md`)).toContain('No matching forward rule — no changes');
		expect(await row(`${ROOT}/Old/former.md`)).toContain('original edited rule matched');
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal')?.textContent ?? '')).toContain('options.frontmatterMemory: On → Not set');
		await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('.dtf-note-preview-warning summary')!.focus());
		await browser.keys(['Enter']);
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLDetailsElement>('.dtf-note-preview-warning')!.open)).toBe(true);
		await unchanged(); await click('Back to editing'); await unchanged();
		await browser.keys(['Escape']);
		console.log('Guided preview: same-ID edit and former coverage complete');
		await openEditor(); await fill();
		await browser.executeObsidian(() => {
			Array.from(((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelectorAll<HTMLButtonElement>('.dtf-guided-actions button')).find((b) => b.textContent === 'Preview note changes')?.click();
			Array.from(((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelectorAll<HTMLButtonElement>('.dtf-note-preview-modal button')).find((b) => b.textContent === 'Cancel scan')?.click();
		});
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('.dtf-note-preview-modal .modal-content')?.dataset.dtfNotePreviewStatus)).toBe('cancelled'); await unchanged();
		await browser.executeObsidian(({ app }, prefix) => {
			const vault = app.vault as unknown as { read(file: { path: string }): Promise<string>; __guidedNoteReadRelease?: () => void; __guidedNoteReadRestore?: () => void };
			const original = vault.read; let count = 0;
			vault.read = async (file) => {
				const bytes = await original.call(vault, file);
				if (file.path.startsWith(prefix) && ++count === 26) await new Promise<void>((resolve) => { vault.__guidedNoteReadRelease = resolve; });
				return bytes;
			};
			vault.__guidedNoteReadRestore = () => { vault.__guidedNoteReadRelease?.(); vault.read = original; delete vault.__guidedNoteReadRelease; delete vault.__guidedNoteReadRestore; };
		}, BRANCH);
		await click('Preview again');
		await browser.executeObsidian(() => {
			const doc = (globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document;
			Array.from(doc.querySelectorAll<HTMLButtonElement>('.dtf-note-preview-modal button')).find((b) => b.textContent === 'Cancel scan')!.focus();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-counts')?.textContent?.includes('25 examined')));
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).activeElement?.textContent)).toBe('Cancel scan');
		await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('[data-dtf-note-path] summary')!.focus());
		await browser.keys(['Enter']);
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLDetailsElement>('[data-dtf-note-path] details')!.open)).toBe(true);
		await click('Cancel scan');
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLDetailsElement>('[data-dtf-note-path] details')!.open)).toBe(true);
		await browser.executeObsidian(({ app }) => (app.vault as unknown as { __guidedNoteReadRestore?: () => void }).__guidedNoteReadRestore?.());
		await unchanged(); await click('Preview again'); await complete();
		console.log('Guided preview: cancel, batch focus/disclosures and refresh complete');
		await browser.executeObsidian(({ app }, note, bytes) => {
			const file = app.vault.getAbstractFileByPath(note)!;
			(app.metadataCache as unknown as { trigger(name: string, ...args: unknown[]): void }).trigger('changed', file, bytes, app.metadataCache.getFileCache(file as never));
		}, `${BRANCH}/Added/a.md`, FILES[`${BRANCH}/Added/a.md`]);
		console.log('Guided preview: metadata notification returned');
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('.dtf-note-preview-modal .modal-content')?.dataset.dtfNotePreviewStatus)).toBe('stale');
		console.log('Guided preview: stale assertion passed');
		await unchanged(); console.log('Guided preview: stale snapshot unchanged');
		await click('Preview again'); await complete(); console.log('Guided preview: stale refresh complete');
		await click('Back to editing');
		await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector<HTMLElement>('.dtf-guided-transfer-card[data-op="opaque"]')?.click());
		await click('Preview note changes', '.dtf-guided-modal'); await complete();
		await click('Show more (5 remaining)');
		expect(await row(`${BRANCH}/Added/a.md`)).toContain('Empty output — valid no-change result'); await unchanged();
		await click('Back to editing');
		await browser.executeObsidian(() => {
			const select = Array.from(((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelectorAll<HTMLSelectElement>('.dtf-guided-modal select')).find((s) => Array.from(s.options).some((o) => o.value === 'tag-to-folder'))!;
			select.value = 'tag-to-folder'; select.dispatchEvent(new Event('change', { bubbles: true }));
		});
		await click('Preview note changes', '.dtf-guided-modal'); await complete();
		expect(await browser.executeObsidian(() => ((globalThis as unknown as { __guidedNoteDoc?: Document }).__guidedNoteDoc ?? document).querySelector('.dtf-note-preview-modal')?.textContent ?? '')).toContain('movement preview is unsupported'); await unchanged();
	}));
});
