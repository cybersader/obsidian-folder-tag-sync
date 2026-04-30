import { browser, expect } from '@wdio/globals';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

/**
 * E2E tests for the hierarchy-first detection view + auto-scope apply.
 *
 * The user's pain case: a vault with nested JD pattern (JD at root + JD
 * inside an entity-scoped subfolder). The flat "X packs detected" list
 * doesn't communicate where the patterns are. The hierarchy-first view
 * + auto-scope apply solves this — these tests prove the wiring works
 * end-to-end inside a real Obsidian instance.
 *
 * Strategy:
 *   - `before` hook builds the nested-JD-in-SEACOW folder structure in
 *     the test vault programmatically. This is more reliable than a
 *     static fixture because the wdio test vault gets reused across
 *     specs and we want a clean known state.
 *   - Each test exercises one engine path through the plugin instance,
 *     using the same pure functions that bun-tests cover at the unit
 *     level — but wired through the loaded plugin in a real Obsidian.
 */

const NESTED_FOLDERS = [
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

describe('hierarchy-first detection — nested JD-in-SEACOW', function () {
	this.timeout(60_000);

	before(async function () {
		// Build the nested fixture inside the running vault. We create real
		// folders via the vault adapter (Obsidian's TFolder objects only
		// materialize once the adapter sees the directory).
		await browser.executeObsidian(async ({ app }) => {
			const adapter = app.vault.adapter;
			const folders = [
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
			for (const f of folders) {
				if (!(await adapter.exists(f))) await adapter.mkdir(f);
				const placeholder = `${f}/_placeholder.md`;
				if (!(await adapter.exists(placeholder))) {
					await adapter.write(placeholder, '# placeholder');
				}
			}
			// Trigger a scan refresh so the metadata cache picks up new folders
			// — without this, getRoot() may not reflect freshly-created paths.
			await new Promise((r) => setTimeout(r, 500));
		});
	});

	after(async function () {
		// Clean up — remove the test folders so subsequent specs see a clean
		// vault. Failure to clean is fatal: dirty state would leak into
		// other specs.
		await browser.executeObsidian(async ({ app }) => {
			const adapter = app.vault.adapter;
			const top = ['01 - Projects', '02 - Areas', '03 - Resources', 'Templates'];
			for (const f of top) {
				if (await adapter.exists(f)) {
					await adapter.rmdir(f, true);
				}
			}
		});
	});

	it('vault folders are visible to the engine', async function () {
		const folderCount = await browser.executeObsidian(({ app }) => {
			let n = 0;
			const walk = (folder: { children: { path?: string; children?: unknown[] }[] }): void => {
				for (const child of folder.children) {
					if ('children' in child && Array.isArray((child as { children: unknown[] }).children)) {
						n++;
						walk(child as { children: { path?: string; children?: unknown[] }[] });
					}
				}
			};
			walk(app.vault.getRoot() as unknown as { children: { path?: string; children?: unknown[] }[] });
			return n;
		});
		expect(folderCount).toBeGreaterThanOrEqual(NESTED_FOLDERS.length);
	});

	it('scan-vault-for-systems command opens the hierarchy-first modal', async function () {
		// Run the registered command. The modal opens asynchronously — we
		// check for its presence after a short wait. Match by "scan" since
		// the command's verb is "scan vault for systems."
		const cmdResult = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { commands: Record<string, unknown>; executeCommandById: (id: string) => boolean };
			}).commands;
			const cmdId = Object.keys(commands.commands).find((id) =>
				id.startsWith('folder-tag-sync:') && /scan|detect/i.test(id),
			);
			if (!cmdId) {
				const all = Object.keys(commands.commands).filter((id) => id.startsWith('folder-tag-sync:'));
				return { found: false, cmdId: null, allCommands: all };
			}
			const ok = commands.executeCommandById(cmdId);
			return { found: true, cmdId, ok, allCommands: null };
		});
		expect(cmdResult.found).toBe(true);

		// Wait for modal render
		await browser.pause(1500);

		const modalInfo = await browser.executeObsidian(() => {
			// Try multiple selectors so we're robust to class-name drift.
			const modal =
				document.querySelector('.dtf-detect-modal') ||
				Array.from(document.querySelectorAll('.modal'))
					.find((m) => /Detect organizational systems/i.test(m.textContent ?? ''));
			if (!modal) {
				return {
					open: false,
					headerText: null,
					allModals: Array.from(document.querySelectorAll('.modal')).length,
					bodyHTML: document.body.innerHTML.slice(0, 500),
				};
			}
			const h2 = modal.querySelector('h2');
			return { open: true, headerText: h2?.textContent ?? null };
		});
		expect(modalInfo.open).toBe(true);
		expect(modalInfo.headerText).toContain('Detect organizational systems');
	});

	it('shows pattern legend with multiple signal chips', async function () {
		const chipCount = await browser.executeObsidian(() => {
			const modal = document.querySelector('.dtf-detect-modal') ||
				Array.from(document.querySelectorAll('.modal'))
					.find((m) => /Detect organizational systems/i.test(m.textContent ?? ''));
			if (!modal) return 0;
			// Pattern legend chips have a tooltip "From <packname>"
			const chips = modal.querySelectorAll('span[title^="From "]');
			return chips.length;
		});
		expect(chipCount).toBeGreaterThan(0);
	});

	it('renders the vault tree with hit folders annotated', async function () {
		const treeInfo = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			if (!tree) return { hasCheckbox: false, hasFolders: false };
			const checkboxes = tree.querySelectorAll('input[type="checkbox"]');
			const folderIcons = (tree.textContent ?? '').match(/📁/g)?.length ?? 0;
			return {
				hasCheckbox: checkboxes.length > 0,
				hasFolders: folderIcons > 0,
				checkboxCount: checkboxes.length,
				folderCount: folderIcons,
			};
		});
		expect(treeInfo.hasFolders).toBe(true);
		expect(treeInfo.hasCheckbox).toBe(true);
	});

	it('checking a folder paints the scope tint into descendants', async function () {
		const result = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			if (!tree) return { ok: false, error: 'no tree' };
			const cb = tree.querySelector<HTMLInputElement>('input[type="checkbox"]');
			if (!cb) return { ok: false, error: 'no checkbox' };
			cb.checked = true;
			cb.dispatchEvent(new Event('change', { bubbles: true }));
			return { ok: true };
		});
		expect(result.ok).toBe(true);

		await browser.pause(300);
		const tintInfo = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-detect-tree="1"]');
			if (!tree) return { hasScopeBadge: false, tintedRowCount: 0 };
			const scopeBadges = Array.from(tree.querySelectorAll('span'))
				.filter((s) => (s.textContent ?? '').trim() === 'scope');
			// Scope tint uses hsla() in inline background
			const allDivs = Array.from(tree.querySelectorAll('div'));
			const tintedRows = allDivs.filter((d) => {
				const bg = d.style.background || '';
				return bg.includes('hsla') || bg.includes('rgba');
			});
			return {
				hasScopeBadge: scopeBadges.length > 0,
				tintedRowCount: tintedRows.length,
			};
		});
		expect(tintInfo.hasScopeBadge).toBe(true);
		expect(tintInfo.tintedRowCount).toBeGreaterThan(0);
	});

	it('apply button reflects scope plan ("N scope(s) · pack-rule-sets")', async function () {
		const btnText = await browser.executeObsidian(() => {
			const modal = document.querySelector('.dtf-detect-modal') ||
				Array.from(document.querySelectorAll('.modal'))
					.find((m) => /Detect organizational systems/i.test(m.textContent ?? ''));
			if (!modal) return null;
			const buttons = Array.from(modal.querySelectorAll('button'));
			const applyBtn = buttons.find((b) =>
				b.classList.contains('mod-cta') && (b.textContent ?? '').startsWith('Apply'),
			);
			return applyBtn?.textContent ?? null;
		});
		expect(btnText).not.toBeNull();
		// With 1 folder selected, button should say "1 scope"
		expect(btnText).toMatch(/1 scope/);
	});

	it('close modal cleans up DOM', async function () {
		await browser.executeObsidian(() => {
			const modal = document.querySelector('.dtf-detect-modal') ||
				Array.from(document.querySelectorAll('.modal'))
					.find((m) => /Detect organizational systems/i.test(m.textContent ?? ''));
			if (!modal) return;
			const buttons = Array.from(modal.querySelectorAll('button'));
			const cancel = buttons.find((b) => (b.textContent ?? '').trim() === 'Cancel');
			cancel?.click();
		});
		await browser.pause(400);
		const stillOpen = await browser.executeObsidian(() => {
			const modal = document.querySelector('.dtf-detect-modal') ||
				Array.from(document.querySelectorAll('.modal'))
					.find((m) => /Detect organizational systems/i.test(m.textContent ?? ''));
			return Boolean(modal);
		});
		expect(stillOpen).toBe(false);
	});
});
