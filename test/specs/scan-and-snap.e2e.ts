import { browser, expect } from '@wdio/globals';
import * as fs from 'node:fs/promises';
import * as path from 'node:path';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

/**
 * E2E tests for the Scan & Snap rule-authoring builder (Phase 1b).
 *
 * Scan & Snap turns "your vault appears to use these known organizational
 * systems" into a flat, triage-able list of *candidate rules* drafted from
 * the detected packs — no hand-written regex. These tests prove the modal
 * wiring works end-to-end inside a real Obsidian instance: the command is
 * registered, running it opens the modal, candidate rows render with
 * checkboxes + coverage chips, the "Add N rules" button reflects selection,
 * and cancel/close cleans up the DOM.
 *
 * Strategy mirrors scope-detect.e2e.ts:
 *   - `before` builds a small nested-mixed folder fixture in the running
 *     vault via the adapter (TFolder objects only materialize once the
 *     adapter sees the directory). This is more reliable than a static
 *     fixture because the wdio test vault is reused across specs.
 *   - Each test exercises one slice of the modal wiring through the loaded
 *     plugin in real Obsidian.
 *   - `after` removes the test folders so subsequent specs see a clean vault.
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

describe('scan & snap — draft rules from detected packs', function () {
	this.timeout(60_000);

	before(async function () {
		// Stage the rule-pack JSON files into the test vault's plugin dir.
		// The wdio install only copies main.js/manifest.json/styles.css — NOT
		// the rule-packs/ folder — so the modal (which loads pack rules from
		// disk via the adapter to build candidates) would otherwise find
		// nothing and show the empty state. Real BRAT/community installs ship
		// the full plugin directory, so this only re-creates production
		// conditions for the test. (Same approach as typed-model.e2e.ts.)
		// Detection itself uses the manifest BUNDLED into the build, so we
		// don't need to stage manifest.json — only the pack files it references.
		const packsDir = path.resolve('rule-packs');
		const packFiles = (await fs.readdir(packsDir)).filter(
			(f) => f.endsWith('.json') && f !== 'manifest.json',
		);
		const packContents: Record<string, string> = {};
		for (const f of packFiles) {
			packContents[f] = await fs.readFile(path.join(packsDir, f), 'utf8');
		}

		// Build the nested fixture + stage the packs inside the running vault.
		// Folders are created via the adapter so the metadata cache + getRoot()
		// reflect them.
		await browser.executeObsidian(async ({ app }, packs: Record<string, string>) => {
			const adapter = app.vault.adapter;

			// Stage pack JSON into the plugin's rule-packs dir.
			const rulePacksDir = `${app.vault.configDir}/plugins/folder-tag-sync/rule-packs`;
			if (!(await adapter.exists(rulePacksDir))) await adapter.mkdir(rulePacksDir);
			for (const [name, content] of Object.entries(packs)) {
				await adapter.write(`${rulePacksDir}/${name}`, content);
			}

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
			// Let the metadata cache pick up new folders.
			await new Promise((r) => setTimeout(r, 500));
		}, packContents);
	});

	after(async function () {
		// Clean up — remove the test folders so subsequent specs see a clean
		// vault. Failure to clean would leak state into other specs.
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

	it('scan-and-snap command is registered', async function () {
		const cmdInfo = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { commands: Record<string, unknown> };
			}).commands;
			const cmdId = Object.keys(commands.commands).find(
				(id) => id === 'folder-tag-sync:scan-and-snap-draft-rules',
			);
			return {
				found: Boolean(cmdId),
				allCommands: Object.keys(commands.commands).filter((id) =>
					id.startsWith('folder-tag-sync:'),
				),
			};
		});
		expect(cmdInfo.found).toBe(true);
	});

	it('running the command opens the Scan & Snap modal', async function () {
		const cmdResult = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			}).commands;
			const ok = commands.executeCommandById('folder-tag-sync:scan-and-snap-draft-rules');
			return { ok };
		});
		expect(cmdResult.ok).toBe(true);

		// Wait for the modal to render (detection + pack-loading is async).
		await browser.pause(1500);

		const modalInfo = await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-scan-snap-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Scan & snap/i.test(m.textContent ?? ''),
				);
			if (!modal) {
				return {
					open: false,
					headerText: null,
					allModals: Array.from(document.querySelectorAll('.modal')).length,
				};
			}
			const h2 = modal.querySelector('h2');
			return { open: true, headerText: h2?.textContent ?? null };
		});
		expect(modalInfo.open).toBe(true);
		expect(modalInfo.headerText).toContain('Scan & snap');
	});

	it('renders candidate rows with checkboxes', async function () {
		const rowInfo = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-scan-snap-tree="1"]');
			if (!tree) return { hasTree: false, rowCount: 0, checkboxCount: 0 };
			const rows = tree.querySelectorAll('[data-dtf-candidate-row="1"]');
			const checkboxes = tree.querySelectorAll('input[type="checkbox"]');
			return {
				hasTree: true,
				rowCount: rows.length,
				checkboxCount: checkboxes.length,
			};
		});
		expect(rowInfo.hasTree).toBe(true);
		expect(rowInfo.rowCount).toBeGreaterThan(0);
		expect(rowInfo.checkboxCount).toBeGreaterThan(0);
	});

	it('candidate rows show coverage chips', async function () {
		const chipInfo = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-scan-snap-tree="1"]');
			if (!tree) return { hasCoverage: false };
			// Coverage chips read either "N files" or "0 — no match".
			const spans = Array.from(tree.querySelectorAll('span'));
			const coverageChips = spans.filter((s) => {
				const t = (s.textContent ?? '').trim();
				return /\d+ files$/.test(t) || /^0 — no match$/.test(t);
			});
			return { hasCoverage: coverageChips.length > 0, count: coverageChips.length };
		});
		expect(chipInfo.hasCoverage).toBe(true);
	});

	it('"Add N rules" button reflects the selection count', async function () {
		// Candidates are checked by default — the button should report the
		// total candidate count. After unchecking one, the count drops by 1.
		const initial = await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-scan-snap-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Scan & snap/i.test(m.textContent ?? ''),
				);
			if (!modal) return { text: null, selected: 0 };
			const addBtn = Array.from(modal.querySelectorAll('button')).find(
				(b) => b.classList.contains('mod-cta') && /^Add /.test(b.textContent ?? ''),
			);
			const match = (addBtn?.textContent ?? '').match(/Add (\d+) rule/);
			return { text: addBtn?.textContent ?? null, selected: match ? Number(match[1]) : 0 };
		});
		expect(initial.text).not.toBeNull();
		expect(initial.selected).toBeGreaterThan(0);

		// Uncheck the first candidate and verify the count decrements.
		await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-scan-snap-tree="1"]');
			const cb = tree?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			if (cb && cb.checked) {
				cb.checked = false;
				cb.dispatchEvent(new Event('change', { bubbles: true }));
			}
		});
		await browser.pause(300);

		const afterUncheck = await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-scan-snap-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Scan & snap/i.test(m.textContent ?? ''),
				);
			if (!modal) return { selected: -1 };
			const addBtn = Array.from(modal.querySelectorAll('button')).find(
				(b) => b.classList.contains('mod-cta') && /^Add /.test(b.textContent ?? ''),
			);
			const match = (addBtn?.textContent ?? '').match(/Add (\d+) rule/);
			return { selected: match ? Number(match[1]) : 0 };
		});
		expect(afterUncheck.selected).toBe(initial.selected - 1);
	});

	it('cancel closes the modal and cleans up the DOM', async function () {
		await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-scan-snap-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Scan & snap/i.test(m.textContent ?? ''),
				);
			if (!modal) return;
			const cancel = Array.from(modal.querySelectorAll('button')).find(
				(b) => (b.textContent ?? '').trim() === 'Cancel',
			);
			cancel?.click();
		});
		await browser.pause(400);

		const stillOpen = await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-scan-snap-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Scan & snap/i.test(m.textContent ?? ''),
				);
			return Boolean(modal);
		});
		expect(stillOpen).toBe(false);
	});
});
