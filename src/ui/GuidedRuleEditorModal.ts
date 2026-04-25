/**
 * Guided rule editor — axis-first authoring with PRINCIPLED visual structure.
 *
 * Layout reflects the principle "two sides, independently typed, then mapped":
 *
 *   ┌─────── live preview strip ─────────┐  ← what the rule will DO,
 *   │ folder/path/sample.md → #tag        │    visible at top before any input
 *   └─────────────────────────────────────┘
 *
 *   ┌─────── status strip ──────────────────┐
 *   │ N folders match · K tags · 1:1 · ✓    │
 *   └───────────────────────────────────────┘
 *
 *   Basic info (compact)
 *
 *   Axis selector — 6 SEACOW tiles with prefix-marker shown
 *
 *   ┌── FOLDER SIDE ──┐ ┌─TRANSFER─┐ ┌── TAG SIDE ──┐
 *   │ entry, scheme,  │ │  ↓ cards │ │ entry, coord │
 *   │ naming          │ │  4×2     │ │              │
 *   └─────────────────┘ └──────────┘ └──────────────┘
 *
 *   Inconsistency warnings (when present)
 *
 *   Disclosures: Sample mappings · Derived regex
 *
 *   Action buttons
 *
 * As the user fills the form, every panel updates synchronously. Save
 * compiles the typed spec via deriveRule() and persists the full
 * MappingRule (Layer 1 + Layer 2). Cancel discards.
 */

import { App, Modal, Setting, Notice, TFolder } from 'obsidian';
import type { MappingRule, RuleOptions, RuleDirection } from '../types/settings';
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

// ─── Library-science conventions ─────────────────────────────────────────

/** SEACOW prefix-marker convention per docs/concepts/axes.md */
const AXIS_CONVENTIONS: Record<
	Axis,
	{ label: string; marker: TagPrefixMarker; description: string }
> = {
	system: { label: 'System', marker: '/', description: 'Platform, config, templates' },
	entity: { label: 'Entity', marker: '--', description: 'Workspace owner, authority' },
	capture: { label: 'Capture', marker: '-', description: 'Ingestion, inbox, clippings' },
	output: { label: 'Output', marker: '_', description: 'Publishable, external-facing' },
	work: { label: 'Work', marker: null, description: 'Active processing (PARA, JD)' },
	relation: { label: 'Relation', marker: null, description: 'Flat cross-link keywords' },
};

/** Per-op mini-diagram for the card grid. Sample input: `A/B/C/D` */
const OP_DIAGRAMS: Record<TransferOp['op'], { gloss: string; output: string }> = {
	identity: { gloss: 'preserve full depth', output: '#a/b/c/d' },
	truncation: { gloss: 'preserve N levels', output: '#a/b/c (drop)' },
	'marker-only': { gloss: 'one fixed tag', output: '#-marker' },
	'promotion-to-root': { gloss: 'first level only', output: '#a' },
	'flattening-to-leaf': { gloss: 'leaf level only', output: '#d' },
	aggregation: { gloss: 'compress all', output: '#a-b-c-d' },
	'post-coordination': { gloss: 'split into N flat tags', output: '#a #b #c #d' },
	opaque: { gloss: 'no tag emitted', output: '(none)' },
};

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
		// Pass raw entry strings — no '(empty)' substitution. Empty entries
		// produce loose patterns the live preview can detect and gate on.
		folderEntry: state.folderEntry,
		tagEntry: state.tagEntry,
		options: { ...DEFAULT_OPTIONS },
	};
}

/**
 * Both folder and tag entries must be non-empty before live derivation
 * makes sense. Empty entries produce vacuous patterns (e.g. `^/`) that
 * pollute the preview output. The status strip + live preview should
 * gate on this and show a "fill in entry paths" hint instead.
 */
function entriesPopulated(state: FormState): boolean {
	return state.folderEntry.trim() !== '' && state.tagEntry.trim() !== '';
}

// ─── Inconsistency detection ─────────────────────────────────────────────

interface Warning {
	field: string;
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
	private vaultFolders: string[] = [];

	// DOM refs for live updates
	private livePreviewEl!: HTMLElement;
	private statusStripEl!: HTMLElement;
	private warningsEl!: HTMLElement;
	private vaultTestEl!: HTMLElement;
	private derivedChipsEl!: HTMLElement;
	private transferCardsEl!: HTMLElement;
	private transferSubOptionsEl!: HTMLElement;
	private axisTilesEl!: HTMLElement;
	private saveBtn!: HTMLButtonElement;

	constructor(app: App, onSave: (rule: MappingRule) => void) {
		super(app);
		this.state = defaultFormState();
		this.onSave = onSave;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('dtf-guided-modal');
		// Wider modal — layout is two/three columns, needs the room
		modalEl.style.width = 'min(900px, 95vw)';

		this.collectVaultFolders();

		// 1. Title
		new Setting(contentEl).setName('Create rule (guided)').setHeading();

		// 2. Live preview strip — at the TOP so the user sees output before inputs
		this.buildLivePreviewStrip(contentEl);

		// 3. Status strip — match count + cardinality + bijective
		this.buildStatusStrip(contentEl);

		// 4. Compact basic row
		this.buildBasicRow(contentEl);

		// 5. Axis tile selector — 6 SEACOW tiles
		this.buildAxisSection(contentEl);

		// 6. Two-column folder | tag split (transfer ops are below in their own row)
		this.buildSplitPanel(contentEl);

		// 7. Transfer op cards — 4×2 grid of selectable mini-diagrams
		this.buildTransferCards(contentEl);

		// 8. Inconsistency warnings (renders only when present)
		this.warningsEl = contentEl.createDiv({ cls: 'dtf-guided-warnings' });

		// 9. Vault test (sample mappings) + derived regex (collapsible)
		this.buildDisclosureSections(contentEl);

		// 10. Action buttons
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

	/** Reactive heartbeat — every field change calls this. */
	private notify(): void {
		this.renderLivePreview();
		this.renderStatusStrip();
		this.renderTransferCards();
		this.renderAxisTiles();
		this.renderWarnings();
		this.renderVaultTest();
		this.renderDerivedChips();
		this.updateSaveButtonState();
	}

	// ─── 2. Live preview strip ───────────────────────────────────────────

	private buildLivePreviewStrip(parent: HTMLElement): void {
		const strip = parent.createDiv({ cls: 'dtf-guided-live-preview' });
		strip.style.padding = '0.6em 0.75em';
		strip.style.background = 'var(--background-modifier-cover)';
		strip.style.borderRadius = '6px';
		strip.style.marginBottom = '0.6em';
		strip.style.fontFamily = 'var(--font-monospace)';
		strip.style.fontSize = '0.95em';
		this.livePreviewEl = strip;
	}

	private renderLivePreview(): void {
		this.livePreviewEl.empty();
		const header = this.livePreviewEl.createDiv();
		header.createEl('strong', { text: 'Live preview' });
		header.style.fontFamily = 'var(--font-interface)';
		header.style.fontSize = '0.75em';
		header.style.opacity = '0.7';
		header.style.textTransform = 'uppercase';
		header.style.letterSpacing = '0.05em';
		header.style.marginBottom = '0.3em';

		const row = this.livePreviewEl.createDiv();
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '0.5em';
		row.style.flexWrap = 'wrap';

		// Gate on both entries being populated. Vacuous patterns (empty
		// entry → loose match-anything regex) produce nonsense previews.
		if (!entriesPopulated(this.state)) {
			const missing: string[] = [];
			if (!this.state.folderEntry.trim()) missing.push('folder entry');
			if (!this.state.tagEntry.trim()) missing.push('tag entry');
			row.createEl('em', {
				text: `Fill ${missing.join(' and ')} to see what this rule will do`,
			});
			return;
		}

		try {
			const spec = buildSpec(this.state);
			const rule = deriveRule(spec);
			const preview = previewRule(rule, this.vaultFolders, { maxSamples: 1 });

			if (preview.samples.length > 0) {
				const sample = preview.samples[0];
				row.createEl('code', { text: sample.folder });
				row.createSpan({ text: ' → ' });
				if (sample.tags.length === 0) {
					row.createEl('em', { text: '(no tag — opaque)' });
				} else {
					sample.tags.forEach((t, i) => {
						if (i > 0) row.createSpan({ text: ' + ' });
						row.createEl('code', { text: t });
					});
				}
			} else if (preview.opaqueByDesign) {
				row.createEl('em', {
					text: 'Opaque rule — folders matched, no tag emitted',
				});
			} else {
				row.createEl('em', {
					text: `No vault folders match "${this.state.folderEntry}" yet. The path may not exist.`,
				});
			}
		} catch (err) {
			this.livePreviewEl.createEl('em', {
				text: `Cannot preview: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// ─── 3. Status strip ─────────────────────────────────────────────────

	private buildStatusStrip(parent: HTMLElement): void {
		const strip = parent.createDiv({ cls: 'dtf-guided-status' });
		strip.style.display = 'flex';
		strip.style.gap = '0.4em';
		strip.style.flexWrap = 'wrap';
		strip.style.marginBottom = '0.8em';
		this.statusStripEl = strip;
	}

	private renderStatusStrip(): void {
		this.statusStripEl.empty();

		const badge = (label: string, value: string, color: string, title?: string) => {
			const b = this.statusStripEl.createDiv({ cls: 'dtf-guided-badge' });
			b.style.padding = '0.2em 0.6em';
			b.style.borderRadius = '12px';
			b.style.fontSize = '0.8em';
			b.style.background = color;
			b.style.color = 'var(--text-on-accent)';
			b.style.fontWeight = '500';
			b.setText(`${label}: ${value}`);
			if (title) b.title = title;
		};

		// When entries are empty, badges are informational placeholders.
		// Cardinality/bijective are computed from settings, not from results,
		// so they'd show green even with 0 matches — misleading the user
		// into thinking the rule is "good" before it actually applies anywhere.
		const NEUTRAL = 'var(--color-base-50)';
		if (!entriesPopulated(this.state)) {
			badge('matches', '—', NEUTRAL, 'Fill in folder + tag entry to see results');
			badge('emits', '— tag(s)', NEUTRAL);
			badge('cardinality', '—', NEUTRAL);
			badge('bijective', '—', NEUTRAL);
			return;
		}

		try {
			const spec = buildSpec(this.state);
			const rule = deriveRule(spec);
			const preview = previewRule(rule, this.vaultFolders, { maxSamples: 0 });

			// `matches` is the only badge derived from VAULT RESULTS, so it's
			// the only one that earns success-green. Settings-derived badges
			// stay informational regardless of value.
			badge(
				'matches',
				String(preview.matchCount),
				preview.matchCount > 0 ? 'var(--color-green)' : NEUTRAL,
				`${preview.matchCount} vault folder(s) would be affected by this rule`,
			);
			badge(
				'emits',
				`${preview.emittedTags.length} tag(s)`,
				NEUTRAL,
				`${preview.emittedTags.length} distinct tag(s) would be emitted`,
			);
			badge(
				'cardinality',
				rule.cardinality ?? '?',
				NEUTRAL,
				`Mapping shape: ${rule.cardinality === '1:1' ? 'one-to-one (lossless)' : rule.cardinality}`,
			);
			badge(
				rule.bijective ? 'bijective' : 'lossy',
				rule.bijective ? '✓' : '⚠',
				NEUTRAL,
				rule.bijective
					? 'This rule preserves enough info to round-trip folder ↔ tag'
					: 'This rule is intentionally lossy — some structure cannot be recovered',
			);
		} catch {
			// silent; live preview will show the error
		}
	}

	// ─── 4. Compact basic row ────────────────────────────────────────────

	private buildBasicRow(parent: HTMLElement): void {
		const row = parent.createDiv({ cls: 'dtf-guided-basic-row' });
		row.style.display = 'grid';
		row.style.gridTemplateColumns = '2fr 1fr 1.4fr';
		row.style.gap = '0.6em';
		row.style.marginBottom = '0.8em';
		row.style.alignItems = 'end';

		// Name
		const nameWrap = row.createDiv();
		nameWrap.createEl('label', { text: 'Rule name' });
		const nameInput = nameWrap.createEl('input', { type: 'text' });
		nameInput.placeholder = 'Short label for this rule';
		nameInput.value = this.state.name;
		nameInput.style.width = '100%';
		nameInput.addEventListener('input', () => {
			this.state.name = nameInput.value;
			this.notify();
		});

		// Priority
		const priWrap = row.createDiv();
		priWrap.createEl('label', { text: 'Priority' });
		const priInput = priWrap.createEl('input', { type: 'text' });
		priInput.value = String(this.state.priority);
		priInput.style.width = '100%';
		priInput.addEventListener('input', () => {
			const n = parseInt(priInput.value, 10);
			if (!Number.isNaN(n) && n >= 0) {
				this.state.priority = n;
				this.notify();
			}
		});

		// Direction
		const dirWrap = row.createDiv();
		dirWrap.createEl('label', { text: 'Direction' });
		const dirSelect = dirWrap.createEl('select');
		dirSelect.style.width = '100%';
		const opts: Array<[RuleDirection, string]> = [
			['bidirectional', 'Bidirectional'],
			['folder-to-tag', 'Folder → tag'],
			['tag-to-folder', 'Tag → folder'],
		];
		for (const [v, l] of opts) {
			const o = dirSelect.createEl('option', { text: l });
			o.value = v;
		}
		dirSelect.value = this.state.direction;
		dirSelect.addEventListener('change', () => {
			this.state.direction = dirSelect.value as RuleDirection;
			this.notify();
		});
	}

	// ─── 5. Axis tile selector ───────────────────────────────────────────

	private buildAxisSection(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: 'dtf-guided-axis-section' });
		section.style.marginBottom = '0.8em';

		const heading = section.createEl('label', { text: 'Axis & marker convention' });
		heading.style.display = 'block';
		heading.style.marginBottom = '0.3em';

		this.axisTilesEl = section.createDiv({ cls: 'dtf-guided-axis-tiles' });
		this.axisTilesEl.style.display = 'grid';
		this.axisTilesEl.style.gridTemplateColumns = 'repeat(6, 1fr)';
		this.axisTilesEl.style.gap = '0.4em';
	}

	private renderAxisTiles(): void {
		this.axisTilesEl.empty();
		for (const [axis, conv] of Object.entries(AXIS_CONVENTIONS) as Array<[Axis, typeof AXIS_CONVENTIONS[Axis]]>) {
			const tile = this.axisTilesEl.createDiv({ cls: 'dtf-guided-axis-tile' });
			tile.setAttribute('data-axis', axis);
			tile.style.padding = '0.5em';
			tile.style.background = 'var(--background-secondary)';
			tile.style.borderRadius = '6px';
			tile.style.border = `2px solid ${this.state.axis === axis ? 'var(--interactive-accent)' : 'transparent'}`;
			tile.style.cursor = 'pointer';
			tile.style.textAlign = 'center';
			tile.style.transition = 'border-color 80ms';
			// Fixed min-height so axes with no marker don't shrink relative
			// to ones with markers — prevents row-height shifts between
			// selected/unselected states.
			tile.style.minHeight = '4em';
			tile.style.display = 'flex';
			tile.style.flexDirection = 'column';
			tile.style.justifyContent = 'center';
			tile.style.alignItems = 'center';
			tile.style.gap = '0.15em';

			const label = tile.createDiv();
			label.createEl('strong', { text: conv.label });
			label.style.fontSize = '0.85em';

			const marker = tile.createDiv();
			if (conv.marker === null) {
				// "(none)" reads like an error state. Italicize the
				// natural-language label to communicate "intentionally bare".
				marker.createEl('em', { text: 'No marker' });
				marker.style.color = 'var(--text-muted)';
				marker.style.fontSize = '0.78em';
			} else {
				marker.setText(conv.marker);
				marker.style.fontFamily = 'var(--font-monospace)';
				marker.style.fontSize = '0.9em';
				marker.style.color = 'var(--text-accent)';
			}

			tile.title = conv.description;

			tile.addEventListener('click', () => {
				this.state.axis = axis;
				this.state.tagPrefixMarker = conv.marker;
				this.notify();
			});
		}
	}

	// ─── 6. Folder | Tag split panel ─────────────────────────────────────

	private buildSplitPanel(parent: HTMLElement): void {
		const split = parent.createDiv({ cls: 'dtf-guided-split' });
		split.style.display = 'grid';
		split.style.gridTemplateColumns = '1fr 1fr';
		split.style.gap = '0.8em';
		split.style.marginBottom = '0.8em';

		// FOLDER SIDE
		const folder = split.createDiv({ cls: 'dtf-guided-folder-col' });
		folder.style.padding = '0.6em';
		folder.style.background = 'var(--background-secondary)';
		folder.style.borderRadius = '6px';

		const folderHeader = folder.createDiv();
		folderHeader.createEl('strong', { text: 'Folder side' });
		folderHeader.style.fontSize = '0.7em';
		folderHeader.style.opacity = '0.6';
		folderHeader.style.letterSpacing = '0.1em';
		folderHeader.style.marginBottom = '0.5em';

		new Setting(folder)
			.setName('Entry path')
			.addText((t) =>
				t.setPlaceholder('e.g. Capture/Inbox').setValue(this.state.folderEntry).onChange((v) => {
					this.state.folderEntry = v;
					this.notify();
				}),
			);

		new Setting(folder)
			.setName('Scheme')
			.addDropdown((d) =>
				d
					.addOption('hierarchical', 'Hierarchical')
					.addOption('enumerative', 'Enumerative')
					.addOption('faceted', 'Faceted')
					.addOption('authority-root', 'Authority root')
					.addOption('container-only', 'Container only')
					.setValue(this.state.folderScheme)
					.onChange((v) => {
						this.state.folderScheme = v as FolderScheme;
						this.notify();
					}),
			);

		new Setting(folder)
			.setName('Naming')
			.addDropdown((d) =>
				d
					.addOption('word', 'Word')
					.addOption('ordinal', 'Ordinal')
					.addOption('symbol-prefixed', 'Symbol-prefixed')
					.addOption('emoji-prefixed', 'Emoji-prefixed')
					.addOption('mixed', 'Mixed')
					.setValue(this.state.folderNaming)
					.onChange((v) => {
						this.state.folderNaming = v as FolderNaming;
						this.notify();
					}),
			);

		// TAG SIDE
		const tag = split.createDiv({ cls: 'dtf-guided-tag-col' });
		tag.style.padding = '0.6em';
		tag.style.background = 'var(--background-secondary)';
		tag.style.borderRadius = '6px';

		const tagHeader = tag.createDiv();
		tagHeader.createEl('strong', { text: 'Tag side' });
		tagHeader.style.fontSize = '0.7em';
		tagHeader.style.opacity = '0.6';
		tagHeader.style.letterSpacing = '0.1em';
		tagHeader.style.marginBottom = '0.5em';

		new Setting(tag)
			.setName('Tag entry')
			.addText((t) =>
				t.setPlaceholder('-inbox').setValue(this.state.tagEntry).onChange((v) => {
					this.state.tagEntry = v;
					this.notify();
				}),
			);

		new Setting(tag)
			.setName('Coordination')
			.addDropdown((d) =>
				d
					.addOption('pre-coordinated', 'Pre-coordinated')
					.addOption('post-coordinated', 'Post-coordinated')
					.addOption('flat-keyword', 'Flat keyword')
					.setValue(this.state.tagCoordination)
					.onChange((v) => {
						this.state.tagCoordination = v as TagCoordination;
						this.notify();
					}),
			);

		new Setting(tag)
			.setName('Prefix marker')
			.addDropdown((d) =>
				d
					.addOption('null', 'None')
					.addOption('/', 'Slash')
					.addOption('--', 'Double-dash')
					.addOption('-', 'Dash')
					.addOption('_', 'Underscore')
					.addOption('', 'Empty')
					.setValue(this.state.tagPrefixMarker === null ? 'null' : this.state.tagPrefixMarker)
					.onChange((v) => {
						this.state.tagPrefixMarker = v === 'null' ? null : (v as TagPrefixMarker);
						this.notify();
					}),
			);
	}

	// ─── 7. Transfer-op cards ────────────────────────────────────────────

	private buildTransferCards(parent: HTMLElement): void {
		const section = parent.createDiv({ cls: 'dtf-guided-transfer-section' });
		section.style.marginBottom = '0.8em';

		const heading = section.createEl('label', { text: 'How folders become tags' });
		heading.style.display = 'block';
		heading.style.marginBottom = '0.3em';
		heading.title = 'Transfer operation — the library-science primitive that maps source-side hierarchy to destination-side hierarchy.';

		const sub = section.createDiv();
		sub.style.fontSize = '0.85em';
		sub.style.color = 'var(--text-muted)';
		sub.style.marginBottom = '0.5em';
		sub.setText('Pick one of eight library-science primitives. Each describes a different way folder structure transfers into tag structure.');

		this.transferCardsEl = section.createDiv({ cls: 'dtf-guided-transfer-cards' });
		this.transferCardsEl.style.display = 'grid';
		this.transferCardsEl.style.gridTemplateColumns = 'repeat(4, 1fr)';
		this.transferCardsEl.style.gap = '0.4em';

		this.transferSubOptionsEl = section.createDiv({ cls: 'dtf-guided-transfer-sub' });
		this.transferSubOptionsEl.style.marginTop = '0.6em';
	}

	private renderTransferCards(): void {
		this.transferCardsEl.empty();
		const ops: TransferOp['op'][] = [
			'identity',
			'truncation',
			'marker-only',
			'promotion-to-root',
			'flattening-to-leaf',
			'aggregation',
			'post-coordination',
			'opaque',
		];

		for (const op of ops) {
			const isSelected = this.state.transferOp === op;
			const card = this.transferCardsEl.createDiv({ cls: 'dtf-guided-transfer-card' });
			card.setAttribute('data-op', op);
			card.setAttribute('role', 'button');
			card.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
			card.tabIndex = 0;
			card.style.padding = '0.5em';
			card.style.background = 'var(--background-secondary)';
			card.style.borderRadius = '5px';
			card.style.border = `2px solid ${isSelected ? 'var(--interactive-accent)' : 'transparent'}`;
			card.style.cursor = 'pointer';
			card.style.fontSize = '0.78em';
			card.style.transition = 'border-color 80ms';
			card.style.position = 'relative';

			// Accessibility: color-only selection indicators fail for ~5% of
			// users + screen readers. Add a checkmark glyph in the corner of
			// the selected card so the state is communicated by shape too.
			if (isSelected) {
				const check = card.createSpan({ text: '✓' });
				check.style.position = 'absolute';
				check.style.top = '0.25em';
				check.style.right = '0.4em';
				check.style.color = 'var(--interactive-accent)';
				check.style.fontWeight = 'bold';
			}

			const name = card.createDiv();
			name.style.fontWeight = '600';
			name.style.marginBottom = '0.2em';
			name.setText(op);

			const gloss = card.createDiv();
			gloss.style.color = 'var(--text-muted)';
			gloss.style.fontSize = '0.95em';
			gloss.setText(OP_DIAGRAMS[op].gloss);

			const diagram = card.createDiv();
			diagram.style.marginTop = '0.3em';
			diagram.style.fontFamily = 'var(--font-monospace)';
			diagram.style.fontSize = '0.85em';
			diagram.style.color = 'var(--text-accent)';
			diagram.setText(`a/b/c/d → ${OP_DIAGRAMS[op].output}`);

			card.addEventListener('click', () => {
				this.state.transferOp = op;
				this.renderTransferSubOptions();
				this.notify();
			});
			card.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					this.state.transferOp = op;
					this.renderTransferSubOptions();
					this.notify();
				}
			});
		}

		this.renderTransferSubOptions();
	}

	private renderTransferSubOptions(): void {
		this.transferSubOptionsEl.empty();
		const op = this.state.transferOp;

		if (op === 'truncation') {
			new Setting(this.transferSubOptionsEl)
				.setName('Depth')
				.setDesc('Number of folder segments preserved on the tag side')
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
				.setDesc('What happens to folder segments deeper than the cap')
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

	// ─── 8. Warnings ─────────────────────────────────────────────────────

	private renderWarnings(): void {
		this.warningsEl.empty();
		const warnings = detectWarnings(this.state);
		if (warnings.length === 0) return;

		this.warningsEl.style.marginBottom = '0.8em';

		for (const w of warnings) {
			const row = this.warningsEl.createDiv({ cls: 'dtf-guided-warning' });
			// Use Obsidian's standard inline-warning pattern — readable in both
			// light and dark themes, doesn't require text-on-accent contrast.
			row.style.padding = '0.5em 0.75em';
			row.style.background = 'var(--background-modifier-error-hover)';
			row.style.color = 'var(--text-normal)';
			row.style.borderLeft = '3px solid var(--text-error)';
			row.style.borderRadius = '4px';
			row.style.marginBottom = '0.3em';
			row.style.display = 'flex';
			row.style.gap = '0.5em';
			row.style.alignItems = 'center';
			row.style.justifyContent = 'space-between';

			const msg = row.createSpan({ text: `⚠ ${w.message}` });
			msg.style.flex = '1';
			msg.style.fontSize = '0.9em';

			if (w.fix) {
				const fixBtn = row.createEl('button', { text: w.fix.label });
				fixBtn.style.flexShrink = '0';
				fixBtn.addEventListener('click', () => {
					w.fix!.apply(this.state);
					this.notify();
				});
			}
		}
	}

	// ─── 9. Disclosure sections (vault test + derived regex) ─────────────

	private buildDisclosureSections(parent: HTMLElement): void {
		// Vault test
		const vt = parent.createEl('details', { cls: 'dtf-guided-vault-test-wrap' });
		vt.style.marginBottom = '0.5em';
		const vtSummary = vt.createEl('summary', { text: 'Sample vault matches' });
		vtSummary.style.cursor = 'pointer';
		vtSummary.style.fontWeight = '500';
		this.vaultTestEl = vt.createDiv({ cls: 'dtf-guided-vault-test' });
		this.vaultTestEl.style.padding = '0.6em';
		this.vaultTestEl.style.fontSize = '0.85em';
		vt.open = true; // open by default — this is the principle in action

		// Derived regex (collapsed by default — the typed model is the durable
		// surface; regex is implementation detail per principle 4)
		const dr = parent.createEl('details', { cls: 'dtf-guided-derived-wrap' });
		dr.style.marginBottom = '0.8em';
		const drSummary = dr.createEl('summary', { text: 'Show derived regex' });
		drSummary.style.cursor = 'pointer';
		drSummary.style.fontSize = '0.85em';
		drSummary.style.color = 'var(--text-muted)';
		this.derivedChipsEl = dr.createDiv({ cls: 'dtf-guided-derived' });
		this.derivedChipsEl.style.padding = '0.6em';
		this.derivedChipsEl.style.fontFamily = 'var(--font-monospace)';
		this.derivedChipsEl.style.fontSize = '0.8em';
	}

	private renderVaultTest(): void {
		this.vaultTestEl.empty();

		if (!entriesPopulated(this.state)) {
			this.vaultTestEl.createEl('em', {
				text: 'Fill folder entry and tag entry to see sample matches.',
			});
			return;
		}

		try {
			const spec = buildSpec(this.state);
			const rule = deriveRule(spec);
			const preview = previewRule(rule, this.vaultFolders, { maxSamples: 5 });

			if (preview.matchCount === 0 && !preview.opaqueByDesign) {
				this.vaultTestEl.createEl('em', { text: 'No vault folders match yet.' });
				return;
			}

			// Summary line — repeats the headline numbers so the user can quickly
			// confirm the rule's blast radius without re-reading the status strip.
			const summary = this.vaultTestEl.createDiv();
			summary.style.marginBottom = '0.4em';
			summary.style.fontWeight = '500';
			if (preview.opaqueByDesign) {
				summary.setText(
					`${preview.matchCount} folder(s) match — opaque, no tag emitted.`,
				);
			} else {
				summary.setText(
					`${preview.matchCount} folder(s) match → ${preview.emittedTags.length} distinct tag(s).`,
				);
			}

			const tagsBlock = this.vaultTestEl.createDiv();
			tagsBlock.createSpan({ text: 'Tags emitted: ' });
			if (preview.emittedTags.length === 0) {
				tagsBlock.createEl('em', { text: '(none — opaque)' });
			} else {
				preview.emittedTags.slice(0, 8).forEach((t, i) => {
					if (i > 0) tagsBlock.createSpan({ text: ' ' });
					const chip = tagsBlock.createEl('code', { text: t });
					chip.style.marginRight = '0.3em';
				});
				if (preview.emittedTags.length > 8) {
					tagsBlock.createSpan({ text: `+${preview.emittedTags.length - 8} more` });
				}
			}

			if (preview.samples.length > 0) {
				const list = this.vaultTestEl.createEl('ul');
				list.style.paddingLeft = '1.2em';
				list.style.marginTop = '0.4em';
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

	private renderDerivedChips(): void {
		this.derivedChipsEl.empty();
		try {
			const spec = buildSpec(this.state);
			const rule = deriveRule(spec);
			const grid = this.derivedChipsEl.createDiv();
			grid.style.display = 'grid';
			grid.style.gridTemplateColumns = '7em 1fr';
			grid.style.gap = '0.2em 0.6em';
			const fieldRow = (label: string, value: string | undefined) => {
				grid.createSpan({ text: label });
				if (value === undefined || value === '') {
					grid.createEl('em', { text: '(not used)' });
				} else {
					grid.createEl('code', { text: value });
				}
			};
			fieldRow('folderPattern', rule.folderPattern);
			fieldRow('tagPattern', rule.tagPattern);
			fieldRow('folderEntryPoint', rule.folderEntryPoint);
			fieldRow('tagEntryPoint', rule.tagEntryPoint);
		} catch (err) {
			this.derivedChipsEl.createEl('em', {
				text: `Cannot derive: ${err instanceof Error ? err.message : String(err)}`,
			});
		}
	}

	// ─── 10. Validation + actions ────────────────────────────────────────

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
		actions.style.justifyContent = 'space-between';
		actions.style.alignItems = 'center';
		actions.style.marginTop = '1em';
		actions.style.paddingTop = '0.6em';
		actions.style.borderTop = '1px solid var(--background-modifier-border)';

		// Keyboard hint — left-aligned, low-emphasis
		const kbHint = actions.createDiv();
		kbHint.style.fontSize = '0.78em';
		kbHint.style.color = 'var(--text-muted)';
		kbHint.setText('Esc to cancel · Cmd/Ctrl+Enter to create');

		const buttons = actions.createDiv();
		buttons.style.display = 'flex';
		buttons.style.gap = '0.5em';

		const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.saveBtn = buttons.createEl('button', { text: 'Create rule', cls: 'mod-cta' });
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
		this.scope.register([], 'Escape', () => {
			this.close();
			return false;
		});
		this.scope.register(['Mod'], 'Enter', () => {
			this.attemptSave();
			return false;
		});
		this.contentEl.addEventListener('keydown', (e) => {
			if (e.key === 'Enter' && !e.isComposing && !e.metaKey && !e.ctrlKey) {
				const target = e.target as HTMLElement;
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
