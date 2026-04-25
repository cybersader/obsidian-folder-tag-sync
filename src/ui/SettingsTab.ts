import { App, PluginSettingTab, Setting, Notice, TFolder } from 'obsidian';
import DynamicTagsFoldersPlugin from '../main';
import { RuleEditorModal } from './RuleEditorModal';
import { MappingRule } from '../types/settings';
import { previewRule, RulePreview } from '../engine/rulePreview';

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

		// Main heading is provided by Obsidian settings tab

		// General Options
		this.displayGeneralOptions(containerEl);

		// Mapping Rules
		this.displayRulesSection(containerEl);

		// Import/Export
		this.displayImportExportSection(containerEl);
	}

	private displayGeneralOptions(containerEl: HTMLElement) {
		new Setting(containerEl).setName('Behavior').setHeading();

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

	/**
	 * Compute and render a rule preview into `panel`. Pulls all folder paths
	 * from the vault, runs the pure `previewRule()` against them, formats
	 * the result as a readable summary.
	 */
	private renderRulePreview(panel: HTMLElement, rule: MappingRule): void {
		panel.empty();

		// Collect all folder paths in the vault. Limit total count to keep
		// large vaults responsive — the user can re-run later if they want.
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

		const preview = previewRule(rule, folderPaths, { maxSamples: 5 });

		// Header line
		const summary = panel.createDiv({ cls: 'dtf-preview-summary' });
		if (preview.opaqueByDesign) {
			summary.createSpan({
				text: `${preview.matchCount} folder(s) match — this rule is opaque and deliberately emits no tag.`,
			});
		} else if (preview.matchCount === 0) {
			summary.createEl('em', {
				text: 'No vault folders match this rule. The pattern may be misconfigured, or the vault doesn\'t contain folders the rule targets.',
			});
			return;
		} else {
			summary.createSpan({
				text: `${preview.matchCount} folder(s) match. Would emit ${preview.emittedTags.length} distinct tag(s).`,
			});
		}

		// Emitted tags chip list
		if (preview.emittedTags.length > 0) {
			const tagsBlock = panel.createDiv({ cls: 'dtf-preview-tags' });
			tagsBlock.style.marginTop = '0.5em';
			tagsBlock.createSpan({ text: 'Tags: ' });
			const capped = preview.emittedTags.slice(0, 12);
			for (const t of capped) {
				const chip = tagsBlock.createEl('code', { text: t });
				chip.style.marginRight = '0.5em';
			}
			if (preview.emittedTags.length > 12) {
				tagsBlock.createSpan({
					text: ` (+${preview.emittedTags.length - 12} more)`,
				});
			}
		}

		// Samples
		if (preview.samples.length > 0) {
			const samplesBlock = panel.createDiv({ cls: 'dtf-preview-samples' });
			samplesBlock.style.marginTop = '0.5em';
			samplesBlock.createDiv({ text: 'Samples:' });
			const list = samplesBlock.createEl('ul');
			list.style.marginTop = '0.25em';
			list.style.paddingLeft = '1.5em';
			for (const sample of preview.samples) {
				const li = list.createEl('li');
				li.createEl('code', { text: sample.folder });
				if (sample.tags.length === 0) {
					li.createSpan({ text: ' → (no tag — opaque)' });
				} else {
					li.createSpan({ text: ' → ' });
					sample.tags.forEach((t, i) => {
						if (i > 0) li.createSpan({ text: ' + ' });
						li.createEl('code', { text: t });
					});
				}
			}
		}
	}

	private displayRuleList(containerEl: HTMLElement) {
		containerEl.empty();

		if (!this.plugin.settings.rules || this.plugin.settings.rules.length === 0) {
			const noRules = containerEl.createDiv({ cls: 'dtf-no-rules' });
			noRules.setText('No rules configured yet. Use the button above to add one.');
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
				'folder-to-tag': 'Folder → tag',
				'tag-to-folder': 'Tag → folder',
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

			// ─── Preview panel — Track B ────────────────────────────────
			// Click "Preview" → expands a panel showing what this rule
			// would do against the current vault: matched folders count,
			// emitted tags, sample folder→tag mappings. Pure derivation;
			// no I/O beyond enumerating vault folders. Surfaces the
			// typed-model runtime decisions before the user commits.
			const previewActions = ruleItem.createDiv({ cls: 'dtf-rule-actions' });
			const previewBtn = previewActions.createEl('button', {
				text: 'Preview against vault',
				cls: 'dtf-rule-preview-toggle'
			});
			const previewPanel = ruleItem.createDiv({ cls: 'dtf-rule-preview-panel' });
			previewPanel.style.display = 'none';
			previewPanel.style.marginTop = '0.5em';
			previewPanel.style.padding = '0.75em';
			previewPanel.style.background = 'var(--background-secondary)';
			previewPanel.style.borderRadius = '4px';
			previewPanel.style.fontSize = '0.85em';

			let previewComputed = false;
			previewBtn.addEventListener('click', (e) => {
				e.stopPropagation(); // don't open the rule editor
				if (previewPanel.style.display === 'none') {
					if (!previewComputed) {
						this.renderRulePreview(previewPanel, rule);
						previewComputed = true;
					}
					previewPanel.style.display = 'block';
					previewBtn.setText('Hide preview');
				} else {
					previewPanel.style.display = 'none';
					previewBtn.setText('Preview against vault');
				}
			});

			// Click to edit (excludes preview interactions via stopPropagation above)
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
		new Setting(section).setName('Import / export').setHeading();

		new Setting(section)
			.setName('Browse bundled rule packs')
			.setDesc('Pick a pre-configured rule pack and import its rules into your settings.')
			.addButton(btn => btn
				.setButtonText('Browse')
				.setCta()
				.onClick(() => {
					void this.plugin.browseRulePacks().then(() => this.display());
				})
			);

		new Setting(section)
			.setName('Export settings')
			.setDesc('Copy all settings as JSON')
			.addButton(btn => btn
				.setButtonText('Export')
				.onClick(() => {
					const json = JSON.stringify(this.plugin.settings, null, 2);
					void navigator.clipboard.writeText(json);
					new Notice('Copied to clipboard');
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
