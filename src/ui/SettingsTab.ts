import { App, PluginSettingTab, Setting, Notice, TFolder } from 'obsidian';
import DynamicTagsFoldersPlugin from '../main';
import { RuleEditorModal } from './RuleEditorModal';
import { GuidedRuleEditorModal } from './GuidedRuleEditorModal';
import { DetectVaultModal } from './DetectVaultModal';
import { ConfirmModal } from './ConfirmModal';
import { MappingRule } from '../types/settings';
import { previewRule, RulePreview } from '../engine/rulePreview';

/**
 * Settings tab for the plugin
 */
export class SettingsTab extends PluginSettingTab {
	plugin: DynamicTagsFoldersPlugin;

	/**
	 * IDs of rules just imported via the DetectVault modal. Used to render
	 * the "review and enable" banner above the rule list. Cleared when the
	 * user dismisses the banner or enables/disables a rule directly.
	 */
	private lastImportedRuleIds: string[] = [];

	constructor(app: App, plugin: DynamicTagsFoldersPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		// Main heading is provided by Obsidian settings tab

		// Settings → Map round-trip — jump straight to the visual map of what
		// the installed rules do per folder (coverage + conflicts).
		new Setting(containerEl)
			.setName('Taxonomy Workbench map')
			.setDesc('Open the map to see what your installed rules do per folder — coverage and conflicts.')
			.addButton(btn => btn
				.setButtonText('Open the map')
				.onClick(() => {
					void this.plugin.activateWorkbenchMap();
				}),
			);

		// General Options
		this.displayGeneralOptions(containerEl);

		// Mapping Rules
		this.displayRulesSection(containerEl);

		// Group precedence (F1 Step 3)
		this.displayGroupPrecedenceSection(containerEl);

		// Import/Export
		this.displayImportExportSection(containerEl);

		// Map → Settings round-trip — if the map handed us a rule id, scroll to
		// and briefly highlight that rule. Consumed once.
		this.consumeFocusRule();
	}

	/**
	 * Consume `plugin.focusRuleId` (set by the Taxonomy Workbench map before it
	 * opens this tab): scroll the matching rule into view and pulse a highlight.
	 * Cleared immediately so a later re-render doesn't re-trigger. Best-effort —
	 * if the rule isn't in the DOM (filtered, removed) it silently no-ops.
	 */
	private consumeFocusRule(): void {
		const id = this.plugin.focusRuleId;
		if (!id) return;
		this.plugin.focusRuleId = undefined; // consume once
		// Defer so the freshly-built rule rows are laid out before we scroll.
		window.setTimeout(() => {
			const selector = `[data-dtf-rule-id="${(window.CSS?.escape ? window.CSS.escape(id) : id)}"]`;
			const el = this.containerEl.querySelector<HTMLElement>(selector);
			if (!el) return;
			el.scrollIntoView({ behavior: 'smooth', block: 'center' });
			el.style.outline = '2px solid var(--interactive-accent)';
			el.style.outlineOffset = '2px';
			window.setTimeout(() => {
				el.style.outline = '';
				el.style.outlineOffset = '';
			}, 2200);
		}, 50);
	}

	/**
	 * F1 Step 3 — Group precedence config UI.
	 *
	 * Renders a list of currently-declared groups (from the rule set) with
	 * up/down arrows to reorder. The order written to settings.groupPrecedence
	 * determines cross-group resolution order in findBestMatch (highest
	 * precedence first).
	 */
	private displayGroupPrecedenceSection(containerEl: HTMLElement) {
		const section = containerEl.createDiv({ cls: 'dtf-section-divider' });
		new Setting(section).setName('Group precedence').setHeading();

		// Discover all distinct groups currently declared on the rule set.
		const declaredGroups = Array.from(
			new Set(
				this.plugin.settings.rules
					.map((r) => r.group)
					.filter((g): g is string => typeof g === 'string' && g.length > 0)
			)
		);

		// Compute the current ordering: items in groupPrecedence first (in their
		// declared order), then any newly-discovered groups not yet in the list,
		// alphabetically.
		const current = this.plugin.settings.groupPrecedence ?? [];
		const known = new Set(current);
		const newlyDiscovered = declaredGroups.filter((g) => !known.has(g)).sort();
		const ordered = [...current.filter((g) => declaredGroups.includes(g)), ...newlyDiscovered];

		new Setting(section)
			.setDesc(
				'Cross-pack precedence: when multiple rules from different groups match ' +
				'the same input, the highest-precedence group wins. Within a group, specificity ' +
				'(and priority as tiebreak) decides. Move groups up to give them higher precedence.'
			);

		if (ordered.length === 0) {
			section.createEl('p', {
				text: 'No groups declared yet. Rule packs auto-declare their group at install time.',
				cls: 'dtf-no-groups-message'
			});
			return;
		}

		const listEl = section.createDiv({ cls: 'dtf-group-precedence-list' });

		ordered.forEach((group, index) => {
			const itemEl = listEl.createDiv({ cls: 'dtf-group-precedence-item' });
			itemEl.style.display = 'flex';
			itemEl.style.alignItems = 'center';
			itemEl.style.gap = '0.5em';
			itemEl.style.padding = '0.4em 0.6em';
			itemEl.style.borderBottom = '1px solid var(--background-modifier-border)';

			const rankEl = itemEl.createSpan({ text: `${index + 1}.`, cls: 'dtf-group-rank' });
			rankEl.style.minWidth = '2em';
			rankEl.style.opacity = '0.7';

			const nameEl = itemEl.createSpan({ text: group, cls: 'dtf-group-name' });
			nameEl.style.flex = '1';
			nameEl.style.fontFamily = 'var(--font-monospace)';

			// Up button
			const upBtn = itemEl.createEl('button', { text: '↑', cls: 'dtf-group-move-up' });
			upBtn.disabled = index === 0;
			upBtn.addEventListener('click', async () => {
				const newOrder = [...ordered];
				[newOrder[index - 1], newOrder[index]] = [newOrder[index], newOrder[index - 1]];
				this.plugin.settings.groupPrecedence = newOrder;
				await this.plugin.saveSettings();
				this.display();
			});

			// Down button
			const downBtn = itemEl.createEl('button', { text: '↓', cls: 'dtf-group-move-down' });
			downBtn.disabled = index === ordered.length - 1;
			downBtn.addEventListener('click', async () => {
				const newOrder = [...ordered];
				[newOrder[index + 1], newOrder[index]] = [newOrder[index], newOrder[index + 1]];
				this.plugin.settings.groupPrecedence = newOrder;
				await this.plugin.saveSettings();
				this.display();
			});
		});
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
		// Section wrapper — gives the heading a top divider so non-first
		// sections are visually separated. Uses the same divider class
		// applied to import/export below so all major sections share rhythm.
		const section = containerEl.createDiv({ cls: 'dtf-section-divider' });

		new Setting(section).setName('Mapping rules').setHeading();

		// Idiomatic Obsidian pattern: section heading above, then a Setting
		// row with description on the left and the primary action on the
		// right. F2 — second CTA "New template rule" opens the advanced editor
		// directly in template mode for users who want the Path Lens
		// authoring path without the guided detour.
		new Setting(section)
			.setName('Create new rule')
			.setDesc('Define rules for mapping between folders and tags. Lower priority numbers are evaluated first.')
			.addButton(btn => {
				btn
					.setButtonText('New template rule')
					.setTooltip('Open the advanced editor in template mode — author with named slots like Projects/{topic} (Path Lens, F2)')
					.onClick(() => this.openRuleEditor(null));
				// Stable e2e hook (matches dtf-add-rule-button pattern).
				btn.buttonEl.addClass('dtf-add-template-rule-button');
			})
			.addButton(btn => {
				btn
					.setButtonText('Add rule')
					.setCta()
					.onClick(() => this.openGuidedRuleEditor());
				// Stable e2e hook — test/specs/typed-model.e2e.ts queries
				// .dtf-add-rule-button to drive the openGuided helper. The
				// class no longer carries styling (Setting().addButton()
				// renders the visual), but the test selector relies on it.
				btn.buttonEl.addClass('dtf-add-rule-button');
			});

		// Rule list — sits inside the section so the divider visually
		// scopes the whole "rules" block, not just the heading row.
		const ruleListContainer = section.createDiv({ cls: 'dtf-rule-list' });
		this.displayRuleList(ruleListContainer);

		// Clear all rules — small QA reset button, only visible when there
		// are rules to clear. Routes through ConfirmModal so accidental
		// clicks don't nuke the user's rule list.
		const ruleCount = this.plugin.settings.rules?.length ?? 0;
		if (ruleCount > 0) {
			new Setting(section)
				.setName('Reset rules')
				.setDesc(`Remove all ${ruleCount} rule${ruleCount === 1 ? '' : 's'}. Useful for re-testing scan-vault detection from a clean slate.`)
				.addButton(btn => btn
					.setButtonText('Clear all rules')
					.setWarning()
					.onClick(() => {
						new ConfirmModal(this.app, {
							title: 'Clear all rules?',
							body: `This will remove all ${ruleCount} rule${ruleCount === 1 ? '' : 's'}. You can re-import from a rule pack or scan again afterwards.`,
							confirmLabel: 'Clear all',
							destructive: true,
							onConfirm: () => {
								this.plugin.settings.rules = [];
								void this.plugin.saveSettings().then(() => {
									this.display();
									new Notice('All rules cleared');
								});
							},
						}).open();
					})
				);
		}
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

		// Invalid regex — render a clear error instead of a misleading
		// "0 matches" panel. Click-edit the rule to fix.
		if (preview.invalidRegex) {
			const err = panel.createDiv({ cls: 'dtf-preview-error' });
			err.style.color = 'var(--text-error)';
			err.style.padding = '0.4em 0';
			err.setText(
				`Invalid ${preview.invalidRegex.which} regex: ${preview.invalidRegex.error}. Edit the rule to fix.`,
			);
			return;
		}

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

		// "Just imported, review and enable" banner — appears after a scan-apply
		// and persists until dismissed. Imported rules ship disabled per the
		// safety mode (see openDetectVault). Banner gives the user one click to
		// "Enable all just-imported", or per-rule via the inline toggle below.
		if (this.lastImportedRuleIds.length > 0) {
			const banner = containerEl.createDiv({ cls: 'dtf-import-banner' });
			banner.style.padding = '0.7em 0.9em';
			banner.style.background = 'var(--background-modifier-form-field)';
			banner.style.borderLeft = '3px solid var(--interactive-accent)';
			banner.style.borderRadius = '4px';
			banner.style.marginBottom = '0.8em';
			banner.style.display = 'flex';
			banner.style.flexWrap = 'wrap';
			banner.style.gap = '0.6em';
			banner.style.alignItems = 'center';
			banner.style.justifyContent = 'space-between';

			const text = banner.createDiv();
			text.style.flex = '1 1 60%';
			const heading = text.createDiv();
			heading.style.fontWeight = '600';
			heading.setText(`${this.lastImportedRuleIds.length} rule(s) just imported — disabled by default`);
			const sub = text.createDiv();
			sub.style.fontSize = '0.85em';
			sub.style.color = 'var(--text-muted)';
			sub.setText('Review them below, then enable. Imports stay paused until you flip the toggle.');

			const actions = banner.createDiv();
			actions.style.display = 'flex';
			actions.style.gap = '0.4em';

			const enableAllBtn = actions.createEl('button', { text: 'Enable all just-imported' });
			enableAllBtn.addClass('mod-cta');
			enableAllBtn.addEventListener('click', () => {
				const ids = new Set(this.lastImportedRuleIds);
				for (const r of this.plugin.settings.rules) {
					if (ids.has(r.id)) r.enabled = true;
				}
				this.lastImportedRuleIds = [];
				void this.plugin.saveSettings().then(() => this.display());
			});

			const dismissBtn = actions.createEl('button', { text: 'Dismiss' });
			dismissBtn.addEventListener('click', () => {
				this.lastImportedRuleIds = [];
				this.display();
			});
		}

		// Bulk + group enable/disable controls — surfaces above the rule list.
		// Bulk: enable/disable ALL rules in one click. Group: per-group buttons
		// that scope to the rules sharing a `group` field (set by the loader
		// per F1 Step 3 — usually the source pack's id).
		const bulkBar = containerEl.createDiv({ cls: 'dtf-bulk-controls' });
		bulkBar.style.display = 'flex';
		bulkBar.style.flexWrap = 'wrap';
		bulkBar.style.gap = '0.4em';
		bulkBar.style.marginBottom = '0.6em';
		bulkBar.style.padding = '0.4em 0.6em';
		bulkBar.style.background = 'var(--background-secondary)';
		bulkBar.style.borderRadius = '4px';
		bulkBar.style.alignItems = 'center';

		const bulkLabel = bulkBar.createSpan();
		bulkLabel.setText('Bulk:');
		bulkLabel.style.fontSize = '0.85em';
		bulkLabel.style.color = 'var(--text-muted)';
		bulkLabel.style.marginRight = '0.2em';

		const enableAllBulkBtn = bulkBar.createEl('button', { text: 'Enable all' });
		enableAllBulkBtn.addEventListener('click', () => {
			for (const r of this.plugin.settings.rules) r.enabled = true;
			void this.plugin.saveSettings().then(() => this.display());
		});

		const disableAllBulkBtn = bulkBar.createEl('button', { text: 'Disable all' });
		disableAllBulkBtn.addEventListener('click', () => {
			for (const r of this.plugin.settings.rules) r.enabled = false;
			void this.plugin.saveSettings().then(() => this.display());
		});

		// Per-group buttons. Group rules by their `group` field; ungrouped
		// rules go under '__default__' (matches loader behavior).
		const groupCounts = new Map<string, { total: number; enabled: number }>();
		for (const r of this.plugin.settings.rules) {
			const g = r.group ?? '__default__';
			const cur = groupCounts.get(g) ?? { total: 0, enabled: 0 };
			cur.total++;
			if (r.enabled) cur.enabled++;
			groupCounts.set(g, cur);
		}

		if (groupCounts.size > 1) {
			// Decorative pipe divider kept as its own span so the "Groups:"
			// label remains a sentence-cased standalone word (parallels "Bulk:").
			const groupDivider = bulkBar.createSpan();
			groupDivider.setText(' | ');
			groupDivider.style.fontSize = '0.85em';
			groupDivider.style.color = 'var(--text-muted)';
			groupDivider.style.marginLeft = '0.5em';

			const groupSep = bulkBar.createSpan();
			groupSep.setText('Groups:');
			groupSep.style.fontSize = '0.85em';
			groupSep.style.color = 'var(--text-muted)';
			groupSep.style.marginRight = '0.2em';

			for (const [groupName, counts] of [...groupCounts.entries()].sort((a, b) =>
				a[0].localeCompare(b[0]),
			)) {
				const allEnabled = counts.enabled === counts.total;
				const groupBtn = bulkBar.createEl('button', {
					text: `${allEnabled ? '✗' : '✓'} ${groupName === '__default__' ? '(ungrouped)' : groupName} (${counts.enabled}/${counts.total})`,
				});
				groupBtn.title = allEnabled
					? `Disable all rules in group "${groupName}"`
					: `Enable all rules in group "${groupName}"`;
				groupBtn.addEventListener('click', () => {
					for (const r of this.plugin.settings.rules) {
						const g = r.group ?? '__default__';
						if (g === groupName) r.enabled = !allEnabled;
					}
					void this.plugin.saveSettings().then(() => this.display());
				});
			}
		}

		// Sort rules by priority
		const sortedRules = [...this.plugin.settings.rules].sort((a, b) => a.priority - b.priority);

		sortedRules.forEach((rule, index) => {
			const ruleItem = containerEl.createDiv({
				cls: `dtf-rule-item ${rule.enabled ? '' : 'disabled'}`
			});
			// Stable hook for the Map → Settings "focus this rule" scroll-to.
			ruleItem.dataset.dtfRuleId = rule.id;

			// Rule header
			const ruleHeader = ruleItem.createDiv({ cls: 'dtf-rule-header' });

			const nameContainer = ruleHeader.createDiv();
			nameContainer.style.display = 'flex';
			nameContainer.style.alignItems = 'center';
			nameContainer.style.gap = '0.5em';

			// Inline enable/disable toggle — no need to open the editor.
			// Stable e2e selector: dtf-rule-enable-toggle.
			const enableToggle = nameContainer.createEl('input', {
				type: 'checkbox',
				cls: 'dtf-rule-enable-toggle',
			}) as HTMLInputElement;
			enableToggle.checked = rule.enabled !== false;
			enableToggle.title = enableToggle.checked
				? 'Disable this rule (sync events stop firing)'
				: 'Enable this rule (sync events fire again)';
			enableToggle.addEventListener('click', (e) => {
				e.stopPropagation(); // don't open the rule editor
				rule.enabled = enableToggle.checked;
				void this.plugin.saveSettings().then(() => this.display());
			});

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
				this.routeRuleEdit(rule);
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

	/**
	 * Open the Detect-mode modal — scans the vault, runs detection against
	 * the bundled rule-packs, lists matches with Apply buttons.
	 */
	private openDetectVault() {
		const modal = new DetectVaultModal(this.app, async (newRules) => {
			// Append, skipping any rule whose id already exists in settings.
			// Force enabled=false on imported rules so scan-apply doesn't
			// auto-arm them for future file events. User reviews + enables.
			const existingIds = new Set(this.plugin.settings.rules.map((r) => r.id));
			const toAdd = newRules.filter((r) => !existingIds.has(r.id))
				.map(r => ({ ...r, enabled: false }));
			this.plugin.settings.rules = [...this.plugin.settings.rules, ...toAdd];
			// Track for the review-and-enable banner.
			this.lastImportedRuleIds = toAdd.map(r => r.id);
			await this.plugin.saveSettings();
			this.display();
		});
		modal.open();
	}

	/**
	 * Smart edit router — clicking an existing rule decides which editor
	 * to open based on whether the rule fits the typed model.
	 *
	 * Principle: ALWAYS default to guided. Whatever the rule looks like —
	 * fully typed, partially inferable, or pure regex — the guided form
	 * can hold it. Missing typed fields are defaulted (the user reviews +
	 * sets explicitly). The "Open in advanced (regex)" link inside the
	 * guided modal is the explicit escape hatch for users who need raw
	 * regex.
	 *
	 *   - rule has typed fields → guided edit, no banner
	 *   - rule has any inferable typed fields → guided edit + best-effort
	 *     banner explaining what was inferred / defaulted
	 *   - rule has nothing inferable (pure regex with weird shape) →
	 *     guided edit anyway, banner says "Couldn't infer — review every
	 *     field," and the Advanced link is right there
	 *
	 * The chooser modal is intentionally NOT used — adding a click before
	 * the user can edit a rule is friction that violates "always default
	 * to the better UX."
	 */
	private routeRuleEdit(rule: MappingRule): void {
		// Path C (F2) — Path Lens template-shaped rule. Round-trip via the
		// advanced editor in template mode; the guided modal's typed-spec
		// inference doesn't apply to templates and would surface a
		// misleading "Imported from regex" banner.
		if (rule.folderTemplate || rule.tagTemplate) {
			this.openRuleEditor(rule);
			return;
		}

		// Path A — explicit typed fields already present (rule was authored
		// via guided modal, or imported through the typed-spec path).
		if (rule.folder && rule.tag && rule.transfer) {
			this.openGuidedEditMode(rule, 'edit');
			return;
		}

		// Path B — anything else. Run inference at population time inside
		// the guided modal (populateFromRule already does this). The banner
		// communicates that some fields are best-effort imports.
		this.openGuidedEditMode(rule, 'edit-from-inferred');
	}

	/** Open guided in edit mode + handle save-by-id (replace existing). */
	private openGuidedEditMode(
		rule: MappingRule,
		kind: 'edit' | 'edit-from-inferred',
	): void {
		const modal = new GuidedRuleEditorModal(
			this.app,
			(updatedRule) => {
				if (updatedRule === null) {
					// Delete signal from the guided modal's Delete button.
					this.plugin.settings.rules = this.plugin.settings.rules.filter(
						(r) => r.id !== rule.id,
					);
					void this.plugin.saveSettings().then(() => this.display());
					return;
				}
				this.upsertRule(updatedRule);
			},
			{ kind, existingRule: rule },
			// Escape hatch — clicking "Open in advanced (regex)" inside the
			// guided modal closes guided and opens the legacy regex editor
			// against the same rule.
			(forwardedRule) => {
				this.openRuleEditor(forwardedRule);
			},
		);
		modal.open();
	}

	/** Replace by id; fall back to appending if no match. */
	private upsertRule(updated: MappingRule): void {
		const idx = this.plugin.settings.rules.findIndex((r) => r.id === updated.id);
		const rules = [...this.plugin.settings.rules];
		if (idx >= 0) {
			rules[idx] = updated;
		} else {
			rules.push(updated);
		}
		this.plugin.settings.rules = rules;
		void this.plugin.saveSettings().then(() => {
			this.display();
			new Notice(idx >= 0 ? `Rule "${updated.name}" updated` : `Rule "${updated.name}" added`);
		});
	}

	/**
	 * Open the guided rule editor — axis-first form with live derivation
	 * preview and a "test against vault" panel. Save persists the rule
	 * with full Layer 1 + Layer 2 fields populated by `deriveRule()`.
	 */
	private openGuidedRuleEditor() {
		const modal = new GuidedRuleEditorModal(
			this.app,
			(newRule) => {
				// Create-mode never receives null (no Delete button in create
				// mode). Guard for type safety.
				if (newRule === null) return;
				this.plugin.settings.rules = [...this.plugin.settings.rules, newRule];
				void this.plugin.saveSettings().then(() => {
					this.display();
					new Notice(`Rule "${newRule.name}" added`);
				});
			},
			undefined,
			// Escape hatch — the user can switch to the advanced editor at
			// any time, even before they've started filling fields. In
			// create mode the link forwards null (open advanced for a new
			// rule); openRuleEditor(null) handles the new-rule case.
			(forwardedRule) => {
				this.openRuleEditor(forwardedRule);
			},
		);
		modal.open();
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
			},
			// Symmetric escape hatch — clicking "Try guided" inside the
			// advanced modal closes advanced and opens the guided editor
			// (in edit-from-inferred mode) against the same rule. Only
			// available for existing rules; for `null` (new rule) the
			// guided editor has its own create flow.
			rule
				? (forwardedRule) => {
					this.openGuidedEditMode(forwardedRule, 'edit-from-inferred');
				}
				: undefined,
		);

		modal.open();
	}

	private displayImportExportSection(containerEl: HTMLElement) {
		// Same divider class as the Mapping rules section above; the
		// dtf-import-export class is preserved so the textarea-specific
		// child styles still apply.
		const section = containerEl.createDiv({ cls: 'dtf-section-divider dtf-import-export' });
		new Setting(section).setName('Import / export').setHeading();

		new Setting(section)
			.setName('Scan vault for organizational systems')
			.setDesc('Detect known organizational patterns already present in your vault and apply matching rule packs.')
			.addButton(btn => btn
				.setButtonText('Scan')
				.setCta()
				.onClick(() => {
					this.openDetectVault();
				})
			);

		new Setting(section)
			.setName('Browse bundled rule packs')
			.setDesc('Pick a pre-configured rule pack and import its rules into your settings.')
			.addButton(btn => btn
				.setButtonText('Browse')
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

		// Import — heading row + full-width textarea + right-aligned button
		// row. Setting() places name+desc on the left and controls on the
		// right of a single row, which crushes a textarea into ~30% of the
		// section width. Splitting into three rows lets the textarea use
		// the full available width.
		const importBlock = section.createDiv({ cls: 'dtf-import-block' });

		new Setting(importBlock)
			.setName('Import settings')
			.setDesc('Paste JSON settings to import (this will replace current settings)');

		const importTextarea = importBlock.createEl('textarea', {
			cls: 'dtf-import-textarea',
			attr: { placeholder: 'Paste JSON settings here' },
		});

		new Setting(importBlock)
			.addButton(btn => btn
				.setButtonText('Import')
				.setWarning()
				.onClick(() => {
					try {
						const json = importTextarea.value;
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
