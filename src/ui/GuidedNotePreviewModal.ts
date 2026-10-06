import { App, Modal } from 'obsidian';
import type { MappingRule } from '../types/settings';
import { GuidedNotePreviewRunner, type PreviewNoteRow } from '../engine/guidedNotePreviewRunner';
import { createGuidedPreviewReadPort } from '../engine/guidedPreviewReadPort';

export interface GuidedNotePreviewContext {
	getRules(): readonly MappingRule[];
	getPrecedence(): readonly string[];
}
export interface GuidedNoteDraftSource {
	getDraft(): MappingRule;
	getFormFingerprint(): string;
}

/** Standalone read-only surface. Deliberately receives neither plugin nor save/log callbacks. */
export class GuidedNotePreviewModal extends Modal {
	private runner: GuidedNotePreviewRunner | null = null;
	private shown = 25;
	private pagingUsed = false;
	private removeFocus: (() => void) | null = null;
	private statusEl!: HTMLElement;
	private countsEl!: HTMLElement;
	private headlineEl!: HTMLElement;
	private incompleteEl!: HTMLElement;
	private directionEl!: HTMLElement;
	private fieldsEl!: HTMLElement;
	private rowsEl!: HTMLElement;
	private againBtn!: HTMLButtonElement;
	private cancelBtn!: HTMLButtonElement;
	private moreBtn!: HTMLButtonElement;
	private renderedPaths = new Set<string>();
	private renderedPlan: object | null = null;
	constructor(app: App, private readonly context: GuidedNotePreviewContext, private readonly draft: GuidedNoteDraftSource) { super(app); }
	onOpen(): void {
		this.modalEl.addClass('dtf-note-preview-modal');
		this.buildShell();
		this.runner = new GuidedNotePreviewRunner(createGuidedPreviewReadPort(this.app, () => ({
			draft: this.draft.getDraft(), rules: this.context.getRules(), precedence: this.context.getPrecedence(),
			formFingerprint: this.draft.getFormFingerprint(),
		})), () => this.render());
		const window = this.contentEl.ownerDocument.defaultView!;
		const check = () => this.runner?.checkFreshness();
		window.addEventListener('focus', check); this.contentEl.addEventListener('focusin', check);
		this.removeFocus = () => { window.removeEventListener('focus', check); this.contentEl.removeEventListener('focusin', check); };
		const activate = (event: KeyboardEvent) => {
			const control = (event.target as HTMLElement | null)?.closest?.('button, summary') as HTMLElement | null;
			control?.click();
		};
		// Stop Enter/Escape at both DOM and keymap boundaries. Summary activation remains available.
		this.modalEl.addEventListener('keydown', (event) => {
			if (event.key !== 'Enter' && event.key !== 'Escape') return;
			event.stopImmediatePropagation(); event.preventDefault();
			if (event.key === 'Escape') this.close();
			else if (!event.ctrlKey && !event.metaKey && !event.isComposing) activate(event);
		}, true);
		this.scope.register([], 'Escape', () => { this.close(); return false; });
		this.scope.register(['Mod'], 'Enter', () => false);
		this.scope.register([], 'Enter', (event) => { activate(event); return false; });
		void this.runner.run();
	}
	private buildShell(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.createEl('h2', { text: 'Preview note changes' });
		contentEl.createEl('p', { text: 'Preview only — nothing saved, enabled, or applied.', cls: 'dtf-note-preview-notice' });
		this.directionEl = contentEl.createEl('p');
		this.headlineEl = contentEl.createEl('p', { cls: 'dtf-note-preview-headline' });
		this.statusEl = contentEl.createEl('p', { cls: 'dtf-note-preview-status', attr: { role: 'status', 'aria-live': 'polite' } });
		this.incompleteEl = contentEl.createEl('p', { text: 'Results below are incomplete or stale, not a complete current prediction.' });
		const about = contentEl.createEl('details', { cls: 'dtf-note-preview-about' });
		about.createEl('summary', { text: 'About this preview' });
		this.countsEl = about.createEl('p', { cls: 'dtf-note-preview-counts' });
		about.createEl('p', { text: 'The unsaved rule is treated as if enabled for forward processing only. This is a point-in-time snapshot, not continuously fresh, a write-permission guarantee or concurrency protection. It predicts tag sets, not exact YAML bytes or rollback. Reverse movement and reverse safety are not certified.' });
		about.createEl('p', { text: 'Only matching notes and the original edited rule’s former coverage are read. Additions use disk and metadata-cache tags together; a write reconstructs from disk parsing. Unsupported or mismatched parsing is warned per note. Tracking records can include human-authored tags. No note bodies or unrelated properties are retained.' });
		this.fieldsEl = contentEl.createDiv();
		const actions = contentEl.createDiv({ cls: 'dtf-note-preview-actions' });
		actions.createEl('button', { text: 'Back to editing' }).addEventListener('click', () => this.close());
		this.againBtn = actions.createEl('button', { text: 'Preview again' });
		this.againBtn.addEventListener('click', () => {
			this.runner?.checkFreshness(); this.shown = 25; this.pagingUsed = false; void this.runner?.run();
		});
		this.cancelBtn = actions.createEl('button', { text: 'Cancel scan' });
		this.cancelBtn.addEventListener('click', () => this.runner?.cancel());
		this.rowsEl = contentEl.createDiv({ cls: 'dtf-note-preview-rows' });
		this.moreBtn = contentEl.createEl('button', { text: 'Show more' });
		this.moreBtn.addEventListener('click', () => {
			this.runner?.checkFreshness();
			if ((this.runner?.result?.rows.length ?? 0) <= this.shown) return;
			this.pagingUsed = true; this.shown += 25; this.render();
		});
	}
	private render(): void {
		const result = this.runner?.result;
		if (!result) return;
		// Only an explicit new snapshot resets result rows. Progress, stale/cancel and paging
		// keep control and existing row identities, focus, scroll and expanded disclosures.
		if (this.renderedPlan !== result.plan) {
			this.renderedPlan = result.plan; this.renderedPaths.clear(); this.rowsEl.empty(); this.fieldsEl.empty();
			const fields = result.plan?.changedFields ?? [];
			if (fields.length) {
				const details = this.fieldsEl.createEl('details', { cls: 'dtf-note-preview-warning' });
				details.createEl('summary', { text: 'Saving from this editor would change advanced options or the rule group. This preview includes those changes.' });
				const display = (field: string, value: unknown): string => value === null
					? field === 'group' ? 'No group' : 'Not set'
					: typeof value === 'boolean' ? value ? 'On' : 'Off' : String(value);
				for (const f of fields) details.createEl('p', { text: `${f.field}: ${display(f.field, f.before)} → ${display(f.field, f.after)}` });
			}
		}
		this.contentEl.dataset.dtfNotePreviewStatus = result.status;
		this.directionEl.setText(result.plan?.draft.direction === 'bidirectional'
			? 'Folder → tag only. Locations unchanged; reverse movement is not previewed.'
			: result.plan?.refusal ? 'Reverse-only rule. Movement preview unavailable.' : 'Folder → tag only. Note locations stay unchanged.');
		this.headlineEl.hidden = !!result.plan?.refusal || result.status === 'error';
		const invalid = result.rows.filter((r) => r.state === 'invalid').length;
		this.headlineEl.setText(`${result.changed} notes would change · ${result.unchanged} with no tag changes`
			+ (invalid ? ` · ${invalid} invalid` : '') + (result.failed ? ` · ${result.failed} unreadable` : ''));
		this.statusEl.setText(result.message);
		this.statusEl.hidden = result.status === 'complete' && !result.plan?.refusal;
		this.countsEl.setText(`${result.total} Markdown paths scanned · ${result.relevant} relevant · ${result.examined} examined · ${result.changed} changed · ${result.unchanged} no tag changes · ${result.skipped} out of scope · ${result.failed} unreadable · ${result.rows.filter((r) => r.state === 'invalid').length} invalid`);
		this.incompleteEl.hidden = result.status === 'complete';
		this.againBtn.disabled = result.status === 'scanning';
		if (this.cancelBtn === this.contentEl.ownerDocument.activeElement && result.status !== 'scanning') this.againBtn.focus();
		this.cancelBtn.hidden = result.status !== 'scanning';
		for (const row of result.rows.slice(0, this.shown)) {
			if (this.renderedPaths.has(row.path)) continue;
			this.renderRow(this.rowsEl, row); this.renderedPaths.add(row.path);
		}
		if (!result.rows.length && result.status === 'complete' && !result.plan?.refusal && !this.rowsEl.childElementCount) this.rowsEl.createEl('p', { text: 'No relevant notes matched the draft or the original edited rule.' });
		const remaining = Math.max(0, result.rows.length - this.shown);
		this.moreBtn.hidden = remaining === 0 && !this.pagingUsed;
		this.moreBtn.setText(remaining ? `Show more (${remaining} remaining)` : 'All notes shown');
		this.moreBtn.setAttribute('aria-disabled', remaining ? 'false' : 'true');
	}
	private renderRow(parent: HTMLElement, row: PreviewNoteRow): void {
		const el = parent.createEl('article', { cls: 'dtf-note-preview-row' }); el.dataset.dtfNotePath = row.path;
		el.createEl('h3', { text: row.path });
		const states = { changed: 'Tag changes', unchanged: 'Already present — no changes', 'no-match': 'No matching forward rule — no changes', empty: 'Empty output — valid no-change result', invalid: 'Invalid winning output — prediction blocked', unreadable: 'Unreadable — not predicted' };
		el.createEl('p', { text: states[row.state], cls: 'dtf-note-preview-row-state' });
		const show = (label: string, tags: readonly string[]) => {
			const line = el.createEl('p'); line.createEl('strong', { text: `${label}: ` }); line.createSpan({ text: tags.length ? tags.join(' · ') : 'None' });
		};
		if (row.delta) {
			show('Existing frontmatter tags (disk parsed)', row.delta.currentTags);
			show('Add', row.delta.added); show('Remove', row.delta.removed); show('Unchanged tags', row.delta.unchanged);
			if (row.delta.witnessWritten) el.createEl('p', { text: 'A live write would also update the tracking record; it may include human-authored tags.' });
		}
		el.createEl('p', { text: `Unchanged folder: ${row.folder.folderPath || 'Vault root'}` });
		if (row.error) el.createEl('p', { text: row.error, cls: 'dtf-note-preview-warning' });
		for (const warning of row.warnings) el.createEl('p', { text: warning, cls: 'dtf-note-preview-warning' });
		const hypothetical = row.folder.hypothetical;
		if (row.folder.draftMatches && hypothetical.winner?.id !== this.runner?.result?.plan?.draft.id) el.createEl('p', { text: `Competing rule wins: ${hypothetical.winner?.name ?? 'None'}. This note remains in scope because the draft matches it.` });
		if (!row.folder.draftMatches && row.folder.originalMatches) el.createEl('p', { text: 'Included because the original edited rule matched this folder; the draft no longer matches it.' });
		const details = el.createEl('details'); details.createEl('summary', { text: 'Current and hypothetical winning rules' });
		for (const [label, outcome] of [['Current', row.folder.current], ['Hypothetical', hypothetical]] as const) {
			details.createEl('p', { text: `${label}: ${outcome.winner?.name ?? 'None'} (${outcome.state}) · ${outcome.tags.join(' · ') || 'No output'}` });
			for (const match of outcome.matches) details.createEl('p', { text: `${match.rule.name} [${match.rule.id}] · group ${match.rule.group ?? '__default__'} · confidence ${match.confidence} · priority ${match.rule.priority} · pattern ${match.matchedPattern}` });
		}
		details.createEl('p', { text: `Resolution: configured group precedence [${this.runner?.result?.plan?.precedence.join(', ') ?? ''}], then unlisted groups alphabetically, specificity, priority, and original rule order on full ties. Disabled installed rules do not compete.` });
	}
	onClose(): void {
		this.runner?.dispose(); this.runner = null; this.removeFocus?.(); this.removeFocus = null; this.renderedPaths.clear(); this.contentEl.empty();
	}
}
