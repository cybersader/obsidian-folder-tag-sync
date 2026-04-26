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
import type { MappingRule, RuleDirection } from '../types/settings';
import type {
	Axis,
	FolderScheme,
	FolderNaming,
	TagCoordination,
	TagPrefixMarker,
	TransferOp,
	TruncationTailHandling,
} from '../types/typed';
import { deriveRule } from '../engine/derive';
import { previewRule } from '../engine/rulePreview';
import {
	type FormState,
	type Warning,
	defaultFormState,
	populateFromRule,
	buildSpec,
	entriesPopulated,
	detectWarnings,
	isFormValid,
} from '../engine/buildSpec';
import { EntryPathSuggest, collectFolderSources, collectTagSources } from './suggest/EntryPathSuggest';
import { ConfirmModal } from './ConfirmModal';

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

/**
 * Plain-English glosses + concrete examples for each option in the four
 * jargon dropdowns (folder Scheme, folder Naming, tag Coordination,
 * tag Prefix marker). Rendered as an inline panel under each dropdown
 * that updates when the value changes — teaches the library-science
 * primitives in context, without forcing the user to read external
 * docs or guess from the term alone.
 *
 * Format per option: { explain: 1-line plain English, example: concrete folder/tag }
 */
const GLOSS: {
	folderScheme: Record<FolderScheme, { explain: string; example: string }>;
	folderNaming: Record<FolderNaming, { explain: string; example: string }>;
	tagCoordination: Record<TagCoordination, { explain: string; example: string }>;
	tagPrefixMarker: Record<string, { explain: string; example: string }>;
} = {
	folderScheme: {
		hierarchical: {
			explain: 'Each child folder is a sub-category of its parent.',
			example: 'Projects/Web/auth → #projects/web/auth',
		},
		enumerative: {
			explain: 'Flat list of independent categories — no nesting semantics.',
			example: 'Books, Articles, Notes',
		},
		faceted: {
			explain: 'Folders capture orthogonal attributes; one item belongs to many.',
			example: 'by-author/Borges + by-topic/Fiction',
		},
		'authority-root': {
			explain: 'Single canonical root list; files live under their authoritative form.',
			example: 'Authors/Borges, Authors/Calvino',
		},
		'container-only': {
			explain: 'Folder is just a container; the folder name itself is not a concept.',
			example: '_Templates/, _Attachments/ (not tagged from name)',
		},
	},
	folderNaming: {
		word: {
			explain: 'Plain words. Simplest convention.',
			example: 'Projects, Capture, Inbox',
		},
		ordinal: {
			explain: 'Numbered prefix establishes a fixed display order.',
			example: '01-Inbox, 02-Active, 03-Archive',
		},
		'symbol-prefixed': {
			explain: 'Special character prefix flags the folder\'s purpose.',
			example: '_Archive, ⬇️Inbox, !Important',
		},
		'emoji-prefixed': {
			explain: 'Emoji icon at the start helps visual scanning.',
			example: '📥 Inbox, 📁 Projects, 🗄 Archive',
		},
		mixed: {
			explain: 'Combination of styles within the same scheme.',
			example: '01-📥 Inbox, _99-Archive',
		},
	},
	tagCoordination: {
		'pre-coordinated': {
			explain: 'A single hierarchical tag captures the full path.',
			example: '#projects/web/auth (one tag, three levels)',
		},
		'post-coordinated': {
			explain: 'Multiple flat tags — combine them at search time.',
			example: '#projects + #web + #auth (three tags, no hierarchy)',
		},
		'flat-keyword': {
			explain: 'Single fixed keyword; no hierarchy, no combination.',
			example: '#inbox, #starred (one tag, terminal)',
		},
	},
	tagPrefixMarker: {
		null: {
			explain: 'No prefix character — plain Work-axis tags.',
			example: '#projects, #areas',
		},
		'/': {
			explain: 'Slash convention — System axis (config, templates).',
			example: '#/templates, #/snippets',
		},
		'--': {
			explain: 'Double-dash convention — Entity axis (workspace owner).',
			example: '#--workspace, #--client-acme',
		},
		'-': {
			explain: 'Single-dash convention — Capture axis (inbox, clippings).',
			example: '#-inbox, #-clip',
		},
		_: {
			explain: 'Underscore convention — Output axis (publishable).',
			example: '#_publish, #_export',
		},
		'': {
			explain: 'Empty string — no prefix, but distinct from "none" for tag generation.',
			example: '(rare; usually use "None" instead)',
		},
	},
};

// ─── Modal ───────────────────────────────────────────────────────────────

/** Mode the modal opens in. Drives title, CTA label, banner. */
export type GuidedEditorMode =
	| { kind: 'create' }
	/** Editing a rule that already has typed (Layer 2) fields. */
	| { kind: 'edit'; existingRule: MappingRule }
	/** Editing a legacy regex rule via best-effort inference. Banner shown. */
	| { kind: 'edit-from-inferred'; existingRule: MappingRule };

/** Optional callback for the "Open in advanced (regex)" escape-hatch link. */
export type SwitchToAdvancedFn = (rule: MappingRule | null) => void;

export class GuidedRuleEditorModal extends Modal {
	private state: FormState;
	/**
	 * Save callback. `null` signals deletion (only fires from the Delete
	 * button in edit modes); the callback distinguishes save-vs-delete by
	 * checking for null. SettingsTab.upsertRule routes appropriately.
	 */
	private readonly onSave: (rule: MappingRule | null) => void;
	private readonly mode: GuidedEditorMode;
	private vaultFolders: string[] = [];

	// Pre-computed autocomplete sources, populated once at modal open.
	private folderSuggestSources: string[] = [];
	private tagSuggestSources: string[] = [];

	// DOM refs for live updates
	private flowDiagramEl!: HTMLElement;
	private livePreviewEl!: HTMLElement;
	private statusStripEl!: HTMLElement;
	private warningsEl!: HTMLElement;
	private vaultTestEl!: HTMLElement;
	private derivedChipsEl!: HTMLElement;
	private transferCardsEl!: HTMLElement;
	private transferSubOptionsEl!: HTMLElement;
	private axisTilesEl!: HTMLElement;
	private saveBtn!: HTMLButtonElement;

	private readonly onSwitchToAdvanced?: SwitchToAdvancedFn;

	constructor(
		app: App,
		onSave: (rule: MappingRule | null) => void,
		mode: GuidedEditorMode = { kind: 'create' },
		onSwitchToAdvanced?: SwitchToAdvancedFn,
	) {
		super(app);
		this.mode = mode;
		this.state = mode.kind === 'create' ? defaultFormState() : populateFromRule(mode.existingRule);
		this.onSave = onSave;
		this.onSwitchToAdvanced = onSwitchToAdvanced;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('dtf-guided-modal');
		// Wider modal — layout is two/three columns, needs the room
		modalEl.style.width = 'min(900px, 95vw)';

		// Sticky bottom action bar pattern: contentEl becomes a flex column
		// with bounded height. The body wrapper scrolls; the action bar sits
		// outside the scroll area so Save/Cancel/Delete are always visible
		// regardless of how far down the form the user has scrolled. This
		// matches the convention used by GitHub, Linear, Notion, Figma, and
		// most modern form modals.
		contentEl.style.display = 'flex';
		contentEl.style.flexDirection = 'column';
		contentEl.style.maxHeight = '85vh';
		contentEl.style.padding = '0';
		contentEl.style.overflow = 'hidden';

		const bodyEl = contentEl.createDiv({ cls: 'dtf-guided-body' });
		bodyEl.style.flex = '1';
		bodyEl.style.overflowY = 'auto';
		bodyEl.style.minHeight = '0';
		bodyEl.style.padding = '1.5em';

		this.collectVaultFolders();

		// 1. Title row — adapts to mode, with optional escape-hatch link
		const titleText =
			this.mode.kind === 'create' ? 'Create rule (guided)' : 'Edit rule (guided)';

		const titleRow = bodyEl.createDiv();
		titleRow.style.display = 'flex';
		titleRow.style.alignItems = 'baseline';
		titleRow.style.justifyContent = 'space-between';
		titleRow.style.gap = '0.5em';

		new Setting(titleRow).setName(titleText).setHeading();

		// Escape hatch — present whenever the user might want raw regex.
		// Available in both edit and create modes: in create mode the link
		// forwards `null` to the advanced editor (signaling "open for a new
		// rule"); the SettingsTab.openRuleEditor(null) flow handles that.
		if (this.onSwitchToAdvanced) {
			const switchLink = titleRow.createEl('a', { text: 'Open in advanced (regex)' });
			switchLink.style.fontSize = '0.85em';
			switchLink.style.cursor = 'pointer';
			switchLink.style.color = 'var(--text-muted)';
			switchLink.addEventListener('click', (e) => {
				e.preventDefault();
				const rule = this.mode.kind !== 'create' ? this.mode.existingRule : null;
				if (this.onSwitchToAdvanced) {
					this.onSwitchToAdvanced(rule);
					this.close();
				}
			});
		}

		// Inferred-mode banner — tinted info-card with left accent so the
		// user's eye lands on it. Heading does the work; body is context
		// for users who want it.
		if (this.mode.kind === 'edit-from-inferred') {
			const banner = bodyEl.createDiv({ cls: 'dtf-inferred-banner' });
			banner.style.padding = '0.6em 0.8em';
			banner.style.background = 'var(--background-modifier-form-field)';
			banner.style.borderLeft = '3px solid var(--text-accent)';
			banner.style.borderRadius = '4px';
			banner.style.marginBottom = '0.6em';
			banner.style.display = 'flex';
			banner.style.flexDirection = 'column';
			banner.style.gap = '0.2em';

			const heading = banner.createDiv();
			heading.style.fontWeight = '600';
			heading.style.fontSize = '0.95em';
			heading.setText('Imported from regex — review fields');

			const body = banner.createDiv();
			body.style.fontSize = '0.85em';
			body.style.color = 'var(--text-muted)';
			body.setText(
				"These fields were guessed from the rule's patterns. If the shape's wrong, use the advanced regex editor link above.",
			);
		}

		// 2. Live preview strip — at the TOP so the user sees output before inputs
		// 2a. High-level flow diagram — visual "what does this rule do?"
		// Three columns: folders → transfer-glyph → tags. Direction-aware
		// arrows (folder-to-tag / tag-to-folder / bidirectional).
		this.buildFlowDiagram(bodyEl);

		this.buildLivePreviewStrip(bodyEl);

		// 3. Status strip — match count + cardinality + bijective
		this.buildStatusStrip(bodyEl);

		// 4. Compact basic row
		this.buildBasicRow(bodyEl);

		// 5. Axis tile selector — 6 SEACOW tiles
		this.buildAxisSection(bodyEl);

		// 6. Two-column folder | tag split (transfer ops are below in their own row)
		this.buildSplitPanel(bodyEl);

		// 7. Transfer op cards — 4×2 grid of selectable mini-diagrams
		this.buildTransferCards(bodyEl);

		// 8. Inconsistency warnings (renders only when present)
		this.warningsEl = bodyEl.createDiv({ cls: 'dtf-guided-warnings' });

		// 9. Vault test (sample mappings) + derived regex (collapsible)
		this.buildDisclosureSections(bodyEl);

		// 10. Action buttons — outside the scroll body, sticky to bottom
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
		// Build the autocomplete source lists from the same walk + the
		// metadata cache. Computed once per modal open — re-rendering the
		// modal (e.g. on inconsistency-fix) doesn't re-walk.
		this.folderSuggestSources = collectFolderSources(out);
		const tagsRecord = (this.app.metadataCache as unknown as { getTags(): Record<string, number> })
			.getTags();
		this.tagSuggestSources = collectTagSources(tagsRecord);
	}

	/**
	 * Pick the rule to preview against. Priority:
	 *   1. If FormState entries are populated, derive from FormState (the
	 *      authoritative source while the user is authoring).
	 *   2. Else if editing an existing rule that has a folderPattern, use
	 *      that rule directly. This covers scan-imported rules with empty
	 *      entry points (e.g. JD numbered-row) — the user opens them and
	 *      should see real samples immediately, before mapping to typed
	 *      fields.
	 *   3. Else null — caller renders the "fill entries" hint.
	 */
	private currentPreviewRule(): MappingRule | null {
		if (entriesPopulated(this.state)) {
			try {
				const spec = buildSpec(this.state);
				return deriveRule(spec);
			} catch {
				return null;
			}
		}
		if (this.mode.kind === 'edit' || this.mode.kind === 'edit-from-inferred') {
			if (this.mode.existingRule.folderPattern) {
				return this.mode.existingRule;
			}
		}
		return null;
	}

	/** Reactive heartbeat — every field change calls this. */
	private notify(): void {
		this.renderFlowDiagram();
		this.renderLivePreview();
		this.renderStatusStrip();
		this.renderTransferCards();
		this.renderAxisTiles();
		this.renderWarnings();
		this.renderVaultTest();
		this.renderDerivedChips();
		this.updateSaveButtonState();
	}

	// ─── 2a. High-level flow diagram ─────────────────────────────────────

	/**
	 * Visual three-column "what does this rule do" panel. Same data the
	 * status strip + live preview already use, but presented spatially:
	 *
	 *   ┌─ FOLDERS ────────┐  TRANSFER  ┌─ TAGS ───────────┐
	 *   │ 📁 Capture        │   identity │ 🏷 #-              │
	 *   │   ├ Inbox         │     ⇄      │   ├ #-inbox       │
	 *   │   ├ Clips/Web     │            │   ├ #-clips/web   │
	 *   │   └ Quotes        │  bidirect. │   └ #-quotes      │
	 *   └───────────────────┘            └───────────────────┘
	 *
	 * The arrow between columns reflects rule direction (→, ←, or ⇄).
	 * Sample folders + tags come from previewRule against the real vault,
	 * capped at 3 to avoid crowding. Updates on every state change.
	 */
	private buildFlowDiagram(parent: HTMLElement): void {
		const wrap = parent.createDiv({ cls: 'dtf-guided-flow' });
		wrap.style.padding = '0.65em 0.75em';
		wrap.style.background = 'var(--background-secondary)';
		wrap.style.border = '1px solid var(--background-modifier-border)';
		wrap.style.borderRadius = '8px';
		wrap.style.marginBottom = '0.6em';
		this.flowDiagramEl = wrap;
	}

	private renderFlowDiagram(): void {
		const wrap = this.flowDiagramEl;
		wrap.empty();

		// Header
		const header = wrap.createDiv();
		header.style.fontFamily = 'var(--font-interface)';
		header.style.fontSize = '0.7em';
		header.style.opacity = '0.65';
		header.style.textTransform = 'uppercase';
		header.style.letterSpacing = '0.08em';
		header.style.marginBottom = '0.5em';
		header.setText('Rule overview');

		// 3-column grid: folders | transfer | tags
		const grid = wrap.createDiv();
		grid.style.display = 'grid';
		grid.style.gridTemplateColumns = 'minmax(0, 1fr) auto minmax(0, 1fr)';
		grid.style.gap = '0.6em';
		grid.style.alignItems = 'stretch';

		// Compute samples — picks the right rule (FormState-derived for the
		// authoring case, existing rule for scan-imported rules with empty
		// entries) so JD-style rules show real matches without forcing the
		// user to fill in entry points first.
		let samples: { folder: string; tags: string[] }[] = [];
		let hasError = false;
		const ruleForPreview = this.currentPreviewRule();
		if (ruleForPreview) {
			try {
				const preview = previewRule(ruleForPreview, this.vaultFolders, { maxSamples: 3 });
				if (preview.invalidRegex) {
					hasError = true;
				} else {
					samples = preview.samples;
				}
			} catch {
				hasError = true;
			}
		}

		// LEFT — folders
		const folderCol = grid.createDiv();
		folderCol.style.padding = '0.5em';
		folderCol.style.background = 'var(--background-primary)';
		folderCol.style.borderRadius = '6px';
		folderCol.style.minHeight = '4.5em';

		const folderHead = folderCol.createDiv();
		folderHead.style.fontSize = '0.72em';
		folderHead.style.opacity = '0.55';
		folderHead.style.letterSpacing = '0.06em';
		folderHead.style.textTransform = 'uppercase';
		folderHead.style.marginBottom = '0.2em';
		folderHead.createSpan({ text: '📁 ' });
		folderHead.createSpan({ text: 'Folders' });

		const folderEntryEl = folderCol.createDiv();
		folderEntryEl.style.fontFamily = 'var(--font-monospace)';
		folderEntryEl.style.fontSize = '0.85em';
		folderEntryEl.style.fontWeight = '600';
		folderEntryEl.setText(this.state.folderEntry || '(no entry)');

		if (samples.length > 0) {
			const list = folderCol.createDiv();
			list.style.fontFamily = 'var(--font-monospace)';
			list.style.fontSize = '0.78em';
			list.style.lineHeight = '1.5';
			list.style.opacity = '0.85';
			list.style.marginTop = '0.15em';
			samples.forEach((s, i) => {
				const row = list.createDiv();
				const isLast = i === samples.length - 1;
				const branch = isLast ? '└ ' : '├ ';
				// Strip the entry prefix to show the relative remainder
				const rel = s.folder.startsWith(this.state.folderEntry + '/')
					? s.folder.slice(this.state.folderEntry.length + 1)
					: s.folder;
				row.setText(`${branch}${rel}`);
			});
		} else if (!hasError && ruleForPreview) {
			const note = folderCol.createDiv();
			note.style.fontSize = '0.78em';
			note.style.fontStyle = 'italic';
			note.style.opacity = '0.55';
			note.style.marginTop = '0.2em';
			note.setText('No vault folders match yet');
		}

		// MIDDLE — transfer + direction
		const midCol = grid.createDiv();
		midCol.style.display = 'flex';
		midCol.style.flexDirection = 'column';
		midCol.style.alignItems = 'center';
		midCol.style.justifyContent = 'center';
		midCol.style.padding = '0 0.4em';
		midCol.style.minWidth = '6em';

		const arrow = midCol.createDiv();
		arrow.style.fontSize = '1.4em';
		arrow.style.lineHeight = '1';
		arrow.style.color = 'var(--text-accent)';
		arrow.setText(
			this.state.direction === 'bidirectional'
				? '⇄'
				: this.state.direction === 'folder-to-tag'
					? '→'
					: '←',
		);

		const opName = midCol.createDiv();
		opName.style.fontSize = '0.78em';
		opName.style.fontWeight = '600';
		opName.style.marginTop = '0.2em';
		opName.style.textAlign = 'center';
		opName.setText(this.state.transferOp);

		const opGloss = midCol.createDiv();
		opGloss.style.fontSize = '0.7em';
		opGloss.style.opacity = '0.6';
		opGloss.style.fontStyle = 'italic';
		opGloss.style.textAlign = 'center';
		opGloss.style.marginTop = '0.1em';
		opGloss.setText(OP_DIAGRAMS[this.state.transferOp].gloss);

		const dirLabel = midCol.createDiv();
		dirLabel.style.fontSize = '0.7em';
		dirLabel.style.opacity = '0.5';
		dirLabel.style.marginTop = '0.4em';
		dirLabel.setText(
			this.state.direction === 'bidirectional'
				? 'bidirectional'
				: this.state.direction === 'folder-to-tag'
					? 'folder → tag'
					: 'tag → folder',
		);

		// RIGHT — tags
		const tagCol = grid.createDiv();
		tagCol.style.padding = '0.5em';
		tagCol.style.background = 'var(--background-primary)';
		tagCol.style.borderRadius = '6px';
		tagCol.style.minHeight = '4.5em';

		const tagHead = tagCol.createDiv();
		tagHead.style.fontSize = '0.72em';
		tagHead.style.opacity = '0.55';
		tagHead.style.letterSpacing = '0.06em';
		tagHead.style.textTransform = 'uppercase';
		tagHead.style.marginBottom = '0.2em';
		tagHead.createSpan({ text: '🏷 ' });
		tagHead.createSpan({ text: 'Tags' });

		const tagEntryEl = tagCol.createDiv();
		tagEntryEl.style.fontFamily = 'var(--font-monospace)';
		tagEntryEl.style.fontSize = '0.85em';
		tagEntryEl.style.fontWeight = '600';
		tagEntryEl.setText(`#${this.state.tagEntry || '(no entry)'}`);

		if (samples.length > 0) {
			const list = tagCol.createDiv();
			list.style.fontFamily = 'var(--font-monospace)';
			list.style.fontSize = '0.78em';
			list.style.lineHeight = '1.5';
			list.style.opacity = '0.85';
			list.style.marginTop = '0.15em';
			samples.forEach((s, i) => {
				const row = list.createDiv();
				const isLast = i === samples.length - 1;
				const branch = isLast ? '└ ' : '├ ';
				const tagText = s.tags.length === 0 ? '(opaque — no tag)' : s.tags.join(', ');
				row.setText(`${branch}${tagText}`);
			});
		} else if (hasError) {
			const note = tagCol.createDiv();
			note.style.fontSize = '0.78em';
			note.style.fontStyle = 'italic';
			note.style.color = 'var(--text-muted)';
			note.style.marginTop = '0.2em';
			note.setText('Cannot preview — fix errors below');
		} else if (!ruleForPreview) {
			const note = tagCol.createDiv();
			note.style.fontSize = '0.78em';
			note.style.fontStyle = 'italic';
			note.style.opacity = '0.55';
			note.style.marginTop = '0.2em';
			note.setText('Fill entries to see flow');
		} else {
			const note = tagCol.createDiv();
			note.style.fontSize = '0.78em';
			note.style.fontStyle = 'italic';
			note.style.opacity = '0.55';
			note.style.marginTop = '0.2em';
			note.setText('No tags emitted yet');
		}
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

		// Use currentPreviewRule so scan-imported rules with empty entries
		// still get a preview from their existing folderPattern.
		const ruleForPreview = this.currentPreviewRule();
		if (!ruleForPreview) {
			const missing: string[] = [];
			if (!this.state.folderEntry.trim()) missing.push('folder entry');
			if (!this.state.tagEntry.trim()) missing.push('tag entry');
			row.createEl('em', {
				text: `Fill ${missing.join(' and ')} to see what this rule will do`,
			});
			return;
		}

		try {
			const preview = previewRule(ruleForPreview, this.vaultFolders, { maxSamples: 1 });

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

		// When no rule is previewable, badges are informational placeholders.
		// Cardinality/bijective are computed from settings, not from results,
		// so they'd show green even with 0 matches — misleading the user
		// into thinking the rule is "good" before it actually applies anywhere.
		const NEUTRAL = 'var(--color-base-50)';
		const ruleForPreview = this.currentPreviewRule();
		if (!ruleForPreview) {
			badge('matches', '—', NEUTRAL, 'Fill in folder + tag entry to see results');
			badge('emits', '— tag(s)', NEUTRAL);
			badge('cardinality', '—', NEUTRAL);
			badge('bijective', '—', NEUTRAL);
			return;
		}

		try {
			const preview = previewRule(ruleForPreview, this.vaultFolders, { maxSamples: 0 });

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
				ruleForPreview.cardinality ?? '?',
				NEUTRAL,
				`Mapping shape: ${ruleForPreview.cardinality === '1:1' ? 'one-to-one (lossless)' : ruleForPreview.cardinality}`,
			);
			badge(
				ruleForPreview.bijective ? 'bijective' : 'lossy',
				ruleForPreview.bijective ? '✓' : '⚠',
				NEUTRAL,
				ruleForPreview.bijective
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
			const isSelected = this.state.axis === axis;
			const tile = this.axisTilesEl.createDiv({ cls: 'dtf-guided-axis-tile' });
			tile.setAttribute('data-axis', axis);
			tile.setAttribute('role', 'button');
			tile.setAttribute('aria-pressed', isSelected ? 'true' : 'false');
			tile.tabIndex = 0;
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

			const select = () => {
				this.state.axis = axis;
				this.state.tagPrefixMarker = conv.marker;
				this.notify();
			};
			tile.addEventListener('click', select);
			tile.addEventListener('keydown', (e) => {
				if (e.key === 'Enter' || e.key === ' ') {
					e.preventDefault();
					select();
				}
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
			.addText((t) => {
				t.setPlaceholder('e.g. Capture/Inbox').setValue(this.state.folderEntry).onChange((v) => {
					this.state.folderEntry = v;
					this.notify();
				});
				// Attach autocomplete on the underlying input element so users
				// pick from real vault folders instead of guessing.
				new EntryPathSuggest(this.app, t.inputEl, this.folderSuggestSources, (picked) => {
					this.state.folderEntry = picked;
					this.notify();
				});
			});

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
						this.renderGloss(schemeGloss, GLOSS.folderScheme[v as FolderScheme]);
						this.notify();
					}),
			);
		const schemeGloss = folder.createDiv({ cls: 'dtf-gloss' });
		this.renderGloss(schemeGloss, GLOSS.folderScheme[this.state.folderScheme]);

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
						this.renderGloss(namingGloss, GLOSS.folderNaming[v as FolderNaming]);
						this.notify();
					}),
			);
		const namingGloss = folder.createDiv({ cls: 'dtf-gloss' });
		this.renderGloss(namingGloss, GLOSS.folderNaming[this.state.folderNaming]);

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
			.addText((t) => {
				t.setPlaceholder('-inbox').setValue(this.state.tagEntry).onChange((v) => {
					this.state.tagEntry = v;
					this.notify();
				});
				new EntryPathSuggest(this.app, t.inputEl, this.tagSuggestSources, (picked) => {
					this.state.tagEntry = picked;
					this.notify();
				});
			});

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
						this.renderGloss(coordGloss, GLOSS.tagCoordination[v as TagCoordination]);
						this.notify();
					}),
			);
		const coordGloss = tag.createDiv({ cls: 'dtf-gloss' });
		this.renderGloss(coordGloss, GLOSS.tagCoordination[this.state.tagCoordination]);

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
						this.renderGloss(markerGloss, GLOSS.tagPrefixMarker[v]);
						this.notify();
					}),
			);
		const markerGloss = tag.createDiv({ cls: 'dtf-gloss' });
		this.renderGloss(
			markerGloss,
			GLOSS.tagPrefixMarker[this.state.tagPrefixMarker === null ? 'null' : this.state.tagPrefixMarker],
		);
	}

	/**
	 * Render an inline gloss panel below a jargon dropdown — small italic
	 * muted text on two lines: plain-English explanation + concrete example.
	 * Updates in place when the dropdown value changes.
	 */
	private renderGloss(
		el: HTMLElement,
		entry: { explain: string; example: string } | undefined,
	): void {
		el.empty();
		if (!entry) return;
		el.style.fontSize = '0.78em';
		el.style.color = 'var(--text-muted)';
		el.style.lineHeight = '1.4';
		el.style.marginTop = '-0.1em';
		el.style.marginBottom = '0.4em';
		el.style.paddingLeft = '0.2em';
		const explainLine = el.createDiv();
		explainLine.setText(entry.explain);
		const exampleLine = el.createDiv();
		exampleLine.style.fontFamily = 'var(--font-monospace)';
		exampleLine.style.fontSize = '0.95em';
		exampleLine.style.opacity = '0.85';
		exampleLine.setText(`e.g. ${entry.example}`);
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

		const ruleForPreview = this.currentPreviewRule();
		if (!ruleForPreview) {
			this.vaultTestEl.createEl('em', {
				text: 'Fill folder entry and tag entry to see sample matches.',
			});
			return;
		}

		try {
			const preview = previewRule(ruleForPreview, this.vaultFolders, { maxSamples: 5 });

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
		// Sticky bottom: flex-shrink: 0 keeps the bar at full height even if
		// the body is short; opaque background prevents scrolled body content
		// from bleeding through. Padding replaces the previous marginTop +
		// paddingTop now that the bar is a sibling of the scroll body rather
		// than the last child of a single scrolling column.
		actions.style.flexShrink = '0';
		actions.style.padding = '0.7em 1.5em';
		actions.style.background = 'var(--background-primary)';
		actions.style.borderTop = '1px solid var(--background-modifier-border)';

		// Keyboard hint — left-aligned, low-emphasis
		const kbHint = actions.createDiv();
		kbHint.style.fontSize = '0.78em';
		kbHint.style.color = 'var(--text-muted)';
		kbHint.setText('Esc to cancel · Cmd/Ctrl+Enter to create');

		const buttons = actions.createDiv();
		buttons.style.display = 'flex';
		buttons.style.gap = '0.5em';

		// Delete only in edit modes — has no meaning for a rule that hasn't
		// been created yet. Routes through ConfirmModal so the user has a
		// deliberate confirmation step instead of a one-click destructive
		// action.
		if (this.mode.kind !== 'create') {
			const deleteBtn = buttons.createEl('button', {
				text: 'Delete rule',
				cls: 'mod-warning',
			});
			deleteBtn.addEventListener('click', () => {
				const rule = this.mode.kind !== 'create' ? this.mode.existingRule : null;
				if (!rule) return;
				new ConfirmModal(this.app, {
					title: 'Delete rule?',
					body: `"${rule.name}" cannot be recovered.`,
					confirmLabel: 'Delete',
					destructive: true,
					onConfirm: () => {
						this.onSave(null);
						new Notice(`Rule "${rule.name}" deleted`);
						this.close();
					},
				}).open();
			});
		}

		const cancelBtn = buttons.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		const saveLabel = this.mode.kind === 'create' ? 'Create rule' : 'Save changes';
		this.saveBtn = buttons.createEl('button', { text: saveLabel, cls: 'mod-cta' });
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
