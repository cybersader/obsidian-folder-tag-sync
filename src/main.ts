import { Plugin, TFile, Notice, Modal } from 'obsidian';
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

		// TODO: Register event listeners for automatic sync
		// this.registerEvent(
		// 	this.app.vault.on('create', this.onFileCreated.bind(this))
		// );
		// this.registerEvent(
		// 	this.app.vault.on('rename', this.onFileRenamed.bind(this))
		// );
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
}
