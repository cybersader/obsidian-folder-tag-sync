import type { RuleInstallPlan } from '../../engine/ruleInstallPlan';
import type { CandidateRow } from '../../engine/scanAndSnapPlan';
import type { MappingRule } from '../../types/settings';
import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type {
	CandidateSort,
	WorkbenchCandidateState,
} from '../../workbench/workbenchState';

/** The persistence callback returns the same exact accounting as the pure install planner. */
export type WorkbenchCandidateInstallResult = RuleInstallPlan;

export interface WorkbenchCandidatePanelOptions {
	snapshot: WorkbenchSessionSnapshot;
	onInstall: (
		selectedRules: readonly MappingRule[],
	) => Promise<WorkbenchCandidateInstallResult>;
	onCandidateStateChange: (
		state: WorkbenchCandidateState,
	) => void | Promise<void>;
	onEditScope: () => void | Promise<void>;
	onRefresh: () => void | Promise<void>;
	onReviewAddedRule: (ruleId: string) => void | Promise<void>;
	onSelectSystem?: (occurrenceKey: string) => void | Promise<void>;
	isSnapshotStale?: () => boolean;
}

type PanelFeedback = {
	kind: 'error' | 'info';
	message: string;
};

/**
 * Embeddable candidate-triage surface for the Taxonomy Workbench.
 *
 * The panel consumes an already-collected session snapshot. It never reads the
 * vault or settings directly and never persists rules itself; every state and
 * installation effect is delegated through the supplied callbacks.
 */
export class WorkbenchCandidatePanel {
	private snapshot: WorkbenchSessionSnapshot;
	private readonly selectedKeys = new Set<string>();
	private installedRuleIds = new Set<string>();
	private selectionDirty = false;
	private confirmationOpen = false;
	private installing = false;
	private destroyed = false;
	private feedback: PanelFeedback | null = null;
	private installResult: WorkbenchCandidateInstallResult | null = null;

	constructor(
		private readonly containerEl: HTMLElement,
		private readonly options: WorkbenchCandidatePanelOptions,
	) {
		this.snapshot = options.snapshot;
		this.syncFromSnapshot(options.snapshot);
		this.render();
	}

	/** Reuse the panel instance after the owning view collects a fresh snapshot. */
	update(snapshot: WorkbenchSessionSnapshot): void {
		this.snapshot = snapshot;
		this.selectionDirty = false;
		this.confirmationOpen = false;
		this.feedback = null;
		this.syncFromSnapshot(snapshot);
		this.render();
	}

	destroy(): void {
		this.destroyed = true;
		this.containerEl.empty();
	}

	private syncFromSnapshot(snapshot: WorkbenchSessionSnapshot): void {
		this.installedRuleIds = new Set(snapshot.ruleNamesById.keys());
		for (const id of this.installResult?.addedRuleIds ?? []) {
			this.installedRuleIds.add(id);
		}
		for (const id of this.installResult?.skippedExistingIds ?? []) {
			this.installedRuleIds.add(id);
		}

		const candidates = snapshot.candidatePlan?.candidates ?? [];
		const byKey = new Map(candidates.map((candidate) => [candidate.key, candidate] as const));
		this.selectedKeys.clear();
		for (const key of snapshot.selectedCandidateKeys) {
			const candidate = byKey.get(key);
			if (candidate && !this.isAlreadyInstalled(candidate)) this.selectedKeys.add(key);
		}
	}

	private render(): void {
		if (this.destroyed) return;
		const root = this.containerEl;
		root.empty();
		root.dataset.dtfWorkbenchCandidates = '1';
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.gap = '0.65em';
		root.style.minHeight = '0';

		this.renderHeader(root);
		this.renderFeedback(root);
		this.renderInstallResult(root);

		const plan = this.snapshot.candidatePlan;
		if (!plan) {
			this.renderUnavailable(root);
			return;
		}

		this.renderStats(root);
		this.renderLoadErrors(root);
		this.renderToolbar(root);
		this.renderCandidateList(root, plan.candidates);
		this.renderFinalPreview(root, plan.candidates);
		if (this.confirmationOpen) this.renderConfirmation(root, plan.candidates);
	}

	private renderHeader(parent: HTMLElement): void {
		const header = parent.createDiv();
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.gap = '0.6em';
		header.style.flexWrap = 'wrap';

		const heading = header.createDiv();
		heading.createEl('h3', { text: 'Review candidate rules' }).style.margin = '0';
		const source = heading.createDiv({
			text: this.snapshot.state.candidates.source === 'scope-selection'
				? 'Drafted from the current scope selection'
				: 'Drafted from detected system instances',
		});
		source.style.color = 'var(--text-muted)';
		source.style.fontSize = '0.82em';

		const actions = header.createDiv();
		actions.style.display = 'flex';
		actions.style.gap = '0.4em';
		actions.style.flexWrap = 'wrap';

		const editScopeBtn = actions.createEl('button', { text: 'Edit scope' });
		editScopeBtn.disabled = this.installing;
		editScopeBtn.addEventListener('click', () => {
			void this.runAuxiliaryCallback('Could not open scope', this.options.onEditScope);
		});

		const refreshBtn = actions.createEl('button', { text: 'Refresh' });
		refreshBtn.disabled = this.installing;
		refreshBtn.addEventListener('click', () => {
			void this.runAuxiliaryCallback('Could not refresh candidates', this.options.onRefresh);
		});
	}

	private renderFeedback(parent: HTMLElement): void {
		if (!this.feedback) return;
		const banner = parent.createDiv({ text: this.feedback.message });
		banner.style.padding = '0.55em 0.7em';
		banner.style.borderRadius = '6px';
		banner.style.fontSize = '0.86em';
		if (this.feedback.kind === 'error') {
			banner.style.background = 'rgba(200, 60, 60, 0.12)';
			banner.style.border = '1px solid rgba(200, 60, 60, 0.4)';
			banner.style.color = 'var(--text-error, rgb(190, 50, 50))';
		} else {
			banner.style.background = 'var(--background-secondary)';
			banner.style.border = '1px solid var(--background-modifier-border)';
			banner.style.color = 'var(--text-muted)';
		}
	}

	private renderInstallResult(parent: HTMLElement): void {
		const result = this.installResult;
		if (!result) return;

		const banner = parent.createDiv();
		banner.style.padding = '0.65em 0.75em';
		banner.style.borderRadius = '6px';
		banner.style.background = 'rgba(40, 140, 70, 0.12)';
		banner.style.border = '1px solid rgba(40, 140, 70, 0.38)';

		const summary = banner.createDiv({
			text: `Install complete: ${result.addedRuleIds.length} added, ${result.skippedExistingIds.length} already installed, ${result.skippedDuplicateCount} duplicate selection${result.skippedDuplicateCount === 1 ? '' : 's'} skipped.`,
		});
		summary.style.fontWeight = '600';
		summary.style.color = 'var(--text-success, rgb(40, 140, 70))';

		if (result.addedRuleIds.length > 0) {
			const review = banner.createDiv();
			review.style.display = 'flex';
			review.style.alignItems = 'center';
			review.style.gap = '0.4em';
			review.style.flexWrap = 'wrap';
			review.style.marginTop = '0.5em';
			review.createSpan({ text: 'Added disabled:' }).style.color = 'var(--text-muted)';
			for (const ruleId of result.addedRuleIds) {
				const id = review.createEl('code', { text: ruleId });
				id.style.fontSize = '0.8em';
				const reviewBtn = review.createEl('button', { text: 'Review in settings' });
				reviewBtn.style.fontSize = '0.8em';
				reviewBtn.addEventListener('click', () => {
					void this.runAuxiliaryCallback(
						`Could not open settings for rule "${ruleId}"`,
						() => this.options.onReviewAddedRule(ruleId),
					);
				});
			}
		}
	}

	private renderUnavailable(parent: HTMLElement): void {
		const empty = parent.createDiv();
		empty.dataset.dtfScanSnapTree = '1';
		empty.style.padding = '1.2em';
		empty.style.textAlign = 'center';
		empty.style.color = 'var(--text-muted)';
		empty.style.background = 'var(--background-secondary)';
		empty.style.borderRadius = '6px';
		empty.createEl('p', {
			text: 'Candidate planning is not active for this surface.',
		});
		empty.createEl('p', {
			text: 'Edit the scope or refresh to collect candidate rules.',
		}).style.fontSize = '0.85em';
	}

	private renderStats(parent: HTMLElement): void {
		const summary = this.snapshot.candidatePlan?.summary;
		if (!summary) return;
		const statBar = parent.createDiv();
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
		statBar.style.gap = '0.5em';
		this.makeStat(statBar, 'Candidates', summary.totalCandidates);
		this.makeStat(statBar, 'With matches', summary.touchingCandidates);
		this.makeStat(statBar, 'Conflicts', summary.conflictingCandidates);
		this.makeStat(statBar, 'Overlap existing', summary.collidingWithExistingCandidates);
		this.makeStat(statBar, 'Systems', summary.distinctSourcePacks.length);
	}

	private makeStat(parent: HTMLElement, label: string, value: number): void {
		const card = parent.createDiv();
		card.style.padding = '0.4em 0.6em';
		card.style.background = 'var(--background-secondary)';
		card.style.borderRadius = '6px';
		const valueEl = card.createDiv({ text: String(value) });
		valueEl.style.fontSize = '1.2em';
		valueEl.style.fontWeight = '600';
		valueEl.style.lineHeight = '1.1';
		const labelEl = card.createDiv({ text: label });
		labelEl.style.fontSize = '0.75em';
		labelEl.style.color = 'var(--text-muted)';
	}

	private renderLoadErrors(parent: HTMLElement): void {
		const errors = this.snapshot.loadedPackErrors;
		if (errors.length === 0) return;
		const warning = parent.createDiv({
			text: `${errors.length} rule pack${errors.length === 1 ? '' : 's'} could not be loaded and were skipped.`,
		});
		warning.style.padding = '0.45em 0.65em';
		warning.style.fontSize = '0.84em';
		warning.style.color = 'var(--text-warning, rgb(180, 120, 20))';
		warning.style.background = 'rgba(200, 140, 30, 0.1)';
		warning.style.border = '1px solid rgba(200, 140, 30, 0.3)';
		warning.style.borderRadius = '6px';
		warning.title = errors.map((error) => error.message).join('\n');
	}

	private renderToolbar(parent: HTMLElement): void {
		const toolbar = parent.createDiv();
		toolbar.style.display = 'flex';
		toolbar.style.alignItems = 'center';
		toolbar.style.gap = '0.4em';
		toolbar.style.flexWrap = 'wrap';

		const selectAllBtn = toolbar.createEl('button', { text: 'Select all' });
		selectAllBtn.disabled = this.installing || this.selectableCandidates().length === 0;
		selectAllBtn.addEventListener('click', () => this.selectAll());

		const selectNoneBtn = toolbar.createEl('button', { text: 'Select none' });
		selectNoneBtn.disabled = this.installing || this.selectedKeys.size === 0;
		selectNoneBtn.addEventListener('click', () => this.selectNone());

		const spacer = toolbar.createDiv();
		spacer.style.flex = '1 1 auto';

		this.renderSortButton(toolbar, 'noise', 'Sort: junk first');
		this.renderSortButton(toolbar, 'conflict', 'Sort: conflicts first');
	}

	private renderSortButton(
		parent: HTMLElement,
		sort: CandidateSort,
		label: string,
	): void {
		const button = parent.createEl('button', { text: label });
		const active = this.snapshot.state.candidates.sort === sort;
		button.disabled = this.installing || active;
		button.setAttr('aria-pressed', active ? 'true' : 'false');
		button.addEventListener('click', () => {
			void this.emitCandidateState({ sort });
		});
	}

	private renderCandidateList(parent: HTMLElement, candidates: readonly CandidateRow[]): void {
		const list = parent.createDiv();
		list.dataset.dtfScanSnapTree = '1';
		list.style.flex = '1 1 auto';
		list.style.minHeight = '160px';
		list.style.overflow = 'auto';
		list.style.background = 'var(--background-secondary)';
		list.style.padding = '0.5em 0.6em';
		list.style.borderRadius = '6px';
		list.style.fontSize = '0.88em';

		if (candidates.length === 0) {
			const empty = list.createDiv({
				text: 'No candidate rules are available for the current source and scope.',
			});
			empty.style.padding = '1em';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--text-muted)';
			return;
		}

		for (const group of this.snapshot.organizationalSystems.candidateGroups) {
			const section = list.createDiv({ cls: 'dtf-candidate-occurrence-group' });
			section.dataset.dtfCandidateOccurrenceKey = group.occurrenceKey;
			const header = section.createEl('button', { cls: 'dtf-candidate-occurrence-header' });
			header.dataset.dtfCandidateGroupHeader = '1';
			header.setAttr(
				'aria-label',
				`Select ${group.provenance.sourcePackName} at ${group.provenance.anchorPath || 'vault root'} in the Organizational systems deck`,
			);
			header.createSpan({
				cls: 'dtf-candidate-occurrence-name',
				text: group.provenance.sourcePackName,
			});
			header.createSpan({
				cls: 'dtf-candidate-occurrence-anchor',
				text: `At ${group.provenance.anchorPath || 'vault root'}`,
			});
			header.createSpan({
				cls: 'dtf-candidate-occurrence-count',
				text: `${group.rows.length} candidate${group.rows.length === 1 ? '' : 's'}`,
			});
			header.addEventListener('click', () => {
				void this.options.onSelectSystem?.(group.occurrenceKey);
			});
			const rows = section.createDiv({ cls: 'dtf-candidate-occurrence-rows' });
			for (const candidate of group.rows) this.renderCandidateRow(rows, candidate);
		}
	}

	private renderCandidateRow(parent: HTMLElement, candidate: CandidateRow): void {
		const installed = this.isAlreadyInstalled(candidate);
		const row = parent.createDiv();
		row.dataset.dtfCandidateRow = '1';
		row.dataset.dtfCandidateKey = candidate.key;
		row.style.display = 'flex';
		row.style.flexDirection = 'column';
		row.style.gap = '0.25em';
		row.style.padding = '0.5em 0.45em';
		row.style.borderRadius = '4px';
		row.style.borderBottom = '1px solid var(--background-modifier-border)';
		if (installed) row.style.opacity = '0.68';
		row.addEventListener('mouseenter', () => {
			row.style.background = 'var(--background-modifier-hover)';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = '';
		});

		const head = row.createDiv();
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.gap = '0.4em';
		head.style.flexWrap = 'wrap';

		const checkbox = head.createEl('input', { type: 'checkbox' });
		checkbox.checked = !installed && this.selectedKeys.has(candidate.key);
		checkbox.disabled = installed || this.installing;
		checkbox.setAttr('aria-label', installed
			? `Rule ${candidate.rule.name} is already installed`
			: `Select candidate rule ${candidate.rule.name}`);
		checkbox.addEventListener('change', () => {
			this.toggleCandidate(candidate.key, checkbox.checked);
		});

		const name = head.createSpan({ text: candidate.rule.name });
		name.style.fontWeight = '600';

		this.renderCoverageChip(head, candidate);
		this.renderBijectivityChip(head, candidate);
		this.renderConflictBadge(head, candidate);
		if (installed) this.renderInstalledBadge(head);

		const provenance = row.createDiv();
		provenance.style.display = 'flex';
		provenance.style.gap = '0.8em';
		provenance.style.flexWrap = 'wrap';
		provenance.style.paddingLeft = '1.65em';
		provenance.style.fontSize = '0.78em';
		provenance.style.color = 'var(--text-muted)';
		provenance.createSpan({ text: `Source: ${candidate.sourcePackName}` });
		const scope = provenance.createSpan({
			text: `Scope: ${candidate.anchorPath || '(vault root)'}`,
		});
		scope.style.fontFamily = 'var(--font-monospace)';

		this.renderConflictDetails(row, candidate);
		this.renderSampleEmissions(row, candidate);
	}

	private renderCoverageChip(parent: HTMLElement, candidate: CandidateRow): void {
		const count = candidate.coverage.matchCount;
		const chip = this.makeChip(parent);
		if (candidate.coverage.previewUnavailableReason === 'inverse-only') {
			chip.dataset.dtfCoverageUnavailable = 'inverse-only';
			chip.setText('Inverse only');
			chip.title = 'This tag-to-folder rule has no folder-to-tag coverage preview.';
			chip.style.background = 'rgba(100, 100, 160, 0.12)';
			chip.style.color = 'var(--text-muted)';
			chip.style.border = '1px solid var(--background-modifier-border)';
		} else if (count > 0) {
			chip.setText(`${count} folder${count === 1 ? '' : 's'}`);
			chip.title = 'Folders this rule matches. Notes in each matched folder receive the emitted tag on sync.';
			chip.style.background = 'rgba(40, 140, 70, 0.15)';
			chip.style.color = 'var(--text-success, rgb(40, 140, 70))';
			chip.style.border = '1px solid rgba(40, 140, 70, 0.35)';
		} else {
			chip.setText('0 — no match');
			chip.style.background = 'var(--background-modifier-form-field)';
			chip.style.color = 'var(--text-muted)';
			chip.style.border = '1px solid var(--background-modifier-border)';
		}
	}

	private renderBijectivityChip(parent: HTMLElement, candidate: CandidateRow): void {
		const verdict = candidate.bijectivity;
		if (verdict === 'unknown') return;
		const chip = this.makeChip(parent);
		chip.style.background = 'var(--background-modifier-form-field)';
		chip.style.border = '1px solid var(--background-modifier-border)';
		if (verdict === 'lossy') {
			chip.setText('Lossy');
			chip.style.background = 'rgba(200, 140, 30, 0.15)';
			chip.style.color = 'var(--text-warning, rgb(180, 120, 20))';
			chip.style.border = '1px solid rgba(200, 140, 30, 0.4)';
			chip.title = 'The tag does not fully reconstruct the folder. Inverse sync may not recover the original.';
		} else if (verdict === 'total') {
			chip.setText('1:1');
			chip.style.color = 'var(--text-muted)';
			chip.title = 'Folder and tag round-trip exactly.';
		} else {
			chip.setText('Conditional');
			chip.style.color = 'var(--text-muted)';
			chip.title = 'The rule round-trips for some inputs but not all.';
		}
	}

	private renderConflictBadge(parent: HTMLElement, candidate: CandidateRow): void {
		if (candidate.conflict.analysisUnavailableReason === 'inverse-only') {
			const chip = this.makeChip(parent);
			chip.dataset.dtfConflictUnavailable = 'inverse-only';
			chip.setText('Tag conflicts not analyzed');
			chip.title = 'The workbench has folder inventory, not a complete tag inventory, so tag-side overlaps are not predicted for inverse-only rules.';
			chip.style.background = 'rgba(200, 140, 30, 0.12)';
			chip.style.color = 'var(--text-warning, rgb(180, 120, 20))';
			chip.style.border = '1px solid rgba(200, 140, 30, 0.35)';
			return;
		}
		if (!candidate.conflict.conflicts) return;
		const chip = this.makeChip(parent);
		if (candidate.conflict.collidesWithExisting) {
			chip.setText('Overlaps an existing rule');
			chip.style.background = 'rgba(200, 60, 60, 0.18)';
			chip.style.color = 'var(--text-error, rgb(190, 50, 50))';
			chip.style.border = '1px solid rgba(200, 60, 60, 0.5)';
		} else {
			chip.setText('Overlaps another candidate');
			chip.style.background = 'rgba(200, 140, 30, 0.12)';
			chip.style.color = 'var(--text-muted)';
			chip.style.border = '1px solid rgba(200, 140, 30, 0.3)';
		}
	}

	private renderInstalledBadge(parent: HTMLElement): void {
		const chip = this.makeChip(parent);
		chip.setText('Already installed');
		chip.style.background = 'var(--background-modifier-form-field)';
		chip.style.color = 'var(--text-muted)';
		chip.style.border = '1px solid var(--background-modifier-border)';
		chip.title = 'This persisted rule ID is already present in settings, so this row cannot be selected.';
	}

	private makeChip(parent: HTMLElement): HTMLSpanElement {
		const chip = parent.createSpan();
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.padding = '0.05em 0.5em';
		chip.style.borderRadius = '999px';
		chip.style.fontSize = '0.74em';
		chip.style.fontWeight = '600';
		return chip;
	}

	private renderConflictDetails(parent: HTMLElement, candidate: CandidateRow): void {
		const conflict = candidate.conflict;
		if (!conflict.conflicts) return;
		const detail = parent.createDiv();
		detail.style.paddingLeft = '1.65em';
		detail.style.fontSize = '0.78em';
		detail.style.color = conflict.collidesWithExisting
			? 'var(--text-error, rgb(190, 50, 50))'
			: 'var(--text-muted)';
		const kind = conflict.collidesWithExisting
			? 'Candidate versus installed-rule conflict.'
			: 'Candidate versus candidate conflict.';
		const winner = conflict.predictedWinnerId
			? ` Predicted winner: ${conflict.predictedWinnerId}.`
			: ' No winner could be predicted.';
		const locations = conflict.overlappingFolderSample.length > 0
			? ` Sample overlap: ${conflict.overlappingFolderSample.join(', ')}.`
			: '';
		detail.setText(`${kind}${winner}${locations}`);
	}

	private renderSampleEmissions(parent: HTMLElement, candidate: CandidateRow): void {
		const samples = candidate.coverage.sampleEmissions.slice(0, 3);
		if (samples.length === 0) return;
		const sampleWrap = parent.createDiv();
		sampleWrap.style.fontFamily = 'var(--font-monospace)';
		sampleWrap.style.fontSize = '0.78em';
		sampleWrap.style.color = 'var(--text-muted)';
		sampleWrap.style.paddingLeft = '1.65em';
		sampleWrap.style.lineHeight = '1.5';
		for (const sample of samples) {
			const line = sampleWrap.createDiv();
			line.createSpan({ text: sample.folder });
			line.createSpan({ text: ' → ' });
			const tagsText = sample.tags
				.map((tag) => tag.startsWith('#') ? tag : `#${tag}`)
				.join(', ');
			const tags = line.createSpan({ text: tagsText || '(no tag)' });
			tags.style.color = sample.tags.length > 0
				? 'var(--text-success, rgb(40, 140, 70))'
				: 'var(--text-faint)';
		}
		if (candidate.coverage.matchCount > samples.length) {
			const more = sampleWrap.createDiv({
				text: `… ${candidate.coverage.matchCount - samples.length} more`,
			});
			more.style.color = 'var(--text-faint)';
		}
	}

	private renderFinalPreview(parent: HTMLElement, candidates: readonly CandidateRow[]): void {
		const chosen = this.selectedCandidates(candidates);
		const uniqueRuleIds = new Set(chosen.map((candidate) => candidate.id));
		const systems = new Set(chosen.map((candidate) => candidate.sourcePackId));
		const existingOverlapCount = chosen.filter(
			(candidate) => candidate.conflict.collidesWithExisting,
		).length;
		const unavailableConflictCount = chosen.filter(
			(candidate) => candidate.conflict.analysisUnavailableReason === 'inverse-only',
		).length;
		const installableCount = candidates.filter(
			(candidate) => !this.isAlreadyInstalled(candidate),
		).length;

		const preview = parent.createDiv();
		preview.style.padding = '0.65em 0.75em';
		preview.style.background = 'var(--background-secondary)';
		preview.style.border = '1px solid var(--background-modifier-border)';
		preview.style.borderRadius = '6px';

		const title = preview.createDiv({ text: 'Final preview' });
		title.style.fontWeight = '600';
		const count = preview.createDiv({
			text: `${chosen.length} of ${installableCount} installable candidate${installableCount === 1 ? '' : 's'} selected · ${uniqueRuleIds.size} unique rule ID${uniqueRuleIds.size === 1 ? '' : 's'} · ${systems.size} system${systems.size === 1 ? '' : 's'}.`,
		});
		count.style.marginTop = '0.25em';
		count.style.fontSize = '0.86em';
		count.style.color = 'var(--text-muted)';

		if (existingOverlapCount > 0) {
			const conflicts = preview.createDiv({
				text: `${existingOverlapCount} selected candidate${existingOverlapCount === 1 ? '' : 's'} overlap an installed rule.`,
			});
			conflicts.style.marginTop = '0.25em';
			conflicts.style.fontSize = '0.84em';
			conflicts.style.color = 'var(--text-error, rgb(190, 50, 50))';
		}
		if (unavailableConflictCount > 0) {
			const unavailable = preview.createDiv({
				text: `${unavailableConflictCount} selected inverse-only candidate${unavailableConflictCount === 1 ? '' : 's'} cannot be checked for tag-side overlaps from folder inventory.`,
			});
			unavailable.style.marginTop = '0.25em';
			unavailable.style.fontSize = '0.84em';
			unavailable.style.color = 'var(--text-warning, rgb(180, 120, 20))';
		}

		const stale = this.options.isSnapshotStale?.() ?? false;
		if (stale) {
			const staleNotice = preview.createDiv({
				text: 'The vault or rule settings changed after these candidates were planned. Installation is paused until refresh completes.',
			});
			staleNotice.dataset.dtfCandidateStale = '1';
			staleNotice.style.marginTop = '0.4em';
			staleNotice.style.color = 'var(--text-warning, rgb(180, 120, 20))';
			staleNotice.style.fontWeight = '600';
		}

		const safety = preview.createDiv({
			text: 'Every added rule will be installed disabled. This action will not change files, folders, frontmatter, or current sync behavior.',
		});
		safety.style.marginTop = '0.4em';
		safety.style.fontWeight = '600';

		const actions = preview.createDiv();
		actions.style.display = 'flex';
		actions.style.justifyContent = 'flex-end';
		actions.style.marginTop = '0.6em';
		const installBtn = actions.createEl('button', {
			text: chosen.length === 0
				? 'Install selected rules'
				: `Install ${chosen.length} selected rule${chosen.length === 1 ? '' : 's'}`,
		});
		installBtn.addClass('mod-cta');
		installBtn.disabled = chosen.length === 0 || this.installing || stale;
		installBtn.addEventListener('click', () => {
			this.feedback = null;
			this.confirmationOpen = true;
			this.render();
		});
	}

	private renderConfirmation(parent: HTMLElement, candidates: readonly CandidateRow[]): void {
		const chosen = this.selectedCandidates(candidates);
		const systems = new Set(chosen.map((candidate) => candidate.sourcePackId));
		const colliding = chosen.filter(
			(candidate) => candidate.conflict.collidesWithExisting,
		).length;
		const unavailable = chosen.filter(
			(candidate) => candidate.conflict.analysisUnavailableReason === 'inverse-only',
		).length;

		const confirmation = parent.createDiv();
		confirmation.style.padding = '0.75em';
		confirmation.style.border = '1px solid var(--interactive-accent)';
		confirmation.style.borderRadius = '6px';
		confirmation.style.background = 'var(--background-primary-alt)';

		const title = confirmation.createDiv({ text: 'Confirm disabled rule installation' });
		title.style.fontWeight = '600';
		confirmation.createEl('p', {
			text: `Install ${chosen.length} selected candidate${chosen.length === 1 ? '' : 's'} from ${systems.size} system${systems.size === 1 ? '' : 's'}?`,
		});
		if (colliding > 0) {
			const warning = confirmation.createEl('p', {
				text: `${colliding} selected candidate${colliding === 1 ? '' : 's'} overlap an installed rule. The predicted winners are shown in the rows above.`,
			});
			warning.style.color = 'var(--text-error, rgb(190, 50, 50))';
			warning.style.fontSize = '0.86em';
		}
		if (unavailable > 0) {
			const warning = confirmation.createEl('p', {
				text: `${unavailable} inverse-only candidate${unavailable === 1 ? '' : 's'} cannot be checked for tag-side overlaps from folder inventory. Review these disabled rules in Settings before enabling them.`,
			});
			warning.style.color = 'var(--text-warning, rgb(180, 120, 20))';
			warning.style.fontSize = '0.86em';
		}
		const safety = confirmation.createEl('p', {
			text: 'New rules are installed disabled. No files, folders, or frontmatter will change.',
		});
		safety.style.fontWeight = '600';
		safety.style.fontSize = '0.88em';

		const actions = confirmation.createDiv();
		actions.style.display = 'flex';
		actions.style.justifyContent = 'flex-end';
		actions.style.gap = '0.5em';
		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.disabled = this.installing;
		cancelBtn.addEventListener('click', () => {
			this.confirmationOpen = false;
			this.feedback = null;
			this.render();
		});

		const confirmBtn = actions.createEl('button', {
			text: this.installing
				? 'Installing…'
				: `Confirm ${chosen.length} rule${chosen.length === 1 ? '' : 's'}`,
		});
		confirmBtn.addClass('mod-cta');
		confirmBtn.disabled = this.installing
			|| chosen.length === 0
			|| (this.options.isSnapshotStale?.() ?? false);
		confirmBtn.addEventListener('click', () => {
			void this.install(chosen);
		});
	}

	private selectAll(): void {
		this.selectedKeys.clear();
		for (const candidate of this.selectableCandidates()) {
			this.selectedKeys.add(candidate.key);
		}
		this.selectionDirty = true;
		this.confirmationOpen = false;
		this.render();
		void this.emitCandidateState({ selectedKeys: this.selectedKeysInPlanOrder() });
	}

	private selectNone(): void {
		this.selectedKeys.clear();
		this.selectionDirty = true;
		this.confirmationOpen = false;
		this.render();
		void this.emitCandidateState({ selectedKeys: [] });
	}

	private toggleCandidate(key: string, selected: boolean): void {
		if (selected) this.selectedKeys.add(key);
		else this.selectedKeys.delete(key);
		this.selectionDirty = true;
		this.confirmationOpen = false;
		this.render();
		void this.emitCandidateState({ selectedKeys: this.selectedKeysInPlanOrder() });
	}

	private async emitCandidateState(
		patch: Partial<Pick<WorkbenchCandidateState, 'sort' | 'selectedKeys'>>,
	): Promise<void> {
		const current = this.snapshot.state.candidates;
		const selectedKeys = patch.selectedKeys !== undefined
			? patch.selectedKeys
			: this.selectionDirty
				? this.selectedKeysInPlanOrder()
				: current.selectedKeys === null ? null : [...current.selectedKeys];
		try {
			await this.options.onCandidateStateChange({
				...current,
				...patch,
				selectedKeys,
			});
		} catch (error) {
			if (this.destroyed) return;
			this.feedback = {
				kind: 'error',
				message: `Could not update candidate state: ${errorMessage(error)}`,
			};
			this.render();
		}
	}

	private async install(chosen: readonly CandidateRow[]): Promise<void> {
		if (this.installing || chosen.length === 0) return;
		if (this.options.isSnapshotStale?.()) {
			this.feedback = {
				kind: 'error',
				message: 'Installation paused because the candidate snapshot is stale. Wait for refresh and review the updated candidates.',
			};
			this.confirmationOpen = false;
			this.render();
			return;
		}
		this.installing = true;
		this.feedback = { kind: 'info', message: 'Installing selected rules…' };
		this.render();

		try {
			const result = await this.options.onInstall(chosen.map((candidate) => candidate.rule));
			validateInstallResult(result);
			if (this.destroyed) return;
			this.installResult = result;
			for (const id of result.addedRuleIds) this.installedRuleIds.add(id);
			for (const id of result.skippedExistingIds) this.installedRuleIds.add(id);
			for (const candidate of chosen) {
				if (this.installedRuleIds.has(candidate.id)) this.selectedKeys.delete(candidate.key);
			}
			this.selectionDirty = true;
			this.confirmationOpen = false;
			this.feedback = null;
		} catch (error) {
			if (this.destroyed) return;
			this.feedback = {
				kind: 'error',
				message: `Installation failed: ${errorMessage(error)} The panel remains open. Because the callback did not return a result, refresh before retrying if persistence may have partially completed.`,
			};
		} finally {
			this.installing = false;
			if (!this.destroyed) this.render();
		}
	}

	private async runAuxiliaryCallback(
		failurePrefix: string,
		callback: () => void | Promise<void>,
	): Promise<void> {
		try {
			await callback();
		} catch (error) {
			if (this.destroyed) return;
			this.feedback = {
				kind: 'error',
				message: `${failurePrefix}: ${errorMessage(error)}`,
			};
			this.render();
		}
	}

	private selectedCandidates(
		candidates: readonly CandidateRow[] = this.snapshot.candidatePlan?.candidates ?? [],
	): CandidateRow[] {
		return candidates.filter(
			(candidate) => !this.isAlreadyInstalled(candidate) && this.selectedKeys.has(candidate.key),
		);
	}

	private selectableCandidates(): CandidateRow[] {
		return (this.snapshot.candidatePlan?.candidates ?? [])
			.filter((candidate) => !this.isAlreadyInstalled(candidate));
	}

	private selectedKeysInPlanOrder(): string[] {
		return this.selectedCandidates().map((candidate) => candidate.key);
	}

	private isAlreadyInstalled(candidate: CandidateRow): boolean {
		return this.installedRuleIds.has(candidate.id);
	}
}

/** Convenience factory for callers that prefer a render-function seam. */
export function renderWorkbenchCandidatePanel(
	containerEl: HTMLElement,
	options: WorkbenchCandidatePanelOptions,
): WorkbenchCandidatePanel {
	return new WorkbenchCandidatePanel(containerEl, options);
}

function validateInstallResult(result: WorkbenchCandidateInstallResult): void {
	if (!result || !Array.isArray(result.addedRuleIds)
		|| !Array.isArray(result.skippedExistingIds)
		|| !Array.isArray(result.skippedDuplicateIds)
		|| !Number.isInteger(result.skippedDuplicateCount)
		|| result.skippedDuplicateCount !== result.skippedDuplicateIds.length) {
		throw new Error('The install callback returned an invalid result');
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== '') return error.message;
	if (typeof error === 'string' && error.trim() !== '') return error;
	return 'Unknown error';
}
