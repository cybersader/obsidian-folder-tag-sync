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
import { renderSemanticPath } from './SemanticPath';

export interface WorkbenchScopePanelCallbacks {
	onSelectedPathsChange(selectedPaths: string[]): void;
	onSignalFilterChange(signalFilter: SignalFilterIdentity | null): void;
	onRouteToCandidates(plan: ScopePackPlan): void;
	onRefresh(): void;
	onSelectSystem?(occurrenceKey: string): void;
}

export interface WorkbenchScopePanelOptions extends WorkbenchScopePanelCallbacks {
	snapshot: WorkbenchSessionSnapshot;
	/** Pass the current WorkbenchState.scope so local interactions never mutate persisted state. */
	scope: WorkbenchScopeState;
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
	private expandedPaths = new Set<string>();
	private initializedExpansion = false;

	constructor(
		private readonly container: HTMLElement,
		options: WorkbenchScopePanelOptions,
	) {
		this.snapshot = options.snapshot;
		this.scope = cloneScope(options.scope);
		this.selectedPaths = new Set(this.scope.selectedPaths);
		this.signalFilter = cloneSignalFilter(this.scope.signalFilter);
		this.callbacks = {
			onSelectedPathsChange: options.onSelectedPathsChange,
			onSignalFilterChange: options.onSignalFilterChange,
			onRouteToCandidates: options.onRouteToCandidates,
			onRefresh: options.onRefresh,
			onSelectSystem: options.onSelectSystem,
		};
		this.render();
	}

	/** Replace the immutable session inputs after the Workbench shell refreshes. */
	update(snapshot: WorkbenchSessionSnapshot, scope: WorkbenchScopeState): void {
		this.snapshot = snapshot;
		this.scope = cloneScope(scope);
		this.selectedPaths = new Set(this.scope.selectedPaths);
		this.signalFilter = cloneSignalFilter(this.scope.signalFilter);
		this.render();
	}

	destroy(): void {
		this.container.empty();
	}

	render(): void {
		this.container.empty();
		const root = this.container.createDiv();
		root.dataset.dtfWorkbenchScope = '1';
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.gap = '0.65em';
		root.style.height = '100%';
		root.style.minHeight = '0';

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

		this.renderHeader(root);
		this.renderStats(root, tree, plan);
		this.renderDetectionNotices(root);
		this.renderSignalLegend(root);
		this.renderToolbar(root, tree);
		this.renderRootScopeControl(root, plan);
		this.renderTree(root, tree, plan);
		this.renderPlanSummary(root, plan);
		this.renderActions(root, plan);
	}

	private renderHeader(parent: HTMLElement): void {
		const header = parent.createDiv();
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.gap = '0.5em';
		header.style.flexWrap = 'wrap';

		const headingWrap = header.createDiv();
		const heading = headingWrap.createEl('h3', { text: 'Scope: choose what to include' });
		heading.style.margin = '0';
		headingWrap.createDiv({
			cls: 'dtf-workbench-surface-intro',
			text: 'Checked folders are inclusion boundaries. They include complete system occurrences beneath them, while each system keeps its own detected anchor.',
		});

		const refresh = header.createEl('button', { text: 'Refresh' });
		refresh.setAttr('aria-label', 'Re-scan the vault');
		refresh.addEventListener('click', () => this.callbacks.onRefresh());
	}

	private renderStats(parent: HTMLElement, tree: AnnotatedTree, plan: ScopePackPlan): void {
		const statBar = parent.createDiv();
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(115px, 1fr))';
		statBar.style.gap = '0.5em';

		this.makeStat(statBar, 'Folders matched', tree.totalHitFolders);
		this.makeStat(statBar, 'Surfaced systems', this.snapshot.surfacedResults.length);
		this.makeStat(statBar, 'Selected folders', this.selectedPaths.size);
		this.makeStat(statBar, 'Inclusion boundaries', plan.scopePaths.length);
		this.makeStat(statBar, 'System occurrences', plan.deployments.length);
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
			warning.createSpan({ text: `Conflicting systems detected: ${names}. ` })
				.style.fontWeight = '600';
			warning.createSpan({
				text: 'An inclusion boundary containing both complete occurrences generates candidates for both.',
			});
		}

		if (this.snapshot.belowThresholdResults.length > 0) {
			this.renderDetectionSummary(
				parent,
				'Below the action threshold',
				this.snapshot.belowThresholdResults.map((result) =>
					`${this.packName(result.packId)} (${result.signalsHit}/${result.minSignals} signals)`,
				),
				'These weak matches are shown for context only and cannot create deployments.',
			);
		}

		if (this.snapshot.suppressedResults.length > 0) {
			this.renderDetectionSummary(
				parent,
				'Suppressed detections',
				this.snapshot.suppressedResults.map((result) => this.packName(result.packId)),
				'The required parent system was not detected, so these matches are not actionable.',
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
		const label = parent.createDiv({ text: 'Detected signals (click to filter visually):' });
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
			'All signals',
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
			const empty = legend.createSpan({ text: 'No surfaced signals' });
			empty.style.color = 'var(--text-muted)';
			empty.style.fontSize = '0.82em';
		}

		const note = parent.createDiv({
			text: 'Filtering changes only the tree emphasis. It never changes the deployment calculation.',
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
	): HTMLElement {
		const chip = parent.createSpan();
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

		const selectAll = toolbar.createEl('button', { text: 'Select all hits' });
		selectAll.disabled = this.snapshot.hitMap.hitsByPath.size === 0;
		selectAll.addEventListener('click', () => {
			this.selectedPaths = new Set(this.snapshot.hitMap.hitsByPath.keys());
			this.emitSelectedPaths();
			this.render();
		});

		const selectNone = toolbar.createEl('button', { text: 'Select none' });
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
		const row = parent.createDiv();
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '0.5em';
		row.style.padding = '0.45em 0.6em';
		row.style.background = rootIsScope
			? colorWithAlpha(rootColor, 0.20)
			: 'var(--background-secondary)';
		row.style.borderRadius = '6px';
		row.style.borderLeft = rootIsScope
			? `4px solid ${rootColor}`
			: '4px solid transparent';

		const checkbox = row.createEl('input', { type: 'checkbox' });
		checkbox.checked = rootSelected;
		checkbox.disabled = this.snapshot.hitMap.hitsByPath.size === 0;
		checkbox.setAttr('aria-label', 'Scope the entire vault');
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) this.selectedPaths.add('');
			else this.selectedPaths.delete('');
			this.emitSelectedPaths();
			this.render();
		});

		const text = row.createDiv();
		text.style.flex = '1 1 auto';
		text.createDiv({ text: 'Vault root' }).style.fontWeight = '600';
		const description = text.createDiv({
			text: 'Select this inclusion boundary to include every complete system occurrence in the vault. Each system keeps its own anchor.',
		});
		description.style.fontSize = '0.78em';
		description.style.color = 'var(--text-muted)';

		if (rootIsScope) this.makeScopeBadge(row, rootColor, '');
	}

	private renderTree(parent: HTMLElement, tree: AnnotatedTree, plan: ScopePackPlan): void {
		const treeContainer = parent.createDiv();
		treeContainer.dataset.dtfDetectTree = '1';
		treeContainer.style.flex = '1 1 auto';
		treeContainer.style.minHeight = '12em';
		treeContainer.style.overflow = 'auto';
		treeContainer.style.background = 'var(--background-secondary)';
		treeContainer.style.padding = '0.5em 0.6em';
		treeContainer.style.borderRadius = '6px';
		treeContainer.style.fontSize = '0.88em';

		if (tree.totalHitFolders === 0) {
			const empty = treeContainer.createDiv();
			empty.style.padding = '1.25em 1em';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--text-muted)';
			empty.createDiv({ text: 'No surfaced organizational patterns were detected.' });
			empty.createDiv({
				text: 'Refresh after the vault contains enough signals for a known system.',
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
				text: `… ${tree.root.elidedChildCount} top-level folder(s) with no surfaced matches`,
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

		const row = parent.createDiv();
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
		if (isScopePoint) {
			row.style.borderLeft = `4px solid ${scopeColor}`;
			row.style.paddingLeft = `${depth * 1.0 + 0.1}em`;
		} else if (isAbsorbed) {
			row.style.borderLeft = `2px dashed ${scopeColor}`;
			row.style.paddingLeft = `${depth * 1.0 + 0.15}em`;
			row.style.opacity = '0.55';
		}
		row.addEventListener('mouseenter', () => {
			row.style.background = baseBackground
				? colorWithAlpha(scopeColor, 0.32)
				: 'var(--background-modifier-hover)';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = baseBackground;
		});

		// Every rendered node is either a surfaced direct hit or an ancestor of
		// one, so both kinds are valid hierarchy-first scope choices.
		const checkbox = row.createEl('input', { type: 'checkbox' });
		checkbox.checked = this.selectedPaths.has(node.fullPath);
		checkbox.disabled = !hasActionableEvidence;
		checkbox.title = !hasActionableEvidence
			? 'This branch contains only incomplete or suppressed evidence and is inspect-only.'
			: isDirectHit
				? 'Include the complete system occurrence containing this folder.'
				: 'Include complete system occurrences at or below this branch.';
		checkbox.addEventListener('click', (event) => event.stopPropagation());
		checkbox.addEventListener('change', () => {
			if (checkbox.checked) this.selectedPaths.add(node.fullPath);
			else this.selectedPaths.delete(node.fullPath);
			this.emitSelectedPaths();
			this.render();
		});

		const expanded = this.expandedPaths.has(node.fullPath);
		const arrow = row.createSpan({
			text: node.children.size > 0 ? (expanded ? '▾' : '▸') : ' ',
		});
		arrow.style.minWidth = '0.8em';
		arrow.style.fontSize = '0.8em';
		arrow.style.color = 'var(--text-muted)';

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
			inspectOnly.title = 'This branch contains only incomplete or suppressed evidence and cannot create candidates.';
		}
		if (isScopePoint) this.makeScopeBadge(row, scopeColor, node.fullPath);
		else if (isAbsorbed) {
			const badge = row.createSpan({ text: 'Covered by parent boundary' });
			badge.style.fontSize = '0.65em';
			badge.style.color = 'var(--text-muted)';
			badge.style.marginLeft = '0.35em';
			badge.style.fontStyle = 'italic';
			badge.title = 'A selected ancestor is already the inclusion boundary for this folder.';
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
				text: `… ${node.elidedChildCount} other folder(s), no surfaced matches`,
			});
			elision.style.paddingLeft = `${(depth + 1) * 1.0}em`;
			elision.style.fontSize = '0.76em';
			elision.style.color = 'var(--text-faint)';
			elision.style.fontStyle = 'italic';
		}

		if (node.children.size > 0) {
			row.addEventListener('click', () => {
				if (this.expandedPaths.has(node.fullPath)) this.expandedPaths.delete(node.fullPath);
				else this.expandedPaths.add(node.fullPath);
				this.render();
			});
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
			chip.style.borderColor = colorForSignalIndex(signal.globalIndex);
			chip.style.opacity = activeKey !== null
				&& activeKey !== signalFilterIdentityKey(identityForSignal(signal))
				? '0.35'
				: '1';
			const fullAnchor = hit.occurrenceAnchorPath || 'vault root';
			if (hit.occurrenceKey) {
				chip.createSpan({
					cls: 'dtf-folder-occurrence-relation',
					text: relation === 'support' ? 'Support for' : 'Member of',
				});
				chip.createSpan({
					cls: 'dtf-folder-occurrence-system',
					text: signal.packName,
				});
				renderSemanticPath(chip, hit.occurrenceAnchorPath || '', {
					role: 'scope-occurrence-anchor',
					focusLabel: 'System anchor',
					variant: 'compact',
				});
				chip.setAttr(
					'aria-label',
					`${relation === 'support' ? 'Support' : 'Member'} evidence for ${signal.packName}. System anchor: ${fullAnchor}.`,
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
			text: 'Selection plan',
		});

		if (plan.deployments.length === 0) {
			summary.createDiv({
				cls: 'dtf-workbench-consequence',
				text: 'Select a complete system occurrence or one of its ancestor branches. Incomplete and suppressed evidence remains inspect only.',
			});
			return;
		}

		const boundaries = summary.createDiv({ cls: 'dtf-scope-plan-section' });
		boundaries.createDiv({
			cls: 'dtf-scope-plan-section-title',
			text: `Inclusion boundaries (${plan.scopePaths.length})`,
		});
		for (const path of plan.scopePaths) {
			renderSemanticPath(boundaries, path, {
				role: 'scope-inclusion-boundary',
				focusLabel: 'Selected branch',
				variant: 'stacked',
			});
		}

		const deployments = summary.createDiv({ cls: 'dtf-scope-plan-section' });
		deployments.createDiv({
			cls: 'dtf-scope-plan-section-title',
			text: `System anchors that will generate candidates (${plan.deployments.length})`,
		});
		for (const deployment of plan.deployments) {
			const row = deployments.createDiv({ cls: 'dtf-scope-deployment-row' });
			row.dataset.dtfScopeDeployment = deployment.occurrenceKey;
			row.createDiv({
				cls: 'dtf-scope-deployment-system',
				text: this.packName(deployment.packId),
			});
			renderSemanticPath(row, deployment.anchorPath, {
				role: 'scope-system-anchor',
				focusLabel: 'System anchor',
				variant: 'stacked',
			});
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
				? 'Review candidates (no complete systems included)'
				: `Review candidates from ${plan.deployments.length} system occurrence${plan.deployments.length === 1 ? '' : 's'}`,
		});
		draft.addClass('mod-cta');
		draft.disabled = plan.deployments.length === 0;
		draft.addEventListener('click', () => {
			if (plan.deployments.length > 0) this.callbacks.onRouteToCandidates(plan);
		});
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
		const badge = parent.createSpan({ text: 'Inclusion boundary' });
		badge.style.fontSize = '0.65em';
		badge.style.padding = '0.05em 0.4em';
		badge.style.background = color;
		badge.style.color = 'white';
		badge.style.borderRadius = '999px';
		badge.style.marginLeft = '0.35em';
		badge.style.fontWeight = '600';
		badge.style.letterSpacing = '0.02em';
		badge.title = path === ''
			? 'Includes every complete system occurrence in the vault. Each system keeps its own anchor.'
			: `Includes complete system occurrences at or below "${path}". Each system keeps its own detected anchor.`;
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

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
