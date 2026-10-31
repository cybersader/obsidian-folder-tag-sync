import {
	buildAnnotatedTree,
	colorForSignalIndex,
	type AnnotatedHit,
	type AnnotatedSignal,
	type AnnotatedTree,
	type AnnotatedTreeNode,
} from '../../engine/detectionTree';
import {
	buildScopePackPlan,
	type ScopePackPlan,
} from '../../engine/scopePackPlan';
import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import {
	signalFilterIdentityKey,
	type SignalFilterIdentity,
	type WorkbenchScopeState,
} from '../../workbench/workbenchState';
import { describeOrganizationalSystemMarker } from './organizationalSystemMarker';
import { renderSemanticPath } from './SemanticPath';
import {
	calculateWorkbenchScopeSplit,
	cloneWorkbenchScopePresentationState,
	createDefaultWorkbenchScopePresentationState,
	normalizeWorkbenchScopeScrollOffset,
	updateWorkbenchScopePresentationState,
	WORKBENCH_SCOPE_SPLIT_METRICS,
	type WorkbenchScopePresentationState,
} from './workbenchScopePresentation';

export interface WorkbenchScopePanelCallbacks {
	onSelectedPathsChange(selectedPaths: string[]): void;
	onSignalFilterChange(signalFilter: SignalFilterIdentity | null): void;
	onRouteToCandidates(plan: ScopePackPlan): void;
	onRefresh(): void;
	onSelectSystem?(occurrenceKey: string): void;
	/** Keeps view-local split geometry and scroll place owned by the Workbench host. */
	onPresentationStateChange?(state: WorkbenchScopePresentationState): void;
}

export interface WorkbenchScopePanelOptions extends WorkbenchScopePanelCallbacks {
	snapshot: WorkbenchSessionSnapshot;
	/** Pass the current WorkbenchState.scope so local interactions never mutate persisted state. */
	scope: WorkbenchScopeState;
	/** Transient split and scroll state. This is deliberately not persisted Workbench state. */
	presentationState?: WorkbenchScopePresentationState;
}

/**
 * Embeddable hierarchy-first Scope surface for the Taxonomy Workbench.
 *
 * The panel owns only transient rendering state (expanded branches). Selection
 * and signal-filter changes are emitted to the Workbench shell. Detection,
 * deployment planning, pack loading, and settings persistence stay outside the
 * panel. In particular, the signal filter only changes visual emphasis: every
 * deployment summary is always calculated from the unfiltered surfaced hit map.
 */
export class WorkbenchScopePanel {
	private snapshot: WorkbenchSessionSnapshot;
	private scope: WorkbenchScopeState;
	private readonly callbacks: WorkbenchScopePanelCallbacks;
	private selectedPaths: Set<string>;
	private signalFilter: SignalFilterIdentity | null;
	private presentationState: WorkbenchScopePresentationState;
	private expandedPaths = new Set<string>();
	private initializedExpansion = false;
	private chooserScroller: HTMLElement | null = null;
	private planScroller: HTMLElement | null = null;
	private separatorEl: HTMLElement | null = null;
	private splitWorkspace: HTMLElement | null = null;
	private splitObserver: ResizeObserver | null = null;
	private focusCheckboxAfterRenderPath: string | null = null;

	constructor(
		private readonly container: HTMLElement,
		options: WorkbenchScopePanelOptions,
	) {
		this.snapshot = options.snapshot;
		this.scope = cloneScope(options.scope);
		this.selectedPaths = new Set(this.scope.selectedPaths);
		this.signalFilter = cloneSignalFilter(this.scope.signalFilter);
		this.presentationState = cloneWorkbenchScopePresentationState(
			options.presentationState ?? createDefaultWorkbenchScopePresentationState(),
		);
		this.callbacks = {
			onSelectedPathsChange: options.onSelectedPathsChange,
			onSignalFilterChange: options.onSignalFilterChange,
			onRouteToCandidates: options.onRouteToCandidates,
			onRefresh: options.onRefresh,
			onSelectSystem: options.onSelectSystem,
			onPresentationStateChange: options.onPresentationStateChange,
		};
		this.render();
	}

	/** Replace the immutable session inputs after the Workbench shell refreshes. */
	update(
		snapshot: WorkbenchSessionSnapshot,
		scope: WorkbenchScopeState,
		presentationState?: WorkbenchScopePresentationState,
	): void {
		const hasRenderedPresentation = this.chooserScroller !== null || this.planScroller !== null;
		this.capturePresentationState();
		this.snapshot = snapshot;
		this.scope = cloneScope(scope);
		this.selectedPaths = new Set(this.scope.selectedPaths);
		this.signalFilter = cloneSignalFilter(this.scope.signalFilter);
		if (presentationState && !hasRenderedPresentation) {
			this.presentationState = cloneWorkbenchScopePresentationState(presentationState);
		}
		this.render();
	}

	destroy(): void {
		this.capturePresentationState();
		this.disconnectSplitObserver();
		this.container.empty();
		this.clearRenderedElements();
	}

	render(): void {
		this.capturePresentationState();
		this.disconnectSplitObserver();
		this.container.empty();
		this.clearRenderedElements();

		const root = this.container.createDiv({
			cls: 'dtf-workbench-scope-surface',
		});
		root.dataset.dtfWorkbenchScope = '1';
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.gap = '0.65em';
		root.style.height = '100%';
		root.style.minHeight = '0';
		root.style.overflow = 'hidden';

		const displayHitsByPath = new Map<string, AnnotatedHit[]>();
		for (const [path, hits] of this.snapshot.allEvidenceHitsByPath) {
			displayHitsByPath.set(path, [...hits]);
		}
		const displayHitMap = {
			...this.snapshot.hitMap,
			allSignals: [...this.snapshot.hitMap.allEvidenceSignals],
			hitsByPath: displayHitsByPath,
		};
		const tree = buildAnnotatedTree(
			[...this.snapshot.folderPaths],
			displayHitMap,
		);
		this.initializeExpansion(tree);
		const plan = this.buildPlan();

		const fixedHeader = root.createDiv({ cls: 'dtf-scope-fixed-header' });
		fixedHeader.dataset.dtfScopeFixedHeader = '1';
		fixedHeader.style.flex = '0 0 auto';
		fixedHeader.style.minWidth = '0';
		this.renderHeader(fixedHeader, plan);
		this.renderStats(fixedHeader, plan);

		const workspace = root.createDiv({ cls: 'dtf-scope-split-workspace' });
		workspace.dataset.dtfScopeSplitWorkspace = '1';
		workspace.style.display = 'flex';
		workspace.style.flex = '1 1 auto';
		workspace.style.flexDirection = 'column';
		workspace.style.minHeight = '0';
		workspace.style.overflow = 'hidden';
		this.splitWorkspace = workspace;

		const chooser = workspace.createDiv({ cls: 'dtf-scope-chooser-scroller' });
		chooser.dataset.dtfScopeChooserScroller = '1';
		chooser.setAttr('role', 'region');
		chooser.setAttr('aria-label', 'Choose folders to organize');
		chooser.style.flex = '1 1 auto';
		chooser.style.minHeight = '0';
		chooser.style.overflow = 'auto';
		chooser.style.paddingRight = '0.15em';
		this.chooserScroller = chooser;
		this.bindScroller(chooser, 'chooserScrollTop');
		this.renderToolbar(chooser, tree);
		this.renderRootScopeControl(chooser, plan);
		this.renderTree(chooser, tree, plan);

		this.separatorEl = this.renderSplitSeparator(workspace);

		const planScroller = workspace.createDiv({ cls: 'dtf-scope-plan-scroller' });
		planScroller.dataset.dtfScopePlanScroller = '1';
		planScroller.setAttr('role', 'region');
		planScroller.setAttr('aria-label', 'Scope plan and next actions');
		planScroller.style.display = 'grid';
		planScroller.style.alignContent = 'start';
		planScroller.style.gap = '0.55em';
		planScroller.style.flex = `0 0 ${WORKBENCH_SCOPE_SPLIT_METRICS.defaultPlanHeight}px`;
		planScroller.style.minHeight = '0';
		planScroller.style.overflow = 'auto';
		planScroller.style.paddingRight = '0.15em';
		this.planScroller = planScroller;
		this.bindScroller(planScroller, 'planScrollTop');
		this.renderPlanSummary(planScroller, plan);
		this.renderActions(planScroller, plan);
		this.renderDetectionDetails(planScroller, tree, plan);

		this.observeSplitWorkspace();
		this.restorePresentationState();
		this.restoreCheckboxFocus();
	}

	private renderHeader(parent: HTMLElement, plan: ScopePackPlan): void {
		const header = parent.createDiv({ cls: 'dtf-scope-header' });
		header.style.display = 'flex';
		header.style.alignItems = 'flex-start';
		header.style.justifyContent = 'space-between';
		header.style.gap = '0.5em';
		header.style.flexWrap = 'wrap';

		const headingWrap = header.createDiv();
		headingWrap.style.flex = '1 1 20em';
		headingWrap.style.minWidth = '0';
		const heading = headingWrap.createEl('h3', { text: 'Choose where rules apply' });
		heading.style.margin = '0';
		headingWrap.createDiv({
			cls: 'dtf-workbench-surface-intro',
			text: 'Select the highest folder you want Folder Tag Sync to organize. Ready organizational systems inside that folder and everything below it can propose rules.',
		});
		this.renderCurrentSystemContext(headingWrap, plan);

		const refresh = header.createEl('button', { text: 'Refresh' });
		refresh.setAttr('aria-label', 'Re-scan the vault');
		refresh.addEventListener('click', () => this.callbacks.onRefresh());
	}

	private renderCurrentSystemContext(parent: HTMLElement, plan: ScopePackPlan): void {
		const selectedKey = this.snapshot.state.selectedSystemInstanceKey;
		const selected = this.snapshot.organizationalSystems.cards.find((card) =>
			card.occurrenceKey === selectedKey) ?? null;
		const context = parent.createDiv({ cls: 'dtf-scope-focused-system' });
		context.dataset.dtfScopeCurrentSystem = selected?.occurrenceKey ?? '';
		context.style.display = 'grid';
		context.style.gridTemplateColumns = '4px minmax(0, 1fr)';
		context.style.gap = '0.5em';
		context.style.alignItems = 'stretch';

		const marker = context.createSpan({ cls: 'dtf-orgsys-occurrence-marker' });
		if (selected) marker.dataset.dtfOrganizationalSystemMarker = selected.occurrenceKey;
		marker.setAttr('aria-hidden', 'true');
		marker.style.display = 'block';
		marker.style.width = '4px';
		marker.style.borderRadius = '999px';
		marker.style.background = selected
			? describeOrganizationalSystemMarker(selected.occurrenceKey).colorToken
			: 'var(--background-modifier-border)';

		const copy = context.createDiv();
		copy.createDiv({
			cls: 'dtf-scope-current-system-label',
			text: 'Current organizational system',
		}).style.fontWeight = '650';
		if (!selected) {
			copy.createDiv({
				text: 'None selected. Checked folders are still the only input to the plan below.',
			});
			return;
		}

		const title = copy.createDiv({ cls: 'dtf-scope-current-system-title' });
		title.createSpan({ text: selected.packName }).style.fontWeight = '650';
		title.createSpan({ text: ' ' });
		title.createSpan({
			cls: `dtf-orgsys-status is-${selected.status}`,
			text: selected.status === 'actionable' ? 'Ready' : 'More folders needed',
		});
		title.createSpan({ text: ` · ${selected.anchorPath || 'Vault root'}` });
		const included = plan.deployments.some((deployment) =>
			deployment.occurrenceKey === selected.occurrenceKey);
		const explanation = selected.status !== 'actionable'
			? `This organizational system needs more folders (${statusLabel(selected.status)}) before it can propose rules. It remains visible for context and does not change the plan.`
			: included
				? 'This organizational system is included by the checked folders and marked Current focus below. Checked folders still determine the complete plan.'
				: 'The current organizational system is not included by the checked folders. The plan below still includes every organizational system selected by those folders.';
		copy.createDiv({
			cls: 'dtf-scope-current-system-explanation',
			text: explanation,
		});
	}

	private renderStats(parent: HTMLElement, plan: ScopePackPlan): void {
		const summary = parent.createDiv({ cls: 'dtf-scope-task-summary' });
		summary.dataset.dtfScopeTaskSummary = '1';
		summary.setText(
			`${plan.scopePaths.length} highest-level folder${plan.scopePaths.length === 1 ? '' : 's'} included · `
				+ `${plan.deployments.length} Ready organizational system${plan.deployments.length === 1 ? '' : 's'} will continue`,
		);
	}

	private renderDetectionDetails(
		parent: HTMLElement,
		tree: AnnotatedTree,
		plan: ScopePackPlan,
	): void {
		const disclosure = parent.createEl('details', { cls: 'dtf-scope-detection-details' });
		disclosure.dataset.dtfScopeDetectionDetails = '1';
		disclosure.createEl('summary', {
			text: 'Why Folder Tag Sync recognized these organizational systems',
		});
		const stats = disclosure.createDiv({ cls: 'dtf-scope-diagnostic-stats' });
		this.makeStat(stats, 'Folders that identify them', tree.totalHitFolders);
		this.makeStat(stats, 'Ready organizational systems', this.snapshot.surfacedResults.length);
		this.makeStat(stats, 'Folders checked', this.selectedPaths.size);
		this.makeStat(stats, 'Included areas', plan.scopePaths.length);
		this.makeStat(stats, 'Organizational systems continuing', plan.deployments.length);
		this.renderDetectionNotices(disclosure);
		this.renderSignalLegend(disclosure);
	}

	private renderDetectionNotices(parent: HTMLElement): void {
		if (this.snapshot.conflicts.length > 0) {
			const warning = parent.createDiv();
			warning.style.padding = '0.55em 0.7em';
			warning.style.background = 'var(--background-modifier-error-hover)';
			warning.style.borderLeft = '3px solid var(--text-error)';
			warning.style.borderRadius = '4px';
			warning.style.fontSize = '0.88em';
			const names = this.snapshot.conflicts
				.map(({ packA, packB }) =>
					`${this.packName(packA)} ↔ ${this.packName(packB)}`,
				)
				.join(', ');
			warning.createSpan({ text: `Overlapping organizational systems: ${names}. ` })
				.style.fontWeight = '600';
			warning.createSpan({
				text: 'A checked folder containing both ready occurrences will propose rules from both.',
			});
		}

		if (this.snapshot.belowThresholdResults.length > 0) {
			this.renderDetectionSummary(
				parent,
				'Below the action threshold',
				this.snapshot.belowThresholdResults.map((result) =>
					`${this.packName(result.packId)} (${result.signalsHit}/${result.minSignals} signals)`,
				),
				'These weak matches are shown for context only and cannot propose rules.',
			);
		}

		if (this.snapshot.suppressedResults.length > 0) {
			this.renderDetectionSummary(
				parent,
				'Suppressed detections',
				this.snapshot.suppressedResults.map((result) => this.packName(result.packId)),
				'The required parent organizational system was not recognized, so these matches cannot propose rules.',
			);
		}
	}

	private renderDetectionSummary(
		parent: HTMLElement,
		label: string,
		items: string[],
		explanation: string,
	): void {
		const notice = parent.createDiv();
		notice.style.padding = '0.45em 0.65em';
		notice.style.background = 'var(--background-secondary)';
		notice.style.borderLeft = '3px solid var(--background-modifier-border)';
		notice.style.borderRadius = '4px';
		notice.style.fontSize = '0.84em';
		const title = notice.createDiv({ text: `${label} (${items.length})` });
		title.style.fontWeight = '600';
		notice.createDiv({ text: items.join(', ') }).style.color = 'var(--text-muted)';
		const detail = notice.createDiv({ text: explanation });
		detail.style.color = 'var(--text-muted)';
		detail.style.fontStyle = 'italic';
		detail.style.marginTop = '0.15em';
	}

	private renderSignalLegend(parent: HTMLElement): void {
		const label = parent.createDiv({ text: 'Highlight detection evidence:' });
		label.style.fontSize = '0.85em';
		label.style.color = 'var(--text-muted)';

		const legend = parent.createDiv();
		legend.style.display = 'flex';
		legend.style.flexWrap = 'wrap';
		legend.style.gap = '0.3em';
		legend.style.padding = '0.4em 0.5em';
		legend.style.background = 'var(--background-modifier-form-field)';
		legend.style.borderRadius = '6px';

		const activeKey = this.signalFilter
			? signalFilterIdentityKey(this.signalFilter)
			: null;
		const allChip = this.makeSignalChip(
			legend,
			null,
			'All evidence',
			this.snapshot.hitMap.allEvidenceSignals.length,
			activeKey === null,
		);
		allChip.addEventListener('click', () => this.changeSignalFilter(null));

		for (const signal of this.snapshot.hitMap.allEvidenceSignals) {
			const identity = identityForSignal(signal);
			const selected = activeKey === signalFilterIdentityKey(identity);
			const chip = this.makeSignalChip(
				legend,
				signal,
				signal.label,
				this.countHitsForSignal(signal.globalIndex),
				selected,
			);
			chip.addEventListener('click', () => this.changeSignalFilter(identity));
		}

		if (this.snapshot.hitMap.allEvidenceSignals.length === 0) {
			const empty = legend.createSpan({ text: 'No detection evidence is available' });
			empty.style.color = 'var(--text-muted)';
			empty.style.fontSize = '0.82em';
		}

		const note = parent.createDiv({
			text: 'These highlights explain the scan. They do not change the folders you chose.',
		});
		note.style.fontSize = '0.78em';
		note.style.color = 'var(--text-muted)';
		note.style.fontStyle = 'italic';
	}

	private makeSignalChip(
		parent: HTMLElement,
		signal: AnnotatedSignal | null,
		label: string,
		count: number,
		selected: boolean,
	): HTMLButtonElement {
		const chip = parent.createEl('button', { cls: 'dtf-scope-signal-chip' });
		chip.setAttr('aria-pressed', String(selected));
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.gap = '0.3em';
		chip.style.padding = '0.18em 0.55em';
		chip.style.background = 'var(--background-secondary-alt)';
		chip.style.border = '1px solid var(--background-modifier-border)';
		chip.style.borderRadius = '999px';
		chip.style.fontSize = '0.78em';
		chip.style.cursor = 'pointer';
		chip.style.userSelect = 'none';
		chip.style.outline = selected ? '2px solid var(--interactive-accent)' : '';
		if (signal) {
			chip.dataset.dtfSignalPackId = signal.packId;
			chip.title = `From ${signal.packName}`;
		}

		const swatch = chip.createSpan();
		swatch.style.display = 'inline-block';
		swatch.style.width = '8px';
		swatch.style.height = '8px';
		swatch.style.borderRadius = '50%';
		swatch.style.background = signal
			? colorForSignalIndex(signal.globalIndex)
			: 'var(--text-muted)';
		chip.createSpan({ text: label });
		const countEl = chip.createSpan({ text: String(count) });
		countEl.style.fontSize = '0.75em';
		countEl.style.color = 'var(--text-muted)';
		return chip;
	}

	private renderToolbar(parent: HTMLElement, tree: AnnotatedTree): void {
		const toolbar = parent.createDiv();
		toolbar.style.display = 'flex';
		toolbar.style.gap = '0.4em';
		toolbar.style.flexWrap = 'wrap';
		toolbar.style.marginBottom = '0.5em';

		const selectNone = toolbar.createEl('button', { text: 'Clear choices' });
		selectNone.disabled = this.selectedPaths.size === 0;
		selectNone.addEventListener('click', () => {
			this.selectedPaths.clear();
			this.emitSelectedPaths();
			this.render();
		});

		const expandAll = toolbar.createEl('button', { text: 'Expand all' });
		expandAll.addEventListener('click', () => {
			this.expandedPaths = collectExpandablePaths(tree);
			this.render();
		});

		const collapseAll = toolbar.createEl('button', { text: 'Collapse all' });
		collapseAll.addEventListener('click', () => {
			this.expandedPaths.clear();
			this.render();
		});
	}

	private renderRootScopeControl(parent: HTMLElement, plan: ScopePackPlan): void {
		const rootSelected = this.selectedPaths.has('');
		const rootIsScope = plan.scopePaths.includes('');
		const rootColor = rootIsScope
			? scopeColorForIndex(plan.scopePaths.indexOf(''))
			: 'var(--interactive-accent)';
		const row = parent.createDiv({ cls: 'dtf-scope-root-row' });
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '0.35em';
		row.style.marginBottom = '0.5em';
		row.style.padding = '0.45em 0.6em';
		row.style.background = rootIsScope
			? colorWithAlpha(rootColor, 0.20)
			: 'var(--background-secondary)';
		row.style.borderRadius = '6px';

		this.renderRowRail(row, rootIsScope ? 'scope' : 'none', rootColor);
		const checkboxSlot = this.createRowSlot(row, 'checkbox');
		const checkbox = checkboxSlot.createEl('input', { type: 'checkbox' });
		checkbox.dataset.dtfScopeCheckboxPath = '';
		checkbox.checked = rootSelected;
		checkbox.disabled = this.snapshot.hitMap.hitsByPath.size === 0;
		checkbox.setAttr('aria-label', 'Organize the whole vault');
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) this.selectedPaths.add('');
			else this.selectedPaths.delete('');
			this.focusCheckboxAfterRenderPath = '';
			this.emitSelectedPaths();
			this.render();
		});
		this.createRowSlot(row, 'disclosure');

		const text = row.createDiv();
		text.style.flex = '1 1 auto';
		text.style.minWidth = '0';
		text.createDiv({ text: 'Organize the whole vault' }).style.fontWeight = '600';
		const description = text.createDiv({
			text: 'Include every Ready organizational system in the vault. Each organizational system still starts from the folder where it was detected.',
		});
		description.style.fontSize = '0.78em';
		description.style.color = 'var(--text-muted)';

		if (rootIsScope) this.makeScopeBadge(row, rootColor, '');
	}

	private renderTree(parent: HTMLElement, tree: AnnotatedTree, plan: ScopePackPlan): void {
		const treeContainer = parent.createDiv({ cls: 'dtf-scope-folder-tree' });
		treeContainer.dataset.dtfDetectTree = '1';
		treeContainer.style.minHeight = '0';
		treeContainer.style.overflow = 'visible';
		treeContainer.style.background = 'var(--background-secondary)';
		treeContainer.style.padding = '0.5em 0.6em';
		treeContainer.style.borderRadius = '6px';
		treeContainer.style.fontSize = '0.88em';

		if (tree.totalHitFolders === 0) {
			const empty = treeContainer.createDiv();
			empty.style.padding = '1.25em 1em';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--text-muted)';
			empty.createDiv({ text: 'No Ready organizational systems were detected.' });
			empty.createDiv({
				text: 'Refresh after the vault contains enough required folders for a known organizational system.',
			}).style.fontSize = '0.84em';
			return;
		}

		const coverSet = new Set(plan.scopePaths);
		const scopeColorByPath = new Map<string, string>();
		plan.scopePaths.forEach((path, index) => {
			scopeColorByPath.set(path, scopeColorForIndex(index));
		});

		for (const key of [...tree.root.children.keys()].sort(compareCodePoints)) {
			this.renderTreeNode(
				treeContainer,
				tree.root.children.get(key)!,
				0,
				coverSet,
				plan.scopePaths,
				scopeColorByPath,
			);
		}
		if (tree.root.elidedChildCount > 0) {
			const elision = treeContainer.createDiv({
				text: `… ${tree.root.elidedChildCount} top-level folder(s) with no recognition evidence`,
			});
			elision.style.fontSize = '0.78em';
			elision.style.color = 'var(--text-faint)';
			elision.style.fontStyle = 'italic';
			elision.style.paddingTop = '0.3em';
		}
	}

	private renderTreeNode(
		parent: HTMLElement,
		node: AnnotatedTreeNode,
		depth: number,
		coverSet: Set<string>,
		cover: string[],
		scopeColorByPath: Map<string, string>,
	): void {
		const isDirectHit = node.hits.length > 0;
		const hasActionableEvidence = this.branchHasActionableEvidence(node.fullPath);
		const isScopePoint = coverSet.has(node.fullPath);
		const isAbsorbed = this.selectedPaths.has(node.fullPath) && !isScopePoint;
		const containingScope = isScopePoint
			? node.fullPath
			: findContainingScope(node.fullPath, cover);
		const isInsideScope = containingScope !== null && !isScopePoint;
		const scopeColor = containingScope !== null
			? scopeColorByPath.get(containingScope) ?? 'var(--interactive-accent)'
			: 'var(--interactive-accent)';
		const filterMatchesBranch = this.branchMatchesFilter(node);
		const baseBackground = isScopePoint
			? colorWithAlpha(scopeColor, 0.20)
			: isInsideScope
				? colorWithAlpha(scopeColor, 0.07)
				: '';

		const row = parent.createDiv({ cls: 'dtf-scope-folder-row' });
		row.dataset.dtfScopeFolderPath = node.fullPath;
		row.dataset.dtfScopeActionable = String(hasActionableEvidence);
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '0.35em';
		row.style.padding = '0.18em 0.3em';
		row.style.paddingLeft = `${depth * 1.0}em`;
		row.style.borderRadius = '3px';
		row.style.cursor = node.children.size > 0 ? 'pointer' : 'default';
		row.style.userSelect = 'none';
		row.style.background = baseBackground;
		if (!filterMatchesBranch) row.style.opacity = '0.4';
		if (isAbsorbed) row.style.opacity = '0.55';
		row.addEventListener('mouseenter', () => {
			row.style.background = baseBackground
				? colorWithAlpha(scopeColor, 0.32)
				: 'var(--background-modifier-hover)';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = baseBackground;
		});

		this.renderRowRail(
			row,
			isScopePoint ? 'scope' : isAbsorbed ? 'absorbed' : 'none',
			scopeColor,
		);

		// Every rendered node is either a surfaced direct hit or an ancestor of
		// one, so both kinds are valid hierarchy-first scope choices.
		const checkboxSlot = this.createRowSlot(row, 'checkbox');
		const checkbox = checkboxSlot.createEl('input', { type: 'checkbox' });
		checkbox.dataset.dtfScopeCheckboxPath = node.fullPath;
		checkbox.checked = this.selectedPaths.has(node.fullPath);
		checkbox.disabled = !hasActionableEvidence;
		checkbox.title = !hasActionableEvidence
			? 'This folder contains only organizational systems needing more folders and cannot continue to proposed rules.'
			: isDirectHit
				? 'Include the Ready organizational system containing this folder.'
				: 'Include Ready organizational systems in this folder and everything below it.';
		checkbox.setAttr('aria-label', `Organize ${node.fullPath}`);
		checkbox.addEventListener('click', (event) => event.stopPropagation());
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) this.selectedPaths.add(node.fullPath);
			else this.selectedPaths.delete(node.fullPath);
			this.focusCheckboxAfterRenderPath = node.fullPath;
			this.emitSelectedPaths();
			this.render();
		});

		const expanded = this.expandedPaths.has(node.fullPath);
		const disclosureSlot = this.createRowSlot(row, 'disclosure');
		if (node.children.size > 0) {
			const disclosure = disclosureSlot.createEl('button', {
				cls: 'dtf-scope-folder-disclosure',
				text: expanded ? '▾' : '▸',
			});
			disclosure.setAttr('aria-label', `${expanded ? 'Collapse' : 'Expand'} ${node.fullPath}`);
			disclosure.setAttr('aria-expanded', String(expanded));
			disclosure.style.width = '1.2em';
			disclosure.style.height = '1.2em';
			disclosure.style.minHeight = '0';
			disclosure.style.padding = '0';
			disclosure.style.border = '0';
			disclosure.style.background = 'transparent';
			disclosure.style.boxShadow = 'none';
			disclosure.style.color = 'var(--text-muted)';
			disclosure.addEventListener('click', (event) => {
				event.stopPropagation();
				this.toggleExpandedPath(node.fullPath);
			});
		}

		row.createSpan({ text: '📁' }).style.fontSize = '0.92em';
		const name = row.createSpan({ text: node.name });
		name.style.fontWeight = isDirectHit ? '600' : '400';
		if (!isDirectHit) name.style.color = 'var(--text-muted)';

		if (!hasActionableEvidence) {
			const inspectOnly = row.createSpan({
				cls: 'dtf-scope-inspect-only',
				text: 'Inspect only',
			});
			inspectOnly.dataset.dtfScopeInspectOnly = '1';
			inspectOnly.title = 'This folder contains only organizational systems needing more folders and cannot create proposed rules.';
		}
		if (isScopePoint) this.makeScopeBadge(row, scopeColor, node.fullPath);
		else if (isAbsorbed) {
			const badge = row.createSpan({ text: 'Already included by a parent folder' });
			badge.style.fontSize = '0.65em';
			badge.style.color = 'var(--text-muted)';
			badge.style.marginLeft = '0.35em';
			badge.style.fontStyle = 'italic';
			badge.title = 'A checked parent folder already includes this folder and everything below it.';
		}

		if (isDirectHit) this.renderFolderSignalChips(row, node.hits);

		const childWrap = parent.createDiv();
		childWrap.dataset.dtfTreeContainer = '1';
		childWrap.style.display = expanded ? '' : 'none';
		for (const key of [...node.children.keys()].sort(compareCodePoints)) {
			this.renderTreeNode(
				childWrap,
				node.children.get(key)!,
				depth + 1,
				coverSet,
				cover,
				scopeColorByPath,
			);
		}
		if (node.elidedChildCount > 0) {
			const elision = childWrap.createDiv({
				text: `… ${node.elidedChildCount} other folder(s), no recognition evidence`,
			});
			elision.style.paddingLeft = `${(depth + 1) * 1.0}em`;
			elision.style.fontSize = '0.76em';
			elision.style.color = 'var(--text-faint)';
			elision.style.fontStyle = 'italic';
		}

		if (node.children.size > 0) {
			row.addEventListener('click', () => this.toggleExpandedPath(node.fullPath));
		}
	}

	private renderFolderSignalChips(parent: HTMLElement, hits: AnnotatedHit[]): void {
		const wrap = parent.createSpan({ cls: 'dtf-scope-occurrence-relations' });
		const activeKey = this.signalFilter
			? signalFilterIdentityKey(this.signalFilter)
			: null;
		const relations = new Map<string, AnnotatedHit>();
		for (const hit of hits) {
			const relation = hit.relation ?? 'member';
			const key = hit.occurrenceKey
				? `${hit.occurrenceKey.length}:${hit.occurrenceKey}:${relation}`
				: `signal:${signalFilterIdentityKey(identityForSignal(hit.signal))}`;
			if (!relations.has(key)) relations.set(key, hit);
		}

		for (const hit of relations.values()) {
			const signal = hit.signal;
			const relation = hit.relation ?? 'member';
			const chip = wrap.createEl(hit.occurrenceKey ? 'button' : 'span', {
				cls: 'dtf-folder-occurrence-chip',
			});
			chip.dataset.dtfSignalPackId = signal.packId;
			chip.dataset.dtfRelation = relation;
			if (hit.occurrenceKey) chip.dataset.dtfOccurrenceKey = hit.occurrenceKey;
			const occurrenceMarker = hit.occurrenceKey
				? describeOrganizationalSystemMarker(hit.occurrenceKey)
				: null;
			chip.style.borderColor = occurrenceMarker?.colorToken
				?? colorForSignalIndex(signal.globalIndex);
			chip.style.opacity = activeKey !== null
				&& activeKey !== signalFilterIdentityKey(identityForSignal(signal))
				? '0.35'
				: '1';
			const fullAnchor = hit.occurrenceAnchorPath || 'vault root';
			if (occurrenceMarker) {
				const marker = chip.createSpan({ cls: 'dtf-orgsys-occurrence-marker' });
				marker.dataset.dtfOrganizationalSystemMarker = hit.occurrenceKey!;
				marker.setAttr('aria-hidden', 'true');
				marker.style.display = 'inline-block';
				marker.style.flex = '0 0 4px';
				marker.style.width = '4px';
				marker.style.height = '1.1em';
				marker.style.borderRadius = '999px';
				marker.style.background = occurrenceMarker.colorToken;
			}
			if (hit.occurrenceKey) {
				chip.createSpan({
					cls: 'dtf-folder-occurrence-relation',
					text: relation === 'support' ? 'Supports' : 'Identifies',
				});
				chip.createSpan({
					cls: 'dtf-folder-occurrence-system',
					text: signal.packName,
				});
				renderSemanticPath(chip, hit.occurrenceAnchorPath || '', {
					role: 'scope-occurrence-anchor',
					focusLabel: 'Rules start here',
					variant: 'compact',
				});
				chip.setAttr(
					'aria-label',
					`${relation === 'support' ? 'Supports' : 'Identifies'} ${signal.packName} organizational system. Recognized at ${fullAnchor}.`,
				);
			} else {
				chip.setText(`Signal · ${signal.label}`);
			}
			chip.title = hit.occurrenceKey
				? `${signal.label}; ${signal.packName} occurrence at ${fullAnchor}`
				: `${signal.label} (${signal.packName})`;
			if (hit.occurrenceKey) {
				const selected = this.snapshot.state.selectedSystemInstanceKey === hit.occurrenceKey;
				chip.setAttr('aria-pressed', String(selected));
				if (selected) chip.addClass('is-selected');
				chip.addEventListener('click', (event) => {
					event.stopPropagation();
					this.callbacks.onSelectSystem?.(hit.occurrenceKey!);
				});
			}
		}
	}

	private renderPlanSummary(parent: HTMLElement, plan: ScopePackPlan): void {
		const summary = parent.createDiv({ cls: 'dtf-scope-plan-summary' });
		summary.dataset.dtfScopePlanSummary = '1';
		summary.createDiv({
			cls: 'dtf-scope-plan-title',
			text: 'What happens next',
		});

		if (plan.deployments.length === 0) {
			summary.createDiv({
				cls: 'dtf-workbench-consequence',
				text: 'Choose a folder containing at least one Ready organizational system. Organizational systems needing more folders remain available for inspection but cannot continue.',
			});
			return;
		}

		const boundaries = summary.createDiv({ cls: 'dtf-scope-plan-section' });
		boundaries.createDiv({
			cls: 'dtf-scope-plan-section-title',
			text: `Folders included (${plan.scopePaths.length})`,
		});
		for (const path of plan.scopePaths) {
			renderSemanticPath(boundaries, path, {
				role: 'scope-inclusion-boundary',
				focusLabel: 'Starts here',
				variant: 'stacked',
			});
		}

		const deployments = summary.createDiv({ cls: 'dtf-scope-plan-section' });
		deployments.createDiv({
			cls: 'dtf-scope-plan-section-title',
			text: `Organizational systems that will propose rules (${plan.deployments.length})`,
		});
		const currentKey = this.snapshot.state.selectedSystemInstanceKey;
		for (const deployment of plan.deployments) {
			const row = deployments.createDiv({ cls: 'dtf-scope-deployment-row' });
			row.dataset.dtfScopeDeployment = deployment.occurrenceKey;
			row.style.display = 'flex';
			row.style.alignItems = 'stretch';
			const isCurrentFocus = deployment.occurrenceKey === currentKey;
			if (isCurrentFocus) row.dataset.dtfScopeCurrentFocus = '1';
			const occurrenceMarker = describeOrganizationalSystemMarker(deployment.occurrenceKey);
			const rail = row.createSpan({ cls: 'dtf-orgsys-occurrence-marker' });
			rail.dataset.dtfOrganizationalSystemMarker = deployment.occurrenceKey;
			rail.setAttr('aria-hidden', 'true');
			rail.style.flex = '0 0 4px';
			rail.style.width = '4px';
			rail.style.minHeight = '2.2em';
			rail.style.borderRadius = '999px';
			rail.style.background = occurrenceMarker.colorToken;
			const content = row.createDiv({ cls: 'dtf-scope-deployment-content' });
			content.style.display = 'flex';
			content.style.flex = '1 1 auto';
			content.style.flexWrap = 'wrap';
			content.style.gap = '0.5em';
			content.style.minWidth = '0';
			const system = content.createDiv({ cls: 'dtf-scope-deployment-system' });
			system.style.flex = '1 1 9em';
			system.createSpan({ text: this.packName(deployment.packId) });
			if (isCurrentFocus) {
				const current = system.createSpan({
					cls: 'dtf-scope-current-focus-badge',
					text: 'Current focus',
				});
				current.style.marginLeft = '0.45em';
				current.style.fontSize = '0.72em';
				current.style.color = occurrenceMarker.colorToken;
			}
			const path = renderSemanticPath(content, deployment.anchorPath, {
				role: 'scope-system-anchor',
				focusLabel: 'Rules start here',
				variant: 'stacked',
			});
			path.style.flex = '2 1 14em';
			path.style.minWidth = '0';
		}
	}

	private renderActions(parent: HTMLElement, plan: ScopePackPlan): void {
		const actions = parent.createDiv();
		actions.style.display = 'flex';
		actions.style.justifyContent = 'flex-end';
		actions.style.alignItems = 'center';
		actions.style.gap = '0.5em';

		const draft = actions.createEl('button', {
			text: plan.deployments.length === 0
				? 'Review proposed rules (choose a Ready organizational system first)'
				: `Review proposed rules for ${plan.deployments.length} organizational system${plan.deployments.length === 1 ? '' : 's'}`,
		});
		draft.addClass('mod-cta');
		draft.disabled = plan.deployments.length === 0;
		draft.addEventListener('click', () => {
			if (plan.deployments.length > 0) this.callbacks.onRouteToCandidates(plan);
		});
	}

	private renderSplitSeparator(parent: HTMLElement): HTMLElement {
		const separator = parent.createDiv({ cls: 'dtf-scope-split-separator' });
		separator.dataset.dtfScopeSeparator = '1';
		separator.setAttr('role', 'separator');
		separator.setAttr('aria-label', 'Resize folder chooser and plan');
		separator.setAttr('aria-orientation', 'horizontal');
		separator.tabIndex = 0;
		separator.style.display = 'flex';
		separator.style.flex = `0 0 ${WORKBENCH_SCOPE_SPLIT_METRICS.separatorThickness}px`;
		separator.style.alignItems = 'center';
		separator.style.justifyContent = 'center';
		separator.style.cursor = 'row-resize';
		separator.style.touchAction = 'none';
		separator.style.userSelect = 'none';

		const handle = separator.createSpan({ cls: 'dtf-scope-split-handle' });
		handle.setAttr('aria-hidden', 'true');
		handle.style.display = 'block';
		handle.style.width = '3.5em';
		handle.style.height = '2px';
		handle.style.borderRadius = '999px';
		handle.style.background = 'var(--background-modifier-border)';

		let pointerId: number | null = null;
		let startClientY = 0;
		let startPlanHeight = 0;
		separator.addEventListener('pointerdown', (event) => {
			if (event.button !== 0) return;
			const split = this.currentSplit();
			if (!split || split.minPlanHeight === split.maxPlanHeight) return;
			event.preventDefault();
			pointerId = event.pointerId;
			startClientY = event.clientY;
			startPlanHeight = split.planHeight;
			separator.setPointerCapture(event.pointerId);
		});
		separator.addEventListener('pointermove', (event) => {
			if (pointerId !== event.pointerId) return;
			this.setPreferredPlanHeight(startPlanHeight - (event.clientY - startClientY));
		});
		const endPointerResize = (event: PointerEvent): void => {
			if (pointerId !== event.pointerId) return;
			if (separator.hasPointerCapture(event.pointerId)) {
				separator.releasePointerCapture(event.pointerId);
			}
			pointerId = null;
		};
		separator.addEventListener('pointerup', endPointerResize);
		separator.addEventListener('pointercancel', endPointerResize);
		separator.addEventListener('lostpointercapture', () => {
			pointerId = null;
		});
		separator.addEventListener('keydown', (event) => {
			const split = this.currentSplit();
			if (!split) return;
			const step = event.shiftKey ? 40 : 10;
			let nextHeight: number | null | undefined;
			switch (event.key) {
				case 'ArrowUp':
					nextHeight = split.planHeight + step;
					break;
				case 'ArrowDown':
					nextHeight = split.planHeight - step;
					break;
				case 'Home':
					nextHeight = split.minPlanHeight;
					break;
				case 'End':
					nextHeight = split.maxPlanHeight;
					break;
				default:
					return;
			}
			event.preventDefault();
			this.setPreferredPlanHeight(nextHeight);
		});
		separator.addEventListener('dblclick', (event) => {
			event.preventDefault();
			this.setPreferredPlanHeight(null);
		});
		return separator;
	}

	private bindScroller(
		scroller: HTMLElement,
		key: 'chooserScrollTop' | 'planScrollTop',
	): void {
		scroller.addEventListener('scroll', () => {
			const nextOffset = normalizeWorkbenchScopeScrollOffset(scroller.scrollTop);
			if (this.presentationState[key] === nextOffset) return;
			this.presentationState = updateWorkbenchScopePresentationState(
				this.presentationState,
				{ [key]: nextOffset },
			);
			this.emitPresentationState();
		});
	}

	private setPreferredPlanHeight(preferredPlanHeight: number | null): void {
		const split = this.currentSplit();
		const normalizedHeight = preferredPlanHeight === null || !split
			? preferredPlanHeight
			: Math.min(
				Math.max(preferredPlanHeight, split.minPlanHeight),
				split.maxPlanHeight,
			);
		this.presentationState = updateWorkbenchScopePresentationState(
			this.presentationState,
			{ preferredPlanHeight: normalizedHeight },
		);
		this.emitPresentationState();
		this.applySplit();
	}

	private currentSplit(): ReturnType<typeof calculateWorkbenchScopeSplit> | null {
		const availableHeight = this.splitWorkspace?.clientHeight ?? 0;
		return availableHeight > 0
			? calculateWorkbenchScopeSplit(availableHeight, this.presentationState)
			: null;
	}

	private applySplit(): void {
		const split = this.currentSplit();
		if (!split || !this.chooserScroller || !this.planScroller || !this.separatorEl) return;
		this.chooserScroller.style.flex = `0 0 ${split.chooserHeight}px`;
		this.planScroller.style.flex = `0 0 ${split.planHeight}px`;
		this.separatorEl.style.flexBasis = `${split.separatorThickness}px`;
		this.separatorEl.setAttr('aria-valuemin', String(Math.round(split.minPlanHeight)));
		this.separatorEl.setAttr('aria-valuemax', String(Math.round(split.maxPlanHeight)));
		this.separatorEl.setAttr('aria-valuenow', String(Math.round(split.planHeight)));
		this.separatorEl.setAttr('aria-valuetext', `Plan height ${Math.round(split.planHeight)} pixels`);
		this.separatorEl.setAttr(
			'aria-disabled',
			String(split.minPlanHeight === split.maxPlanHeight),
		);
	}

	private observeSplitWorkspace(): void {
		this.applySplit();
		if (!this.splitWorkspace || typeof ResizeObserver === 'undefined') return;
		this.splitObserver = new ResizeObserver(() => this.applySplit());
		this.splitObserver.observe(this.splitWorkspace);
	}

	private disconnectSplitObserver(): void {
		this.splitObserver?.disconnect();
		this.splitObserver = null;
	}

	private capturePresentationState(): void {
		if (!this.chooserScroller && !this.planScroller) return;
		const next = updateWorkbenchScopePresentationState(this.presentationState, {
			chooserScrollTop: normalizeWorkbenchScopeScrollOffset(
				this.chooserScroller?.scrollTop ?? this.presentationState.chooserScrollTop,
			),
			planScrollTop: normalizeWorkbenchScopeScrollOffset(
				this.planScroller?.scrollTop ?? this.presentationState.planScrollTop,
			),
		});
		if (samePresentationState(next, this.presentationState)) return;
		this.presentationState = next;
		this.emitPresentationState();
	}

	private restorePresentationState(): void {
		if (this.chooserScroller) {
			this.chooserScroller.scrollTop = this.presentationState.chooserScrollTop;
		}
		if (this.planScroller) {
			this.planScroller.scrollTop = this.presentationState.planScrollTop;
		}
	}

	private restoreCheckboxFocus(): void {
		const path = this.focusCheckboxAfterRenderPath;
		if (path === null) return;
		this.focusCheckboxAfterRenderPath = null;
		requestAnimationFrame(() => {
			const checkbox = Array.from(
				this.container.querySelectorAll<HTMLInputElement>('[data-dtf-scope-checkbox-path]'),
			).find((candidate) => candidate.dataset.dtfScopeCheckboxPath === path);
			checkbox?.focus({ preventScroll: true });
		});
	}

	private emitPresentationState(): void {
		this.callbacks.onPresentationStateChange?.(
			cloneWorkbenchScopePresentationState(this.presentationState),
		);
	}

	private clearRenderedElements(): void {
		this.chooserScroller = null;
		this.planScroller = null;
		this.separatorEl = null;
		this.splitWorkspace = null;
	}

	private createRowSlot(
		parent: HTMLElement,
		kind: 'checkbox' | 'disclosure',
	): HTMLElement {
		const slot = parent.createSpan({ cls: `dtf-scope-row-${kind}-slot` });
		slot.dataset.dtfScopeRowSlot = kind;
		slot.style.display = 'inline-flex';
		slot.style.flex = '0 0 1.35em';
		slot.style.width = '1.35em';
		slot.style.alignItems = 'center';
		slot.style.justifyContent = 'center';
		return slot;
	}

	private renderRowRail(
		parent: HTMLElement,
		state: 'scope' | 'absorbed' | 'none',
		color: string,
	): void {
		const rail = parent.createSpan({ cls: 'dtf-scope-row-rail-slot' });
		rail.dataset.dtfScopeRowSlot = 'rail';
		rail.setAttr('aria-hidden', 'true');
		rail.style.display = 'block';
		rail.style.alignSelf = 'stretch';
		rail.style.flex = '0 0 4px';
		rail.style.width = '4px';
		rail.style.minHeight = '1.2em';
		rail.style.borderRadius = '999px';
		if (state === 'scope') rail.style.background = color;
		else if (state === 'absorbed') rail.style.borderLeft = `2px dashed ${color}`;
	}

	private toggleExpandedPath(path: string): void {
		if (this.expandedPaths.has(path)) this.expandedPaths.delete(path);
		else this.expandedPaths.add(path);
		this.render();
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

	private makeScopeBadge(parent: HTMLElement, color: string, path: string): void {
		const badge = parent.createSpan({ text: 'Starts here' });
		badge.style.fontSize = '0.65em';
		badge.style.padding = '0.05em 0.4em';
		badge.style.background = color;
		badge.style.color = 'white';
		badge.style.borderRadius = '999px';
		badge.style.marginLeft = '0.35em';
		badge.style.fontWeight = '600';
		badge.style.letterSpacing = '0.02em';
		badge.title = path === ''
			? 'Includes every Ready organizational system in the vault. Each organizational system keeps its own detected starting folder.'
			: `Includes Ready organizational systems at or below "${path}". Each organizational system keeps its own detected starting folder.`;
	}

	private branchHasActionableEvidence(path: string): boolean {
		for (const hitPath of this.snapshot.actionableHitsByPath.keys()) {
			if (path === '' || hitPath === path || hitPath.startsWith(`${path}/`)) return true;
		}
		return false;
	}

	private buildPlan(): ScopePackPlan {
		return buildScopePackPlan({
			selectedPaths: [...this.selectedPaths],
			hitMap: this.snapshot.hitMap,
		});
	}

	private branchMatchesFilter(node: AnnotatedTreeNode): boolean {
		if (this.signalFilter === null) return true;
		const activeKey = signalFilterIdentityKey(this.signalFilter);
		if (node.hits.some((hit) =>
			signalFilterIdentityKey(identityForSignal(hit.signal)) === activeKey,
		)) return true;
		for (const child of node.children.values()) {
			if (this.branchMatchesFilter(child)) return true;
		}
		return false;
	}

	private countHitsForSignal(globalIndex: number): number {
		let count = 0;
		for (const hits of this.snapshot.allEvidenceHitsByPath.values()) {
			if (hits.some((hit) => hit.signal.globalIndex === globalIndex)) count++;
		}
		return count;
	}

	private changeSignalFilter(signalFilter: SignalFilterIdentity | null): void {
		this.signalFilter = cloneSignalFilter(signalFilter);
		this.callbacks.onSignalFilterChange(cloneSignalFilter(signalFilter));
		this.render();
	}

	private emitSelectedPaths(): void {
		this.callbacks.onSelectedPathsChange(
			[...this.selectedPaths].sort(compareCodePoints),
		);
	}

	private packName(packId: string): string {
		return this.snapshot.packNamesById.get(packId) ?? packId;
	}

	private initializeExpansion(tree: AnnotatedTree): void {
		const validExpandablePaths = collectExpandablePaths(tree);
		if (!this.initializedExpansion) {
			for (const node of tree.root.children.values()) {
				if (node.children.size > 0) this.expandedPaths.add(node.fullPath);
			}
			this.initializedExpansion = true;
		} else {
			this.expandedPaths = new Set(
				[...this.expandedPaths].filter((path) => validExpandablePaths.has(path)),
			);
		}
	}
}

/** Render-and-return convenience for shells that rebuild panels declaratively. */
export function renderWorkbenchScopePanel(
	container: HTMLElement,
	options: WorkbenchScopePanelOptions,
): WorkbenchScopePanel {
	return new WorkbenchScopePanel(container, options);
}

function identityForSignal(signal: AnnotatedSignal): SignalFilterIdentity {
	return {
		packId: signal.packId,
		regex: signal.regex,
		scope: signal.scope,
	};
}

function cloneScope(scope: WorkbenchScopeState): WorkbenchScopeState {
	return {
		selectedPaths: [...scope.selectedPaths],
		signalFilter: cloneSignalFilter(scope.signalFilter),
	};
}

function cloneSignalFilter(
	filter: SignalFilterIdentity | null,
): SignalFilterIdentity | null {
	return filter ? { ...filter } : null;
}

function collectExpandablePaths(tree: AnnotatedTree): Set<string> {
	const paths = new Set<string>();
	const visit = (node: AnnotatedTreeNode): void => {
		if (node.children.size > 0 && node.fullPath !== '') paths.add(node.fullPath);
		for (const child of node.children.values()) visit(child);
	};
	visit(tree.root);
	return paths;
}

function findContainingScope(path: string, cover: readonly string[]): string | null {
	let best: string | null = null;
	let bestLength = -1;
	for (const scope of cover) {
		if (scope === '') {
			if (bestLength < 0) best = '';
			continue;
		}
		if (path === scope) return scope;
		if (path.startsWith(`${scope}/`) && scope.length > bestLength) {
			best = scope;
			bestLength = scope.length;
		}
	}
	return best;
}

function scopeColorForIndex(index: number): string {
	const hue = (index * 137.508 + 200) % 360;
	return `hsl(${hue.toFixed(0)}, 72%, 52%)`;
}

function colorWithAlpha(color: string, alpha: number): string {
	if (color.startsWith('hsl(')) {
		return color.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
	}
	return `rgba(var(--interactive-accent-rgb, 84, 132, 255), ${alpha})`;
}

function samePresentationState(
	a: WorkbenchScopePresentationState,
	b: WorkbenchScopePresentationState,
): boolean {
	return a.preferredPlanHeight === b.preferredPlanHeight
		&& a.chooserScrollTop === b.chooserScrollTop
		&& a.planScrollTop === b.planScrollTop;
}

function statusLabel(status: 'actionable' | 'incomplete' | 'suppressed'): string {
	if (status === 'incomplete') return 'more folders needed';
	if (status === 'suppressed') return 'required parent organizational system not ready';
	return 'Ready';
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
