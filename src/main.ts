import { App, Plugin, TFile, TFolder, Notice, Modal } from 'obsidian';
import { buildCoverageReport, type VaultCoverageReport } from './engine/ruleCoverage';
import { DynamicTagsFoldersSettings, DEFAULT_SETTINGS, MappingRule } from './types/settings';
import { SettingsTab } from './ui/SettingsTab';
import { RulePackPickerModal } from './ui/RulePackPickerModal';
import { DetectVaultModal } from './ui/DetectVaultModal';
import { DebugLogger } from './utils/debug';
import { FolderToTagSync } from './sync/FolderToTagSync';
import { TagToFolderSync } from './sync/TagToFolderSync';
import { loadRulePackFromJSON, RulePack } from './engine/rulePackLoader';

/**
 * Dynamic Tags & Folders Plugin
 *
 * Bidirectional mapping between folder paths and tags using regex patterns
 * and transformation rules.
 */
export default class DynamicTagsFoldersPlugin extends Plugin {
	settings: DynamicTagsFoldersSettings = DEFAULT_SETTINGS;
	debugLogger!: DebugLogger;

	async onload() {
		console.debug('Loading Dynamic Tags & Folders plugin');

		// Load settings
		await this.loadSettings();

		// Initialize debug logger
		this.debugLogger = new DebugLogger(
			this.app,
			this.settings.options.debugMode
		);

		// Clear previous debug log and start fresh
		await this.debugLogger.clear();
		await this.debugLogger.info('Plugin loaded', {
			version: this.manifest.version,
			rulesCount: this.settings.rules.length,
			debugMode: this.settings.options.debugMode
		});

		// Add settings tab
		this.addSettingTab(new SettingsTab(this.app, this));

		// Add commands
		this.addCommand({
			id: 'sync-folder-to-tags',
			name: 'Sync folder to tags (current file)',
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					void this.syncFolderToTags(file);
				}
			}
		});

		this.addCommand({
			id: 'sync-tags-to-folder',
			name: 'Sync tags to folder (current file)',
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					void this.syncTagsToFolder(file);
				}
			}
		});

		this.addCommand({
			id: 'import-rule-pack',
			name: 'Import rule pack from bundled packs',
			callback: () => {
				void this.browseRulePacks();
			}
		});

		this.addCommand({
			id: 'scan-vault-for-systems',
			name: 'Scan vault for organizational systems',
			callback: () => {
				void this.scanVaultForSystems();
			}
		});

		// Bulk sync — preview + apply across the entire vault
		this.addCommand({
			id: 'preview-vault-sync',
			name: 'Preview vault sync (folder→tag, dry-run)',
			callback: () => {
				void this.previewVaultSync();
			}
		});

		this.addCommand({
			id: 'sync-entire-vault',
			name: 'Sync entire vault (folder→tag)',
			callback: () => {
				void this.confirmAndSyncEntireVault();
			}
		});

		// Coverage report — read-only "where do my rules apply" view
		this.addCommand({
			id: 'show-rule-coverage',
			name: 'Show rule coverage report (where rules apply)',
			callback: () => {
				void this.showRuleCoverage();
			}
		});

		// Auto-sync on file events — wired 2026-04-28 in 0.1.18.
		// SAFETY-FIRST DESIGN: only the FORWARD direction (folder → tag) auto-fires.
		// The inverse direction (tag → folder, which moves files) stays manual-command-
		// only because it can be destructive (lossy filters can't recover original
		// folder names). User must explicitly invoke "Sync tags to folder (current file)".
		//
		// Forward sync is purely additive — adds tags to frontmatter, never moves files,
		// never modifies folders. Worst case: extra tags the user can manually delete.
		this.registerEvent(
			this.app.vault.on('create', (file) => {
				if (file instanceof TFile && file.extension === 'md') {
					void this.autoSyncOnEvent(file, 'create');
				}
			}),
		);
		this.registerEvent(
			this.app.vault.on('rename', (file, oldPath) => {
				if (file instanceof TFile && file.extension === 'md') {
					void this.autoSyncOnEvent(file, 'rename', oldPath);
				}
			}),
		);
	}

	/**
	 * Auto-fire forward sync (folder → tag) on file create or rename. Respects
	 * each rule's per-rule sync flags (`syncOnFileCreate`, `syncOnFileRename`,
	 * `syncOnFileMove`). Never auto-fires inverse direction (which moves files)
	 * — that stays manual-command-only for safety.
	 */
	private async autoSyncOnEvent(
		file: TFile,
		event: 'create' | 'rename',
		_oldPath?: string,
	): Promise<void> {
		try {
			// Filter rules whose flags allow this event type
			const eligibleRules = this.settings.rules.filter((r) => {
				if (!r.enabled) return false;
				if (event === 'create' && !r.options.syncOnFileCreate) return false;
				if (event === 'rename' && !(r.options.syncOnFileRename || r.options.syncOnFileMove)) return false;
				// Only forward direction fires automatically
				return r.direction === 'folder-to-tag' || r.direction === 'bidirectional';
			});
			if (eligibleRules.length === 0) return;
			await this.syncFolderToTags(file);
		} catch (err) {
			await this.debugLogger.error('Auto-sync failed on event', {
				event,
				file: file.path,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	onunload(): void {
		console.debug('Unloading Dynamic Tags & Folders plugin');
		void this.debugLogger.info('Plugin unloaded');
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}

	/**
	 * Sync folder path to tags for a file
	 */
	async syncFolderToTags(file: TFile) {
		console.debug('Syncing folder to tags:', file.path);
		await this.debugLogger.info('Sync folder to tags started', {
			file: file.path,
			folder: file.parent?.path
		});

		try {
			// Create sync engine
			const syncEngine = new FolderToTagSync(this.app, this.settings, this.debugLogger);

			// Sync the file
			const result = await syncEngine.syncFile(file);

			// Log result
			await this.debugLogger.info('Sync folder to tags completed', {
				success: result.success,
				tagsAdded: result.tagsAdded,
				message: result.message,
				error: result.error
			});

			// Show notification
			if (result.success && result.tagsAdded.length > 0) {
				new Notice(`Added ${result.tagsAdded.length} tag(s): ${result.tagsAdded.join(', ')}`);
			} else if (!result.success) {
				new Notice(`Sync failed: ${result.error || 'Unknown error'}`);
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			await this.debugLogger.error('Sync folder to tags failed', {
				error: errorMessage
			});
			new Notice(`Error: ${errorMessage}`);
		}
	}

	/**
	 * Sync tags to folder location for a file
	 */
	/**
	 * Open the Detect-mode modal — scans the vault for organizational
	 * patterns, lists detected packs ranked by confidence, applies on click.
	 */
	scanVaultForSystems(): void {
		const modal = new DetectVaultModal(this.app, async (newRules) => {
			const existingIds = new Set(this.settings.rules.map((r) => r.id));
			const toAdd = newRules.filter((r) => !existingIds.has(r.id));
			this.settings.rules = [...this.settings.rules, ...toAdd];
			await this.saveSettings();
			await this.debugLogger.info('Detect-mode pack applied', {
				rulesAdded: toAdd.length,
				skippedDuplicates: newRules.length - toAdd.length,
			});
		});
		modal.open();
	}

	/**
	 * Discover every `*.json` file under `rule-packs/` inside the plugin's
	 * own directory, parse each with `loadRulePackFromJSON`, and open a
	 * picker. On select, prompt replace-vs-append and merge into settings.
	 */
	async browseRulePacks(): Promise<void> {
		const adapter = this.app.vault.adapter;
		const pluginDir = `${this.app.vault.configDir}/plugins/${this.manifest.id}`;
		const rulePacksDir = `${pluginDir}/rule-packs`;

		let entries: string[];
		try {
			const listing = await adapter.list(rulePacksDir);
			entries = listing.files;
		} catch (err) {
			new Notice(`No rule-packs/ folder found at ${rulePacksDir}`);
			await this.debugLogger.error('Rule pack discovery failed', {
				error: (err as Error).message,
				dir: rulePacksDir
			});
			return;
		}

		const packs: RulePack[] = [];
		const errors: string[] = [];
		for (const path of entries) {
			if (!path.endsWith('.json')) continue;
			try {
				const json = await adapter.read(path);
				const result = loadRulePackFromJSON(json);
				if (result.ok) {
					packs.push(result.pack);
				} else {
					errors.push(`${path}: ${result.errors[0]}`);
				}
			} catch (err) {
				errors.push(`${path}: ${(err as Error).message}`);
			}
		}

		if (packs.length === 0) {
			new Notice(`No valid rule packs found. ${errors.length} parse errors.`);
			if (errors.length) {
				await this.debugLogger.error('Rule pack parse errors', { errors });
			}
			return;
		}

		const picker = new RulePackPickerModal(this.app, packs, (pack) => {
			this.confirmImportRulePack(pack);
		});
		picker.open();
	}

	/**
	 * Show a small modal asking whether to replace all rules or append to
	 * the existing list. Applies the choice + saves settings.
	 */
	private confirmImportRulePack(pack: RulePack): void {
		const modal = new Modal(this.app);
		modal.setTitle(`Import ${pack.name}`);

		const { contentEl } = modal;
		contentEl.createEl('p', {
			text: `${pack.description} — ${pack.rules.length} rules.`
		});
		contentEl.createEl('p', {
			text: 'Existing rules will be kept if you append, or removed if you replace.'
		});

		const btnContainer = contentEl.createDiv({
			attr: { style: 'display: flex; gap: 8px; justify-content: flex-end; margin-top: 1em;' }
		});

		const appendBtn = btnContainer.createEl('button', { text: 'Append' });
		appendBtn.addEventListener('click', () => {
			void this.applyRulePack(pack, 'append');
			modal.close();
		});

		const replaceBtn = btnContainer.createEl('button', { text: 'Replace all', cls: 'mod-warning' });
		replaceBtn.addEventListener('click', () => {
			void this.applyRulePack(pack, 'replace');
			modal.close();
		});

		const cancelBtn = btnContainer.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => modal.close());

		modal.open();
	}

	private async applyRulePack(pack: RulePack, mode: 'append' | 'replace'): Promise<void> {
		if (mode === 'replace') {
			this.settings.rules = pack.rules;
		} else {
			const existingIds = new Set(this.settings.rules.map((r: MappingRule) => r.id));
			const toAdd = pack.rules.filter((r) => !existingIds.has(r.id));
			this.settings.rules = [...this.settings.rules, ...toAdd];
		}
		await this.saveSettings();
		await this.debugLogger.info('Rule pack imported', {
			pack: pack.name,
			mode,
			rulesAdded: pack.rules.length
		});
		new Notice(`Imported ${pack.name}: ${pack.rules.length} rules (${mode})`);
	}

	async syncTagsToFolder(file: TFile) {
		console.debug('Syncing tags to folder:', file.path);
		await this.debugLogger.info('Sync tags to folder started', {
			file: file.path
		});

		try {
			// Create sync engine
			const syncEngine = new TagToFolderSync(this.app, this.settings, this.debugLogger);

			// Sync the file
			const result = await syncEngine.syncFile(file);

			// Log result
			await this.debugLogger.info('Sync tags to folder completed', {
				success: result.success,
				targetFolder: result.targetFolder,
				message: result.message,
				error: result.error
			});

			// Show notification
			if (result.success && result.targetFolder) {
				new Notice(`Moved to folder: ${result.targetFolder}`);
			} else if (!result.success) {
				new Notice(`Sync failed: ${result.error || 'Unknown error'}`);
			} else if (!result.targetFolder) {
				new Notice('No matching rule found for tags');
			}
		} catch (error) {
			const errorMessage = error instanceof Error ? error.message : 'Unknown error';
			await this.debugLogger.error('Sync tags to folder failed', {
				error: errorMessage
			});
			new Notice(`Error: ${errorMessage}`);
		}
	}

	/**
	 * Preview what would happen if we ran forward sync against every markdown
	 * file in the vault — opens a modal showing affected files, sample changes,
	 * and aggregate counts. User can choose 'Apply changes' or 'Cancel'.
	 */
	async previewVaultSync(): Promise<void> {
		new Notice('Computing vault sync preview...');
		try {
			const syncEngine = new FolderToTagSync(this.app, this.settings, this.debugLogger);
			const result = await syncEngine.previewVault();
			new VaultSyncPreviewModal(this.app, result, async () => {
				await this.runVaultSyncWithProgress();
			}).open();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await this.debugLogger.error('Vault preview failed', { error: msg });
			new Notice(`Preview failed: ${msg}`);
		}
	}

	/**
	 * Build a vault-wide coverage report grouped by rule + open a read-only
	 * modal showing where each enabled rule applies (folders + tags),
	 * conflicts where multiple rules overlap, and unmatched folders.
	 */
	async showRuleCoverage(): Promise<void> {
		new Notice('Computing rule coverage report...');
		try {
			// Walk vault folders
			const folderPaths: string[] = [];
			const walk = (folder: TFolder) => {
				for (const child of folder.children) {
					if (child instanceof TFolder) {
						folderPaths.push(child.path);
						walk(child);
					}
				}
			};
			walk(this.app.vault.getRoot());

			// Collect all tags from metadata cache
			const tagsSet = new Set<string>();
			const allFiles = this.app.vault.getMarkdownFiles();
			for (const file of allFiles) {
				const cache = this.app.metadataCache.getFileCache(file);
				if (cache?.frontmatter?.tags) {
					const fmTags = cache.frontmatter.tags;
					if (Array.isArray(fmTags)) {
						for (const t of fmTags) tagsSet.add(String(t).startsWith('#') ? String(t) : `#${t}`);
					} else if (typeof fmTags === 'string') {
						tagsSet.add(fmTags.startsWith('#') ? fmTags : `#${fmTags}`);
					}
				}
				if (cache?.tags) for (const t of cache.tags) tagsSet.add(t.tag);
			}

			const report = buildCoverageReport(this.settings.rules, folderPaths, [...tagsSet]);
			new RuleCoverageModal(this.app, report).open();
		} catch (err) {
			const msg = err instanceof Error ? err.message : String(err);
			await this.debugLogger.error('Coverage report failed', { error: msg });
			new Notice(`Coverage report failed: ${msg}`);
		}
	}

	/**
	 * Confirm + run full vault sync. Skips the modal preview (user invoked
	 * directly). Use the preview command first if you want to see changes first.
	 */
	async confirmAndSyncEntireVault(): Promise<void> {
		const allFiles = this.app.vault.getMarkdownFiles();
		const confirmed = confirm(
			`Sync forward (folder → tag) across ${allFiles.length} markdown files?\n\n` +
			`Forward sync is purely additive — adds tags to frontmatter, never moves files.\n\n` +
			`Worst case: extra tags you can manually delete.\n\n` +
			`Recommend running 'Preview vault sync' first to see changes before applying.`,
		);
		if (!confirmed) return;
		await this.runVaultSyncWithProgress();
	}

	/**
	 * Execute the full-vault forward sync with a Notice-based progress
	 * indicator. Updates the notice every 10 files; final notice shows
	 * aggregate result.
	 */
	async runVaultSyncWithProgress(): Promise<void> {
		const syncEngine = new FolderToTagSync(this.app, this.settings, this.debugLogger);
		const progressNotice = new Notice('Syncing vault...', 0); // 0 = stay until manually closed
		try {
			const result = await syncEngine.syncVault((current, total, file) => {
				if (current % 10 === 0 || current === total) {
					progressNotice.setMessage(`Syncing ${current}/${total}: ${file}`);
				}
			});
			progressNotice.hide();
			const errSummary = result.errors.length > 0 ? ` (${result.errors.length} errors)` : '';
			new Notice(
				`Synced ${result.filesAffected}/${result.filesProcessed} files; added ${result.totalTagsAdded} tags${errSummary}`,
				6000,
			);
			if (result.errors.length > 0) {
				await this.debugLogger.error('Vault sync errors', { errors: result.errors });
			}
		} catch (err) {
			progressNotice.hide();
			const msg = err instanceof Error ? err.message : String(err);
			await this.debugLogger.error('Vault sync failed', { error: msg });
			new Notice(`Sync failed: ${msg}`);
		}
	}
}

/**
 * Modal that presents the vault-sync preview — aggregate counts + sample
 * folder→tag pairs — and gives the user 'Apply changes' / 'Cancel' actions.
 */
class VaultSyncPreviewModal extends Modal {
	constructor(
		app: App,
		private readonly preview: import('./sync/FolderToTagSync').VaultPreviewResult,
		private readonly onApply: () => Promise<void>,
	) {
		super(app);
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass('dtf-vault-preview-modal');

		contentEl.createEl('h2', { text: 'Vault sync preview (folder → tag)' });

		// Aggregate summary
		const summary = contentEl.createDiv();
		summary.style.padding = '0.6em 0.8em';
		summary.style.background = 'var(--background-modifier-form-field)';
		summary.style.borderRadius = '4px';
		summary.style.marginBottom = '0.8em';
		summary.style.fontSize = '0.95em';
		summary.style.lineHeight = '1.6';
		summary.createEl('div', { text: `Total markdown files: ${this.preview.totalFiles}` });
		const aff = summary.createEl('div');
		aff.createSpan({ text: `Would change: ` });
		aff.createEl('strong', { text: String(this.preview.filesAffected) });
		aff.createSpan({ text: ` files (${this.preview.totalTagsToAdd} tags to add)` });
		summary.createEl('div', { text: `Already in sync (no change needed): ${this.preview.filesUnchanged}` });
		summary.createEl('div', { text: `No matching rule: ${this.preview.filesNoMatch}` });

		// Empty state
		if (this.preview.filesAffected === 0) {
			const note = contentEl.createDiv();
			note.style.padding = '0.6em 0.8em';
			note.style.fontStyle = 'italic';
			note.style.color = 'var(--text-muted)';
			note.setText(
				'No changes needed. Either no files match an enabled rule, or all files already have their tags.',
			);
			const closeBtn = contentEl.createEl('button', { text: 'Close' });
			closeBtn.addEventListener('click', () => this.close());
			return;
		}

		// Sample list of changes
		contentEl.createEl('h3', {
			text: `Sample changes (showing ${Math.min(this.preview.items.length, this.preview.filesAffected)} of ${this.preview.filesAffected})`,
		});
		const list = contentEl.createDiv();
		list.style.maxHeight = '40vh';
		list.style.overflow = 'auto';
		list.style.background = 'var(--background-secondary)';
		list.style.padding = '0.5em';
		list.style.borderRadius = '4px';
		list.style.fontFamily = 'var(--font-monospace)';
		list.style.fontSize = '0.85em';
		list.style.lineHeight = '1.5';
		list.style.marginBottom = '0.8em';
		for (const item of this.preview.items) {
			const row = list.createDiv();
			row.createSpan({ text: `${item.filePath}` });
			row.createSpan({ text: ' → ', cls: 'dtf-arrow' });
			row.createSpan({
				text: item.tagsToAdd.join(', '),
				cls: 'dtf-tag-add',
			});
			(row.lastChild as HTMLElement).style.color = 'var(--text-success, rgb(40, 140, 70))';
			row.createSpan({ text: ` (rule: ${item.matchedRule})` });
			(row.lastChild as HTMLElement).style.color = 'var(--text-muted)';
			(row.lastChild as HTMLElement).style.fontSize = '0.85em';
		}

		// Actions
		const actions = contentEl.createDiv();
		actions.style.display = 'flex';
		actions.style.gap = '0.5em';
		actions.style.justifyContent = 'flex-end';
		actions.style.marginTop = '1em';

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const applyBtn = actions.createEl('button', { text: `Apply changes (${this.preview.filesAffected} files)` });
		applyBtn.addClass('mod-cta');
		applyBtn.addEventListener('click', async () => {
			this.close();
			await this.onApply();
		});
	}
}

/**
 * Rule coverage report — read-only modal showing where each enabled rule
 * applies. Per-rule grouped: matching folders + sample emissions on the
 * forward side, matching tags on the inverse side. Plus conflicts (folders
 * matched by 2+ rules) and unmatched folders.
 *
 * Answers the user's question "how do I know what will get forward or back
 * synced?" — by enumerating the matches across the vault, grouped by rule,
 * before any sync runs.
 */
class RuleCoverageModal extends Modal {
	constructor(app: App, private readonly report: VaultCoverageReport) {
		super(app);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.style.width = 'min(900px, 95vw)';
		contentEl.addClass('dtf-coverage-modal');

		contentEl.createEl('h2', { text: 'Rule coverage report' });

		// Aggregate summary
		const summary = contentEl.createDiv();
		summary.style.padding = '0.6em 0.8em';
		summary.style.background = 'var(--background-modifier-form-field)';
		summary.style.borderRadius = '4px';
		summary.style.marginBottom = '0.8em';
		summary.style.fontSize = '0.9em';
		summary.style.lineHeight = '1.6';
		summary.createEl('div', {
			text: `${this.report.totalFolders} folders + ${this.report.totalTags} distinct tags scanned`,
		});
		summary.createEl('div', {
			text: `${this.report.forwardCoverage.length} forward rule(s) · ${this.report.inverseCoverage.length} inverse rule(s) · ${this.report.conflicts.length} conflict(s)`,
		});

		// Conflicts (most important — surface first)
		if (this.report.conflicts.length > 0) {
			const conflictSection = contentEl.createDiv();
			conflictSection.style.padding = '0.6em 0.8em';
			conflictSection.style.background = 'rgba(220, 90, 90, 0.10)';
			conflictSection.style.borderLeft = '3px solid rgb(170, 50, 50)';
			conflictSection.style.borderRadius = '4px';
			conflictSection.style.marginBottom = '0.8em';
			conflictSection.createEl('div', {
				text: `⚠ ${this.report.conflicts.length} folder(s) matched by 2+ rules`,
			}).style.fontWeight = '600';
			const conflictList = conflictSection.createDiv();
			conflictList.style.fontSize = '0.85em';
			conflictList.style.fontFamily = 'var(--font-monospace)';
			conflictList.style.marginTop = '0.4em';
			for (const c of this.report.conflicts.slice(0, 10)) {
				const row = conflictList.createDiv();
				row.setText(`${c.folderPath} → [${c.matchingRuleIds.join(', ')}]`);
			}
			if (this.report.conflicts.length > 10) {
				conflictList.createEl('div', {
					text: `… ${this.report.conflicts.length - 10} more`,
				}).style.color = 'var(--text-muted)';
			}
		}

		// Per-rule forward coverage (folder → tag direction)
		if (this.report.forwardCoverage.length > 0) {
			const fwdHeader = contentEl.createEl('h3', { text: 'Forward direction (folder → tag)' });
			fwdHeader.style.marginTop = '0.8em';
			for (const cov of this.report.forwardCoverage) {
				const ruleSection = contentEl.createDiv();
				ruleSection.style.padding = '0.5em 0.7em';
				ruleSection.style.background = 'var(--background-secondary)';
				ruleSection.style.borderRadius = '4px';
				ruleSection.style.marginBottom = '0.5em';

				const ruleHeader = ruleSection.createDiv();
				ruleHeader.style.fontWeight = '600';
				ruleHeader.style.marginBottom = '0.3em';
				ruleHeader.setText(`${cov.ruleName} — ${cov.matchedFolderCount} folder(s)`);

				if (cov.matchedFolderCount === 0) {
					ruleSection.createDiv({ text: '(no matches)' }).style.color = 'var(--text-muted)';
					continue;
				}

				const samples = ruleSection.createDiv();
				samples.style.fontFamily = 'var(--font-monospace)';
				samples.style.fontSize = '0.82em';
				samples.style.lineHeight = '1.5';
				const display = cov.sampleEmissions.slice(0, 5);
				for (const s of display) {
					const row = samples.createDiv();
					row.createSpan({ text: s.folder });
					row.createSpan({ text: ' → ' });
					row.createSpan({
						text: s.tags.map(t => (t.startsWith('#') ? t : `#${t}`)).join(', '),
						cls: 'dtf-tag-add',
					}).style.color = 'var(--text-success, rgb(40, 140, 70))';
				}
				if (cov.matchedFolderCount > display.length) {
					samples.createEl('div', {
						text: `… ${cov.matchedFolderCount - display.length} more`,
					}).style.color = 'var(--text-muted)';
				}
			}
		}

		// Per-rule inverse coverage (tag → folder direction)
		if (this.report.inverseCoverage.length > 0) {
			const invHeader = contentEl.createEl('h3', { text: 'Inverse direction (tag → folder)' });
			invHeader.style.marginTop = '0.8em';
			for (const cov of this.report.inverseCoverage) {
				const ruleSection = contentEl.createDiv();
				ruleSection.style.padding = '0.5em 0.7em';
				ruleSection.style.background = 'var(--background-secondary)';
				ruleSection.style.borderRadius = '4px';
				ruleSection.style.marginBottom = '0.5em';

				const ruleHeader = ruleSection.createDiv();
				ruleHeader.style.fontWeight = '600';
				ruleHeader.style.marginBottom = '0.3em';
				ruleHeader.setText(`${cov.ruleName} — ${cov.matchedTagCount} tag(s) match`);

				if (cov.matchedTagCount === 0) {
					ruleSection.createDiv({ text: '(no matching tags)' }).style.color = 'var(--text-muted)';
					continue;
				}

				const tagsList = ruleSection.createDiv();
				tagsList.style.fontFamily = 'var(--font-monospace)';
				tagsList.style.fontSize = '0.82em';
				tagsList.style.display = 'flex';
				tagsList.style.flexWrap = 'wrap';
				tagsList.style.gap = '0.3em';
				const display = cov.matchedTags.slice(0, 12);
				for (const t of display) {
					const chip = tagsList.createEl('code', { text: t });
					chip.style.padding = '0.1em 0.4em';
					chip.style.background = 'var(--background-modifier-hover)';
					chip.style.borderRadius = '3px';
				}
				if (cov.matchedTagCount > display.length) {
					tagsList.createEl('span', {
						text: `… ${cov.matchedTagCount - display.length} more`,
					}).style.color = 'var(--text-muted)';
				}
			}
		}

		// Unmatched folders (potential gaps)
		if (this.report.unmatchedFolders.length > 0) {
			const unmatchedSection = contentEl.createEl('h3', {
				text: 'Folders no rule touches (sample)',
			});
			unmatchedSection.style.marginTop = '0.8em';
			const note = contentEl.createDiv();
			note.style.fontSize = '0.85em';
			note.style.color = 'var(--text-muted)';
			note.style.marginBottom = '0.4em';
			note.setText(
				'These folders won\'t get tags from any enabled rule. May be intentional (system folders) or a gap (rule needed).',
			);
			const list = contentEl.createDiv();
			list.style.fontFamily = 'var(--font-monospace)';
			list.style.fontSize = '0.82em';
			list.style.lineHeight = '1.5';
			list.style.maxHeight = '20vh';
			list.style.overflow = 'auto';
			for (const f of this.report.unmatchedFolders.slice(0, 30)) {
				list.createEl('div', { text: f });
			}
		}

		// Close button
		const closeBtn = contentEl.createEl('button', { text: 'Close' });
		closeBtn.style.marginTop = '1em';
		closeBtn.addEventListener('click', () => this.close());
	}
}
