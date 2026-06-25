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
import { compileTemplate, computeBijectivity, extractSlots, TemplateParseError } from '../engine/compileTemplate';
import { applyTemplateRuleForward } from '../engine/applyTemplate';
import { ConfirmModal } from './ConfirmModal';
import {
	EntryPathSuggest,
	collectFolderSources,
	collectTagSources,
} from './suggest/EntryPathSuggest';

type RuleEditorMode = 'template' | 'lens-flavored' | 'slot-objects' | 'regex';

/**
 * Quick-start template starters — one click fills both folder + tag templates
 * with a working example. The 5-7 most common shapes; user can adjust after.
 */
interface TemplateStarter {
	id: string;
	label: string;
	folder: string;
	tag: string;
	notes?: string;
}

const TEMPLATE_STARTERS: TemplateStarter[] = [
	{
		id: 'top-folder-and-children',
		label: 'Match a top-level folder + all children — Projects/{deeper...} ↔ #projects/{deeper...}',
		folder: 'Projects/{deeper...}',
		tag: '#projects/{deeper...}',
		notes: 'Trailing glob with bare-entry support — matches `Projects` AND `Projects/X` AND `Projects/X/Y/Z`',
	},
	{
		id: 'every-top-folder',
		label: 'Match EVERY top-level folder + children — {root}/{deeper...} ↔ #{root | kebab-case}/{deeper...}',
		folder: '{root}/{deeper...}',
		tag: '#{root | kebab-case}/{deeper...}',
		notes: 'Catch-all — every root folder gets a tag namespace',
	},
	{
		id: 'identity',
		label: 'PARA identity — Projects/{topic} ↔ #projects/{topic}',
		folder: 'Projects/{topic}',
		tag: '#projects/{topic}',
	},
	{
		id: 'jd-2digit',
		label: 'JD 2-digit area — 10 - Projects/{deeper...} ↔ #10-projects/{deeper...}',
		folder: '10 - Projects/{deeper...}',
		tag: '#10-projects/{deeper...}',
	},
	{
		id: 'jd-1digit',
		label: 'JD single-digit area — 0 - Tasks, Planning/{deeper...} ↔ #0-tasks-planning/{deeper...}',
		folder: '0 - Tasks, Planning/{deeper...}',
		tag: '#0-tasks-planning/{deeper...}',
		notes: 'For enterprise vaults with single-digit numbered roots',
	},
	{
		id: 'jd-catchall',
		label: 'Catch-all numbered area — {num} - {name}/{deeper...} ↔ #{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		folder: '{num} - {name}/{deeper...}',
		tag: '#{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		notes: 'ONE rule for ALL numbered roots. Files moving between areas (e.g., 0 - Tasks/X → 1 - Projects/X) re-tag automatically. ⚠ Bijectivity: round-trips cleanly if folder names contain no invalid-for-tags chars (.,;:?!@\\). Established-from-clean-names = total bijection. Existing names like "1 - Tasks, Planning" lose the comma on tag→folder inverse — F3 frontmatter witness (post-MVP) will close this gap by recording the original folder name per-file.',
	},
	{
		id: 'jd-strict-numbered',
		label: 'Strict numbered area (Tier B regex) — {num:\\d{1,2}} - {name}/{deeper...} ↔ #{num:\\d{1,2}}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		folder: '{num:\\d{1,2}} - {name}/{deeper...}',
		tag: '#{num:\\d{1,2}}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		notes: 'Like the catch-all but {num:\\d{1,2}} constrains the prefix to 1-2 digits on BOTH sides. The dual-side constraint is critical: without {num:\\d{1,2}} on the tag template too, inverse direction mis-parses tags like "#0-tasks-planning/Q1" by greedy-matching {num} as "0-tasks". Tier B inline regex eliminates this ambiguity.',
	},
	{
		id: 'date-prefixed',
		label: 'Date-prefixed notes (Tier B regex) — {date:\\d{4}-\\d{2}-\\d{2}}/{title} ↔ #notes/{date}/{title | kebab-case}',
		folder: '{date:\\d{4}-\\d{2}-\\d{2}}/{title}',
		tag: '#notes/{date}/{title | kebab-case}',
		notes: 'Captures only YYYY-MM-DD prefixed folders. {date} slot rejects anything not matching the strict ISO date format.',
	},
	{
		id: 'promotion-to-root',
		label: 'Root-only tag (promotion-to-root) — {num} - {name}/{deeper...} ↔ #{num}-{name | strip-invalid-tag-chars | kebab-case}',
		folder: '{num} - {name}/{deeper...}',
		tag: '#{num}-{name | strip-invalid-tag-chars | kebab-case}',
		notes: 'Tag reflects ONLY the root area, ignoring deeper folder structure. File at "0 - Tasks/Q1/X.md" → tag "#0-tasks". File moved to "5 - Archive/Q1/X.md" → tag "#5-archive". Lossy by design (deeper info discarded going to tag), but that\'s the point — promotion-to-root semantics. With the F3 frontmatter witness enabled (per-rule), orphan cleanup correctly removes the old #0-tasks tag when the file moves to area 5.',
	},
	// ─── SEACOW(r) nested implementations ────────────────────────────────
	// Templates following the cyberbase tag-prefix conventions:
	//   #-     → CAPTURE
	//   #--    → ENTITY (+ WORK by composition)
	//   #_     → OUTPUT
	//   #      → RELATION (plain)
	// Source: github.com/cybersader/seacowr-knowledge-platform-meta-framework
	{
		id: 'seacow-capture-clip',
		label: 'SEACOW capture/clip — Capture/Clips/{deeper...} ↔ #-clip/{deeper...}',
		folder: 'Capture/Clips/{deeper...}',
		tag: '#-clip/{deeper...}',
		notes: 'Web clippings + raw captured material. Two-level depth recommended per SEACOW(r) capture rules. The "-" prefix sorts captures together at the top of Obsidian\'s tag pane.',
	},
	{
		id: 'seacow-capture-inbox',
		label: 'SEACOW capture/inbox (marker-only) — Capture/Inbox/{discarded...} ↔ #-inbox',
		folder: 'Capture/Inbox/{discarded...}',
		tag: '#-inbox',
		notes: 'Flat marker tag for inbox items; deeper structure discarded going to tag. Lossy by design. Pair with F3 frontmatter witness (per-rule "Remember origin in frontmatter") for inverse round-trip recovery.',
	},
	{
		id: 'seacow-entity-scoped',
		label: 'SEACOW per-entity scoping — Entity/{owner}/{deeper...} ↔ #--{owner | kebab-case}/{deeper...}',
		folder: 'Entity/{owner}/{deeper...}',
		tag: '#--{owner | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		notes: 'Per-entity namespace. File at "Entity/Cybersader/Projects/Web/note.md" → tag "#--cybersader/Projects/Web/note.md". The "--" prefix marks Entity tags. Bidirectional. Composes naturally with other rules — descendants under Entity/Owner can also match nested rules (Output, Capture, etc.) for multi-axis tagging.',
	},
	{
		id: 'seacow-entity-scoped-jd',
		label: 'SEACOW Entity + JD nested — Entity/{owner}/Output/{num} - {area}/{deeper...}',
		folder: 'Entity/{owner}/Output/{num:\\d{1,2}} - {name}/{deeper...}',
		tag: '#--{owner | kebab-case}/{num}-{name | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		notes: 'Multi-axis: Entity + Output + JD numbering combined. Tier B regex on {num} ensures only digit-prefixed Output folders match. Demonstrates nested implementations — "Entity/Cybersader/Output/01 - Projects/Web Auth" → "#--cybersader/01-projects/Web Auth".',
	},
	{
		id: 'seacow-output-public',
		label: 'SEACOW Output/Public taxonomy — Output/Public/{topic}/{deeper...} ↔ #_/{topic | kebab-case}/{deeper...}',
		folder: 'Output/Public/{topic}/{deeper...}',
		tag: '#_/{topic | strip-invalid-tag-chars | kebab-case}/{deeper...}',
		notes: 'Public-facing audience taxonomy. The "_" prefix marks OUTPUT tags. Deep nesting allowed (per SEACOW Output rules). Round-trips cleanly for inputs without invalid-tag chars.',
	},
	{
		id: 'seacow-daily-notes',
		label: 'Daily notes (date-glob) — 🕸️ Daily Notes/{deeper...} ↔ #daily/{deeper...}',
		folder: '🕸️ Daily Notes/{deeper...}',
		tag: '#daily/{deeper...}',
		notes: 'Daily-notes folder with date-organized children. Plain "#daily" tag for RELATION axis (cross-cutting). Emoji prefix in the literal matches your folder convention exactly.',
	},
	{
		id: 'emoji-prefix',
		label: 'Emoji-prefixed — 📁 Projects/{deeper...} ↔ #projects/{deeper...}',
		folder: '📁 Projects/{deeper...}',
		tag: '#projects/{deeper...}',
	},
	{
		id: 'emoji-jd',
		label: 'Emoji + JD — 📁 01 - Projects/{deeper...} ↔ #projects/{deeper...}',
		folder: '📁 01 - Projects/{deeper...}',
		tag: '#projects/{deeper...}',
	},
	{
		id: 'glob-deep-segmented',
		label: 'Two-slot — Projects/{topic}/{deeper...} ↔ #projects/{topic}/{deeper...}',
		folder: 'Projects/{topic}/{deeper...}',
		tag: '#projects/{topic}/{deeper...}',
	},
	{
		id: 'marker-only',
		label: 'Marker-only (lossy) — Capture/Inbox/{discarded...} ↔ #-inbox',
		folder: 'Capture/Inbox/{discarded...}',
		tag: '#-inbox',
	},
	{
		id: 'kebab-tag',
		label: 'Areas + kebab on tag — Areas/{area} ↔ #areas/{area | kebab-case}',
		folder: 'Areas/{area}',
		tag: '#areas/{area | kebab-case}',
	},
];

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

	// F2 commit 1d — Path Lens template mode toggle. New rules default to
	// 'template'; existing regex-shaped rules open in 'regex' mode.
	// Existing template-shaped rules (folderTemplate set) open in 'template'.
	private editMode: RuleEditorMode = 'template';
	// Template-side validation errors, mirror of regexErrors for the template mode.
	private templateErrors: Record<'folderTemplate' | 'tagTemplate', string | null> = {
		folderTemplate: null,
		tagTemplate: null,
	};

	// Cached vault folder list — computed once on open, reused by the live
	// preview panel on every input change.
	private vaultFolderPaths: string[] = [];
	private previewPanelEl: HTMLElement | null = null;
	// Cleanup hook for window resize listener on the 2-column grid layout.
	private collapseHandler: (() => void) | null = null;

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

		// Initial editor mode:
		//  - existing rule with templates → template mode
		//  - existing rule with only regex → regex mode
		//  - new rule → template mode (canonical authoring path)
		if (this.rule.folderTemplate || this.rule.tagTemplate) {
			this.editMode = 'template';
		} else if (this.rule.folderPattern || this.rule.tagPattern) {
			this.editMode = 'regex';
		} else {
			this.editMode = 'template';
		}
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
		// Wider modal so the 2-column layout has room. CSS clamps to 95vw
		// on narrow viewports; the grid below collapses to 1-column under
		// ~720px container width.
		modalEl.style.width = 'min(1100px, 95vw)';

		// Sticky bottom action bar: contentEl is a flex column with bounded
		// height; bodyEl scrolls; the action row stays pinned. Same pattern
		// as the guided modal, same rationale (Save/Cancel/Delete should
		// never require scroll-hunting on a tall form).
		contentEl.style.display = 'flex';
		contentEl.style.flexDirection = 'column';
		contentEl.style.maxHeight = '85vh';
		contentEl.style.padding = '0';
		contentEl.style.overflow = 'hidden';

		const bodyEl = contentEl.createDiv({ cls: 'dtf-advanced-body' });
		bodyEl.style.flex = '1';
		bodyEl.style.overflowY = 'auto';
		bodyEl.style.minHeight = '0';
		bodyEl.style.padding = '1.5em';

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
		const titleRow = bodyEl.createDiv();
		titleRow.style.display = 'flex';
		titleRow.style.alignItems = 'baseline';
		titleRow.style.justifyContent = 'space-between';
		titleRow.style.gap = '0.5em';
		new Setting(titleRow)
			.setName(this.isNew ? 'Create new rule' : 'Edit rule')
			.setHeading();
		this.renderTryGuidedLink(titleRow);

		// 2-column wide layout: form on the left, sticky live preview on
		// the right. On narrow viewports the right column wraps below.
		// CSS grid auto-fits; preview stays visible while user edits.
		const grid = bodyEl.createDiv({ cls: 'dtf-advanced-grid' });
		grid.style.display = 'grid';
		grid.style.gridTemplateColumns = 'minmax(0, 2fr) minmax(0, 1fr)';
		grid.style.gap = '1em';
		grid.style.alignItems = 'start';

		const leftCol = grid.createDiv({ cls: 'dtf-advanced-form-col' });
		const rightCol = grid.createDiv({ cls: 'dtf-advanced-preview-col' });
		// Sticky preview — stays in view as the user scrolls the form.
		// `position: sticky` requires a scroll container above; the modal
		// content is the scroll container, so this works without extra
		// wiring.
		rightCol.style.position = 'sticky';
		rightCol.style.top = '0';

		// LEFT — form sections
		this.buildBasicInfoSection(leftCol);
		this.buildDirectionSection(leftCol);
		this.buildPatternSection(leftCol);
		this.buildTransformationSection(leftCol);
		this.buildOptionsSection(leftCol);

		// RIGHT — live preview panel (sticky)
		this.buildPreviewSection(rightCol);

		// Action buttons span both columns at the bottom.
		this.buildActionButtons(contentEl);

		// Collapse to single column on narrow viewports — done via a
		// container query proxy: if the modal is below ~720px, drop the
		// right column inline. Re-render hook below also accounts for it.
		const collapseIfNarrow = () => {
			if (modalEl.clientWidth < 720) {
				grid.style.gridTemplateColumns = '1fr';
				rightCol.style.position = 'static';
			} else {
				grid.style.gridTemplateColumns = 'minmax(0, 2fr) minmax(0, 1fr)';
				rightCol.style.position = 'sticky';
				rightCol.style.top = '0';
			}
		};
		collapseIfNarrow();
		window.addEventListener('resize', collapseIfNarrow);
		this.collapseHandler = collapseIfNarrow;

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
			.setName('Priority (override)')
			.setDesc(
				'Within-group tiebreak when multiple rules tie on specificity. ' +
				'After F1 Step 1+2, the engine sorts matches by pattern specificity first; ' +
				'priority only resolves ties. Lower number = higher precedence.'
			)
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

		// F1 Step 3 — Group field (cross-pack precedence cluster)
		new Setting(section)
			.setName('Group')
			.setDesc(
				'Optional cross-pack precedence cluster. Rules in different groups are ' +
				'partitioned by the vault\'s group-precedence list (Settings → Group precedence). ' +
				'Default is the rule\'s pack ID. Leave empty for ungrouped (lowest precedence).'
			)
			.addText(text => text
				.setPlaceholder('For example: para, jd, seacow-cyberbase')
				.setValue(this.rule.group ?? '')
				.onChange(value => {
					const trimmed = value.trim();
					if (trimmed.length === 0) {
						delete this.rule.group;
					} else {
						this.rule.group = trimmed;
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

		// F2 — 4-way mode dropdown. Templates / Lens-flavored / Slot-objects
		// are three peer authoring surfaces over the SAME engine. Regex is the
		// escape hatch for patterns templates cannot express.
		new Setting(section)
			.setName('Authoring shape')
			.setDesc(
				'Template / Lens-flavored / Slot-objects all author Path Lens rules — same engine, ' +
				'different ergonomics. Regex is the power-user escape hatch.',
			)
			.addDropdown(dd => {
				dd.addOption('template', 'Template (Path Lens, simple)');
				dd.addOption('lens-flavored', 'Lens-flavored (Path Lens + assertions)');
				dd.addOption('slot-objects', 'Slot-objects (Path Lens, structured)');
				dd.addOption('regex', 'Regex (advanced)');
				dd.setValue(this.editMode);
				dd.onChange(value => {
					this.editMode = value as RuleEditorMode;
					// Re-render the modal to swap sections. Same pattern as
					// the direction toggle.
					this.onOpen();
				});
			});

		// All 3 template-like modes share the engine; lens-flavored adds
		// assertion fields (iso, cardinality), slot-objects renders slots
		// as structured detail blocks. Each dispatches to its own builder.
		if (this.editMode === 'template') {
			this.buildTemplatePatternSection(section);
			return;
		}
		if (this.editMode === 'lens-flavored') {
			this.buildTemplatePatternSection(section);
			this.buildLensAssertionSection(section);
			return;
		}
		if (this.editMode === 'slot-objects') {
			this.buildSlotObjectsSection(section);
			return;
		}

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

	/**
	 * F2 — interactive template editor with quick-start picker, live sample
	 * previews, slot diff chip, and bijectivity status chip. The previous
	 * version had two empty text boxes with no feedback; this version shows
	 * the user where to begin AND what their template is doing in real time.
	 *
	 * Layout (top → bottom):
	 *   1. Quick-start picker (one-click starter templates)
	 *   2. Folder template input  → live "would match: <vault folder>"
	 *   3. Tag template input     → live "would emit: <tag from sample>"
	 *   4. Slot diff chip (which slots are folder-only / tag-only / shared)
	 *   5. Bijectivity status chip (round-trips / conditional / lossy)
	 *
	 * Used by both 'template' and 'lens-flavored' modes — lens-flavored adds
	 * an assertion section (iso, cardinality) AFTER this returns.
	 */
	private buildTemplatePatternSection(section: HTMLElement) {
		const needsFolder = this.rule.direction === 'folder-to-tag' || this.rule.direction === 'bidirectional';
		const needsTag = this.rule.direction === 'tag-to-folder' || this.rule.direction === 'bidirectional';

		// === 1. Quick-start picker ===
		new Setting(section)
			.setName('Quick-start')
			.setDesc('Pick a starter template to fill both fields. Adjust to fit your vault.')
			.addDropdown(dd => {
				dd.addOption('', '— pick a starter —');
				for (const starter of TEMPLATE_STARTERS) {
					dd.addOption(starter.id, starter.label);
				}
				dd.setValue('');
				dd.onChange(value => {
					if (!value) return;
					const starter = TEMPLATE_STARTERS.find(s => s.id === value);
					if (!starter) return;
					this.rule.folderTemplate = starter.folder;
					this.rule.tagTemplate = starter.tag;
					// F3 auto-enable: when the starter uses lossy filters
					// (strip-invalid-tag-chars / strip-emoji / strip-num-prefix /
					// kebab-case on potentially non-clean inputs), turn on
					// frontmatterMemory so inverse direction can recover
					// the original folder name losslessly via the witness.
					// Also auto-enable removeOrphanedTags so cross-area moves
					// clean up old tags. User can override these defaults.
					const hasLossyFilters = /\bstrip-(invalid-tag-chars|emoji|num-prefix)\b|\bkebab-case\b|\bjoin\(/.test(
						starter.folder + ' ' + starter.tag,
					);
					if (hasLossyFilters) {
						this.rule.options.frontmatterMemory = true;
						this.rule.options.removeOrphanedTags = true;
					}
					// Auto-derive folderPattern + tagPattern so the vault-test
					// preview pane has live data immediately (without waiting
					// for save). Same logic as save-time auto-derivation.
					this.deriveTemplatePatternsForPreview();
					// Preserve scroll position before full re-render — onOpen()
					// rebuilds the modal contents which resets scrollTop to 0.
					const bodyEl = this.contentEl.querySelector('.dtf-advanced-body') as HTMLElement | null;
					const scrollTop = bodyEl?.scrollTop ?? 0;
					this.onOpen();
					requestAnimationFrame(() => {
						const newBody = this.contentEl.querySelector('.dtf-advanced-body') as HTMLElement | null;
						if (newBody) newBody.scrollTop = scrollTop;
					});
				});
			});

		// Inputs + status containers — references closed over by refresh handlers
		let folderInput: HTMLInputElement | null = null;
		let folderErrEl: HTMLElement | null = null;
		let tagInput: HTMLInputElement | null = null;
		let tagErrEl: HTMLElement | null = null;
		let folderSampleEl: HTMLElement | null = null;
		let tagSampleEl: HTMLElement | null = null;

		// === 2. Folder template input + live "would match" preview ===
		if (needsFolder) {
			new Setting(section)
				.setName('Folder template')
				.setDesc(
					'Path Lens template. Empty matches NOTHING — to match every root folder use {root}/{deeper...}. ' +
					'To match a specific root folder + descendants use Projects/{deeper...} (matches "Projects" AND "Projects/X"). ' +
					'Slot kinds: {topic} = single segment, {deeper...} = one or more. ' +
					'Tier B inline regex: {num:\\d{1,2}} = strict 1-2 digit constraint, {date:\\d{4}-\\d{2}-\\d{2}} = ISO-date constraint. Validator rejects regex that could match `/`.',
				)
				.addText(text => {
					folderInput = text.inputEl;
					text
						.setPlaceholder('Projects/{topic}')
						.setValue(this.rule.folderTemplate ?? '')
						.onChange(value => {
							this.rule.folderTemplate = value || undefined;
							this.deriveTemplatePatternsForPreview();
							this.updateTemplateValidationUI('folderTemplate', value, folderInput, folderErrEl);
							refresh();
						});
				});
			folderErrEl = this.makeInlineErrorEl(section);
			folderSampleEl = this.makeInlineSampleEl(section);
			this.updateTemplateValidationUI(
				'folderTemplate',
				this.rule.folderTemplate ?? '',
				folderInput,
				folderErrEl,
			);
		}

		// === 3. Tag template input + live "would emit" preview ===
		if (needsTag) {
			new Setting(section)
				.setName('Tag template')
				.setDesc(
					'Path Lens template. Use the same slot names as the folder template for round-tripping. ' +
					'Add filters like {topic | kebab-case} to normalize tag casing.',
				)
				.addText(text => {
					tagInput = text.inputEl;
					text
						.setPlaceholder('#projects/{topic}')
						.setValue(this.rule.tagTemplate ?? '')
						.onChange(value => {
							this.rule.tagTemplate = value || undefined;
							this.deriveTemplatePatternsForPreview();
							this.updateTemplateValidationUI('tagTemplate', value, tagInput, tagErrEl);
							refresh();
						});
				});
			tagErrEl = this.makeInlineErrorEl(section);
			tagSampleEl = this.makeInlineSampleEl(section);
			this.updateTemplateValidationUI(
				'tagTemplate',
				this.rule.tagTemplate ?? '',
				tagInput,
				tagErrEl,
			);
		}

		// === 4. Slot diff chip (folder-only / tag-only / shared) ===
		const slotDiffEl = section.createDiv({ cls: 'dtf-template-slot-diff' });
		slotDiffEl.style.padding = '0.3em 0.7em';
		slotDiffEl.style.borderRadius = '4px';
		slotDiffEl.style.fontSize = '0.8em';
		slotDiffEl.style.marginTop = '0.4em';
		slotDiffEl.style.marginBottom = '0.4em';
		slotDiffEl.style.display = 'none';

		// === 5. Bijectivity status chip ===
		const statusChip = section.createDiv({ cls: 'dtf-template-chip' });
		statusChip.style.padding = '0.4em 0.7em';
		statusChip.style.borderRadius = '4px';
		statusChip.style.fontSize = '0.85em';
		statusChip.style.marginBottom = '0.6em';
		statusChip.style.display = 'inline-block';

		// Refresh — runs on every input keystroke. Updates samples + slot diff + chip.
		const refresh = () => {
			this.refreshTemplateSamples(folderSampleEl, tagSampleEl);
			this.refreshSlotDiff(slotDiffEl);
			this.refreshBijectivityChip(statusChip);
		};

		refresh();
	}

	/**
	 * Auto-derive folderPattern + tagPattern from the current templates so the
	 * vault-test preview pane (which uses the regex pattern, not the template
	 * source) renders immediately during authoring — no need to wait for save.
	 * Silently no-ops on parse errors; the validation UI surfaces those.
	 */
	private deriveTemplatePatternsForPreview(): void {
		try {
			if (this.rule.folderTemplate) {
				this.rule.folderPattern = compileTemplate(this.rule.folderTemplate).regex.source;
			} else {
				this.rule.folderPattern = undefined;
			}
		} catch { /* parse error shown elsewhere */ }
		try {
			if (this.rule.tagTemplate) {
				this.rule.tagPattern = compileTemplate(this.rule.tagTemplate).regex.source;
			} else {
				this.rule.tagPattern = undefined;
			}
		} catch { /* parse error shown elsewhere */ }
	}

	private makeInlineErrorEl(parent: HTMLElement): HTMLElement {
		const el = parent.createDiv({ cls: 'dtf-template-error' });
		el.style.color = 'var(--text-error)';
		el.style.fontSize = '0.8em';
		el.style.marginTop = '-0.3em';
		el.style.marginBottom = '0.4em';
		el.style.paddingLeft = '0.25em';
		el.style.display = 'none';
		return el;
	}

	private makeInlineSampleEl(parent: HTMLElement): HTMLElement {
		const el = parent.createDiv({ cls: 'dtf-template-sample' });
		el.style.color = 'var(--text-muted)';
		el.style.fontSize = '0.8em';
		el.style.marginTop = '-0.3em';
		el.style.marginBottom = '0.5em';
		el.style.paddingLeft = '0.25em';
		el.style.fontFamily = 'var(--font-monospace)';
		el.style.display = 'none';
		return el;
	}

	/**
	 * Refresh the live sample previews under each input. For folder template,
	 * find a vault folder that the compiled template's regex matches. For
	 * tag template, take that sample folder + run forward sync to compute the
	 * resulting tag. Updates DOM in place.
	 */
	private refreshTemplateSamples(
		folderSampleEl: HTMLElement | null,
		tagSampleEl: HTMLElement | null,
	): void {
		if (folderSampleEl) {
			folderSampleEl.style.display = 'none';
			folderSampleEl.setText('');
			if (!this.rule.folderTemplate) {
				// Empty-template trap: many users assume empty matches "the root".
				// Surface that explicitly so they aren't confused by silent nothing.
				folderSampleEl.setText(
					'⚠ Empty template matches no folders. Try {root}/{deeper...} for every top-level folder, or pick a Quick-start above.',
				);
				folderSampleEl.style.color = 'var(--text-warning, rgb(180, 110, 0))';
				folderSampleEl.style.display = 'block';
			} else {
				try {
					const compiled = compileTemplate(this.rule.folderTemplate);
					// Compute total match count across the whole vault — gives the
					// user immediate intuition for scope ('matches 47 folders' is
					// far more useful than 'matches one sample').
					const allMatches = this.vaultFolderPaths.filter(p => compiled.regex.test(p));
					const sample = allMatches[0];
					if (sample) {
						const slots = extractSlots(compiled, sample);
						const slotPairs = slots
							? Object.entries(slots).map(([k, v]) => `${k}=${v}`).join(', ')
							: '';
						folderSampleEl.setText(
							`✓ matches ${allMatches.length} folder(s). Sample: ${sample}${slotPairs ? `   [${slotPairs}]` : ''}`,
						);
						folderSampleEl.style.color = 'var(--text-success, rgb(40, 140, 70))';
					} else {
						folderSampleEl.setText('⚠ no vault folder matches this template yet');
						folderSampleEl.style.color = 'var(--text-warning, rgb(180, 110, 0))';
					}
					folderSampleEl.style.display = 'block';
				} catch {
					// parse error already shown by validation UI
				}
			}
		}

		if (tagSampleEl) {
			tagSampleEl.style.display = 'none';
			tagSampleEl.setText('');
			if (this.rule.folderTemplate && this.rule.tagTemplate) {
				try {
					const compiled = compileTemplate(this.rule.folderTemplate);
					const allMatches = this.vaultFolderPaths.filter(p => compiled.regex.test(p));
					const sample = allMatches[0];
					if (sample) {
						const fwdResult = applyTemplateRuleForward(sample, this.rule);
						if (fwdResult.tags.length > 0) {
							// Compute distinct emitted tags across all matches (deduped).
							const allEmittedTags = new Set<string>();
							for (const folder of allMatches) {
								try {
									const r = applyTemplateRuleForward(folder, this.rule);
									for (const t of r.tags) allEmittedTags.add(t);
								} catch { /* skip */ }
							}
							tagSampleEl.setText(
								`→ would emit ${allEmittedTags.size} distinct tag(s). Sample: ${fwdResult.tags[0]}`,
							);
							tagSampleEl.style.color = 'var(--text-success, rgb(40, 140, 70))';
							tagSampleEl.style.display = 'block';
						}
					}
				} catch {
					// parse error already shown
				}
			}
		}
	}

	/**
	 * Refresh the slot diff chip. Shows which slots are folder-only / tag-only
	 * / shared. Color-codes shared slots green (round-trip), folder-only
	 * yellow (matched-but-discarded), tag-only red (unsourced — config error).
	 */
	private refreshSlotDiff(slotDiffEl: HTMLElement): void {
		slotDiffEl.empty();
		slotDiffEl.style.display = 'none';
		if (!this.rule.folderTemplate || !this.rule.tagTemplate) return;

		let folderSlots: string[] = [];
		let tagSlots: string[] = [];
		try {
			folderSlots = compileTemplate(this.rule.folderTemplate).slots.map(s => s.name);
			tagSlots = compileTemplate(this.rule.tagTemplate).slots.map(s => s.name);
		} catch {
			return; // parse errors handled elsewhere
		}

		const shared = folderSlots.filter(n => tagSlots.includes(n));
		const folderOnly = folderSlots.filter(n => !tagSlots.includes(n));
		const tagOnly = tagSlots.filter(n => !folderSlots.includes(n));

		if (shared.length === 0 && folderOnly.length === 0 && tagOnly.length === 0) return;

		slotDiffEl.style.display = 'flex';
		slotDiffEl.style.flexWrap = 'wrap';
		slotDiffEl.style.gap = '0.4em';
		slotDiffEl.style.background = 'var(--background-modifier-form-field)';

		const addBadge = (label: string, color: string, bg: string) => {
			const badge = slotDiffEl.createSpan();
			badge.setText(label);
			badge.style.padding = '0.1em 0.5em';
			badge.style.borderRadius = '3px';
			badge.style.color = color;
			badge.style.background = bg;
			badge.style.fontFamily = 'var(--font-monospace)';
		};

		for (const name of shared) {
			addBadge(`✓ {${name}}`, 'rgb(40, 140, 70)', 'rgba(80, 200, 120, 0.18)');
		}
		for (const name of folderOnly) {
			addBadge(`⚠ {${name}} folder-only`, 'rgb(180, 110, 0)', 'rgba(240, 180, 50, 0.18)');
		}
		for (const name of tagOnly) {
			addBadge(`✗ {${name}} tag-only`, 'rgb(170, 50, 50)', 'rgba(220, 90, 90, 0.18)');
		}
	}

	private refreshBijectivityChip(statusChip: HTMLElement): void {
		if (!this.rule.folderTemplate || !this.rule.tagTemplate) {
			statusChip.style.background = 'var(--background-modifier-hover)';
			statusChip.style.color = 'var(--text-muted)';
			statusChip.setText('Authoring — both templates required for bijectivity check');
			return;
		}
		const verdict = computeBijectivity(this.rule.folderTemplate, this.rule.tagTemplate);
		if (verdict.status === 'total') {
			statusChip.style.background = 'rgba(80, 200, 120, 0.15)';
			statusChip.style.color = 'rgb(40, 140, 70)';
			const slotNames = Object.keys(verdict.perSlot);
			statusChip.setText(
				slotNames.length > 0
					? `✓ Round-trips. Shared slots: ${slotNames.map((n) => `{${n}}`).join(', ')}`
					: '✓ Round-trips (literal-only).',
			);
		} else if (verdict.status === 'conditional') {
			statusChip.style.background = 'rgba(240, 180, 50, 0.18)';
			statusChip.style.color = 'rgb(180, 110, 0)';
			statusChip.setText(`⚠ Conditional bijection — ${verdict.reason ?? 'depends on input domain'}`);
		} else {
			statusChip.style.background = 'rgba(220, 90, 90, 0.16)';
			statusChip.style.color = 'rgb(170, 50, 50)';
			statusChip.setText(`✗ Lossy — ${verdict.reason ?? 'cannot reverse'}`);
		}
	}

	/**
	 * F2 commit 2 — Lens-flavored authoring shape.
	 *
	 * Same templates as the simple Template mode (rendered above this section
	 * via buildTemplatePatternSection), PLUS explicit lens-calculus assertion
	 * fields:
	 *
	 *   - cardinality: '1:1' / '1:many' / 'many:1' / 'many:many'
	 *   - iso (bijective assertion): user can assert total bijection even
	 *     when the engine's automatic verdict says 'conditional'. The engine
	 *     computes its own verdict at load time; this is the user's override
	 *     for cases where they know their inputs respect the reversibility
	 *     domain (e.g., they always use lowercase folder names so kebab-case
	 *     round-trips cleanly).
	 *
	 * Both fields persist to MappingRule.cardinality + MappingRule.bijective
	 * (existing fields — no type change needed).
	 */
	private buildLensAssertionSection(section: HTMLElement): void {
		const lensSection = section.createDiv({ cls: 'dtf-lens-assertions' });
		lensSection.style.padding = '0.6em 0.8em';
		lensSection.style.background = 'var(--background-modifier-form-field)';
		lensSection.style.borderLeft = '3px solid var(--interactive-accent)';
		lensSection.style.borderRadius = '4px';
		lensSection.style.marginTop = '0.6em';
		lensSection.style.marginBottom = '0.6em';

		const heading = lensSection.createDiv();
		heading.style.fontWeight = '600';
		heading.style.fontSize = '0.95em';
		heading.style.marginBottom = '0.4em';
		heading.setText('Lens-calculus assertions');

		const explainer = lensSection.createDiv();
		explainer.style.fontSize = '0.8em';
		explainer.style.color = 'var(--text-muted)';
		explainer.style.marginBottom = '0.6em';
		explainer.setText(
			"Assert lens-calculus properties of this rule. The engine still computes its own verdict — these are your overrides for cases where you know your data respects the reversibility domain.",
		);

		new Setting(lensSection)
			.setName('Cardinality')
			.setDesc('Folder→tag relationship. 1:1 means each folder produces one unique tag, vice versa.')
			.addDropdown(dd => {
				dd.addOption('', 'Auto (engine decides)');
				dd.addOption('1:1', '1:1 — bijective');
				dd.addOption('1:many', '1:many — one folder, many tags (post-coordination)');
				dd.addOption('many:1', 'Many:1 — many folders, one tag (collapse / aggregate)');
				dd.addOption('many:many', 'Many:many — fully cross-cutting (rare)');
				dd.setValue(this.rule.cardinality ?? '');
				dd.onChange(value => {
					this.rule.cardinality = (value || undefined) as MappingRule['cardinality'];
				});
			});

		new Setting(lensSection)
			.setName('Iso (assert total bijection)')
			.setDesc('Override the engine if you know your inputs round-trip cleanly. Off = trust the engine verdict.')
			.addToggle(toggle => {
				toggle
					.setValue(this.rule.bijective === true)
					.onChange(value => {
						this.rule.bijective = value;
					});
			});
	}

	/**
	 * F2 commit 3 — Slot-objects authoring shape.
	 *
	 * Renders a structured view of the slots parsed from the current
	 * folderTemplate + tagTemplate. Read-only inspector for v1 — user
	 * authors via the template inputs above; this section visualizes
	 * the structure. Editing slots from the inspector is post-MVP polish.
	 *
	 * Per-slot row shows: name, kind (segment / glob), filter pipeline,
	 * presence on folder side / tag side / both.
	 */
	private buildSlotObjectsSection(section: HTMLElement): void {
		// Re-render the standard template input area first so the user can
		// see the templates they're editing slots within. The slot-objects
		// editor below the templates lets them edit per-slot details (regex,
		// filters) without re-typing the inline `{name:regex|filter}` syntax.
		this.buildTemplatePatternSection(section);

		const inspectorSection = section.createDiv({ cls: 'dtf-slot-objects-inspector' });
		inspectorSection.style.marginTop = '0.6em';
		inspectorSection.style.padding = '0.6em 0.8em';
		inspectorSection.style.background = 'var(--background-modifier-form-field)';
		inspectorSection.style.borderLeft = '3px solid var(--interactive-accent)';
		inspectorSection.style.borderRadius = '4px';

		const heading = inspectorSection.createDiv();
		heading.style.fontWeight = '600';
		heading.style.fontSize = '0.95em';
		heading.style.marginBottom = '0.4em';
		heading.setText('Slot definitions');

		const explainer = inspectorSection.createDiv();
		explainer.style.fontSize = '0.8em';
		explainer.style.color = 'var(--text-muted)';
		explainer.style.marginBottom = '0.6em';
		explainer.setText(
			"Edit per-slot regex + filters here without typing the inline syntax. Slot existence + kind (segment/glob) are still defined by the templates above. Changes here re-emit the templates with updated slot details.",
		);

		const tableEl = inspectorSection.createEl('table');
		tableEl.style.width = '100%';
		tableEl.style.borderCollapse = 'collapse';
		tableEl.style.fontSize = '0.85em';

		this.renderSlotObjectsTable(tableEl);

		// Refresh table when templates change in the inputs above
		section.addEventListener('input', () => {
			this.renderSlotObjectsTable(tableEl);
		});
	}

	private renderSlotObjectsTable(tableEl: HTMLElement): void {
		tableEl.empty();

		const headerRow = tableEl.createEl('tr');
		for (const colHeader of ['Slot', 'Kind', 'Inline regex', 'Filters (folder | tag)', 'Sides']) {
			const th = headerRow.createEl('th');
			th.setText(colHeader);
			th.style.textAlign = 'left';
			th.style.padding = '0.3em 0.5em';
			th.style.borderBottom = '1px solid var(--background-modifier-border)';
			th.style.fontWeight = '600';
		}

		let folderCompiled: ReturnType<typeof compileTemplate> | null = null;
		let tagCompiled: ReturnType<typeof compileTemplate> | null = null;
		try {
			if (this.rule.folderTemplate) folderCompiled = compileTemplate(this.rule.folderTemplate);
		} catch { /* shown in template error UI */ }
		try {
			if (this.rule.tagTemplate) tagCompiled = compileTemplate(this.rule.tagTemplate);
		} catch { /* shown in template error UI */ }

		const folderSlots = folderCompiled?.slots ?? [];
		const tagSlots = tagCompiled?.slots ?? [];
		const allSlotNames = [...new Set([
			...folderSlots.map(s => s.name),
			...tagSlots.map(s => s.name),
		])];

		if (allSlotNames.length === 0) {
			const emptyRow = tableEl.createEl('tr');
			const td = emptyRow.createEl('td');
			td.colSpan = 5;
			td.style.padding = '0.4em 0.5em';
			td.style.color = 'var(--text-muted)';
			td.style.fontStyle = 'italic';
			td.setText('No slots yet — add {name} or {name...} to your templates above');
			return;
		}

		for (const name of allSlotNames) {
			const folderSlot = folderSlots.find(s => s.name === name);
			const tagSlot = tagSlots.find(s => s.name === name);
			const onFolder = !!folderSlot;
			const onTag = !!tagSlot;

			const row = tableEl.createEl('tr');

			// Column 1: slot name (read-only — defined by template, not here)
			const nameTd = row.createEl('td');
			nameTd.setText(`{${name}}`);
			nameTd.style.padding = '0.25em 0.5em';
			nameTd.style.borderBottom = '1px solid var(--background-modifier-border)';
			nameTd.style.fontFamily = 'var(--font-monospace)';
			nameTd.style.fontWeight = '600';

			// Column 2: kind
			const kindTd = row.createEl('td');
			kindTd.setText((folderSlot ?? tagSlot)?.kind ?? '');
			kindTd.style.padding = '0.25em 0.5em';
			kindTd.style.borderBottom = '1px solid var(--background-modifier-border)';
			kindTd.style.fontFamily = 'var(--font-monospace)';
			kindTd.style.color = 'var(--text-muted)';

			// Column 3: editable inline regex (applies to BOTH sides if either has it)
			const regexTd = row.createEl('td');
			regexTd.style.padding = '0.25em 0.5em';
			regexTd.style.borderBottom = '1px solid var(--background-modifier-border)';
			const currentRegex = folderSlot?.inlineRegex ?? tagSlot?.inlineRegex ?? '';
			const regexInput = regexTd.createEl('input', { type: 'text' });
			regexInput.value = currentRegex;
			regexInput.placeholder = '— none —';
			regexInput.style.fontFamily = 'var(--font-monospace)';
			regexInput.style.fontSize = '0.85em';
			regexInput.style.width = '100%';
			regexInput.style.padding = '0.15em 0.3em';
			regexInput.addEventListener('change', () => {
				this.updateSlotInTemplates(name, { inlineRegex: regexInput.value || undefined });
				this.onOpen();
			});

			// Column 4: filters input (comma-separated)
			const filtersTd = row.createEl('td');
			filtersTd.style.padding = '0.25em 0.5em';
			filtersTd.style.borderBottom = '1px solid var(--background-modifier-border)';

			const folderFiltersInput = filtersTd.createEl('input', { type: 'text' });
			folderFiltersInput.placeholder = 'Folder-side filters';
			folderFiltersInput.value = (folderSlot?.filters ?? []).join(' | ');
			folderFiltersInput.style.fontFamily = 'var(--font-monospace)';
			folderFiltersInput.style.fontSize = '0.85em';
			folderFiltersInput.style.width = 'calc(50% - 0.2em)';
			folderFiltersInput.style.marginRight = '0.4em';
			folderFiltersInput.style.padding = '0.15em 0.3em';
			folderFiltersInput.title = 'Folder-side filters, pipe-separated. E.g. "kebab-case" or "strip-emoji | kebab-case"';
			folderFiltersInput.addEventListener('change', () => {
				const filters = folderFiltersInput.value.split('|').map(s => s.trim()).filter(s => s.length > 0);
				this.updateSlotInTemplates(name, { folderFilters: filters }, 'folder');
				this.onOpen();
			});

			const tagFiltersInput = filtersTd.createEl('input', { type: 'text' });
			tagFiltersInput.placeholder = 'Tag-side filters';
			tagFiltersInput.value = (tagSlot?.filters ?? []).join(' | ');
			tagFiltersInput.style.fontFamily = 'var(--font-monospace)';
			tagFiltersInput.style.fontSize = '0.85em';
			tagFiltersInput.style.width = 'calc(50% - 0.2em)';
			tagFiltersInput.style.padding = '0.15em 0.3em';
			tagFiltersInput.title = 'Tag-side filters, pipe-separated.';
			tagFiltersInput.addEventListener('change', () => {
				const filters = tagFiltersInput.value.split('|').map(s => s.trim()).filter(s => s.length > 0);
				this.updateSlotInTemplates(name, { tagFilters: filters }, 'tag');
				this.onOpen();
			});

			// Column 5: presence indicator
			const sidesTd = row.createEl('td');
			sidesTd.setText(`${onFolder ? '✓' : '✗'} folder · ${onTag ? '✓' : '✗'} tag`);
			sidesTd.style.padding = '0.25em 0.5em';
			sidesTd.style.borderBottom = '1px solid var(--background-modifier-border)';
			sidesTd.style.fontSize = '0.8em';
			sidesTd.style.color = 'var(--text-muted)';
		}
	}

	/**
	 * Slot-objects edit support — splices an updated slot definition into the
	 * folder + tag templates by replacing just that slot's `{...}` block in
	 * place. Preserves all literal content around the slot. The user defines
	 * slot existence + kind via the template inputs; this method handles the
	 * detail-update pathway (regex, filters).
	 *
	 * For regex updates: applies to both sides (if slot exists on both).
	 * For filter updates: applied per side (folder vs tag).
	 */
	private updateSlotInTemplates(
		name: string,
		change: { inlineRegex?: string | undefined; folderFilters?: string[]; tagFilters?: string[] },
		side?: 'folder' | 'tag',
	): void {
		const updateOne = (template: string | undefined, sideKey: 'folder' | 'tag'): string | undefined => {
			if (!template) return template;
			let compiled: ReturnType<typeof compileTemplate>;
			try {
				compiled = compileTemplate(template);
			} catch {
				return template; // can't update on parse errors; user will see error in UI
			}
			const slot = compiled.slots.find(s => s.name === name);
			if (!slot) return template;
			// Find the slot's `{...}` block in the source by walking forward
			// from `slot.templatePosition` and matching closing brace.
			const open = slot.templatePosition;
			let depth = 1;
			let close = -1;
			for (let j = open + 1; j < template.length; j++) {
				if (template[j] === '{') depth++;
				else if (template[j] === '}') {
					depth--;
					if (depth === 0) { close = j; break; }
				}
			}
			if (close === -1) return template;
			// Build new slot body: name + (...) suffix + (:regex)? + (| filters)?
			const newRegex = change.inlineRegex !== undefined ? change.inlineRegex : slot.inlineRegex;
			const newFilters =
				sideKey === 'folder' && change.folderFilters !== undefined ? change.folderFilters
				: sideKey === 'tag' && change.tagFilters !== undefined ? change.tagFilters
				: slot.filters;
			let body = name;
			if (newRegex) body += `:${newRegex}`;
			if (slot.kind === 'glob') body += '...';
			if (newFilters.length > 0) body += ' | ' + newFilters.join(' | ');
			return template.slice(0, open) + '{' + body + '}' + template.slice(close + 1);
		};

		// Regex applies to both sides; filters are side-specific
		if (change.inlineRegex !== undefined) {
			this.rule.folderTemplate = updateOne(this.rule.folderTemplate, 'folder');
			this.rule.tagTemplate = updateOne(this.rule.tagTemplate, 'tag');
		} else if (side === 'folder') {
			this.rule.folderTemplate = updateOne(this.rule.folderTemplate, 'folder');
		} else if (side === 'tag') {
			this.rule.tagTemplate = updateOne(this.rule.tagTemplate, 'tag');
		}
	}

	private updateTemplateValidationUI(
		field: 'folderTemplate' | 'tagTemplate',
		value: string,
		inputEl: HTMLInputElement | null,
		errorEl: HTMLElement | null,
	) {
		if (!inputEl || !errorEl) return;
		if (!value) {
			this.templateErrors[field] = null;
			inputEl.removeClass('dtf-input-invalid');
			inputEl.style.borderColor = '';
			errorEl.style.display = 'none';
			errorEl.setText('');
			return;
		}
		try {
			compileTemplate(value);
			this.templateErrors[field] = null;
			inputEl.removeClass('dtf-input-invalid');
			inputEl.style.borderColor = '';
			errorEl.style.display = 'none';
			errorEl.setText('');
		} catch (e) {
			const msg = e instanceof TemplateParseError
				? e.message.split('\n')[0].replace('Template parse error at position ', 'Position ')
				: (e as Error).message;
			this.templateErrors[field] = msg;
			inputEl.addClass('dtf-input-invalid');
			inputEl.style.borderColor = 'var(--text-error)';
			errorEl.style.display = 'block';
			errorEl.setText(msg);
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
				// applyRuleForward (and applyTemplateRuleForward) already
				// return tags with their `#` prefix. Don't double-prepend.
				const tagPart = preview.opaqueByDesign
					? '(no tag emitted)'
					: sample.tags
							.map((t) => (t.startsWith('#') ? t : `#${t}`))
							.join(', ');
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
		// Sticky bottom: flex-shrink: 0 holds full height even on short forms;
		// opaque background prevents scrolled body content from bleeding
		// through; flex layout puts buttons in a row instead of stacking
		// (browser default for buttons is inline-block but each click
		// handler used to render with no spacing in some Obsidian themes).
		buttonContainer.style.flexShrink = '0';
		buttonContainer.style.display = 'flex';
		buttonContainer.style.gap = '0.5em';
		buttonContainer.style.justifyContent = 'flex-end';
		buttonContainer.style.padding = '0.7em 1.5em';
		buttonContainer.style.background = 'var(--background-primary)';
		buttonContainer.style.borderTop = '1px solid var(--background-modifier-border)';

		// Save button
		const saveButton = buttonContainer.createEl('button', {
			text: this.isNew ? 'Create rule' : 'Save changes',
			cls: 'mod-cta'
		});

		saveButton.addEventListener('click', () => {
			// F2 — template-like save (template / lens-flavored / slot-objects):
			// validate templates parse, auto-derive folderPattern + tagPattern
			// from compiled regex, and clear the legacy regex fields if present
			// (rule shape mutual exclusivity). Lens-flavored adds iso + cardinality
			// fields; slot-objects round-trips to a template string.
			if (this.editMode === 'template' || this.editMode === 'lens-flavored' || this.editMode === 'slot-objects') {
				const templateProblems: string[] = [];
				if (this.templateErrors.folderTemplate) {
					templateProblems.push(`Folder template: ${this.templateErrors.folderTemplate}`);
				}
				if (this.templateErrors.tagTemplate) {
					templateProblems.push(`Tag template: ${this.templateErrors.tagTemplate}`);
				}
				if (templateProblems.length > 0) {
					new Notice(`Fix template errors before saving: ${templateProblems.join('; ')}`);
					return;
				}

				// Direction-specific requirements
				const needsFolder = this.rule.direction === 'folder-to-tag' || this.rule.direction === 'bidirectional';
				const needsTag = this.rule.direction === 'tag-to-folder' || this.rule.direction === 'bidirectional';
				if (needsFolder && !this.rule.folderTemplate) {
					new Notice('Folder template is required for the selected direction.');
					return;
				}
				if (needsTag && !this.rule.tagTemplate) {
					new Notice('Tag template is required for the selected direction.');
					return;
				}

				// Auto-derive runtime patterns from compiled templates so the
				// matcher gates work. Same logic as rulePackLoader.validateTemplateRule.
				try {
					if (this.rule.folderTemplate) {
						this.rule.folderPattern = compileTemplate(this.rule.folderTemplate).regex.source;
					} else {
						this.rule.folderPattern = undefined;
					}
					if (this.rule.tagTemplate) {
						this.rule.tagPattern = compileTemplate(this.rule.tagTemplate).regex.source;
					} else {
						this.rule.tagPattern = undefined;
					}
				} catch (e) {
					new Notice(`Template compile failed at save: ${(e as Error).message}`);
					return;
				}

				// Stash the bijectivity verdict
				if (this.rule.folderTemplate && this.rule.tagTemplate) {
					const verdict = computeBijectivity(this.rule.folderTemplate, this.rule.tagTemplate);
					this.rule.bijective = verdict.status === 'total';
				}
			} else {
				// Regex mode — clear template fields so the rule shape stays clean.
				this.rule.folderTemplate = undefined;
				this.rule.tagTemplate = undefined;

				// Block save on invalid regex.
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
			}

			const validation = validateRule(this.rule);

			if (!validation.valid) {
				new Notice(`Invalid rule: ${validation.errors.join(', ')}`);
				return;
			}

			// Save-time confirmation: show how many folders will be touched
			// when this rule fires. Gives a final intuition check + makes the
			// commitment explicit. NEW rules with > 0 matches show the dialog;
			// edits to existing rules skip it (less surprising).
			if (this.isNew) {
				let folderMatchCount = 0;
				if (this.rule.folderPattern) {
					try {
						const re = new RegExp(this.rule.folderPattern);
						folderMatchCount = this.vaultFolderPaths.filter(p => re.test(p)).length;
					} catch { /* invalid regex — caught above */ }
				}
				const isLossy = !!(
					(this.rule.folderTemplate || '') + ' ' + (this.rule.tagTemplate || '')
				).match(/\bstrip-(invalid-tag-chars|emoji|num-prefix)\b|\bjoin\(/);
				const lossyNote = isLossy
					? '\n\nThis rule has lossy filters. The witness (frontmatterMemory) was auto-enabled so inverse direction recovers original folder names.'
					: '';
				const proceed = confirm(
					`Create rule "${this.rule.name}"?\n\n` +
					`On save: this rule will be added to your settings (enabled). It will fire automatically on file create/move events going forward.\n\n` +
					`Forward direction will match ${folderMatchCount} folder(s) in your current vault.${lossyNote}\n\n` +
					`Existing files won't be touched until you run "Sync entire vault" or "Preview vault sync" from the command palette.`,
				);
				if (!proceed) return;
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
				new ConfirmModal(this.app, {
					title: 'Delete rule?',
					body: `"${this.rule.name}" cannot be recovered.`,
					confirmLabel: 'Delete',
					destructive: true,
					onConfirm: () => {
						this.onSave(null);
						new Notice(`Rule "${this.rule.name}" deleted`);
						this.close();
					},
				}).open();
			});
		}
	}

	onClose() {
		const { contentEl } = this;
		contentEl.empty();
		// Detach the resize listener that drives the 2-column → 1-column
		// collapse — would otherwise leak across modal opens.
		if (this.collapseHandler) {
			window.removeEventListener('resize', this.collapseHandler);
			this.collapseHandler = null;
		}
	}
}
