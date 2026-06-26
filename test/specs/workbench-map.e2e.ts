import { browser, expect } from '@wdio/globals';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

/**
 * E2E tests for the Taxonomy Workbench map — a large dockable pane (ItemView)
 * that renders the full annotated vault hierarchy with detected organizational
 * systems on each folder. This is the read-only DISPLAY slice (no snap/drag).
 *
 * The proof here mirrors `scope-detect.e2e.ts`: build a nested-mixed fixture
 * so detection has something to show, run the registered command, and assert
 * the leaf opens with the annotated tree rendered — all inside a real Obsidian.
 *
 * Strategy:
 *   - `before` builds the nested-JD-in-SEACOW folder structure in the test
 *     vault via the adapter (TFolder objects only materialize once the adapter
 *     sees the directory).
 *   - `after` removes the fixture folders AND detaches the workbench leaf so
 *     subsequent specs see a clean vault + workspace.
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

describe('Taxonomy Workbench map — dockable annotated hierarchy pane', function () {
	this.timeout(60_000);

	before(async function () {
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
			// Let the metadata cache pick up the freshly-created folders.
			await new Promise((r) => setTimeout(r, 500));
		});
	});

	after(async function () {
		// Detach the workbench leaf + remove the fixture folders. Failure to
		// clean is fatal: dirty state would leak into other specs.
		await browser.executeObsidian(async ({ app }) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
			const adapter = app.vault.adapter;
			const top = ['01 - Projects', '02 - Areas', '03 - Resources', 'Templates'];
			for (const f of top) {
				if (await adapter.exists(f)) {
					await adapter.rmdir(f, true);
				}
			}
		});
	});

	it('registers the taxonomy-workbench-open-map command', async function () {
		const found = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { commands: Record<string, unknown> };
			}).commands;
			return Object.keys(commands.commands).some((id) =>
				id === 'folder-tag-sync:taxonomy-workbench-open-map',
			);
		});
		expect(found).toBe(true);
	});

	it('running the command opens a leaf of view type taxonomy-workbench-map', async function () {
		const cmdOk = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			}).commands;
			return commands.executeCommandById('folder-tag-sync:taxonomy-workbench-open-map');
		});
		expect(cmdOk).toBe(true);

		// Wait for the view to mount + render.
		await browser.pause(1500);

		const leafCount = await browser.executeObsidian(({ app }) => {
			return app.workspace.getLeavesOfType('taxonomy-workbench-map').length;
		});
		expect(leafCount).toBeGreaterThanOrEqual(1);
	});

	it('renders the map tree container with at least one folder row', async function () {
		const info = await browser.executeObsidian(() => {
			const tree = document.querySelector<HTMLElement>('[data-dtf-workbench-map="1"]');
			if (!tree) return { hasTree: false, folderCount: 0 };
			const folderIcons = (tree.textContent ?? '').match(/📁/g)?.length ?? 0;
			return { hasTree: true, folderCount: folderIcons };
		});
		expect(info.hasTree).toBe(true);
		expect(info.folderCount).toBeGreaterThanOrEqual(1);
	});

	it('detaching the leaf cleans up', async function () {
		await browser.executeObsidian(({ app }) => {
			app.workspace.detachLeavesOfType('taxonomy-workbench-map');
		});
		await browser.pause(400);
		const stillOpen = await browser.executeObsidian(({ app }) => {
			const leaves = app.workspace.getLeavesOfType('taxonomy-workbench-map').length;
			const dom = document.querySelector('[data-dtf-workbench-map="1"]');
			return { leaves, hasDom: Boolean(dom) };
		});
		expect(stillOpen.leaves).toBe(0);
		expect(stillOpen.hasDom).toBe(false);
	});
});
