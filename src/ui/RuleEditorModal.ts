/**
 * Rule Editor Modal
 *
 * Comprehensive UI for creating and editing mapping rules
 */

import { App, Modal, Setting, Notice } from 'obsidian';
import { MappingRule, CaseTransformType, RuleDirection } from '../types/settings';
import { validateRule } from '../engine/ruleMatcher';
import { folderToTag, tagToFolder, isTransformReversible } from '../transformers/pipeline';

export class RuleEditorModal extends Modal {
	rule: MappingRule;
	onSave: (rule: MappingRule) => void;
	isNew: boolean;

	constructor(
		app: App,
		rule: MappingRule | null,
		onSave: (rule: MappingRule) => void
	) {
		super(app);
		this.onSave = onSave;
		this.isNew = rule === null;

		// Initialize with default values if new rule
		this.rule = rule || this.createDefaultRule();
	}

	private createDefaultRule(): MappingRule {
		return {
			id: `rule-${Date.now()}`,
			name: 'New rule',
			description: '',
			enabled: true,
			priority: 100,
			direction: 'bidirectional',
			folderPattern: '',
			tagPattern: '',
			folderTransforms: {},
			tagTransforms: {},
			options: {
				createFolders: true,
				addTags: true,
				removeOrphanedTags: false,
				syncOnFileCreate: true,
				syncOnFileMove: true,
				syncOnFileRename: true
			}
		};
	}

	onOpen() {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl)
			.setName(this.isNew ? 'Create new rule' : 'Edit rule')
			.setHeading();

		// Basic Information Section
		this.buildBasicInfoSection(contentEl);

		// Direction Section
		this.buildDirectionSection(contentEl);

		// Pattern Section
		this.buildPatternSection(contentEl);

		// Transformation Section
		this.buildTransformationSection(contentEl);

		// Options Section
		this.buildOptionsSection(contentEl);

		// Testing/Preview Section
		this.buildPreviewSection(contentEl);

		// Action Buttons
		this.buildActionButtons(contentEl);
	}

	private buildBasicInfoSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'rule-editor-section' });
		new Setting(section).setName('Basic information').setHeading();

		new Setting(section)
			.setName('Rule name')
			.setDesc('A descriptive name for this rule')
			.addText(text => text
				.setPlaceholder('e.g., Project folders to tags')
				.setValue(this.rule.name)
				.onChange(value => {
					this.rule.name = value;
				})
			);

		new Setting(section)
			.setName('Description')
			.setDesc('Optional description explaining what this rule does')
			.addTextArea(text => text
				.setPlaceholder('e.g., Maps project folders to #projects/ tags')
				.setValue(this.rule.description || '')
				.onChange(value => {
					this.rule.description = value;
				})
			);

		new Setting(section)
			.setName('Enabled')
			.setDesc('Enable or disable this rule')
			.addToggle(toggle => toggle
				.setValue(this.rule.enabled)
				.onChange(value => {
					this.rule.enabled = value;
				})
			);

		new Setting(section)
			.setName('Priority')
			.setDesc('Lower numbers = higher priority (evaluated first)')
			.addText(text => text
				.setPlaceholder('100')
				.setValue(String(this.rule.priority))
				.onChange(value => {
					const num = parseInt(value);
					if (!isNaN(num) && num >= 0) {
						this.rule.priority = num;
					}
				})
			);
	}

	private buildDirectionSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'rule-editor-section' });
		new Setting(section).setName('Sync direction').setHeading();

		new Setting(section)
			.setName('Direction')
			.setDesc('Choose when this rule should apply')
			.addDropdown(dropdown => dropdown
				.addOption('bidirectional', 'Bidirectional (both directions)')
				.addOption('folder-to-tag', 'Folder → tag (folder changes update tags)')
				.addOption('tag-to-folder', 'Tag → folder (tag changes move files)')
				.setValue(this.rule.direction)
				.onChange((value) => {
					this.rule.direction = value as RuleDirection;
					// Refresh UI to show/hide relevant pattern fields
					this.onOpen();
				})
			);
	}

	private buildPatternSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'rule-editor-section' });
		new Setting(section).setName('Patterns').setHeading();

		const needsFolderPattern = this.rule.direction === 'folder-to-tag' || this.rule.direction === 'bidirectional';
		const needsTagPattern = this.rule.direction === 'tag-to-folder' || this.rule.direction === 'bidirectional';

		if (needsFolderPattern) {
			new Setting(section)
				.setName('Folder pattern')
				.setDesc('Glob or regex pattern to match folder paths (e.g., "Projects/*" or "^Projects/(.*)$")')
				.addText(text => text
					.setPlaceholder('Projects/*')
					.setValue(this.rule.folderPattern || '')
					.onChange(value => {
						this.rule.folderPattern = value;
					})
				);

			new Setting(section)
				.setName('Folder entry point')
				.setDesc('Base folder path where matched folders should live')
				.addText(text => text
					.setPlaceholder('Projects/')
					.setValue(this.rule.folderEntryPoint || '')
					.onChange(value => {
						this.rule.folderEntryPoint = value;
					})
				);
		}

		if (needsTagPattern) {
			new Setting(section)
				.setName('Tag pattern')
				.setDesc('Regex pattern to match tags (e.g., "^projects/(.*)$")')
				.addText(text => text
					.setPlaceholder('projects/*')
					.setValue(this.rule.tagPattern || '')
					.onChange(value => {
						this.rule.tagPattern = value;
					})
				);

			new Setting(section)
				.setName('Tag entry point')
				.setDesc('Tag prefix for matched tags (e.g., "projects/")')
				.addText(text => text
					.setPlaceholder('projects/')
					.setValue(this.rule.tagEntryPoint || '')
					.onChange(value => {
						this.rule.tagEntryPoint = value;
					})
				);
		}
	}

	private buildTransformationSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'rule-editor-section' });
		new Setting(section).setName('Transformations').setHeading();

		// Folder transformations
		const folderSection = section.createDiv({ cls: 'transform-subsection' });
		new Setting(folderSection).setName('Folder to tag transformations').setHeading();

		if (!this.rule.folderTransforms) {
			this.rule.folderTransforms = {};
		}

		const folderTransforms = this.rule.folderTransforms;

		new Setting(folderSection)
			.setName('Case transformation')
			.setDesc('Convert folder names to tag format')
			.addDropdown(dropdown => dropdown
				.addOption('none', 'None (keep as-is)')
				.addOption('snake_case', 'snake_case')
				.addOption('kebab-case', 'kebab-case')
				.addOption('camelCase', 'camelCase')
				.addOption('PascalCase', 'PascalCase')
				.addOption('Title Case', 'Title Case')
				.addOption('lowercase', 'lowercase')
				.addOption('UPPERCASE', 'UPPERCASE')
				.setValue(folderTransforms.caseTransform || 'none')
				.onChange((value) => {
					this.rule.folderTransforms!.caseTransform = value as CaseTransformType;
				})
			);

		new Setting(folderSection)
			.setName('Emoji handling')
			.setDesc('How to handle emoji in folder names')
			.addDropdown(dropdown => dropdown
				.addOption('keep', 'Keep emoji')
				.addOption('strip', 'Strip emoji')
				.setValue(folderTransforms.emojiHandling || 'keep')
				.onChange((value) => {
					this.rule.folderTransforms!.emojiHandling = value as 'keep' | 'strip';
				})
			);

		new Setting(folderSection)
			.setName('Number prefix handling')
			.setDesc('How to handle number prefixes (e.g., "01 - projects")')
			.addDropdown(dropdown => dropdown
				.addOption('keep', 'Keep numbers')
				.addOption('strip', 'Strip numbers')
				.addOption('extract', 'Extract numbers separately')
				.setValue(folderTransforms.numberPrefixHandling || 'keep')
				.onChange((value) => {
					this.rule.folderTransforms!.numberPrefixHandling = value as 'keep' | 'strip' | 'extract';
				})
			);

		// Tag transformations
		const tagSection = section.createDiv({ cls: 'transform-subsection' });
		new Setting(tagSection).setName('Tag to folder transformations').setHeading();

		if (!this.rule.tagTransforms) {
			this.rule.tagTransforms = {};
		}

		const tagTransforms = this.rule.tagTransforms;

		new Setting(tagSection)
			.setName('Case transformation')
			.setDesc('Convert tags to folder name format')
			.addDropdown(dropdown => dropdown
				.addOption('none', 'None (keep as-is)')
				.addOption('snake_case', 'snake_case')
				.addOption('kebab-case', 'kebab-case')
				.addOption('camelCase', 'camelCase')
				.addOption('PascalCase', 'PascalCase')
				.addOption('Title Case', 'Title Case')
				.addOption('lowercase', 'lowercase')
				.addOption('UPPERCASE', 'UPPERCASE')
				.setValue(tagTransforms.caseTransform || 'none')
				.onChange((value) => {
					this.rule.tagTransforms!.caseTransform = value as CaseTransformType;
				})
			);

		// Show reversibility warning
		const reversibility = isTransformReversible(this.rule.folderTransforms);
		if (!reversibility.reversible && reversibility.warnings.length > 0) {
			const warningEl = section.createDiv({ cls: 'rule-editor-warning' });
			warningEl.createEl('strong', { text: '⚠️ Warning: ' });
			warningEl.createSpan({ text: 'This transformation may not be reversible' });
			const warningList = warningEl.createEl('ul');
			reversibility.warnings.forEach(warning => {
				warningList.createEl('li', { text: warning });
			});
		}
	}

	private buildOptionsSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'rule-editor-section' });
		new Setting(section).setName('Sync options').setHeading();

		new Setting(section)
			.setName('Create folders')
			.setDesc('Automatically create folders if they don\'t exist')
			.addToggle(toggle => toggle
				.setValue(this.rule.options.createFolders)
				.onChange(value => {
					this.rule.options.createFolders = value;
				})
			);

		new Setting(section)
			.setName('Add tags')
			.setDesc('Automatically add tags to files')
			.addToggle(toggle => toggle
				.setValue(this.rule.options.addTags)
				.onChange(value => {
					this.rule.options.addTags = value;
				})
			);

		new Setting(section)
			.setName('Remove orphaned tags')
			.setDesc('Remove tags when file is moved out of matching folder')
			.addToggle(toggle => toggle
				.setValue(this.rule.options.removeOrphanedTags)
				.onChange(value => {
					this.rule.options.removeOrphanedTags = value;
				})
			);

		new Setting(section)
			.setName('Sync on file create')
			.setDesc('Apply rule when new files are created')
			.addToggle(toggle => toggle
				.setValue(this.rule.options.syncOnFileCreate)
				.onChange(value => {
					this.rule.options.syncOnFileCreate = value;
				})
			);

		new Setting(section)
			.setName('Sync on file move')
			.setDesc('Apply rule when files are moved')
			.addToggle(toggle => toggle
				.setValue(this.rule.options.syncOnFileMove)
				.onChange(value => {
					this.rule.options.syncOnFileMove = value;
				})
			);

		new Setting(section)
			.setName('Sync on file rename')
			.setDesc('Apply rule when files are renamed')
			.addToggle(toggle => toggle
				.setValue(this.rule.options.syncOnFileRename)
				.onChange(value => {
					this.rule.options.syncOnFileRename = value;
				})
			);
	}

	private buildPreviewSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'rule-editor-section' });
		new Setting(section).setName('Test and preview').setHeading();

		const testContainer = section.createDiv({ cls: 'rule-test-container' });

		new Setting(testContainer)
			.setName('Test folder path')
			.setDesc('Enter a folder path to test transformation')
			.addText(text => text
				.setPlaceholder('Projects/my project')
				.onChange((value) => {
					if (value && this.rule.folderTransforms) {
						const result = folderToTag(value, this.rule.folderTransforms);
						const resultEl = testContainer.querySelector('.test-folder-result');
						if (resultEl) {
							resultEl.setText(`→ Tag: ${result}`);
						}
					}
				})
			);

		testContainer.createDiv({ cls: 'test-folder-result' });

		new Setting(testContainer)
			.setName('Test tag')
			.setDesc('Enter a tag to test transformation')
			.addText(text => text
				.setPlaceholder('my_project')
				.onChange((value) => {
					if (value && this.rule.tagTransforms) {
						const result = tagToFolder(value, this.rule.tagTransforms);
						const resultEl = testContainer.querySelector('.test-tag-result');
						if (resultEl) {
							resultEl.setText(`→ Folder: ${result}`);
						}
					}
				})
			);

		testContainer.createDiv({ cls: 'test-tag-result' });
	}

	private buildActionButtons(containerEl: HTMLElement) {
		const buttonContainer = containerEl.createDiv({ cls: 'rule-editor-buttons' });

		// Save button
		const saveButton = buttonContainer.createEl('button', {
			text: this.isNew ? 'Create rule' : 'Save changes',
			cls: 'mod-cta'
		});

		saveButton.addEventListener('click', () => {
			const validation = validateRule(this.rule);

			if (!validation.valid) {
				new Notice(`Invalid rule: ${validation.errors.join(', ')}`);
				return;
			}

			this.onSave(this.rule);
			new Notice(`Rule "${this.rule.name}" ${this.isNew ? 'created' : 'updated'}`);
			this.close();
		});

		// Cancel button
		const cancelButton = buttonContainer.createEl('button', {
			text: 'Cancel'
		});

		cancelButton.addEventListener('click', () => {
			this.close();
		});

		// Delete button (only for existing rules)
		if (!this.isNew) {
			const deleteButton = buttonContainer.createEl('button', {
				text: 'Delete rule',
				cls: 'mod-warning'
			});

			deleteButton.addEventListener('click', () => {
				// Signal deletion by passing null - the callback handles this
				// Cast is safe here as the callback checks for null
				this.onSave(null as unknown as MappingRule);
				new Notice(`Rule "${this.rule.name}" deleted`);
				this.close();
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
	}
}
