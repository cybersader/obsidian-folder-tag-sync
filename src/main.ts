import { App, Plugin, TFile, TFolder, Notice, Modal } from 'obsidian';
import { buildCoverageReport, type VaultCoverageReport } from './engine/ruleCoverage';
import { DynamicTagsFoldersSettings, DEFAULT_SETTINGS, MappingRule } from './types/settings';
import { SettingsTab } from './ui/SettingsTab';
import { RulePackPickerModal } from './ui/RulePackPickerModal';
import { DetectVaultModal } from './ui/DetectVaultModal';
import { ScanAndSnapModal } from './ui/ScanAndSnapModal';
import { OrgsysPreviewModal } from './ui/OrgsysPreviewModal';
import { TaxonomyWorkbenchView, TAXONOMY_WORKBENCH_VIEW } from './ui/TaxonomyWorkbenchView';
import { DebugLogger } from './utils/debug';
import { FolderToTagSync } from './sync/FolderToTagSync';
import { TagToFolderSync } from './sync/TagToFolderSync';
import { loadRulePackFromJSON, RulePack } from './engine/rulePackLoader';

/**
 * Trailing-edge debounce window (ms) for auto-sync on file events. A single
 * user action — e.g. creating a new note that Obsidian immediately auto-renames
 * from `Untitled.md` to its first-line title — fires create + rename in quick
 * succession; coalescing them into one forward sync avoids redundant churn.
 * Correctness does NOT depend on this timing (the read/write path is
 * idempotent); the debounce only reduces wasted work.
 */
const AUTO_SYNC_DEBOUNCE_MS = 400;

/**
 * Dynamic Tags & Folders Plugin
 *
 * Bidirectional mapping between folder paths and tags using regex patterns
 * and transformation rules.
 */
export default class DynamicTagsFoldersPlugin extends Plugin {
	settings: DynamicTagsFoldersSettings = DEFAULT_SETTINGS;
	debugLogger!: DebugLogger;

	/**
	 * Map → Settings hand-off. The Taxonomy Workbench map sets this to a rule
	 * id before opening the settings tab; `SettingsTab.display()` consumes it
	 * ONCE to scroll to + briefly highlight that rule, then clears it. Undefined
	 * when settings is opened without a focus target.
	 */
	focusRuleId?: string;

	/**
	 * Per-path trailing-edge debounce timers for event-driven auto-sync. Keyed
	 * by file path; each new event for a path clears and reschedules the prior
	 * timer. Cleared en masse in `onunload`.
	 */
	private pendingAutoSyncs = new Map<string, ReturnType<typeof setTimeout>>();

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

		// Register the Taxonomy Workbench map — a large dockable pane that
		// renders the full annotated vault hierarchy (read-only display).
		this.registerView(
			TAXONOMY_WORKBENCH_VIEW,
			(leaf) => new TaxonomyWorkbenchView(leaf, this),
		);
		this.addRibbonIcon('layers', 'Open the Taxonomy Workbench map', () => {
			void this.activateWorkbenchMap();
		});

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

		this.addCommand({
			id: 'scan-and-snap-draft-rules',
			name: 'Taxonomy Workbench: draft rules from detected systems',
			callback: () => {
				this.scanAndSnapDraftRules();
			}
		});

		this.addCommand({
			id: 'taxonomy-workbench-preview-orgsys',
			name: 'Taxonomy Workbench: preview a system definition',
			callback: () => {
				this.previewOrgsysDefinition();
			}
		});

		this.addCommand({
			id: 'taxonomy-workbench-open-map',
			name: 'Taxonomy Workbench: open the map',
			callback: () => {
				void this.activateWorkbenchMap();
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
		//
		// The 'create' listener is registered behind onLayoutReady: Obsidian fires
		// 'create' for EVERY existing markdown file during initial vault indexing,
		// so registering it directly in onload would re-run a vault-wide forward
		// sync on every startup. onLayoutReady is the canonical guard against that
		// load-time 'create' storm. ('rename' does not fire en masse at load, so it
		// stays registered directly.)
		this.app.workspace.onLayoutReady(() => {
			this.registerEvent(
				this.app.vault.on('create', (file) => {
					if (file instanceof TFile && file.extension === 'md') {
						void this.autoSyncOnEvent(file, 'create');
					}
				}),
			);
		});
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
			this.scheduleAutoSync(file);
		} catch (err) {
			await this.debugLogger.error('Auto-sync failed on event', {
				event,
				file: file.path,
				error: err instanceof Error ? err.message : String(err),
			});
		}
	}

	/**
	 * Schedule a trailing-edge debounced forward sync for `file`. Coalesces
	 * rapid create→rename cascades (and duplicate create events) on the same
	 * path into a single `syncFolderToTags` call. Re-validates the file still
	 * exists when the timer fires (it may have been deleted/renamed within the
	 * debounce window). Only ever invokes the additive forward direction —
	 * never the inverse (file-moving) direction — preserving the safety-first
	 * auto-sync design.
	 */
	private scheduleAutoSync(file: TFile): void {
		const path = file.path;
		const existing = this.pendingAutoSyncs.get(path);
		if (existing !== undefined) clearTimeout(existing);
		const handle = setTimeout(() => {
			this.pendingAutoSyncs.delete(path);
			const current = this.app.vault.getAbstractFileByPath(path);
			if (current instanceof TFile && current.extension === 'md') {
				void this.syncFolderToTags(current);
			}
		}, AUTO_SYNC_DEBOUNCE_MS);
		this.pendingAutoSyncs.set(path, handle);
	}

	onunload(): void {
		console.debug('Unloading Dynamic Tags & Folders plugin');
		// Clear any pending debounced syncs so a timer can't fire against a
		// torn-down plugin instance.
		for (const handle of this.pendingAutoSyncs.values()) clearTimeout(handle);
		this.pendingAutoSyncs.clear();
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
	 * Open the Scan & Snap modal — drafts scoped candidate rules from the
	 * organizational systems already detected in the vault, lets the user
	 * triage them (coverage / bijectivity / conflicts), and commits the
	 * selected ones into settings. Read-only on the vault: only rules change.
	 */
	scanAndSnapDraftRules(): void {
		const modal = new ScanAndSnapModal(
			this.app,
			this.settings.rules,
			this.settings.groupPrecedence,
			async (newRules) => {
				const existingIds = new Set(this.settings.rules.map((r) => r.id));
				const toAdd = newRules.filter((r) => !existingIds.has(r.id));
				this.settings.rules = [...this.settings.rules, ...toAdd];
				await this.saveSettings();
				await this.debugLogger.info('Scan & snap rules applied', {
					rulesAdded: toAdd.length,
					skippedDuplicates: newRules.length - toAdd.length,
				});
			},
		);
		modal.open();
	}

	/**
	 * Open the Taxonomy Workbench preview modal — a live "edit a `.orgsys`
	 * definition → see what it compiles to" surface. Read-only: it compiles the
	 * definition with the verified compiler and previews sample emissions
	 * against the vault's folders, but never mutates settings, folders, or files.
	 */
	previewOrgsysDefinition(): void {
		const modal = new OrgsysPreviewModal(this.app, this.settings.groupPrecedence);
		modal.open();
	}

	/**
	 * Open the Taxonomy Workbench map — a large dockable pane (ItemView) that
	 * renders the full annotated vault hierarchy. Detaches any existing leaves
	 * of this type first so re-invoking focuses one pane rather than stacking
	 * duplicates. Opens in a main-area tab (roomy — the whole point vs. the
	 * cramped detect modal) and reveals it.
	 */
	async activateWorkbenchMap(): Promise<void> {
		const { workspace } = this.app;
		// Detach existing leaves of this type to avoid duplicates.
		workspace.detachLeavesOfType(TAXONOMY_WORKBENCH_VIEW);

		// Open in a main-area tab so the hierarchy gets the full editor width.
		const leaf = workspace.getLeaf('tab');
		await leaf.setViewState({ type: TAXONOMY_WORKBENCH_VIEW, active: true });
		workspace.revealLeaf(leaf);
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
			new VaultSyncPreviewModal(this.app, result, async (selectedPaths) => {
				await this.runVaultSyncWithProgress(selectedPaths);
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
	async runVaultSyncWithProgress(onlyPaths?: Set<string>): Promise<void> {
		const syncEngine = new FolderToTagSync(this.app, this.settings, this.debugLogger);
		const progressNotice = new Notice('Syncing vault...', 0); // 0 = stay until manually closed
		try {
			const result = await syncEngine.syncVault((current, total, file) => {
				if (current % 10 === 0 || current === total) {
					progressNotice.setMessage(`Syncing ${current}/${total}: ${file}`);
				}
			}, onlyPaths);
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
/**
 * Interactive hierarchical preview of vault forward-sync changes.
 *
 * Design goals:
 *  - Render the full change set as a collapsible folder tree, not a flat list,
 *    so 100+ changes stay scannable.
 *  - Selective apply via tri-state checkboxes — folder checkboxes show
 *    indeterminate when only some descendants are selected, and toggling a
 *    folder cascades to all descendants.
 *  - Per-rule colour coding so you can see at a glance which rule produced
 *    which tags. Rule legend doubles as a filter (click a swatch to isolate).
 *  - Tag chips render as proper diff-style add pills, not comma-separated
 *    text — much faster to scan visually.
 *  - Live "Apply N files" button that reflects current selection.
 *  - Search box filters tree by file path or rule name.
 *  - Optional flat-list view for users who want the old layout.
 */
class VaultSyncPreviewModal extends Modal {
	private selectedPaths = new Set<string>();
	private ruleFilter: string | null = null;
	private searchQuery = '';
	private viewMode: 'tree' | 'flat' = 'tree';
	private listEl!: HTMLElement;
	private applyBtn!: HTMLButtonElement;
	private legendRows = new Map<string, HTMLElement>();

	constructor(
		app: App,
		private readonly preview: import('./sync/FolderToTagSync').VaultPreviewResult,
		private readonly onApply: (selectedPaths: Set<string>) => Promise<void>,
	) {
		super(app);
		// Default to all files selected — user opts out of specifics.
		for (const item of preview.items) this.selectedPaths.add(item.filePath);
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.style.width = 'min(1000px, 95vw)';
		modalEl.style.maxHeight = '90vh';
		contentEl.addClass('dtf-vault-preview-modal');

		contentEl.createEl('h2', { text: 'Vault sync preview (folder → tag)' });

		// ─── Aggregate stat cards (visual KPIs at a glance) ─────────────
		const statBar = contentEl.createDiv();
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(140px, 1fr))';
		statBar.style.gap = '0.5em';
		statBar.style.marginBottom = '0.9em';

		const makeStat = (label: string, value: string | number, hint?: string, accent?: string) => {
			const card = statBar.createDiv();
			card.style.padding = '0.5em 0.7em';
			card.style.background = 'var(--background-secondary)';
			card.style.borderRadius = '6px';
			if (accent) card.style.borderLeft = `3px solid ${accent}`;
			const v = card.createEl('div', { text: String(value) });
			v.style.fontSize = '1.4em';
			v.style.fontWeight = '600';
			v.style.lineHeight = '1.1';
			const l = card.createEl('div', { text: label });
			l.style.fontSize = '0.78em';
			l.style.color = 'var(--text-muted)';
			l.style.marginTop = '0.15em';
			if (hint) {
				const h = card.createEl('div', { text: hint });
				h.style.fontSize = '0.72em';
				h.style.color = 'var(--text-faint)';
			}
		};
		makeStat(
			'Files to change',
			this.preview.filesAffected,
			`of ${this.preview.totalFiles} total`,
			'var(--text-success, rgb(40, 140, 70))',
		);
		makeStat('Tags to add', this.preview.totalTagsToAdd);
		makeStat('Already in sync', this.preview.filesUnchanged);
		makeStat('No matching rule', this.preview.filesNoMatch);

		// Empty state
		if (this.preview.filesAffected === 0) {
			const note = contentEl.createDiv();
			note.style.padding = '0.8em';
			note.style.fontStyle = 'italic';
			note.style.color = 'var(--text-muted)';
			note.setText(
				'No changes needed. Either no files match an enabled rule, or all files already have their tags.',
			);
			const closeBtn = contentEl.createEl('button', { text: 'Close' });
			closeBtn.addEventListener('click', () => this.close());
			return;
		}

		// Cap notice (preview was capped at 1000 items)
		if (this.preview.items.length < this.preview.filesAffected) {
			const cap = contentEl.createDiv();
			cap.style.fontSize = '0.82em';
			cap.style.color = 'var(--text-muted)';
			cap.style.marginBottom = '0.5em';
			cap.setText(
				`Showing ${this.preview.items.length} of ${this.preview.filesAffected} affected files. ` +
				`Apply will sync all matching files in the vault.`,
			);
		}

		// ─── Rule legend (per-rule colour swatches + counts, click to filter) ─
		const ruleStats = computeRuleStats(this.preview.items);
		const legend = contentEl.createDiv();
		legend.style.display = 'flex';
		legend.style.flexWrap = 'wrap';
		legend.style.gap = '0.4em';
		legend.style.marginBottom = '0.6em';
		legend.style.padding = '0.4em 0.5em';
		legend.style.background = 'var(--background-modifier-form-field)';
		legend.style.borderRadius = '6px';

		const allRuleChip = makeRuleChip(legend, 'All rules', null, this.preview.items.length, ruleColorFor(null));
		this.legendRows.set('__all__', allRuleChip);
		allRuleChip.addEventListener('click', () => {
			this.ruleFilter = null;
			this.refreshLegendActive();
			this.renderList();
		});
		for (const [ruleName, count] of ruleStats) {
			const color = ruleColorFor(ruleName);
			const chip = makeRuleChip(legend, ruleName, ruleName, count, color);
			this.legendRows.set(ruleName, chip);
			chip.addEventListener('click', () => {
				this.ruleFilter = this.ruleFilter === ruleName ? null : ruleName;
				this.refreshLegendActive();
				this.renderList();
			});
		}
		this.refreshLegendActive();

		// ─── Toolbar: search + view toggle + select-all/none + expand-all ────
		const toolbar = contentEl.createDiv();
		toolbar.style.display = 'flex';
		toolbar.style.gap = '0.4em';
		toolbar.style.alignItems = 'center';
		toolbar.style.marginBottom = '0.5em';
		toolbar.style.flexWrap = 'wrap';

		const searchInput = toolbar.createEl('input', {
			type: 'search',
			placeholder: 'Filter files / rules…',
		});
		searchInput.style.flex = '1 1 220px';
		searchInput.style.minWidth = '160px';
		searchInput.addEventListener('input', () => {
			this.searchQuery = searchInput.value.trim().toLowerCase();
			this.renderList();
		});

		const treeBtn = toolbar.createEl('button', { text: 'Tree' });
		treeBtn.addClass('mod-cta');
		const flatBtn = toolbar.createEl('button', { text: 'Flat' });
		const setViewMode = (m: 'tree' | 'flat') => {
			this.viewMode = m;
			if (m === 'tree') { treeBtn.addClass('mod-cta'); flatBtn.removeClass('mod-cta'); }
			else { flatBtn.addClass('mod-cta'); treeBtn.removeClass('mod-cta'); }
			this.renderList();
		};
		treeBtn.addEventListener('click', () => setViewMode('tree'));
		flatBtn.addEventListener('click', () => setViewMode('flat'));

		const selectAllBtn = toolbar.createEl('button', { text: 'Select all' });
		selectAllBtn.addEventListener('click', () => {
			for (const item of this.preview.items) this.selectedPaths.add(item.filePath);
			this.renderList();
			this.refreshApplyBtn();
		});
		const selectNoneBtn = toolbar.createEl('button', { text: 'Select none' });
		selectNoneBtn.addEventListener('click', () => {
			this.selectedPaths.clear();
			this.renderList();
			this.refreshApplyBtn();
		});
		const expandAllBtn = toolbar.createEl('button', { text: 'Expand all' });
		const collapseAllBtn = toolbar.createEl('button', { text: 'Collapse all' });
		expandAllBtn.addEventListener('click', () => this.toggleAllFolders(true));
		collapseAllBtn.addEventListener('click', () => this.toggleAllFolders(false));

		// ─── Tree / list container ──────────────────────────────────────
		this.listEl = contentEl.createDiv();
		this.listEl.style.maxHeight = '52vh';
		this.listEl.style.overflow = 'auto';
		this.listEl.style.background = 'var(--background-secondary)';
		this.listEl.style.padding = '0.4em 0.5em';
		this.listEl.style.borderRadius = '6px';
		this.listEl.style.fontSize = '0.88em';
		this.listEl.style.lineHeight = '1.45';
		this.listEl.style.marginBottom = '0.8em';

		this.renderList();

		// ─── Footer actions (live apply count) ──────────────────────────
		const actions = contentEl.createDiv();
		actions.style.display = 'flex';
		actions.style.gap = '0.5em';
		actions.style.justifyContent = 'flex-end';
		actions.style.alignItems = 'center';
		actions.style.marginTop = '0.5em';

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.applyBtn = actions.createEl('button', { text: '' });
		this.applyBtn.addClass('mod-cta');
		this.refreshApplyBtn();
		this.applyBtn.addEventListener('click', async () => {
			// Only forward selected paths if user has narrowed the selection.
			// Empty = nothing to do; full = let syncVault do the whole vault
			// (so files beyond the 1000-item preview cap also sync).
			const isFullSelection = this.selectedPaths.size === this.preview.items.length;
			const onlyPaths = isFullSelection ? undefined : new Set(this.selectedPaths);
			this.close();
			await this.onApply(onlyPaths!);
		});
	}

	private refreshApplyBtn(): void {
		const n = this.selectedPaths.size;
		this.applyBtn.disabled = n === 0;
		this.applyBtn.setText(
			n === 0 ? 'Apply changes' :
			n === this.preview.items.length ? `Apply all (${this.preview.filesAffected} files)` :
			`Apply selected (${n} files)`,
		);
	}

	private refreshLegendActive(): void {
		for (const [key, el] of this.legendRows) {
			const isActive = (this.ruleFilter === null && key === '__all__') ||
			                 (this.ruleFilter !== null && key === this.ruleFilter);
			el.style.outline = isActive ? '2px solid var(--interactive-accent)' : '';
			el.style.opacity = (this.ruleFilter !== null && key !== this.ruleFilter && key !== '__all__') ? '0.45' : '1';
		}
	}

	private filteredItems(): import('./sync/FolderToTagSync').VaultPreviewItem[] {
		const q = this.searchQuery;
		return this.preview.items.filter((item) => {
			if (this.ruleFilter && item.matchedRule !== this.ruleFilter) return false;
			if (q && !item.filePath.toLowerCase().includes(q) && !item.matchedRule.toLowerCase().includes(q)) {
				const tagMatch = item.tagsToAdd.some((t) => t.toLowerCase().includes(q));
				if (!tagMatch) return false;
			}
			return true;
		});
	}

	private renderList(): void {
		this.listEl.empty();
		const items = this.filteredItems();
		if (items.length === 0) {
			const empty = this.listEl.createDiv();
			empty.style.padding = '1em';
			empty.style.fontStyle = 'italic';
			empty.style.color = 'var(--text-muted)';
			empty.style.textAlign = 'center';
			empty.setText('No items match the current filter.');
			return;
		}
		if (this.viewMode === 'tree') {
			const tree = buildPreviewTree(items);
			this.renderTreeNode(this.listEl, tree, 0);
		} else {
			this.renderFlatList(this.listEl, items);
		}
	}

	private renderFlatList(parent: HTMLElement, items: import('./sync/FolderToTagSync').VaultPreviewItem[]): void {
		for (const item of items) {
			const row = parent.createDiv();
			row.style.display = 'flex';
			row.style.alignItems = 'center';
			row.style.gap = '0.4em';
			row.style.padding = '0.18em 0.3em';
			row.style.borderRadius = '3px';
			row.addEventListener('mouseenter', () => row.style.background = 'var(--background-modifier-hover)');
			row.addEventListener('mouseleave', () => row.style.background = '');

			const cb = row.createEl('input', { type: 'checkbox' });
			cb.checked = this.selectedPaths.has(item.filePath);
			cb.addEventListener('change', () => {
				if (cb.checked) this.selectedPaths.add(item.filePath);
				else this.selectedPaths.delete(item.filePath);
				this.refreshApplyBtn();
			});

			const swatch = row.createSpan();
			swatch.style.display = 'inline-block';
			swatch.style.width = '8px';
			swatch.style.height = '8px';
			swatch.style.borderRadius = '50%';
			swatch.style.background = ruleColorFor(item.matchedRule);

			const path = row.createSpan({ text: item.filePath });
			path.style.fontFamily = 'var(--font-monospace)';
			path.style.fontSize = '0.92em';

			const arrow = row.createSpan({ text: '→' });
			arrow.style.color = 'var(--text-muted)';

			renderTagChips(row, item.tagsToAdd);

			const ruleLabel = row.createSpan({ text: item.matchedRule });
			ruleLabel.style.fontSize = '0.78em';
			ruleLabel.style.color = 'var(--text-muted)';
			ruleLabel.style.marginLeft = 'auto';
		}
	}

	private renderTreeNode(parent: HTMLElement, node: PreviewTreeNode, depth: number): void {
		const childKeys = [...node.children.keys()].sort();
		for (const key of childKeys) {
			const child = node.children.get(key)!;
			this.renderFolderRow(parent, child, depth);
		}
		for (const leaf of node.leaves) {
			this.renderLeafRow(parent, leaf, depth);
		}
	}

	private renderFolderRow(parent: HTMLElement, child: PreviewTreeNode, depth: number): void {
		const allLeaves = collectLeaves(child);
		const totalCount = allLeaves.length;
		const expanded = { value: depth < 1 }; // root-level open, deeper collapsed by default

		const folderRow = parent.createDiv();
		folderRow.style.display = 'flex';
		folderRow.style.alignItems = 'center';
		folderRow.style.gap = '0.35em';
		folderRow.style.padding = '0.18em 0.3em';
		folderRow.style.paddingLeft = `${depth * 1.1 + 0.2}em`;
		folderRow.style.cursor = 'pointer';
		folderRow.style.userSelect = 'none';
		folderRow.style.borderRadius = '3px';
		folderRow.addEventListener('mouseenter', () => folderRow.style.background = 'var(--background-modifier-hover)');
		folderRow.addEventListener('mouseleave', () => folderRow.style.background = '');

		const arrow = folderRow.createSpan({ text: expanded.value ? '▾' : '▸' });
		arrow.style.color = 'var(--text-muted)';
		arrow.style.fontSize = '0.85em';
		arrow.style.minWidth = '0.8em';

		// Tri-state checkbox: checked (all), unchecked (none), indeterminate (some)
		const cb = folderRow.createEl('input', { type: 'checkbox' });
		const updateCbState = () => {
			const selectedCount = allLeaves.filter((l) => this.selectedPaths.has(l.filePath)).length;
			if (selectedCount === 0) { cb.checked = false; cb.indeterminate = false; }
			else if (selectedCount === allLeaves.length) { cb.checked = true; cb.indeterminate = false; }
			else { cb.checked = false; cb.indeterminate = true; }
		};
		updateCbState();
		cb.addEventListener('click', (e) => e.stopPropagation());
		cb.addEventListener('change', () => {
			if (cb.checked) {
				for (const l of allLeaves) this.selectedPaths.add(l.filePath);
			} else {
				for (const l of allLeaves) this.selectedPaths.delete(l.filePath);
			}
			this.renderList();
			this.refreshApplyBtn();
		});

		folderRow.createSpan({ text: '📁' }).style.fontSize = '0.95em';
		const nameSpan = folderRow.createSpan({ text: child.name });
		nameSpan.style.fontWeight = '600';

		const countSpan = folderRow.createSpan({ text: `${totalCount}` });
		countSpan.style.fontSize = '0.78em';
		countSpan.style.color = 'var(--text-on-accent)';
		countSpan.style.background = 'var(--text-muted)';
		countSpan.style.padding = '0.05em 0.45em';
		countSpan.style.borderRadius = '8px';
		countSpan.style.marginLeft = '0.2em';

		// Inline rule swatches showing which rules touch this subtree
		const subRules = new Set(allLeaves.map((l) => l.matchedRule));
		if (subRules.size > 0) {
			const swatchWrap = folderRow.createSpan();
			swatchWrap.style.display = 'inline-flex';
			swatchWrap.style.gap = '2px';
			swatchWrap.style.marginLeft = '0.3em';
			for (const r of [...subRules].slice(0, 6)) {
				const sw = swatchWrap.createSpan();
				sw.style.display = 'inline-block';
				sw.style.width = '6px';
				sw.style.height = '6px';
				sw.style.borderRadius = '50%';
				sw.style.background = ruleColorFor(r);
				sw.title = r;
			}
		}

		const childContainer = parent.createDiv();
		childContainer.dataset.dtfTreeContainer = '1';
		if (!expanded.value) childContainer.style.display = 'none';
		this.renderTreeNode(childContainer, child, depth + 1);

		folderRow.addEventListener('click', () => {
			expanded.value = !expanded.value;
			arrow.setText(expanded.value ? '▾' : '▸');
			childContainer.style.display = expanded.value ? '' : 'none';
		});
	}

	private renderLeafRow(parent: HTMLElement, leaf: PreviewLeaf, depth: number): void {
		const row = parent.createDiv();
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '0.35em';
		row.style.padding = '0.15em 0.3em';
		row.style.paddingLeft = `${depth * 1.1 + 1.0}em`; // extra indent past arrow column
		row.style.borderRadius = '3px';
		row.addEventListener('mouseenter', () => row.style.background = 'var(--background-modifier-hover)');
		row.addEventListener('mouseleave', () => row.style.background = '');

		const cb = row.createEl('input', { type: 'checkbox' });
		cb.checked = this.selectedPaths.has(leaf.filePath);
		cb.addEventListener('change', () => {
			if (cb.checked) this.selectedPaths.add(leaf.filePath);
			else this.selectedPaths.delete(leaf.filePath);
			this.renderList(); // re-render so ancestor folder checkboxes update tri-state
			this.refreshApplyBtn();
		});

		const ruleSwatch = row.createSpan();
		ruleSwatch.style.display = 'inline-block';
		ruleSwatch.style.width = '8px';
		ruleSwatch.style.height = '8px';
		ruleSwatch.style.borderRadius = '50%';
		ruleSwatch.style.background = ruleColorFor(leaf.matchedRule);
		ruleSwatch.title = `Rule: ${leaf.matchedRule}`;

		row.createSpan({ text: '📄' }).style.fontSize = '0.9em';
		const fileName = leaf.filePath.split('/').pop() ?? leaf.filePath;
		const fileSpan = row.createSpan({ text: fileName });
		fileSpan.style.color = 'var(--text-normal)';

		const arrow = row.createSpan({ text: '+' });
		arrow.style.color = 'var(--text-success, rgb(40, 140, 70))';
		arrow.style.fontWeight = '600';
		arrow.style.marginLeft = '0.3em';

		renderTagChips(row, leaf.tagsToAdd);

		const ruleLabel = row.createSpan({ text: leaf.matchedRule });
		ruleLabel.style.fontSize = '0.74em';
		ruleLabel.style.color = 'var(--text-muted)';
		ruleLabel.style.marginLeft = 'auto';
		ruleLabel.style.whiteSpace = 'nowrap';
	}

	private toggleAllFolders(open: boolean): void {
		const containers = this.listEl.querySelectorAll<HTMLElement>('[data-dtf-tree-container]');
		containers.forEach((c) => { c.style.display = open ? '' : 'none'; });
		// Also flip the arrow indicators next to each folder
		const arrows = this.listEl.querySelectorAll<HTMLElement>('div > span:first-child');
		arrows.forEach((a) => {
			if (a.textContent === '▾' || a.textContent === '▸') a.textContent = open ? '▾' : '▸';
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

// ─── Hierarchical tree-view helpers for the vault sync preview ─────────

interface PreviewLeaf {
	filePath: string;
	matchedRule: string;
	tagsToAdd: string[];
}

interface PreviewTreeNode {
	name: string;
	fullPath: string;
	children: Map<string, PreviewTreeNode>;
	leaves: PreviewLeaf[];
}

/**
 * Build a hierarchical tree from a flat list of preview items. Each item's
 * path is split by `/`; the final segment is the file (leaf), the rest form
 * folder nodes. Children are inserted by name into a Map so insertion order
 * is preserved (stable rendering).
 */
function buildPreviewTree(
	items: import('./sync/FolderToTagSync').VaultPreviewItem[],
): PreviewTreeNode {
	const root: PreviewTreeNode = {
		name: '',
		fullPath: '',
		children: new Map(),
		leaves: [],
	};
	for (const item of items) {
		const segments = item.filePath.split('/').filter((s) => s.length > 0);
		const fileName = segments.pop();
		if (!fileName) continue;
		let cursor = root;
		let pathSoFar = '';
		for (const seg of segments) {
			pathSoFar = pathSoFar ? `${pathSoFar}/${seg}` : seg;
			if (!cursor.children.has(seg)) {
				cursor.children.set(seg, {
					name: seg,
					fullPath: pathSoFar,
					children: new Map(),
					leaves: [],
				});
			}
			cursor = cursor.children.get(seg)!;
		}
		cursor.leaves.push({
			filePath: item.filePath,
			matchedRule: item.matchedRule,
			tagsToAdd: item.tagsToAdd,
		});
	}
	return root;
}

/** Walk a tree and return all leaves in flat order (used for tri-state checkboxes). */
function collectLeaves(node: PreviewTreeNode): PreviewLeaf[] {
	const out: PreviewLeaf[] = [...node.leaves];
	for (const child of node.children.values()) out.push(...collectLeaves(child));
	return out;
}

/**
 * Tally items per matched rule, sorted descending by count. Used to populate
 * the rule-legend chips at the top of the modal.
 */
function computeRuleStats(
	items: import('./sync/FolderToTagSync').VaultPreviewItem[],
): Array<[string, number]> {
	const counts = new Map<string, number>();
	for (const item of items) {
		counts.set(item.matchedRule, (counts.get(item.matchedRule) ?? 0) + 1);
	}
	return [...counts.entries()].sort((a, b) => b[1] - a[1]);
}

/**
 * Deterministic colour-from-string. Hashes the input into a hue (0–360) and
 * returns an HSL string with fixed saturation/lightness. Stable across
 * sessions — same rule name always gets the same colour.
 */
function ruleColorFor(name: string | null): string {
	if (name === null) return 'var(--text-muted)';
	let hash = 0;
	for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) | 0;
	const hue = Math.abs(hash) % 360;
	return `hsl(${hue}, 65%, 55%)`;
}

/**
 * Build a clickable rule-legend chip with a colour swatch + name + count.
 * Used in the rule-filter row at the top of the modal.
 */
function makeRuleChip(
	parent: HTMLElement,
	label: string,
	_ruleName: string | null,
	count: number,
	color: string,
): HTMLElement {
	const chip = parent.createSpan();
	chip.style.display = 'inline-flex';
	chip.style.alignItems = 'center';
	chip.style.gap = '0.3em';
	chip.style.padding = '0.18em 0.55em';
	chip.style.background = 'var(--background-secondary-alt)';
	chip.style.border = '1px solid var(--background-modifier-border)';
	chip.style.borderRadius = '999px';
	chip.style.fontSize = '0.82em';
	chip.style.cursor = 'pointer';
	chip.style.userSelect = 'none';

	const swatch = chip.createSpan();
	swatch.style.display = 'inline-block';
	swatch.style.width = '8px';
	swatch.style.height = '8px';
	swatch.style.borderRadius = '50%';
	swatch.style.background = color;

	chip.createSpan({ text: label });

	const countBadge = chip.createSpan({ text: String(count) });
	countBadge.style.fontSize = '0.75em';
	countBadge.style.color = 'var(--text-muted)';
	countBadge.style.marginLeft = '0.15em';

	return chip;
}

/**
 * Render a list of tag strings as inline pill chips with a `+` prefix to
 * reinforce that these are additions. Pills wrap and don't overflow.
 */
function renderTagChips(parent: HTMLElement, tags: string[]): void {
	const wrap = parent.createSpan();
	wrap.style.display = 'inline-flex';
	wrap.style.flexWrap = 'wrap';
	wrap.style.gap = '0.25em';
	for (const tag of tags) {
		const chip = wrap.createSpan({ text: tag });
		chip.style.display = 'inline-block';
		chip.style.padding = '0.05em 0.45em';
		chip.style.background = 'rgba(40, 140, 70, 0.15)';
		chip.style.color = 'var(--text-success, rgb(40, 140, 70))';
		chip.style.border = '1px solid rgba(40, 140, 70, 0.35)';
		chip.style.borderRadius = '999px';
		chip.style.fontSize = '0.78em';
		chip.style.fontFamily = 'var(--font-monospace)';
		chip.style.whiteSpace = 'nowrap';
	}
}
