/**
 * Guided rule editor — axis-first authoring with live derivation preview
 * AND a live "test against vault" panel.
 *
 * The user describes their mapping in library-science vocabulary:
 *   - which SEACOW axis is being classified
 *   - how the folder side is structured (classifier)
 *   - how the tag side is structured (vocabulary)
 *   - how structure transfers between them (8 transfer primitives)
 *
 * As the user types, three things update synchronously:
 *
 *   1. Derived Layer-1 fields rendered as code chips (folderPattern,
 *      tagPattern) plus colored badges (cardinality, bijective).
 *   2. "Test against my vault" panel — runs `previewRule()` against the
 *      vault's actual folder list, showing N matches + sample
 *      folder→tag(s) mappings. Updates per-keystroke.
 *   3. Inconsistency warnings — flash hints next to fields when the
 *      user picks a combination that contradicts itself (e.g.
 *      `marker-only` + `pre-coordinated`). Each warning offers a "Fix"
 *      affordance that auto-corrects.
 *
 * Validation: the Create button is disabled until `name`, `folderEntry`,
 * and `tagEntry` are non-empty. Tooltip lists missing fields.
 *
 * Keyboard: Enter saves (when enabled), Escape closes, Cmd/Ctrl+Enter
 * saves regardless of focus. Tab order follows visual order.
 */

import { App, Modal, Setting, Notice, TFolder } from 'obsidian';
import type { MappingRule, RuleOptions, RuleDirection, TransformConfig } from '../types/settings';
import type {
	Axis,
	FolderScheme,
	FolderNaming,
	TagCoordination,
	TagPrefixMarker,
	TransferOp,
	TypedRuleSpec,
	TruncationTailHandling,
} from '../types/typed';
import { deriveRule } from '../engine/derive';
import { previewRule } from '../engine/rulePreview';

// ─── Form state ──────────────────────────────────────────────────────────

interface FormState {
	id: string;
	name: string;
	description: string;
	priority: number;
	direction: RuleDirection;
	enabled: boolean;

	axis: Axis;

	folderEntry: string;
	folderScheme: FolderScheme;
	folderNaming: FolderNaming;

	tagEntry: string;
	tagCoordination: TagCoordination;
	tagPrefixMarker: TagPrefixMarker;

	// Transfer op + per-op sub-options (only the relevant ones are read at save time)
	transferOp: TransferOp['op'];
	truncationDepth: number;
	truncationTailHandling: TruncationTailHandling;
	truncationSeparator: string;
	markerOnlyMarker: string;
	aggregationSeparator: string;
}

const DEFAULT_OPTIONS: RuleOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

function defaultFormState(): FormState {
	return {
		id: `rule-${Date.now()}`,
		name: '',
		description: '',
		priority: 100,
		direction: 'bidirectional',
		enabled: true,
		axis: 'work',
		folderEntry: '',
		folderScheme: 'enumerative',
		folderNaming: 'word',
		tagEntry: '',
		tagCoordination: 'pre-coordinated',
		tagPrefixMarker: null,
		transferOp: 'identity',
		truncationDepth: 2,
		truncationTailHandling: 'drop',
		truncationSeparator: '-',
		markerOnlyMarker: '-inbox',
		aggregationSeparator: '-',
	};
}

// ─── Form → TypedRuleSpec → MappingRule (pure) ───────────────────────────

function buildTransferOp(state: FormState): TransferOp {
	switch (state.transferOp) {
		case 'identity':
			return { op: 'identity' };
		case 'truncation':
			return {
				op: 'truncation',
				depth: state.truncationDepth,
				tailHandling: state.truncationTailHandling,
				separator: state.truncationSeparator || '-',
			};
		case 'marker-only':
			return { op: 'marker-only', marker: state.markerOnlyMarker };
		case 'promotion-to-root':
			return { op: 'promotion-to-root' };
		case 'flattening-to-leaf':
			return { op: 'flattening-to-leaf' };
		case 'aggregation':
			return { op: 'aggregation', separator: state.aggregationSeparator || '-' };
		case 'post-coordination':
			return { op: 'post-coordination' };
		case 'opaque':
			return { op: 'opaque' };
	}
}

function buildSpec(state: FormState): TypedRuleSpec {
	const transfer = buildTransferOp(state);
	return {
		id: state.id,
		name: state.name || '(unnamed rule)',
		description: state.description || undefined,
		priority: state.priority,
		direction: state.direction,
		enabled: state.enabled,
		folder: {
			axes: [state.axis],
			scheme: state.folderScheme,
			naming: state.folderNaming,
			subdivisionDepth: 'unbounded',
			siblingUniformity: 'unique',
		},
		tag: {
			axis: state.axis,
			coordination: state.tagCoordination,
			prefixMarker: state.tagPrefixMarker,
			authority:
				state.direction === 'bidirectional'
					? 'mutual'
					: state.direction === 'folder-to-tag'
						? 'folder-authoritative'
						: 'tag-authoritative',
		},
		transfer,
		inverseTransfer: transfer,
		folderEntry: state.folderEntry || '(empty)',
		tagEntry: state.tagEntry || '(empty)',
		options: { ...DEFAULT_OPTIONS },
	};
}

// ─── Inconsistency detection ─────────────────────────────────────────────

interface Warning {
	field: 'tagCoordination' | 'transferOp' | 'tagEntry' | 'folderEntry';
	message: string;
	fix?: { label: string; apply: (state: FormState) => void };
}

function detectWarnings(state: FormState): Warning[] {
	const out: Warning[] = [];

	if (state.transferOp === 'marker-only' && state.tagCoordination === 'pre-coordinated') {
		out.push({
			field: 'tagCoordination',
			message:
				"marker-only emits a single fixed term — pre-coordination is contradictory. Use flat-keyword.",
			fix: {
				label: 'Set to flat-keyword',
				apply: (s) => {
					s.tagCoordination = 'flat-keyword';
				},
			},
		});
	}

	if (state.transferOp === 'post-coordination' && state.tagCoordination !== 'post-coordinated') {
		out.push({
			field: 'tagCoordination',
			message:
				'post-coordination transfer should pair with post-coordinated tag vocabulary.',
			fix: {
				label: 'Set to post-coordinated',
				apply: (s) => {
					s.tagCoordination = 'post-coordinated';
				},
			},
		});
	}

	if (state.tagEntry && state.tagPrefixMarker && !state.tagEntry.startsWith(state.tagPrefixMarker)) {
		out.push({
			field: 'tagEntry',
			message: `Tag entry should include its prefix marker "${state.tagPrefixMarker}".`,
			fix: {
				label: `Prepend "${state.tagPrefixMarker}"`,
				apply: (s) => {
					s.tagEntry = `${s.tagPrefixMarker}${s.tagEntry.replace(/^[/_-]+/, '')}`;
				},
			},
		});
	}

	return out;
}

function isFormValid(state: FormState): { valid: boolean; missing: string[] } {
	const missing: string[] = [];
	if (!state.name.trim()) missing.push('name');
	if (!state.folderEntry.trim()) missing.push('folder entry');
	if (!state.tagEntry.trim()) missing.push('tag entry');
	return { valid: missing.length === 0, missing };
}

// ─── Modal ───────────────────────────────────────────────────────────────

export class GuidedRuleEditorModal extends Modal {
	private state: FormState;
	private readonly onSave: (rule: MappingRule) => void;

	// Cache vault folders once on open — re-computing per keystroke would be
	// painful on large vaults. Folders rarely change mid-edit.
	private vaultFolders: string[] = [];

	// DOM refs for live updates
	private derivedChipsEl!: HTMLElement;
	private vaultTestEl!: HTMLElement;
	private warningsEl!: HTMLElement;
	private transferSubOptionsEl!: HTMLElement;
	private saveBtn!: HTMLButtonElement;

	constructor(app: App, onSave: (rule: MappingRule) => void) {
		super(app);
		this.state = defaultFormState();
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		this.collectVaultFolders();

		new Setting(contentEl).setName('Create rule (guided)').setHeading();

		this.buildBasicSection(contentEl);
		this.buildAxisSection(contentEl);
		this.buildFolderSection(contentEl);
		this.buildTagSection(contentEl);
		this.buildTransferSection(contentEl);
		this.buildLivePreviewSection(contentEl);
		this.buildActions(contentEl);
		this.bindKeyboard();

		this.notify();
	}

	private collectVaultFolders(): void {
		const out: string[] = [];
		const walk = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					out.push(child.path);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());
		this.vaultFolders = out;
	}

	/** The reactive heartbeat — every field change calls this. */
	private notify(): void {
		this.renderDerivedChips();
		this.renderVaultTest();
		this.renderWarnings();
		this.updateSaveButtonState();
	}

	// ─── Sections ────────────────────────────────────────────────────────

	private buildBasicSection(parent: HTMLElement): void {
		new Setting(parent).setName('Basic').setHeading();

		new Setting(parent)
			.setName('Rule name')
			.setDesc('Short label shown in the rule list')
			.addText((t) =>
				t.setPlaceholder('Short label for this rule').setValue(this.state.name).onChange((v) => {
					this.state.name = v;
					this.notify();
				}),
			);

		new Setting(parent)
			.setName('Priority')
			.setDesc('Lower number runs first')
			.addText((t) =>
				t.setValue(String(this.state.priority)).onChange((v) => {
					const n = parseInt(v, 10);
					if (!Number.isNaN(n) && n >= 0) {
						this.state.priority = n;
						this.notify();
					}
				}),
			);

		new Setting(parent)
			.setName('Direction')
			.addDropdown((d) =>
				d
					.addOption('bidirectional', 'Bidirectional')
					.addOption('folder-to-tag', 'Folder → tag')
					.addOption('tag-to-folder', 'Tag → folder')
					.setValue(this.state.direction)
					.onChange((v) => {
						this.state.direction = v as RuleDirection;
						this.notify();
					}),
			);
	}

	private buildAxisSection(parent: HTMLElement): void {
		new Setting(parent).setName('Axis').setHeading();
		new Setting(parent)
			.setName('Which axis does this rule classify?')
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- SEACOW is the framework name; preserving its all-caps style
			.setDesc('SEACOW axes — see the concepts documentation for details on each')
			.addDropdown((d) =>
				d
					.addOption('work', 'Work — active processing')
					.addOption('output', 'Output — publishable, external-facing')
					.addOption('capture', 'Capture — ingestion, inbox, clippings')
					.addOption('entity', 'Entity — workspace owner, authority')
					.addOption('system', 'System — platform, config, templates')
					.addOption('relation', 'Relation — flat cross-link keywords')
					.setValue(this.state.axis)
					.onChange((v) => {
						this.state.axis = v as Axis;
						this.notify();
					}),
			);
	}

	private buildFolderSection(parent: HTMLElement): void {
		new Setting(parent).setName('Folder side').setHeading();

		new Setting(parent)
			.setName('Folder entry path')
			.setDesc('Root path under which this rule applies — e.g. Projects, Capture/Inbox')
			.addText((t) =>
				t.setPlaceholder('e.g. Capture/Inbox').setValue(this.state.folderEntry).onChange((v) => {
					this.state.folderEntry = v;
					this.notify();
				}),
			);

		new Setting(parent)
			.setName('Classification scheme')
			.setDesc('How this folder structures its content')
			.addDropdown((d) =>
				d
					.addOption('hierarchical', 'Hierarchical — deep subject tree')
					.addOption('enumerative', 'Enumerative — numbered siblings')
					.addOption('faceted', 'Faceted — independent sub-axes')
					.addOption('authority-root', 'Authority root — per-entity workspace')
					.addOption('container-only', 'Container only — groups but does not classify')
					.setValue(this.state.folderScheme)
					.onChange((v) => {
						this.state.folderScheme = v as FolderScheme;
						this.notify();
					}),
			);

		new Setting(parent)
			.setName('Naming convention')
			.addDropdown((d) =>
				d
					.addOption('word', 'Word')
					.addOption('ordinal', 'Ordinal — numeric prefix')
					.addOption('symbol-prefixed', 'Symbol-prefixed')
					.addOption('emoji-prefixed', 'Emoji-prefixed')
					.addOption('mixed', 'Mixed')
					.setValue(this.state.folderNaming)
					.onChange((v) => {
						this.state.folderNaming = v as FolderNaming;
						this.notify();
					}),
			);
	}

	private buildTagSection(parent: HTMLElement): void {
		new Setting(parent).setName('Tag side').setHeading();

		new Setting(parent)
			.setName('Tag entry')
			.setDesc('Tag prefix this rule emits — include any marker like -clip or --cybersader')
			.addText((t) =>
				t.setPlaceholder('-inbox').setValue(this.state.tagEntry).onChange((v) => {
					this.state.tagEntry = v;
					this.notify();
				}),
			);

		new Setting(parent)
			.setName('Coordination')
			.setDesc('How concepts combine in this tag family')
			.addDropdown((d) =>
				d
					.addOption('pre-coordinated', 'Pre-coordinated — concepts fused in the term')
					.addOption('post-coordinated', 'Post-coordinated — concepts as separate tags')
					.addOption('flat-keyword', 'Flat keyword — single concept')
					.setValue(this.state.tagCoordination)
					.onChange((v) => {
						this.state.tagCoordination = v as TagCoordination;
						this.notify();
					}),
			);

		new Setting(parent)
			.setName('Prefix marker')
			// eslint-disable-next-line obsidianmd/ui/sentence-case -- SEACOW is the framework name
			.setDesc('SEACOW convention — slash for system, double-dash for entity, dash for capture, underscore for output, none for work')
			.addDropdown((d) =>
				d
					.addOption('null', 'None')
					.addOption('/', 'Slash — system')
					.addOption('--', 'Double-dash — entity')
					.addOption('-', 'Dash — capture')
					.addOption('_', 'Underscore — output')
					.addOption('', 'Empty string — work convention')
					.setValue(this.state.tagPrefixMarker === null ? 'null' : this.state.tagPrefixMarker)
					.onChange((v) => {
						this.state.tagPrefixMarker = v === 'null' ? null : (v as TagPrefixMarker);
						this.notify();
					}),
			);
	}

	private buildTransferSection(parent: HTMLElement): void {
		new Setting(parent).setName('Transfer operation').setHeading();

		new Setting(parent)
			.setName('How does folder structure become tag structure?')
			.setDesc('Eight library-science primitives for hierarchy transfer')
			.addDropdown((d) =>
				d
					.addOption('identity', 'Identity — preserve full depth')
					.addOption('truncation', 'Truncation — preserve some depth, configurable tail')
					.addOption('marker-only', 'Marker only — one fixed tag, ignores sub-path')
					.addOption('promotion-to-root', 'Promotion to root — first segment only')
					.addOption('flattening-to-leaf', 'Flattening to leaf — leaf segment only')
					.addOption('aggregation', 'Aggregation — entire path joined into one tag')
					.addOption('post-coordination', 'Post-coordination — many independent flat tags')
					.addOption('opaque', 'Opaque — emit no tag, clustering only')
					.setValue(this.state.transferOp)
					.onChange((v) => {
						this.state.transferOp = v as TransferOp['op'];
						this.renderTransferSubOptions();
						this.notify();
					}),
			);

		this.transferSubOptionsEl = parent.createDiv({ cls: 'dtf-guided-transfer-sub' });
		this.renderTransferSubOptions();
	}

	private renderTransferSubOptions(): void {
		this.transferSubOptionsEl.empty();
		const op = this.state.transferOp;

		if (op === 'truncation') {
			new Setting(this.transferSubOptionsEl)
				.setName('Depth')
				.setDesc('How many folder segments survive on the tag side')
				.addText((t) =>
					t.setValue(String(this.state.truncationDepth)).onChange((v) => {
						const n = parseInt(v, 10);
						if (!Number.isNaN(n) && n > 0) {
							this.state.truncationDepth = n;
							this.notify();
						}
					}),
				);

			new Setting(this.transferSubOptionsEl)
				.setName('Tail handling')
				.setDesc('What to do with folder segments beyond the depth cap')
				.addDropdown((d) =>
					d
						.addOption('drop', 'Drop — deeper paths reject the rule')
						.addOption('aggregate', 'Aggregate — join tail with separator')
						.addOption('flatten', 'Flatten — replace tail with leaf only')
						.setValue(this.state.truncationTailHandling)
						.onChange((v) => {
							this.state.truncationTailHandling = v as TruncationTailHandling;
							this.notify();
						}),
				);

			new Setting(this.transferSubOptionsEl)
				.setName('Separator')
				.setDesc('Used by aggregate tail handling')
				.addText((t) =>
					t.setValue(this.state.truncationSeparator).onChange((v) => {
						this.state.truncationSeparator = v;
						this.notify();
					}),
				);
		} else if (op === 'marker-only') {
			new Setting(this.transferSubOptionsEl)
				.setName('Marker')
				.setDesc('The literal tag to emit — exact match, never re-cased')
				.addText((t) =>
					t.setValue(this.state.markerOnlyMarker).onChange((v) => {
						this.state.markerOnlyMarker = v;
						this.notify();
					}),
				);
		} else if (op === 'aggregation') {
			new Setting(this.transferSubOptionsEl)
				.setName('Separator')
				.setDesc('Used to join all path segments into one tag segment')
				.addText((t) =>
					t.setValue(this.state.aggregationSeparator).onChange((v) => {
						this.state.aggregationSeparator = v;
						this.notify();
					}),
				);
		}
	}

	// ─── Live preview rendering ──────────────────────────────────────────

	private buildLivePreviewSection(parent: HTMLElement): void {
		new Setting(parent).setName('Live preview').setHeading();

		this.warningsEl = parent.createDiv({ cls: 'dtf-guided-warnings' });
		this.warningsEl.style.marginBottom = '0.5em';

		this.derivedChipsEl = parent.createDiv({ cls: 'dtf-guided-derived' });
		this.derivedChipsEl.style.padding = '0.75em';
		this.derivedChipsEl.style.background = 'var(--background-secondary)';
		this.derivedChipsEl.style.borderRadius = '4px';
		this.derivedChipsEl.style.fontSize = '0.85em';
		this.derivedChipsEl.style.marginBottom = '0.5em';

		this.vaultTestEl = parent.createDiv({ cls: 'dtf-guided-vault-test' });
		this.vaultTestEl.style.padding = '0.75em';
		this.vaultTestEl.style.background = 'var(--background-secondary)';
		this.vaultTestEl.style.borderRadius = '4px';
		this.vaultTestEl.style.fontSize = '0.85em';
	}

	private renderDerivedChips(): void {
		this.derivedChipsEl.empty();

		try {
			const spec = buildSpec(this.state);
			const rule = deriveRule(spec);

			const header = this.derivedChipsEl.createDiv();
			header.createEl('strong', { text: 'Derived patterns and transforms' });

			const grid = this.derivedChipsEl.createDiv();
			grid.style.marginTop = '0.4em';
			grid.style.display = 'grid';
			grid.style.gridTemplateColumns = '8em 1fr';
			grid.style.gap = '0.3em 0.7em';
			grid.style.fontFamily = 'var(--font-monospace)';

			const fieldRow = (label: string, value: string | undefined, isCode = true) => {
				grid.createSpan({ text: label, cls: 'dtf-guided-field-label' });
				if (value === undefined || value === '') {
					grid.createEl('em', { text: '(not used)' });
				} else if (isCode) {
					grid.createEl('code', { text: value });
				} else {
					grid.createSpan({ text: value });
				}
			};

			fieldRow('folderPattern', rule.folderPattern);
			fieldRow('tagPattern', rule.tagPattern);
			fieldRow('folderEntry', rule.folderEntryPoint);
			fieldRow('tagEntry', rule.tagEntryPoint);

			// Cardinality + bijective as colored badges
			const meta = this.derivedChipsEl.createDiv();
			meta.style.marginTop = '0.5em';
			meta.style.display = 'flex';
			meta.style.gap = '0.5em';
			meta.style.alignItems = 'center';

			const cardBadge = meta.createSpan({
				text: `cardinality: ${rule.cardinality ?? '?'}`,
			});
			cardBadge.style.padding = '0.15em 0.5em';
			cardBadge.style.borderRadius = '3px';
			cardBadge.style.fontSize = '0.8em';
			cardBadge.style.background =
				rule.cardinality === '1:1' ? 'var(--color-green)' : 'var(--color-yellow)';
			cardBadge.style.color = 'var(--text-on-accent)';

			const bijBadge = meta.createSpan({
				text: rule.bijective ? 'bijective ✓' : 'lossy',
			});
			bijBadge.style.padding = '0.15em 0.5em';
			bijBadge.style.borderRadius = '3px';
			bijBadge.style.fontSize = '0.8em';
			bijBadge.style.background = rule.bijective ? 'var(--color-green)' : 'var(--color-red)';
			bijBadge.style.color = 'var(--text-on-accent)';
			if (!rule.bijective) {
				bijBadge.title =
					'This rule cannot perfectly reconstruct the original folder structure from the emitted tag. Some information is lost by design.';
			}
		} catch (err) {
			this.derivedChipsEl.createEl('em', {
				text: `Derivation error: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	private renderVaultTest(): void {
		this.vaultTestEl.empty();

		const header = this.vaultTestEl.createDiv();
		header.createEl('strong', { text: 'Test against your vault' });

		try {
			const spec = buildSpec(this.state);
			const rule = deriveRule(spec);
			const preview = previewRule(rule, this.vaultFolders, { maxSamples: 5 });

			const summary = this.vaultTestEl.createDiv();
			summary.style.marginTop = '0.4em';

			if (preview.opaqueByDesign) {
				summary.setText(
					`${preview.matchCount} folder(s) match — this rule is opaque and deliberately emits no tag.`,
				);
			} else if (preview.matchCount === 0) {
				summary.createEl('em', {
					text: 'No vault folders match yet. Either the entry path doesn\'t exist or the pattern is too restrictive.',
				});
				return;
			} else {
				summary.setText(
					`${preview.matchCount} folder(s) match → ${preview.emittedTags.length} distinct tag(s).`,
				);
			}

			if (preview.emittedTags.length > 0) {
				const tagsBlock = this.vaultTestEl.createDiv();
				tagsBlock.style.marginTop = '0.4em';
				tagsBlock.createSpan({ text: 'Tags: ' });
				const capped = preview.emittedTags.slice(0, 8);
				for (const t of capped) {
					const chip = tagsBlock.createEl('code', { text: t });
					chip.style.marginRight = '0.4em';
				}
				if (preview.emittedTags.length > 8) {
					tagsBlock.createSpan({ text: ` (+${preview.emittedTags.length - 8} more)` });
				}
			}

			if (preview.samples.length > 0) {
				const samplesBlock = this.vaultTestEl.createDiv();
				samplesBlock.style.marginTop = '0.4em';
				samplesBlock.createDiv({ text: 'Samples:' });
				const list = samplesBlock.createEl('ul');
				list.style.marginTop = '0.2em';
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
		} catch (err) {
			this.vaultTestEl.createEl('em', {
				text: `Preview error: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	private renderWarnings(): void {
		this.warningsEl.empty();
		const warnings = detectWarnings(this.state);
		if (warnings.length === 0) return;

		for (const w of warnings) {
			const row = this.warningsEl.createDiv({ cls: 'dtf-guided-warning' });
			row.style.padding = '0.5em 0.75em';
			row.style.background = 'var(--color-yellow)';
			row.style.color = 'var(--text-on-accent)';
			row.style.borderRadius = '4px';
			row.style.marginBottom = '0.3em';
			row.style.display = 'flex';
			row.style.gap = '0.5em';
			row.style.alignItems = 'center';
			row.style.justifyContent = 'space-between';

			const msg = row.createSpan({ text: `⚠ ${w.message}` });
			msg.style.flex = '1';

			if (w.fix) {
				const fixBtn = row.createEl('button', { text: w.fix.label });
				fixBtn.addEventListener('click', () => {
					w.fix!.apply(this.state);
					// Re-render the entire modal — fix may need to update a dropdown's
					// shown value and that requires re-binding. Cheaper than per-field refs.
					this.onOpen();
				});
			}
		}
	}

	// ─── Validation + actions ────────────────────────────────────────────

	private updateSaveButtonState(): void {
		if (!this.saveBtn) return;
		const v = isFormValid(this.state);
		this.saveBtn.disabled = !v.valid;
		this.saveBtn.title = v.valid ? '' : `Missing: ${v.missing.join(', ')}`;
		this.saveBtn.style.opacity = v.valid ? '1' : '0.5';
	}

	private buildActions(parent: HTMLElement): void {
		const actions = parent.createDiv({ cls: 'dtf-guided-actions' });
		actions.style.display = 'flex';
		actions.style.gap = '0.5em';
		actions.style.justifyContent = 'flex-end';
		actions.style.marginTop = '1em';

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.saveBtn = actions.createEl('button', { text: 'Create rule', cls: 'mod-cta' });
		this.saveBtn.addEventListener('click', () => this.attemptSave());
	}

	private attemptSave(): void {
		const v = isFormValid(this.state);
		if (!v.valid) {
			new Notice(`Cannot save — fill in: ${v.missing.join(', ')}`);
			return;
		}
		try {
			const spec = buildSpec(this.state);
			const rule = deriveRule(spec);
			this.onSave(rule);
			new Notice(`Rule "${rule.name}" created`);
			this.close();
		} catch (err) {
			new Notice(`Cannot create rule: ${err instanceof Error ? err.message : String(err)}`);
		}
	}

	private bindKeyboard(): void {
		// Cmd/Ctrl+Enter = save (works regardless of focus)
		// Plain Enter inside an input also saves (when valid)
		// Escape closes
		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});
		this.scope.register(['Mod'], 'Enter', () => {
			this.attemptSave();
			return false;
		});
		// Plain Enter in any text input also triggers save
		this.contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.isComposing && !e.metaKey && !e.ctrlKey) {
				const target = e.target as HTMLElement;
				// Only fire on text inputs, not textareas or buttons
				if (target instanceof HTMLInputElement && target.type === 'text') {
					e.preventDefault();
					this.attemptSave();
				}
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
