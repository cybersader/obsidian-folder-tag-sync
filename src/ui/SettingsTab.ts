import { App, PluginSettingTab, Setting, Notice } from 'obsidian';
import DynamicTagsFoldersPlugin from '../main';
import { RuleEditorModal } from './RuleEditorModal';
import { MappingRule } from '../types/settings';

/**
 * Settings tab for the plugin
 */
export class SettingsTab extends PluginSettingTab {
	plugin: DynamicTagsFoldersPlugin;

	constructor(app: App, plugin: DynamicTagsFoldersPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		new Setting(containerEl)
			.setName('Folder Tag Sync settings')
			.setHeading();

		// General Options
		this.displayGeneralOptions(containerEl);

		// Mapping Rules
		this.displayRulesSection(containerEl);

		// Import/Export
		this.displayImportExportSection(containerEl);
	}

	private displayGeneralOptions(containerEl: HTMLElement) {
		new Setting(containerEl).setName('General options').setHeading();

		new Setting(containerEl)
			.setName('Sync on file create')
			.setDesc('Automatically sync when creating new files')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.options.syncOnCreate)
				.onChange(async (value) => {
					this.plugin.settings.options.syncOnCreate = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Sync on file rename/move')
			.setDesc('Automatically sync when files are moved or renamed')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.options.syncOnRename)
				.onChange(async (value) => {
					this.plugin.settings.options.syncOnRename = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Show notifications')
			.setDesc('Show notifications when files are moved or tags are updated')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.options.showNotifications)
				.onChange(async (value) => {
					this.plugin.settings.options.showNotifications = value;
					await this.plugin.saveSettings();
				})
			);

		new Setting(containerEl)
			.setName('Debug mode')
			.setDesc('Enable detailed logging for troubleshooting')
			.addToggle(toggle => toggle
				.setValue(this.plugin.settings.options.debugMode || false)
				.onChange(async (value) => {
					this.plugin.settings.options.debugMode = value;
					await this.plugin.saveSettings();
				})
			);
	}

	private displayRulesSection(containerEl: HTMLElement) {
		const header = containerEl.createDiv({ cls: 'dtf-settings-header' });
		new Setting(header).setName('Mapping rules').setHeading();

		const addButton = header.createEl('button', {
			text: 'Add rule',
			cls: 'mod-cta dtf-add-rule-button'
		});

		addButton.addEventListener('click', () => {
			this.openRuleEditor(null);
		});

		const rulesDesc = containerEl.createDiv({ cls: 'setting-item-description' });
		rulesDesc.setText('Define rules for mapping between folders and tags. Lower priority numbers are evaluated first.');

		// Display rule list
		const ruleListContainer = containerEl.createDiv({ cls: 'dtf-rule-list' });
		this.displayRuleList(ruleListContainer);
	}

	private displayRuleList(containerEl: HTMLElement) {
		containerEl.empty();

		if (!this.plugin.settings.rules || this.plugin.settings.rules.length === 0) {
			const noRules = containerEl.createDiv({ cls: 'dtf-no-rules' });
			noRules.setText('No rules configured yet. Click "Add Rule" to create your first mapping rule.');
			return;
		}

		// Sort rules by priority
		const sortedRules = [...this.plugin.settings.rules].sort((a, b) => a.priority - b.priority);

		sortedRules.forEach((rule, index) => {
			const ruleItem = containerEl.createDiv({
				cls: `dtf-rule-item ${rule.enabled ? '' : 'disabled'}`
			});

			// Rule header
			const ruleHeader = ruleItem.createDiv({ cls: 'dtf-rule-header' });

			const nameContainer = ruleHeader.createDiv();
			nameContainer.createSpan({
				text: rule.name,
				cls: 'dtf-rule-name'
			});

			if (!rule.enabled) {
				nameContainer.createSpan({
					text: ' (disabled)',
					cls: 'dtf-rule-disabled-label'
				});
			}

			const infoContainer = ruleHeader.createDiv();
			infoContainer.createSpan({
				text: `Priority: ${rule.priority}`,
				cls: 'dtf-rule-priority'
			});

			// Rule direction
			const directionText = {
				'folder-to-tag': 'Folder → Tag',
				'tag-to-folder': 'Tag → Folder',
				'bidirectional': 'Bidirectional'
			}[rule.direction];

			ruleItem.createDiv({
				text: directionText,
				cls: 'dtf-rule-direction'
			});

			// Rule patterns
			const patternsContainer = ruleItem.createDiv({ cls: 'dtf-rule-patterns' });

			if (rule.folderPattern) {
				patternsContainer.createDiv({
					text: `📁 ${rule.folderPattern}`
				});
			}

			if (rule.tagPattern) {
				patternsContainer.createDiv({
					text: `🏷️  ${rule.tagPattern}`
				});
			}

			// Rule description
			if (rule.description) {
				ruleItem.createDiv({
					text: rule.description,
					cls: 'dtf-rule-description'
				});
			}

			// Click to edit
			ruleItem.addEventListener('click', () => {
				this.openRuleEditor(rule);
			});

			// Make draggable for reordering
			ruleItem.setAttribute('draggable', 'true');
			ruleItem.addEventListener('dragstart', (e) => {
				e.dataTransfer!.setData('text/plain', String(index));
				ruleItem.addClass('dragging');
			});

			ruleItem.addEventListener('dragend', () => {
				ruleItem.removeClass('dragging');
			});

			ruleItem.addEventListener('dragover', (e) => {
				e.preventDefault();
				ruleItem.addClass('drag-over');
			});

			ruleItem.addEventListener('dragleave', () => {
				ruleItem.removeClass('drag-over');
			});

			ruleItem.addEventListener('drop', (e) => {
				e.preventDefault();
				ruleItem.removeClass('drag-over');

				const fromIndex = parseInt(e.dataTransfer!.getData('text/plain'));
				const toIndex = index;

				if (fromIndex !== toIndex) {
					// Reorder rules
					const rules = [...this.plugin.settings.rules];
					const [movedRule] = rules.splice(fromIndex, 1);
					rules.splice(toIndex, 0, movedRule);

					// Update priorities to match new order
					rules.forEach((r, i) => {
						r.priority = (i + 1) * 10;
					});

					this.plugin.settings.rules = rules;
					void this.plugin.saveSettings().then(() => {
						// Refresh display
						this.display();
						new Notice('Rule order updated');
					});
				}
			});
		});
	}

	private openRuleEditor(rule: MappingRule | null) {
		const modal = new RuleEditorModal(
			this.app,
			rule,
			(updatedRule) => {
				if (updatedRule === null) {
					// Delete rule
					if (rule) {
						this.plugin.settings.rules = this.plugin.settings.rules.filter(
							r => r.id !== rule.id
						);
						void this.plugin.saveSettings().then(() => this.display());
					}
				} else if (rule === null) {
					// Add new rule
					this.plugin.settings.rules.push(updatedRule);
					void this.plugin.saveSettings().then(() => this.display());
				} else {
					// Update existing rule
					const index = this.plugin.settings.rules.findIndex(r => r.id === rule.id);
					if (index !== -1) {
						this.plugin.settings.rules[index] = updatedRule;
						void this.plugin.saveSettings().then(() => this.display());
					}
				}
			}
		);

		modal.open();
	}

	private displayImportExportSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'dtf-import-export' });
		new Setting(section).setName('Import / export settings').setHeading();

		new Setting(section)
			.setName('Export settings')
			.setDesc('Copy all settings as JSON')
			.addButton(btn => btn
				.setButtonText('Export')
				.onClick(() => {
					const json = JSON.stringify(this.plugin.settings, null, 2);
					navigator.clipboard.writeText(json);
					new Notice('Settings copied to clipboard');
				})
			);

		new Setting(section)
			.setName('Import settings')
			.setDesc('Paste JSON settings to import (this will replace current settings)')
			.addTextArea(text => text
				.setPlaceholder('Paste JSON settings here')
				.onChange(() => {
					// Just for display, actual import happens on button click
				})
			)
			.addButton(btn => btn
				.setButtonText('Import')
				.setWarning()
				.onClick(() => {
					const textarea = section.querySelector('textarea');
					if (!textarea) return;

					try {
						const json = textarea.value;
						const settings = JSON.parse(json);

						// Validate settings structure
						if (!settings.rules || !Array.isArray(settings.rules)) {
							new Notice('Invalid settings format');
							return;
						}

						// Import settings directly (user explicitly clicked Import)
						this.plugin.settings = settings;
						void this.plugin.saveSettings().then(() => {
							this.display();
							new Notice('Settings imported successfully');
						});
					} catch (error) {
						const message = error instanceof Error ? error.message : 'Unknown error';
						new Notice('Error parsing JSON: ' + message);
					}
				})
			);
	}
}
