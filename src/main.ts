import { Plugin, TFile, Notice } from 'obsidian';
import { DynamicTagsFoldersSettings, DEFAULT_SETTINGS } from './types/settings';
import { SettingsTab } from './ui/SettingsTab';
import { DebugLogger } from './utils/debug';
import { FolderToTagSync } from './sync/FolderToTagSync';
import { TagToFolderSync } from './sync/TagToFolderSync';

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
					this.syncFolderToTags(file);
				}
			}
		});

		this.addCommand({
			id: 'sync-tags-to-folder',
			name: 'Sync tags to folder (current file)',
			callback: () => {
				const file = this.app.workspace.getActiveFile();
				if (file) {
					this.syncTagsToFolder(file);
				}
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
