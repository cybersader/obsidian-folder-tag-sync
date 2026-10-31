import { browser, expect } from '@wdio/globals';
// Use wdio-mocha-framework's runtime-bound globals; importing from 'mocha'
// fails because the module bindings populate AFTER tsx loads the spec.
declare const describe: (name: string, fn: (this: { timeout: (ms: number) => void }) => void) => void;
declare const it: (name: string, fn: () => Promise<void> | void) => void;
declare const before: (fn: () => Promise<void> | void) => void;
declare const after: (fn: () => Promise<void> | void) => void;

const FOLDER = 'SupportPrivateFolder_SENTINEL';
const NOTE_NAME = 'SupportPrivateNote_SENTINEL.md';
const NOTE_BODY = 'SUPPORT_PRIVATE_BODY_SENTINEL';
const FRONTMATTER = 'SUPPORT_PRIVATE_FRONTMATTER_SENTINEL';
const RULE_NAME = 'Support private rule SENTINEL';
const RULE_PATTERN = '^SupportPrivateFolder_SENTINEL(?:/|$)';
const TAG_NAME = 'support-private-tag-sentinel';
const ABSOLUTE_PATH = 'C:\\Users\\PrivatePerson_SENTINEL\\Vault\\SupportPrivateNote_SENTINEL.md';

const RULE = {
	id: 'support-private-rule-sentinel',
	name: RULE_NAME,
	enabled: true,
	priority: 1,
	direction: 'folder-to-tag',
	folderPattern: RULE_PATTERN,
	folderEntryPoint: FOLDER,
	tagEntryPoint: TAG_NAME,
	options: {
		createFolders: true,
		addTags: true,
		removeOrphanedTags: false,
		syncOnFileCreate: true,
		syncOnFileMove: true,
		syncOnFileRename: true,
	},
};

describe('Support bundle — production diagnostics and privacy', function () {
	this.timeout(90_000);
	let readableText = '';

	before(async function () {
		await browser.executeObsidian(async ({ app }, fixture) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[]; options: { debugMode: boolean; showNotifications: boolean; syncOnCreate: boolean } };
					saveSettings: () => Promise<void>;
					debugLogger: {
						clear: () => Promise<void>;
						info: (message: string, data?: unknown) => Promise<void>;
						setEnabled: (enabled: boolean) => void;
						isEnabled: () => boolean;
					};
				}> };
			}).plugins.plugins['folder-tag-sync'];

			const state = globalThis as unknown as {
				__supportPrevRules?: unknown[];
				__supportPrevDebug?: boolean;
				__supportPrevNotifications?: boolean;
				__supportPrevSyncOnCreate?: boolean;
			};
			state.__supportPrevRules = plugin.settings.rules;
			state.__supportPrevDebug = plugin.settings.options.debugMode;
			state.__supportPrevNotifications = plugin.settings.options.showNotifications;
			state.__supportPrevSyncOnCreate = plugin.settings.options.syncOnCreate;

			plugin.settings.options.debugMode = false;
			plugin.settings.options.showNotifications = false;
			plugin.settings.options.syncOnCreate = false;
			await plugin.saveSettings();
			plugin.debugLogger.setEnabled(true);
			await plugin.debugLogger.clear();
			await plugin.debugLogger.info('Support privacy sentinel event', {
				file: `${fixture.folder}/${fixture.noteName}`,
				content: fixture.noteBody,
				frontmatter: { secret: fixture.frontmatter },
				absolutePath: fixture.absolutePath,
			});
			plugin.debugLogger.setEnabled(false);
			await plugin.saveSettings();

			if (!app.vault.getAbstractFileByPath(fixture.folder)) {
				await app.vault.createFolder(fixture.folder);
			}
			const notePath = `${fixture.folder}/${fixture.noteName}`;
			if (!app.vault.getAbstractFileByPath(notePath)) {
				await app.vault.create(
					notePath,
					`---\nprivate: ${fixture.frontmatter}\n---\n${fixture.noteBody}`,
				);
			}
			plugin.settings.rules = [fixture.rule];
			await plugin.saveSettings();
		}, {
			folder: FOLDER,
			noteName: NOTE_NAME,
			noteBody: NOTE_BODY,
			frontmatter: FRONTMATTER,
			absolutePath: ABSOLUTE_PATH,
			rule: RULE,
		});
		await browser.pause(500);
	});

	// Teardown runs as four short, individually awaited steps instead of one long
	// script. The single-script version could exceed WebDriver's 30s script
	// timeout; WebDriver then retries the same `execute/sync`, so the whole hook
	// body ran more than once and the second pass hit
	// `ENOENT ... lstat '<vault>/SupportPrivateFolder_SENTINEL'` -- the vault's
	// cache still held a TFolder for a directory the first pass had already
	// removed. Splitting the work keeps each script well inside the timeout, and
	// the fixture removal below is idempotent for this spec's own fixture only.
	after(async function () {
		// 1. Close this spec's UI (support-bundle modals in either document, then
		//    the Settings dialog) before touching settings or the vault.
		await browser.executeObsidian(({ app }) => {
			const settingsDocument = (globalThis as unknown as {
				__dtfSupportSettingsDocument?: Document;
			}).__dtfSupportSettingsDocument;
			const documents = settingsDocument && settingsDocument !== document
				? [document, settingsDocument]
				: [document];
			for (const targetDocument of documents) {
				targetDocument.querySelectorAll('.dtf-support-bundle-modal').forEach((modal) => {
					const close = Array.from(modal.querySelectorAll('button')).find(
						(button) => (button.textContent ?? '').trim() === 'Close',
					);
					(close as HTMLButtonElement | undefined)?.click();
				});
			}
			delete (globalThis as unknown as {
				__dtfSupportSettingsDocument?: Document;
			}).__dtfSupportSettingsDocument;
			const setting = (app as unknown as { setting?: { close: () => void } }).setting;
			setting?.close();
		});

		// 2. Silence the debug logger and clear the log it wrote. Done before the
		//    fixture delete so removing the folder cannot re-enter the logger.
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { options: { debugMode: boolean } };
					saveSettings: () => Promise<void>;
					debugLogger: {
						clear: () => Promise<void>;
						setEnabled: (enabled: boolean) => void;
					};
				}> };
			}).plugins.plugins['folder-tag-sync'];
			plugin.debugLogger.setEnabled(true);
			await plugin.debugLogger.clear();
			plugin.settings.options.debugMode = false;
			plugin.debugLogger.setEnabled(false);
			await plugin.saveSettings();
		});

		// 3. Remove exactly this spec's synthetic fixture, and only while the
		//    spec's own sentinel rule is still the active rule set -- restoring the
		//    user's rules first would let them react to the deletion.
		//
		//    `getAbstractFileByPath` can hand back a cached TFolder for a directory
		//    an earlier retry already deleted, and `vault.delete` then throws
		//    ENOENT. Asking the adapter whether the path is really on disk makes
		//    this idempotent for the owned fixture without swallowing anything
		//    else: any other failure still propagates.
		const removal = await browser.executeObsidian(async ({ app }, folder) => {
			const adapter = app.vault.adapter;
			if (!(await adapter.exists(folder))) return 'already-absent';
			const fixture = app.vault.getAbstractFileByPath(folder);
			if (fixture) {
				await app.vault.delete(fixture, true);
			} else {
				// On disk but missing from the vault cache: remove the owned path directly.
				await adapter.rmdir(folder, true);
			}
			return 'removed';
		}, FOLDER);
		expect(['removed', 'already-absent']).toContain(removal);

		await browser.waitUntil(
			async () => browser.executeObsidian(
				async ({ app }, folder) => !(await app.vault.adapter.exists(folder)),
				FOLDER,
			),
			{ timeout: 10_000, timeoutMsg: `Support bundle fixture ${FOLDER} was not removed` },
		);

		// 4. Only now put the user's settings back.
		await browser.executeObsidian(async ({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, {
					settings: { rules: unknown[]; options: { debugMode: boolean; showNotifications: boolean; syncOnCreate: boolean } };
					saveSettings: () => Promise<void>;
					debugLogger: { setEnabled: (enabled: boolean) => void };
				}> };
			}).plugins.plugins['folder-tag-sync'];
			const state = globalThis as unknown as {
				__supportPrevRules?: unknown[];
				__supportPrevDebug?: boolean;
				__supportPrevNotifications?: boolean;
				__supportPrevSyncOnCreate?: boolean;
			};
			if (state.__supportPrevRules) plugin.settings.rules = state.__supportPrevRules;
			plugin.settings.options.showNotifications = state.__supportPrevNotifications ?? true;
			plugin.settings.options.syncOnCreate = state.__supportPrevSyncOnCreate ?? true;
			const previousDebug = state.__supportPrevDebug ?? false;
			plugin.settings.options.debugMode = previousDebug;
			plugin.debugLogger.setEnabled(previousDebug);
			await plugin.saveSettings();
		});
	});

	it('registers the support command with the expected user-facing name', async function () {
		const command = await browser.executeObsidian(({ app }) => {
			const commands = (app as unknown as {
				commands: { commands: Record<string, { name?: string }> };
			}).commands.commands;
			return commands['folder-tag-sync:open-support-bundle'] ?? null;
		});
		expect(command).not.toBeNull();
		expect(command?.name).toBe('Folder Tag Sync: Open support bundle preview');
	});

	it('opens a readable preview with the complete folder-only tree and privacy exclusions', async function () {
		const opened = await browser.executeObsidian(({ app }) => {
			return (app as unknown as {
				commands: { executeCommandById: (id: string) => boolean };
			}).commands.executeCommandById('folder-tag-sync:open-support-bundle');
		});
		expect(opened).toBe(true);

		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const modal = document.querySelector<HTMLElement>('[data-dtf-support-bundle="1"]');
			return modal?.dataset.dtfSupportStatus === 'ready';
		}), { timeout: 15_000, timeoutMsg: 'Support bundle did not become ready' });

		const preview = await browser.executeObsidian(() => {
			const textarea = document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]');
			return textarea?.value ?? '';
		});
		readableText = preview;

		expect(preview).toContain('FOLDER TAG SYNC SUPPORT BUNDLE v1');
		expect(preview).toContain('=== FULL FOLDER TREE ===');
		expect(preview).toContain(FOLDER);
		expect(preview).toContain(RULE_NAME);
		expect(preview).toContain(RULE_PATTERN);
		expect(preview).toContain(TAG_NAME);
		expect(preview).not.toContain(NOTE_NAME);
		expect(preview).not.toContain(NOTE_BODY);
		expect(preview).not.toContain(FRONTMATTER);
		expect(preview).not.toContain(ABSOLUTE_PATH);

		const vaultName = await browser.executeObsidian(({ app }) => app.vault.getName());
		expect(preview).not.toContain(vaultName);

		await browser.saveScreenshot('test/support-bundle-readable.png');
	});

	it('anonymizes names without recollecting and restores the identical readable payload', async function () {
		const switched = await browser.executeObsidian(() => {
			const modal = document.querySelector<HTMLElement>('[data-dtf-support-bundle="1"]');
			const input = modal?.querySelector<HTMLInputElement>('[data-dtf-support-mode] input[type="checkbox"]');
			if (!input) return false;
			input.click();
			return true;
		});
		expect(switched).toBe(true);
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const mode = document.querySelector<HTMLElement>('[data-dtf-support-mode]')
				?.dataset.dtfSupportMode;
			const preview = document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]')
				?.value ?? '';
			return mode === 'anonymized' && preview.includes('Mode: anonymized');
		}), { timeout: 10_000, timeoutMsg: 'Support bundle did not switch to anonymized mode' });

		const anonymized = await browser.executeObsidian(() => {
			const textarea = document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]');
			return textarea?.value ?? '';
		});
		expect(anonymized).toContain('Mode: anonymized');
		expect(anonymized).toContain('<vault-root>');
		expect(anonymized).not.toContain(FOLDER);
		expect(anonymized).not.toContain(RULE_NAME);
		expect(anonymized).not.toContain(RULE_PATTERN);
		expect(anonymized).not.toContain(TAG_NAME);
		await browser.saveScreenshot('test/support-bundle-anonymized.png');

		await browser.executeObsidian(() => {
			const modal = document.querySelector<HTMLElement>('[data-dtf-support-bundle="1"]');
			modal?.querySelector<HTMLInputElement>('[data-dtf-support-mode] input[type="checkbox"]')?.click();
		});
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const mode = document.querySelector<HTMLElement>('[data-dtf-support-mode]')
				?.dataset.dtfSupportMode;
			const preview = document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]')
				?.value ?? '';
			return mode === 'readable' && preview.includes('Mode: readable');
		}), { timeout: 10_000, timeoutMsg: 'Support bundle did not return to readable mode' });
		const restored = await browser.executeObsidian(() =>
			document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]')?.value ?? '',
		);
		expect(restored).toBe(readableText);
	});

	it('clears stale preview state and keeps Copy disabled during a delayed refresh', async function () {
		await browser.executeObsidian(({ app }) => {
			const logger = (app as unknown as {
				plugins: { plugins: Record<string, { debugLogger: {
					readRecentEntries: () => Promise<unknown>;
				} }> };
			}).plugins.plugins['folder-tag-sync'].debugLogger;
			const state = globalThis as unknown as {
				__supportOriginalRead?: () => Promise<unknown>;
				__supportResolveRead?: () => void;
			};
			state.__supportOriginalRead = logger.readRecentEntries;
			logger.readRecentEntries = () => new Promise((resolve) => {
				state.__supportResolveRead = () => resolve({
					entries: [{ level: 'info', message: 'DELAYED_REFRESH_READY_SENTINEL' }],
					status: {
						returnedCount: 1,
						validEntryCount: 1,
						malformedLineCount: 0,
						returnedBytes: 64,
						truncated: false,
						errors: [],
					},
				});
			});
		});

		try {
			const clicked = await browser.executeObsidian(() => {
				const button = document.querySelector<HTMLButtonElement>('[data-dtf-support-refresh="1"]');
				if (!button || button.disabled) return false;
				button.click();
				return true;
			});
			expect(clicked).toBe(true);

			await browser.waitUntil(async () => browser.executeObsidian(() => {
				const modal = document.querySelector<HTMLElement>('[data-dtf-support-bundle="1"]');
				const preview = document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]');
				const copy = document.querySelector<HTMLButtonElement>('[data-dtf-support-copy="1"]');
				return modal?.dataset.dtfSupportStatus === 'collecting'
					&& preview?.value === ''
					&& copy?.disabled === true;
			}), { timeout: 5_000, timeoutMsg: 'Refresh retained stale copyable preview state' });

			await browser.executeObsidian(() => {
				const state = globalThis as unknown as { __supportResolveRead?: () => void };
				state.__supportResolveRead?.();
			});
			await browser.waitUntil(async () => browser.executeObsidian(() => {
				const modal = document.querySelector<HTMLElement>('[data-dtf-support-bundle="1"]');
				const preview = document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]')
					?.value ?? '';
				return modal?.dataset.dtfSupportStatus === 'ready'
					&& preview.includes('DELAYED_REFRESH_READY_SENTINEL');
			}), { timeout: 15_000, timeoutMsg: 'Delayed refresh did not publish its completed snapshot' });
			readableText = await browser.executeObsidian(() =>
				document.querySelector<HTMLTextAreaElement>('[data-dtf-support-preview="1"]')?.value ?? '',
			);
		} finally {
			await browser.executeObsidian(({ app }) => {
				const logger = (app as unknown as {
					plugins: { plugins: Record<string, { debugLogger: {
						readRecentEntries: () => Promise<unknown>;
					} }> };
				}).plugins.plugins['folder-tag-sync'].debugLogger;
				const state = globalThis as unknown as {
					__supportOriginalRead?: () => Promise<unknown>;
					__supportResolveRead?: () => void;
				};
				state.__supportResolveRead?.();
				if (state.__supportOriginalRead) logger.readRecentEntries = state.__supportOriginalRead;
				delete state.__supportOriginalRead;
				delete state.__supportResolveRead;
			});
		}
	});

	it('copies exactly the visible preview to the system clipboard', async function () {
		const clicked = await browser.executeObsidian(() => {
			const button = document.querySelector<HTMLButtonElement>('[data-dtf-support-copy="1"]');
			if (!button || button.disabled) return false;
			button.click();
			return true;
		});
		expect(clicked).toBe(true);

		await browser.waitUntil(async () => browser.executeObsidian(() =>
			document.querySelector('[data-dtf-support-status="copied"]') !== null,
		), { timeout: 10_000, timeoutMsg: 'Support bundle copy did not complete' });

		const clipboardText = await browser.execute(async () => navigator.clipboard.readText());
		expect(clipboardText).toBe(readableText);
	});

	it('the Settings support row opens the same preview modal', async function () {
		await browser.executeObsidian(({ app }) => {
			const modal = document.querySelector('[data-dtf-support-bundle="1"]');
			const close = modal && Array.from(modal.querySelectorAll('button')).find(
				(button) => (button.textContent ?? '').trim() === 'Close',
			);
			(close as HTMLButtonElement | undefined)?.click();
			const setting = (app as unknown as {
				setting: { open: () => void; openTabById: (id: string) => void };
			}).setting;
			setting.open();
			setting.openTabById('folder-tag-sync');
		});
		await browser.pause(500);

		const opened = await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as {
				setting: { activeTab?: { containerEl?: HTMLElement } };
			}).setting;
			const container = setting.activeTab?.containerEl;
			const row = container
				?.querySelector<HTMLElement>('[data-dtf-support-bundle-setting="1"]');
			const button = row?.querySelector<HTMLButtonElement>('button');
			if (!button || !container) return false;
			(globalThis as unknown as {
				__dtfSupportSettingsDocument?: Document;
			}).__dtfSupportSettingsDocument = container.ownerDocument;
			button.click();
			return true;
		});
		expect(opened).toBe(true);
		await browser.waitUntil(async () => browser.executeObsidian(() => {
			const settingsDocument = (globalThis as unknown as {
				__dtfSupportSettingsDocument?: Document;
			}).__dtfSupportSettingsDocument;
			return settingsDocument?.querySelector('[data-dtf-support-bundle="1"]') !== null;
		}), { timeout: 10_000, timeoutMsg: 'Settings did not open the support bundle modal' });
	});

	it('the Debug mode setting changes the live logger immediately', async function () {
		await browser.executeObsidian(() => {
			const settingsDocument = (globalThis as unknown as {
				__dtfSupportSettingsDocument?: Document;
			}).__dtfSupportSettingsDocument;
			const modal = settingsDocument?.querySelector('[data-dtf-support-bundle="1"]')
				?? document.querySelector('[data-dtf-support-bundle="1"]');
			const close = modal && Array.from(modal.querySelectorAll('button')).find(
				(button) => (button.textContent ?? '').trim() === 'Close',
			);
			(close as HTMLButtonElement | undefined)?.click();
		});
		await browser.pause(150);

		const beforeState = await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { debugLogger: { isEnabled: () => boolean } }> };
			}).plugins.plugins['folder-tag-sync'];
			return plugin.debugLogger.isEnabled();
		});
		expect(beforeState).toBe(false);

		const clicked = await browser.executeObsidian(({ app }) => {
			const setting = (app as unknown as {
				setting: { activeTab?: { containerEl?: HTMLElement } };
			}).setting;
			const rows = Array.from(setting.activeTab?.containerEl
				?.querySelectorAll<HTMLElement>('.setting-item') ?? []);
			const row = rows.find((candidate) =>
				candidate.querySelector('.setting-item-name')?.textContent?.trim() === 'Debug mode',
			);
			const input = row?.querySelector<HTMLInputElement>('input[type="checkbox"]');
			if (!input) return false;
			input.click();
			return true;
		});
		expect(clicked).toBe(true);
		await browser.pause(150);

		const afterState = await browser.executeObsidian(({ app }) => {
			const plugin = (app as unknown as {
				plugins: { plugins: Record<string, { debugLogger: { isEnabled: () => boolean } }> };
			}).plugins.plugins['folder-tag-sync'];
			return plugin.debugLogger.isEnabled();
		});
		expect(afterState).toBe(true);
	});
});
