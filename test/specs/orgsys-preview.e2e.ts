import { browser, expect } from '@wdio/globals';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

/**
 * E2E tests for the Taxonomy Workbench `.orgsys` preview modal.
 *
 * The modal is the in-app surface for the new `.orgsys` system-definition
 * format: edit a definition, watch what it compiles to. It is self-contained
 * (the PARA / Johnny Decimal examples are inlined, not read from disk) and a
 * pure consumer of the verified compiler — so these tests need no vault
 * fixture and no staged rule-pack files. They prove the wiring works
 * end-to-end inside a real Obsidian instance:
 *   - the command is registered;
 *   - running it opens the modal with the preview heading;
 *   - the compiled-rules list renders ≥1 rule for the default PARA example;
 *   - loading the composed example expands a mount into >1 compiled rule;
 *   - cancel/close cleans up the DOM.
 *
 * Structure mirrors scope-detect.e2e.ts (runtime-bound describe/it/before/
 * after globals; modal located by class with a heading-text fallback).
 */

describe('taxonomy workbench — .orgsys preview modal', function () {
	this.timeout(60_000);

	before(async function () {
		// Nothing to stage — the modal inlines its examples and compiles in
		// memory. A short settle lets the plugin finish loading its commands.
		await browser.executeObsidian(async () => {
			await new Promise((r) => setTimeout(r, 300));
		});
	});

	after(async function () {
		// Defensively close the modal in case a test left it open.
		await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-orgsys-preview-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Taxonomy Workbench/i.test(m.textContent ?? ''),
				);
			if (!modal) return;
			const close = Array.from(modal.querySelectorAll('button')).find(
				(b) => (b.textContent ?? '').trim() === 'Close',
			);
			close?.click();
		});
	});

	it('taxonomy-workbench-preview-orgsys command is registered', async function () {
		const cmdInfo = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { commands: Record<string, unknown> };
			}).commands;
			const cmdId = Object.keys(commands.commands).find(
				(id) => id === 'folder-tag-sync:taxonomy-workbench-preview-orgsys',
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

	it('running the command opens the preview modal', async function () {
		const cmdResult = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			}).commands;
			const ok = commands.executeCommandById('folder-tag-sync:taxonomy-workbench-preview-orgsys');
			return { ok };
		});
		expect(cmdResult.ok).toBe(true);

		// Wait for the modal to render (first compile runs synchronously on open).
		await browser.pause(1000);

		const modalInfo = await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-orgsys-preview-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Taxonomy Workbench/i.test(m.textContent ?? ''),
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
		expect(modalInfo.headerText).toContain('Taxonomy Workbench');
	});

	it('renders the compiled-rules list with ≥1 rule for the default PARA example', async function () {
		const ruleInfo = await browser.executeObsidian(() => {
			const list = document.querySelector<HTMLElement>('[data-dtf-orgsys-rules="1"]');
			if (!list) return { hasList: false, ruleCount: 0 };
			const rows = list.querySelectorAll('[data-dtf-orgsys-rule="1"]');
			return { hasList: true, ruleCount: rows.length };
		});
		expect(ruleInfo.hasList).toBe(true);
		expect(ruleInfo.ruleCount).toBeGreaterThan(0);
	});

	it('shows the sample-emissions output region', async function () {
		const hasOutput = await browser.executeObsidian(() => {
			const out = document.querySelector<HTMLElement>('[data-dtf-orgsys-preview="1"]');
			if (!out) return false;
			return /Sample emissions/i.test(out.textContent ?? '');
		});
		expect(hasOutput).toBe(true);
	});

	it('loading the composed example expands the mount into >1 compiled rule', async function () {
		// Click the composition preset. The composed def mounts Johnny Decimal
		// under every Entity/*/Output folder; even when the vault has none, the
		// modal compiles against derived sample anchors so the nested expansion
		// (host rule + mounted rule) is always visible — proving the mount fired.
		const clicked = await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-orgsys-preview-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Taxonomy Workbench/i.test(m.textContent ?? ''),
				);
			if (!modal) return false;
			const btn = Array.from(modal.querySelectorAll('button')).find(
				(b) => (b.textContent ?? '').trim() === 'Load composed example',
			);
			if (!btn) return false;
			(btn as HTMLButtonElement).click();
			return true;
		});
		expect(clicked).toBe(true);

		// loadPreset recompiles synchronously; a short settle is defensive.
		await browser.pause(800);

		const info = await browser.executeObsidian(() => {
			const list = document.querySelector<HTMLElement>('[data-dtf-orgsys-rules="1"]');
			const out = document.querySelector<HTMLElement>('[data-dtf-orgsys-preview="1"]');
			const rows = list ? list.querySelectorAll('[data-dtf-orgsys-rule="1"]').length : 0;
			return {
				hasList: Boolean(list),
				ruleCount: rows,
				// The nested emission carries the host's tag namespace (`#--…`),
				// which a bare un-mounted Johnny Decimal rule would never produce.
				showsNestedTag: /#--/.test(out?.textContent ?? ''),
			};
		});
		expect(info.hasList).toBe(true);
		expect(info.ruleCount).toBeGreaterThan(1);
		expect(info.showsNestedTag).toBe(true);
	});

	it('close cleans up the DOM', async function () {
		await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-orgsys-preview-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Taxonomy Workbench/i.test(m.textContent ?? ''),
				);
			if (!modal) return;
			const close = Array.from(modal.querySelectorAll('button')).find(
				(b) => (b.textContent ?? '').trim() === 'Close',
			);
			close?.click();
		});
		await browser.pause(400);

		const stillOpen = await browser.executeObsidian(() => {
			const modal =
				document.querySelector('.dtf-orgsys-preview-modal') ||
				Array.from(document.querySelectorAll('.modal')).find((m) =>
					/Taxonomy Workbench/i.test(m.textContent ?? ''),
				);
			return Boolean(modal);
		});
		expect(stillOpen).toBe(false);
	});
});
