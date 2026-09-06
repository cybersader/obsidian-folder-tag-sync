import type { RuleInstallPlan } from '../../engine/ruleInstallPlan';
import type { CandidateRow } from '../../engine/scanAndSnapPlan';
import type { MappingRule } from '../../types/settings';
import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type {
	CandidateSort,
	WorkbenchCandidateState,
} from '../../workbench/workbenchState';
import {
	getCandidateDirectionalStatus,
	type CandidateDirectionStatus,
} from './candidateDirectionStatus';
import { renderSemanticPath } from './SemanticPath';

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
	/** Opens Settings centered on the exact installed rule named by a conflict target. */
	onReviewInstalledRule?: (ruleId: string) => void | Promise<void>;
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
	private readonly expandedDirectionKeys = new Set<string>();
	private installedRuleIds = new Set<string>();
	private focusedConflictCandidateKey: string | null = null;
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
		root.style.height = '100%';
		root.style.minHeight = '0';
		root.style.overflow = 'hidden';

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
		heading.createEl('h3', { text: 'Review proposed rules' }).style.margin = '0';
		const source = heading.createDiv({
			text: this.snapshot.state.candidates.source === 'scope-selection'
				? 'Built from the folders and Ready organizational systems you included'
				: 'Built from every Ready organizational system currently detected',
		});
		source.style.color = 'var(--text-muted)';
		source.style.fontSize = '0.82em';
		heading.createDiv({
			cls: 'dtf-workbench-surface-intro dtf-candidate-safety-intro',
			text: 'Safe to save: checked proposals become disabled drafts. Saving does not run sync or change files, folders, tags, or frontmatter.',
		});

		const actions = header.createDiv();
		actions.style.display = 'flex';
		actions.style.gap = '0.4em';
		actions.style.flexWrap = 'wrap';

		const editScopeBtn = actions.createEl('button', { text: 'Change included folders' });
		editScopeBtn.disabled = this.installing;
		editScopeBtn.addEventListener('click', () => {
			void this.runAuxiliaryCallback('Could not open scope', this.options.onEditScope);
		});

		const refreshBtn = actions.createEl('button', { text: 'Refresh' });
		refreshBtn.disabled = this.installing;
		refreshBtn.addEventListener('click', () => {
			void this.runAuxiliaryCallback('Could not refresh proposed rules', this.options.onRefresh);
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
			text: `Disabled drafts added: ${result.addedRuleIds.length} new, ${result.skippedExistingIds.length} already installed, ${result.skippedDuplicateCount} duplicate selection${result.skippedDuplicateCount === 1 ? '' : 's'} skipped.`,
		});
		summary.style.fontWeight = '600';
		summary.style.color = 'var(--text-success, rgb(40, 140, 70))';

		if (result.addedRuleIds.length > 0) {
			const review = banner.createDiv({ cls: 'dtf-candidate-install-next-step' });
			review.createDiv({
				text: 'Next: inspect the saved drafts in Settings, then enable only the rules you want to use.',
			}).style.color = 'var(--text-muted)';
			const firstRuleId = result.addedRuleIds[0];
			const reviewBtn = review.createEl('button', {
				text: result.addedRuleIds.length === 1
					? 'Review saved draft in Settings'
					: 'Review first saved draft in Settings',
			});
			reviewBtn.dataset.dtfReviewSavedDraft = firstRuleId;
			reviewBtn.addClass('mod-cta');
			reviewBtn.addEventListener('click', () => {
				void this.runAuxiliaryCallback(
					`Could not open settings for rule "${firstRuleId}"`,
					() => this.options.onReviewAddedRule(firstRuleId),
				);
			});
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
			text: 'Proposed-rule planning is not active for this view.',
		});
		empty.createEl('p', {
			text: 'Change the included folders or refresh to collect proposed rules.',
		}).style.fontSize = '0.85em';
	}

	private renderStats(parent: HTMLElement): void {
		const summary = this.snapshot.candidatePlan?.summary;
		if (!summary) return;
		const statBar = parent.createDiv({ cls: 'dtf-candidate-task-summary' });
		statBar.dataset.dtfCandidateTaskSummary = '1';
		statBar.setText(
			`${summary.totalCandidates} proposed rule${summary.totalCandidates === 1 ? '' : 's'} · `
				+ `${summary.distinctSourcePacks.length} source organizational system${summary.distinctSourcePacks.length === 1 ? '' : 's'} · `
				+ `${summary.conflictingCandidates} overlap warning${summary.conflictingCandidates === 1 ? '' : 's'}`,
		);
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

		const selectAllBtn = toolbar.createEl('button', { text: 'Include all' });
		selectAllBtn.disabled = this.installing || this.selectableCandidates().length === 0;
		selectAllBtn.addEventListener('click', () => this.selectAll());

		const selectNoneBtn = toolbar.createEl('button', { text: 'Clear selection' });
		selectNoneBtn.disabled = this.installing || this.selectedKeys.size === 0;
		selectNoneBtn.addEventListener('click', () => this.selectNone());

		const spacer = toolbar.createDiv();
		spacer.style.flex = '1 1 auto';

		this.renderSortButton(toolbar, 'noise', 'Sort: low-signal first');
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
		list.style.minHeight = '0';
		list.style.overflow = 'auto';
		list.style.background = 'var(--background-secondary)';
		list.style.padding = '0.5em 0.6em';
		list.style.borderRadius = '6px';
		list.style.fontSize = '0.88em';

		if (candidates.length === 0) {
			const empty = list.createDiv({
				text: 'No proposed rules are available. Choose at least one folder containing a Ready organizational system, then return here.',
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
				`Focus the ${group.provenance.sourcePackName} organizational system at ${group.provenance.anchorPath || 'vault root'}. This does not change which proposed rules are checked.`,
			);
			header.createSpan({
				cls: 'dtf-workbench-object-kind',
				text: 'Suggested from',
			});
			header.createSpan({
				cls: 'dtf-candidate-occurrence-name',
				text: group.provenance.sourcePackName,
			});
			renderSemanticPath(header, group.provenance.anchorPath, {
				role: 'candidate-source-system-anchor',
				focusLabel: 'Organizational system found here',
				variant: 'compact',
			});
			header.createSpan({
				cls: 'dtf-candidate-occurrence-count',
				text: `${group.rows.length} proposed rule${group.rows.length === 1 ? '' : 's'}`,
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
		row.tabIndex = -1;
		row.style.display = 'flex';
		row.style.flexDirection = 'column';
		row.style.gap = '0.25em';
		row.style.padding = '0.5em 0.45em';
		row.style.borderRadius = '4px';
		row.style.borderBottom = '1px solid var(--background-modifier-border)';
		if (candidate.key === this.focusedConflictCandidateKey) {
			this.applyConflictTargetHighlight(row);
		}
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

		head.createSpan({
			cls: 'dtf-workbench-object-kind dtf-candidate-rule-kind',
			text: 'Proposed rule',
		});
		const checkbox = head.createEl('input', { type: 'checkbox' });
		checkbox.checked = !installed && this.selectedKeys.has(candidate.key);
		checkbox.disabled = installed || this.installing;
		checkbox.setAttr('aria-label', installed
			? `Rule ${candidate.rule.name} is already installed`
			: `Queue ${candidate.rule.name} as a disabled rule draft`);
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
		provenance.createSpan({ text: `Suggested from: ${candidate.sourcePackName}` });
		renderSemanticPath(provenance, candidate.anchorPath, {
			role: 'candidate-rule-anchor',
			focusLabel: 'Applies from',
			variant: 'compact',
		});

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
			chip.setText(`Matches ${count} folder${count === 1 ? '' : 's'}`);
			chip.title = 'Folders this rule matches. Notes in each matched folder receive the emitted tag on sync.';
			chip.style.background = 'rgba(40, 140, 70, 0.15)';
			chip.style.color = 'var(--text-success, rgb(40, 140, 70))';
			chip.style.border = '1px solid rgba(40, 140, 70, 0.35)';
		} else {
			chip.setText('Matches 0 folders');
			chip.style.background = 'var(--background-modifier-form-field)';
			chip.style.color = 'var(--text-muted)';
			chip.style.border = '1px solid var(--background-modifier-border)';
		}
	}

	private renderBijectivityChip(parent: HTMLElement, candidate: CandidateRow): void {
		const status = getCandidateDirectionalStatus(candidate);
		const disclosureId = `dtf-candidate-directions-${domIdPart(candidate.key)}`;
		const expanded = this.expandedDirectionKeys.has(candidate.key);
		const wrap = parent.createDiv({ cls: 'dtf-candidate-direction-status' });
		wrap.dataset.dtfCandidateDirectionStatus = candidate.key;
		wrap.style.display = 'inline-flex';
		wrap.style.flexDirection = 'column';
		wrap.style.alignItems = 'flex-start';

		const toggle = wrap.createEl('button', {
			text: `Folder → tag ${directionStatusIcon(status.folderToTag)} ${status.folderToTag.label} · `
				+ `Tag → folder ${directionStatusIcon(status.tagToFolder)} ${status.tagToFolder.label}`,
		});
		toggle.dataset.dtfCandidateDirectionToggle = candidate.key;
		toggle.setAttr('aria-expanded', expanded ? 'true' : 'false');
		toggle.setAttr('aria-controls', disclosureId);
		toggle.setAttr(
			'aria-label',
			`${expanded ? 'Hide' : 'Show'} direction details for ${candidate.rule.name}. `
				+ `Folder to tag: ${status.folderToTag.label}. Tag to folder: ${status.tagToFolder.label}.`,
		);
		toggle.style.height = 'auto';
		toggle.style.minHeight = '0';
		toggle.style.padding = '0.05em 0.5em';
		toggle.style.borderRadius = '999px';
		toggle.style.fontSize = '0.74em';
		toggle.style.fontWeight = '600';
		toggle.style.whiteSpace = 'normal';
		toggle.style.textAlign = 'left';
		toggle.style.color = directionSummaryColor(status.folderToTag, status.tagToFolder);
		toggle.style.background = 'var(--background-modifier-form-field)';
		toggle.style.border = '1px solid var(--background-modifier-border)';

		const details = wrap.createDiv({ cls: 'dtf-candidate-direction-details' });
		details.id = disclosureId;
		details.hidden = !expanded;
		details.style.marginTop = '0.3em';
		details.style.padding = '0.45em 0.55em';
		details.style.maxWidth = '34em';
		details.style.background = 'var(--background-primary)';
		details.style.border = '1px solid var(--background-modifier-border)';
		details.style.borderRadius = '5px';
		this.renderDirectionDetail(details, 'Folder → tag', status.folderToTag);
		this.renderDirectionDetail(details, 'Tag → folder', status.tagToFolder);

		toggle.addEventListener('click', (event) => {
			event.stopPropagation();
			const nextExpanded = !this.expandedDirectionKeys.has(candidate.key);
			if (nextExpanded) this.expandedDirectionKeys.add(candidate.key);
			else this.expandedDirectionKeys.delete(candidate.key);
			toggle.setAttr('aria-expanded', nextExpanded ? 'true' : 'false');
			toggle.setAttr(
				'aria-label',
				`${nextExpanded ? 'Hide' : 'Show'} direction details for ${candidate.rule.name}. `
					+ `Folder to tag: ${status.folderToTag.label}. Tag to folder: ${status.tagToFolder.label}.`,
			);
			details.hidden = !nextExpanded;
		});
	}

	private renderDirectionDetail(
		parent: HTMLElement,
		direction: string,
		status: CandidateDirectionStatus,
	): void {
		const row = parent.createDiv();
		row.dataset.dtfCandidateDirection = direction === 'Folder → tag'
			? 'folder-to-tag'
			: 'tag-to-folder';
		row.style.display = 'block';
		row.style.lineHeight = '1.35';
		const heading = row.createSpan({ text: `${direction}: ${status.label}. ` });
		heading.style.fontWeight = '600';
		heading.style.color = directionStatusColor(status);
		row.createSpan({ text: status.detail });
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
		const installedTargets = candidate.conflict.installedTargets ?? [];
		const candidateTargets = candidate.conflict.candidateTargets ?? [];
		const targets = [
			...installedTargets.map((target) => ({ ...target, source: 'installed' as const })),
			...candidateTargets.map((target) => ({ ...target, source: 'proposed' as const })),
		];
		const first = targets[0];
		const chip = this.makeChip(parent);
		if (first) {
			chip.setText(targets.length === 1
				? `Overlaps ${first.source} rule “${first.ruleName}”`
				: `Overlaps “${first.ruleName}” and ${targets.length - 1} other rule${targets.length === 2 ? '' : 's'}`);
			chip.title = targets
				.map((target) => `${target.source} rule “${target.ruleName}”`)
				.join('; ');
		} else {
			chip.setText('Overlaps another rule');
		}
		if (candidate.conflict.collidesWithExisting) {
			chip.style.background = 'rgba(200, 60, 60, 0.18)';
			chip.style.color = 'var(--text-error, rgb(190, 50, 50))';
			chip.style.border = '1px solid rgba(200, 60, 60, 0.5)';
		} else {
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
		const detail = parent.createDiv({ cls: 'dtf-candidate-conflict-details' });
		detail.style.paddingLeft = '1.65em';
		detail.style.fontSize = '0.78em';
		detail.style.color = conflict.collidesWithExisting
			? 'var(--text-error, rgb(190, 50, 50))'
			: 'var(--text-muted)';
		detail.createDiv({ text: 'Rule overlap' }).style.fontWeight = '600';

		const candidateTargets = conflict.candidateTargets ?? [];
		for (const target of candidateTargets) {
			const item = detail.createDiv({ cls: 'dtf-candidate-conflict-target' });
			item.dataset.dtfConflictCandidateKey = target.candidateKey;
			item.dataset.dtfConflictOccurrenceKey = target.occurrenceKey;
			item.style.marginTop = '0.35em';
			item.createSpan({
				cls: 'dtf-workbench-object-kind',
				text: 'Proposed rule',
			});
			const focusButton = item.createEl('button', { text: target.ruleName });
			focusButton.dataset.dtfConflictCandidateTarget = target.candidateKey;
			focusButton.style.height = 'auto';
			focusButton.style.minHeight = '0';
			focusButton.style.marginLeft = '0.35em';
			focusButton.setAttr(
				'aria-label',
				`Focus proposed rule ${target.ruleName}, suggested from ${target.sourcePackName} at ${target.anchorPath || 'vault root'}. This does not change which proposals are checked.`,
			);
			focusButton.addEventListener('click', (event) => {
				event.stopPropagation();
				this.focusConflictCandidate(target.candidateKey);
			});

			const provenance = item.createDiv();
			provenance.createSpan({ text: `Suggested from: ${target.sourcePackName}` });
			renderSemanticPath(provenance, target.anchorPath, {
				role: 'candidate-conflict-target-anchor',
				focusLabel: 'Organizational system found here',
				variant: 'compact',
			});
			this.renderConflictSamples(item, target.sampleFolders);
		}

		const installedTargets = conflict.installedTargets ?? [];
		for (const target of installedTargets) {
			const item = detail.createDiv({ cls: 'dtf-candidate-conflict-target' });
			item.dataset.dtfConflictInstalledRuleId = target.ruleId;
			item.style.marginTop = '0.35em';
			item.createSpan({
				cls: 'dtf-workbench-object-kind',
				text: 'Installed rule',
			});
			const reviewButton = item.createEl('button', { text: target.ruleName });
			reviewButton.dataset.dtfConflictInstalledTarget = target.ruleId;
			reviewButton.style.height = 'auto';
			reviewButton.style.minHeight = '0';
			reviewButton.style.marginLeft = '0.35em';
			reviewButton.setAttr('aria-label', `Review installed rule ${target.ruleName} in Settings`);
			reviewButton.addEventListener('click', (event) => {
				event.stopPropagation();
				void this.runAuxiliaryCallback(
					`Could not open settings for installed rule "${target.ruleName}"`,
					() => (this.options.onReviewInstalledRule ?? this.options.onReviewAddedRule)(target.ruleId),
				);
			});
			this.renderConflictSamples(item, target.sampleFolders);
		}

		if (candidateTargets.length === 0 && installedTargets.length === 0) {
			const unavailable = detail.createDiv({
				text: 'Exact overlap targets are unavailable in this candidate snapshot.',
			});
			unavailable.style.marginTop = '0.35em';
		}

		const winner = detail.createDiv({ cls: 'dtf-candidate-predicted-winner' });
		winner.style.marginTop = '0.45em';
		winner.style.paddingTop = '0.35em';
		winner.style.borderTop = '1px solid var(--background-modifier-border)';
		const winnerFolder = conflict.overlappingFolderSample[0] || 'Vault root';
		winner.createSpan({
			text: `Predicted winner at ${winnerFolder}: `,
		}).style.fontWeight = '600';
		winner.createSpan({
			text: conflict.predictedWinnerId
				? this.conflictWinnerName(candidate, conflict.predictedWinnerId)
				: 'Not determined',
		});
	}

	private renderConflictSamples(parent: HTMLElement, sampleFolders: readonly string[]): void {
		if (sampleFolders.length === 0) return;
		const samples = parent.createDiv();
		samples.createSpan({ text: 'Shared folder sample: ' }).style.fontWeight = '600';
		for (const [index, folder] of sampleFolders.entries()) {
			if (index > 0) samples.createSpan({ text: ', ' });
			samples.createEl('code', { text: folder || 'Vault root' });
		}
	}

	private conflictWinnerName(candidate: CandidateRow, winnerId: string): string {
		if (candidate.id === winnerId) return candidate.rule.name;
		const candidateTarget = candidate.conflict.candidateTargets
			?.find((target) => target.ruleId === winnerId);
		if (candidateTarget) return candidateTarget.ruleName;
		const installedTarget = candidate.conflict.installedTargets
			?.find((target) => target.ruleId === winnerId);
		return installedTarget?.ruleName ?? winnerId;
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
		sampleWrap.createDiv({
			cls: 'dtf-candidate-sample-heading',
			text: 'Examples: folder → tag',
		});
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

		const title = preview.createDiv({ text: 'Rules selected to save' });
		title.style.fontWeight = '600';
		const count = preview.createDiv({
			text: `${chosen.length} of ${installableCount} available disabled draft${installableCount === 1 ? '' : 's'} selected · ${uniqueRuleIds.size} unique rule ID${uniqueRuleIds.size === 1 ? '' : 's'} · ${systems.size} source organizational system${systems.size === 1 ? '' : 's'}.`,
		});
		count.style.marginTop = '0.25em';
		count.style.fontSize = '0.86em';
		count.style.color = 'var(--text-muted)';

		if (existingOverlapCount > 0) {
			const conflicts = preview.createDiv({
				text: `${existingOverlapCount} selected proposed rule${existingOverlapCount === 1 ? '' : 's'} overlap an installed rule.`,
			});
			conflicts.style.marginTop = '0.25em';
			conflicts.style.fontSize = '0.84em';
			conflicts.style.color = 'var(--text-error, rgb(190, 50, 50))';
		}
		if (unavailableConflictCount > 0) {
			const unavailable = preview.createDiv({
				text: `${unavailableConflictCount} selected inverse-only proposed rule${unavailableConflictCount === 1 ? '' : 's'} cannot be checked for tag-side overlaps from folder inventory.`,
			});
			unavailable.style.marginTop = '0.25em';
			unavailable.style.fontSize = '0.84em';
			unavailable.style.color = 'var(--text-warning, rgb(180, 120, 20))';
		}

		const stale = this.options.isSnapshotStale?.() ?? false;
		if (stale) {
			const staleNotice = preview.createDiv({
				text: 'The vault or rule settings changed after these proposed rules were built. Saving is paused until refresh completes.'
			});
			staleNotice.dataset.dtfCandidateStale = '1';
			staleNotice.style.marginTop = '0.4em';
			staleNotice.style.color = 'var(--text-warning, rgb(180, 120, 20))';
			staleNotice.style.fontWeight = '600';
		}

		const safety = preview.createDiv({
			text: 'Checked proposals will be saved as disabled drafts. Saving does not run sync or change files, folders, tags, or frontmatter.',
		});
		safety.style.marginTop = '0.4em';
		safety.style.fontWeight = '600';

		const actions = preview.createDiv();
		actions.style.display = 'flex';
		actions.style.justifyContent = 'flex-end';
		actions.style.marginTop = '0.6em';
		const installBtn = actions.createEl('button', {
			text: chosen.length === 0
				? 'Save draft rules'
				: `Save ${chosen.length} draft rule${chosen.length === 1 ? '' : 's'}`,
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

		const title = confirmation.createDiv({ text: 'Save disabled draft rules?' });
		title.style.fontWeight = '600';
		confirmation.createEl('p', {
			text: `Save ${chosen.length} disabled draft rule${chosen.length === 1 ? '' : 's'} from ${systems.size} source organizational system${systems.size === 1 ? '' : 's'}?`,
		});
		if (colliding > 0) {
			const warning = confirmation.createEl('p', {
				text: `${colliding} selected proposed rule${colliding === 1 ? '' : 's'} overlap an installed rule. The predicted winners are shown in the rows above.`,
			});
			warning.style.color = 'var(--text-error, rgb(190, 50, 50))';
			warning.style.fontSize = '0.86em';
		}
		if (unavailable > 0) {
			const warning = confirmation.createEl('p', {
				text: `${unavailable} inverse-only proposed rule${unavailable === 1 ? '' : 's'} cannot be checked for tag-side overlaps from folder inventory. Review these disabled rules in Settings before enabling them.`,
			});
			warning.style.color = 'var(--text-warning, rgb(180, 120, 20))';
			warning.style.fontSize = '0.86em';
		}
		const safety = confirmation.createEl('p', {
			text: 'New drafts are added disabled. No files, folders, tags, or frontmatter will change.',
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
				? 'Saving disabled drafts…'
				: `Save ${chosen.length} disabled draft${chosen.length === 1 ? '' : 's'}`,
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
				message: 'Saving is paused because the proposed-rule snapshot is stale. Wait for refresh and review the updated proposals.',
			};
			this.confirmationOpen = false;
			this.render();
			return;
		}
		this.installing = true;
		this.feedback = { kind: 'info', message: 'Saving selected disabled drafts…' };
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
				message: `Adding disabled drafts failed: ${errorMessage(error)} The panel remains open. Because the callback did not return a result, refresh before retrying if persistence may have partially completed.`,
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

	private focusConflictCandidate(candidateKey: string): void {
		const rows = Array.from(
			this.containerEl.querySelectorAll<HTMLElement>('[data-dtf-candidate-row="1"]'),
		);
		const target = rows.find((row) => row.dataset.dtfCandidateKey === candidateKey);
		if (!target) {
			this.feedback = {
				kind: 'error',
				message: 'The exact proposed-rule target is no longer available. Refresh the candidate plan and review the updated overlaps.',
			};
			this.render();
			return;
		}

		for (const row of rows) this.clearConflictTargetHighlight(row);
		this.focusedConflictCandidateKey = candidateKey;
		this.applyConflictTargetHighlight(target);
		target.scrollIntoView({ block: 'center', inline: 'nearest' });
		target.focus({ preventScroll: true });
	}

	private applyConflictTargetHighlight(row: HTMLElement): void {
		row.dataset.dtfConflictTargetFocused = '1';
		row.style.outline = '2px solid var(--interactive-accent)';
		row.style.outlineOffset = '-2px';
	}

	private clearConflictTargetHighlight(row: HTMLElement): void {
		delete row.dataset.dtfConflictTargetFocused;
		row.style.outline = '';
		row.style.outlineOffset = '';
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

function directionSummaryColor(
	folderToTag: CandidateDirectionStatus,
	tagToFolder: CandidateDirectionStatus,
): string {
	const statuses = [folderToTag.status, tagToFolder.status];
	if (statuses.every((status) => status === 'exact' || status === 'available')) {
		return 'var(--text-success, rgb(40, 140, 70))';
	}
	if (statuses.some((status) =>
		status === 'lossy' || status === 'conditional' || status === 'uncertain')) {
		return 'var(--text-warning, rgb(180, 120, 20))';
	}
	return 'var(--text-muted)';
}

function directionStatusColor(status: CandidateDirectionStatus): string {
	if (status.status === 'exact' || status.status === 'available') {
		return 'var(--text-success, rgb(40, 140, 70))';
	}
	if (status.status === 'lossy' || status.status === 'conditional' || status.status === 'uncertain') {
		return 'var(--text-warning, rgb(180, 120, 20))';
	}
	return 'var(--text-muted)';
}

function directionStatusIcon(status: CandidateDirectionStatus): string {
	switch (status.status) {
		case 'exact':
		case 'available':
			return '✓';
		case 'conditional':
			return '△';
		case 'lossy':
			return '!';
		case 'unavailable':
			return '—';
		case 'uncertain':
			return '?';
	}
}

function domIdPart(value: string): string {
	let hash = 0;
	for (let index = 0; index < value.length; index++) {
		hash = (Math.imul(hash, 31) + value.charCodeAt(index)) | 0;
	}
	const readable = value.replace(/[^A-Za-z0-9_-]/g, '-').slice(0, 48);
	return `${readable}-${(hash >>> 0).toString(36)}`;
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
