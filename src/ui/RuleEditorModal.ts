/**
 * Rule Editor Modal
 *
 * Comprehensive UI for creating and editing mapping rules
 */

import { App, Modal, Setting, Notice, TFolder } from 'obsidian';
import { MappingRule, CaseTransformType, RuleDirection } from '../types/settings';
import { validateRule } from '../engine/ruleMatcher';
import { isTransformReversible } from '../transformers/pipeline';
import { validateRegexPattern } from '../transformers/regexTransformers';
import { previewRule } from '../engine/rulePreview';
import { inferTypedModel } from '../engine/inferTyped';
import {
	EntryPathSuggest,
	collectFolderSources,
	collectTagSources,
} from './suggest/EntryPathSuggest';

/**
 * Optional callback for the "Try guided" return-link in the advanced
 * modal header. Wired by SettingsTab — closes the advanced modal and
 * reopens the rule in the guided editor (in edit-from-inferred mode).
 */
export type SwitchToGuidedFn = (rule: MappingRule) => void;

export class RuleEditorModal extends Modal {
	rule: MappingRule;
	/**
	 * Save callback. `null` signals deletion (only fires from the Delete
	 * button on existing rules); the callback distinguishes save-vs-delete
	 * by checking for null. Previously typed as `MappingRule` with a cast
	 * at the delete site, which was a lie — this is the honest version.
	 */
	onSave: (rule: MappingRule | null) => void;
	isNew: boolean;
	private readonly onSwitchToGuided?: SwitchToGuidedFn;

	// Invalid-regex tracking — set on input, checked on save. Keyed by
	// pattern field name so we can unblock save once both go valid.
	private regexErrors: Record<'folderPattern' | 'tagPattern', string | null> = {
		folderPattern: null,
		tagPattern: null,
	};

	// Cached vault folder list — computed once on open, reused by the live
	// preview panel on every input change.
	private vaultFolderPaths: string[] = [];
	private previewPanelEl: HTMLElement | null = null;

	constructor(
		app: App,
		rule: MappingRule | null,
		onSave: (rule: MappingRule | null) => void,
		onSwitchToGuided?: SwitchToGuidedFn,
	) {
		super(app);
		this.onSave = onSave;
		this.isNew = rule === null;
		this.onSwitchToGuided = onSwitchToGuided;

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
		const { contentEl, modalEl } = this;
		contentEl.empty();
		// Unique class so e2e tests can scope queries to this modal —
		// without it, .modal-container .modal also matches Obsidian's
		// settings dialog and tests grab the wrong inputs.
		modalEl.addClass('dtf-advanced-modal');

		// Walk the vault folder tree once per open. Both the pattern-section
		// autocomplete and the live preview panel consume this list.
		this.vaultFolderPaths = [];
		const walk = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					this.vaultFolderPaths.push(child.path);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());

		// Title row + optional "Try guided" return link.
		const titleRow = contentEl.createDiv();
		titleRow.style.display = 'flex';
		titleRow.style.alignItems = 'baseline';
		titleRow.style.justifyContent = 'space-between';
		titleRow.style.gap = '0.5em';
		new Setting(titleRow)
			.setName(this.isNew ? 'Create new rule' : 'Edit rule')
			.setHeading();
		this.renderTryGuidedLink(titleRow);

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

		// Reactive preview — any input or change inside the modal triggers
		// a preview re-render. Single integration point instead of plumbing
		// notify() through every Setting.onChange handler.
		const refresh = () => this.renderVaultTestPreview();
		contentEl.addEventListener('input', refresh);
		contentEl.addEventListener('change', refresh);
		refresh();
	}

	private buildBasicInfoSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'rule-editor-section' });
		new Setting(section).setName('Basic information').setHeading();

		new Setting(section)
			.setName('Rule name')
			.setDesc('A descriptive name for this rule')
			.addText(text => text
				.setPlaceholder('My project folders rule')
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

		// Reuse the cached folder walk from onOpen() — autocomplete sources
		// are derived from the same list as the live preview panel below.
		const folderSources = collectFolderSources(this.vaultFolderPaths);
		const tagSources = collectTagSources(
			(this.app.metadataCache as unknown as { getTags(): Record<string, number> })
				.getTags() ?? {},
		);

		if (needsFolderPattern) {
			let folderPatternInput: HTMLInputElement | null = null;
			let folderPatternErrorEl: HTMLElement | null = null;
			new Setting(section)
				.setName('Folder pattern')
				.setDesc('Glob or regex pattern to match folder paths (e.g., "Projects/*" or "^Projects/(.*)$")')
				.addText(text => {
					folderPatternInput = text.inputEl;
					text
						.setPlaceholder('Projects/*')
						.setValue(this.rule.folderPattern || '')
						.onChange(value => {
							this.rule.folderPattern = value;
							this.updateRegexValidationUI(
								'folderPattern',
								value,
								folderPatternInput,
								folderPatternErrorEl,
							);
						});
				});
			folderPatternErrorEl = section.createDiv({ cls: 'dtf-regex-error' });
			folderPatternErrorEl.style.color = 'var(--text-error)';
			folderPatternErrorEl.style.fontSize = '0.8em';
			folderPatternErrorEl.style.marginTop = '-0.3em';
			folderPatternErrorEl.style.marginBottom = '0.5em';
			folderPatternErrorEl.style.paddingLeft = '0.25em';
			folderPatternErrorEl.style.display = 'none';
			// Run validation once on mount so an existing invalid pattern is
			// flagged immediately (matters for edit-mode).
			this.updateRegexValidationUI(
				'folderPattern',
				this.rule.folderPattern || '',
				folderPatternInput,
				folderPatternErrorEl,
			);

			new Setting(section)
				.setName('Folder entry point')
				.setDesc('Base folder path where matched folders should live')
				.addText(text => {
					text
						.setPlaceholder('Projects/')
						.setValue(this.rule.folderEntryPoint || '')
						.onChange(value => {
							this.rule.folderEntryPoint = value;
						});
					new EntryPathSuggest(this.app, text.inputEl, folderSources);
				});
		}

		if (needsTagPattern) {
			let tagPatternInput: HTMLInputElement | null = null;
			let tagPatternErrorEl: HTMLElement | null = null;
			new Setting(section)
				.setName('Tag pattern')
				.setDesc('Regex pattern to match tags (e.g., "^projects/(.*)$")')
				.addText(text => {
					tagPatternInput = text.inputEl;
					text
						.setPlaceholder('^projects/(.*)$')
						.setValue(this.rule.tagPattern || '')
						.onChange(value => {
							this.rule.tagPattern = value;
							this.updateRegexValidationUI(
								'tagPattern',
								value,
								tagPatternInput,
								tagPatternErrorEl,
							);
						});
				});
			tagPatternErrorEl = section.createDiv({ cls: 'dtf-regex-error' });
			tagPatternErrorEl.style.color = 'var(--text-error)';
			tagPatternErrorEl.style.fontSize = '0.8em';
			tagPatternErrorEl.style.marginTop = '-0.3em';
			tagPatternErrorEl.style.marginBottom = '0.5em';
			tagPatternErrorEl.style.paddingLeft = '0.25em';
			tagPatternErrorEl.style.display = 'none';
			this.updateRegexValidationUI(
				'tagPattern',
				this.rule.tagPattern || '',
				tagPatternInput,
				tagPatternErrorEl,
			);

			new Setting(section)
				.setName('Tag entry point')
				.setDesc('Tag prefix for matched tags (e.g., "projects/")')
				.addText(text => {
					text
						.setPlaceholder('e.g., projects/')
						.setValue(this.rule.tagEntryPoint || '')
						.onChange(value => {
							this.rule.tagEntryPoint = value;
						});
					new EntryPathSuggest(this.app, text.inputEl, tagSources);
				});
		}
	}

	private updateRegexValidationUI(
		field: 'folderPattern' | 'tagPattern',
		value: string,
		inputEl: HTMLInputElement | null,
		errorEl: HTMLElement | null,
	) {
		if (!inputEl || !errorEl) return;
		// Empty is fine — required-field check happens in validateRule() at
		// save time. Only flag *invalid* regex.
		if (!value) {
			this.regexErrors[field] = null;
			inputEl.removeClass('dtf-input-invalid');
			inputEl.style.borderColor = '';
			errorEl.style.display = 'none';
			errorEl.setText('');
			return;
		}
		const result = validateRegexPattern(value);
		if (result.valid) {
			this.regexErrors[field] = null;
			inputEl.removeClass('dtf-input-invalid');
			inputEl.style.borderColor = '';
			errorEl.style.display = 'none';
			errorEl.setText('');
		} else {
			this.regexErrors[field] = result.error ?? 'Invalid regex';
			inputEl.addClass('dtf-input-invalid');
			inputEl.style.borderColor = 'var(--text-error)';
			errorEl.style.display = 'block';
			errorEl.setText(`Invalid regex: ${result.error ?? 'unknown error'}`);
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
				.addOption('snake_case', 'Snake case')
				.addOption('kebab-case', 'Kebab case')
				.addOption('camelCase', 'Camel case')
				.addOption('PascalCase', 'Pascal case')
				.addOption('Title Case', 'Title case')
				.addOption('lowercase', 'Lowercase')
				.addOption('UPPERCASE', 'Uppercase')
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
				.addOption('snake_case', 'Snake case')
				.addOption('kebab-case', 'Kebab case')
				.addOption('camelCase', 'Camel case')
				.addOption('PascalCase', 'Pascal case')
				.addOption('Title Case', 'Title case')
				.addOption('lowercase', 'Lowercase')
				.addOption('UPPERCASE', 'Uppercase')
				.setValue(tagTransforms.caseTransform || 'none')
				.onChange((value) => {
					this.rule.tagTransforms!.caseTransform = value as CaseTransformType;
				})
			);

		// Symmetric with folderTransforms — TransformConfig type supports
		// emoji and number-prefix handling on both sides; only the folder
		// side was previously exposed in the UI.
		new Setting(tagSection)
			.setName('Emoji handling')
			.setDesc('How to handle emoji in tag names')
			.addDropdown(dropdown => dropdown
				.addOption('keep', 'Keep emoji')
				.addOption('strip', 'Strip emoji')
				.setValue(tagTransforms.emojiHandling || 'keep')
				.onChange((value) => {
					this.rule.tagTransforms!.emojiHandling = value as 'keep' | 'strip';
				})
			);

		new Setting(tagSection)
			.setName('Number prefix handling')
			.setDesc('How to handle number prefixes in tag names')
			.addDropdown(dropdown => dropdown
				.addOption('keep', 'Keep numbers')
				.addOption('strip', 'Strip numbers')
				.addOption('extract', 'Extract numbers separately')
				.setValue(tagTransforms.numberPrefixHandling || 'keep')
				.onChange((value) => {
					this.rule.tagTransforms!.numberPrefixHandling = value as 'keep' | 'strip' | 'extract';
				})
			);

		// Show reversibility warning
		const reversibility = isTransformReversible(this.rule.folderTransforms);
		if (!reversibility.reversible && reversibility.warnings.length > 0) {
			const warningEl = section.createDiv({ cls: 'rule-editor-warning' });
			warningEl.createEl('strong', { text: '⚠️ ' });
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
		new Setting(section).setName('Test against your vault').setHeading();

		const desc = section.createEl('p');
		desc.style.fontSize = '0.85em';
		desc.style.color = 'var(--text-muted)';
		desc.style.marginTop = '-0.5em';
		desc.style.marginBottom = '0.5em';
		desc.setText(
			'Live preview — applies the rule to your real vault folders and shows what it would emit. Updates as you edit fields above.',
		);

		this.previewPanelEl = section.createDiv({ cls: 'dtf-advanced-preview-panel' });
		this.previewPanelEl.style.padding = '0.5em 0.75em';
		this.previewPanelEl.style.background = 'var(--background-secondary)';
		this.previewPanelEl.style.borderRadius = '4px';
		this.previewPanelEl.style.fontSize = '0.9em';
	}

	/**
	 * Render the "Try guided" return-link in the modal header. Symmetric
	 * to the "Open in advanced (regex)" link in the guided modal.
	 *
	 * Visibility gating:
	 *   - No callback wired → no link (e.g., direct programmatic open)
	 *   - inferTypedModel returns full folder + tag + transfer → strong CTA
	 *     ("Try guided")
	 *   - Inference is partial → muted link with explanatory copy
	 *     ("Try guided (best-effort import)") — user is told what they're
	 *     getting before they click.
	 */
	private renderTryGuidedLink(parentEl: HTMLElement): void {
		if (!this.onSwitchToGuided) return;

		const inferred = inferTypedModel(this.rule);
		const fullyInferable = Boolean(inferred.folder && inferred.tag && inferred.transfer);
		const partial = Boolean(inferred.folder || inferred.tag || inferred.transfer);

		// If inference yields nothing at all, hide the link — guided would
		// open with empty fields and the user would just be confused.
		if (!fullyInferable && !partial) return;

		const link = parentEl.createEl('a', {
			text: fullyInferable ? 'Try guided' : 'Try guided (best-effort import)',
		});
		link.style.fontSize = '0.85em';
		link.style.cursor = 'pointer';
		link.style.color = fullyInferable ? 'var(--text-accent)' : 'var(--text-muted)';
		link.addEventListener('click', (e) => {
			e.preventDefault();
			if (this.onSwitchToGuided) {
				this.onSwitchToGuided(this.rule);
				this.close();
			}
		});
	}

	private renderVaultTestPreview(): void {
		const panel = this.previewPanelEl;
		if (!panel) return;
		panel.empty();

		// Refuse to preview while regex is invalid — the inline error already
		// communicates the problem; running previewRule against a broken
		// regex would just throw.
		if (this.regexErrors.folderPattern || this.regexErrors.tagPattern) {
			const note = panel.createDiv();
			note.style.color = 'var(--text-muted)';
			note.setText('Fix regex errors above to see preview.');
			return;
		}

		// Without a folder pattern there's nothing to match against. The
		// rule may still be tag-to-folder only, but previewRule's path
		// works off folder→tag — show a friendly note instead of "0 folders".
		if (!this.rule.folderPattern) {
			const note = panel.createDiv();
			note.style.color = 'var(--text-muted)';
			note.setText('Add a folder pattern to see what this rule matches.');
			return;
		}

		const preview = previewRule(this.rule, this.vaultFolderPaths, { maxSamples: 5 });

		// previewRule no longer throws on invalid regex — it surfaces the
		// problem via invalidRegex. The inline-validation gate above
		// should already catch this case, but render a clear message if
		// it slips through.
		if (preview.invalidRegex) {
			const note = panel.createDiv();
			note.style.color = 'var(--text-error)';
			note.setText(
				`Invalid ${preview.invalidRegex.which} regex: ${preview.invalidRegex.error}.`,
			);
			return;
		}

		// Summary line
		const summary = panel.createDiv();
		summary.style.fontWeight = '500';
		summary.style.marginBottom = '0.4em';
		if (preview.opaqueByDesign) {
			summary.setText(
				`Matches ${preview.matchCount} folders · this rule deliberately emits no tags (opaque)`,
			);
		} else {
			summary.setText(
				`Matches ${preview.matchCount} folders · emits ${preview.emittedTags.length} distinct tags`,
			);
		}

		// Sample pairs — folder → tag(s)
		if (preview.samples.length > 0) {
			const samplesList = panel.createDiv();
			samplesList.style.fontFamily = 'var(--font-monospace)';
			samplesList.style.fontSize = '0.85em';
			samplesList.style.lineHeight = '1.5';
			for (const sample of preview.samples) {
				const row = samplesList.createDiv();
				row.style.color = 'var(--text-normal)';
				const tagPart = preview.opaqueByDesign
					? '(no tag emitted)'
					: sample.tags.map((t) => `#${t}`).join(', ');
				row.setText(`${sample.folder} → ${tagPart}`);
			}
		} else if (preview.matchCount === 0 && !preview.opaqueByDesign) {
			const note = panel.createDiv();
			note.style.color = 'var(--text-muted)';
			note.style.fontStyle = 'italic';
			note.setText('No vault folders match this pattern yet.');
		}
	}

	private buildActionButtons(containerEl: HTMLElement) {
		const buttonContainer = containerEl.createDiv({ cls: 'rule-editor-buttons' });

		// Save button
		const saveButton = buttonContainer.createEl('button', {
			text: this.isNew ? 'Create rule' : 'Save changes',
			cls: 'mod-cta'
		});

		saveButton.addEventListener('click', () => {
			// Block save on invalid regex — the user has already been shown
			// the inline error, so just nudge them with a notice.
			const regexProblems: string[] = [];
			if (this.regexErrors.folderPattern) {
				regexProblems.push(`Folder pattern: ${this.regexErrors.folderPattern}`);
			}
			if (this.regexErrors.tagPattern) {
				regexProblems.push(`Tag pattern: ${this.regexErrors.tagPattern}`);
			}
			if (regexProblems.length > 0) {
				new Notice(`Fix regex errors before saving: ${regexProblems.join('; ')}`);
				return;
			}

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
				// Confirm before destructive action. Click-once delete on a
				// big modal button is too easy to fire accidentally; the
				// confirm dialog is the standard browser native and runs in
				// Electron without extra plumbing.
				const ok = confirm(
					`Delete rule "${this.rule.name}"? This cannot be undone.`,
				);
				if (!ok) return;
				this.onSave(null);
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
