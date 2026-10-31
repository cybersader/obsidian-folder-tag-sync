import { Menu } from 'obsidian';
import {
	buildAnnotatedTree,
	type AnnotatedHit,
	type AnnotatedTree,
	type CrossPackHitMap,
} from '../../engine/detectionTree';
import type { FolderRuleEntry } from '../../engine/folderRuleView';
import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type { OrganizationalSystemCard } from '../../workbench/organizationalSystemsProjection';
import type {
	WorkbenchMapMode,
	WorkbenchState,
} from '../../workbench/workbenchState';
import {
	collectOccurrenceRelations,
	renderAnnotatedTree,
} from '../annotatedTreeRender';
import { describeOrganizationalSystemMarker } from './organizationalSystemMarker';
import { renderFullPath, renderSemanticPath } from './SemanticPath';
import {
	createDefaultWorkbenchMapPresentationState,
	defaultExpandedPaths,
	reconcileWorkbenchMapPresentationState,
	setPathExpanded,
	type WorkbenchMapPresentationState,
} from './workbenchMapPresentation';

export interface WorkbenchMapPanelCallbacks {
	/** Receives controlled Map state changes such as mode and folder detail. */
	onStateChange?: (state: WorkbenchState) => void;
	/** Requests a fresh WorkbenchSession snapshot. */
	onRefresh?: () => void | Promise<void>;
	/** Opens plugin settings, optionally focused on a rule. */
	onOpenSettings?: (ruleId?: string) => void;
	/** Routes the chosen folder branch into the Scope surface. */
	onChooseBranchInScope?: (path: string) => void;
	/** Opens the persistent system chooser without changing scope. */
	onOpenSystemsBrowser?: () => void;
	/** Focuses the occurrence shared with the persistent Organizational systems deck. */
	onSelectSystem?: (occurrenceKey: string) => void;
	/** Focuses and opens one exact occurrence without changing Scope. */
	onOpenSystemOccurrence?: (occurrenceKey: string) => void;
	/** Keeps view-local tree navigation stable while domain state changes. */
	onPresentationStateChange?: (state: WorkbenchMapPresentationState) => void;
}

/**
 * Read-only Workbench Map panel. It owns only DOM rendered beneath `parent`;
 * scanning, navigation, persistence, settings, and preview presentation stay in
 * the host through callbacks.
 */
export class WorkbenchMapPanel {
	private readonly parent: HTMLElement;
	private readonly callbacks: WorkbenchMapPanelCallbacks;
	private snapshot: WorkbenchSessionSnapshot | null = null;
	private presentationState: WorkbenchMapPresentationState;
	private treeEl: HTMLElement | null = null;
	private workspaceEl: HTMLElement | null = null;
	private detailEl: HTMLElement | null = null;
	private focusAfterRenderPath: string | null = null;

	constructor(
		parent: HTMLElement,
		callbacks: WorkbenchMapPanelCallbacks = {},
		presentationState: WorkbenchMapPresentationState = createDefaultWorkbenchMapPresentationState(),
	) {
		this.parent = parent;
		this.callbacks = callbacks;
		this.presentationState = presentationState;
	}

	render(snapshot: WorkbenchSessionSnapshot): void {
		this.capturePresentationState();
		this.snapshot = snapshot;
		const tree = buildWorkbenchMapTree(snapshot, snapshot.state.mapMode);
		this.presentationState = reconcileWorkbenchMapPresentationState(
			this.presentationState,
			[...snapshot.folderPaths],
		);
		if (this.presentationState.expandedPaths === null) {
			this.presentationState = {
				...this.presentationState,
				expandedPaths: defaultExpandedPaths(tree, 2),
			};
			this.emitPresentationState();
		}

		this.parent.empty();
		const root = this.parent.createDiv({ cls: 'dtf-workbench-view dtf-workbench-map-surface' });
		root.dataset.dtfWorkbenchMapSurface = '1';

		this.renderHeader(root, snapshot);
		this.renderModeExplanation(root, snapshot.state.mapMode);
		this.renderStats(root, snapshot);

		const workspace = root.createDiv({ cls: 'dtf-workbench-map-workspace' });
		this.workspaceEl = workspace;
		this.renderTree(workspace, snapshot, tree);

		const detail = workspace.createDiv({ cls: 'dtf-workbench-folder-inspector' });
		this.detailEl = detail;
		detail.dataset.dtfFolderDetail = '1';
		detail.setAttr('role', 'region');
		detail.setAttr('aria-label', 'Folder inspector');
		detail.addEventListener('keydown', (event) => {
			if (event.key !== 'Escape') return;
			event.preventDefault();
			this.closeFolderDetail();
		});
		this.renderFolderDetail(snapshot.state.detailPath);
		this.restorePresentationState();
	}

	/** Replace the immutable session input after the Workbench host refreshes. */
	update(snapshot: WorkbenchSessionSnapshot): void {
		this.render(snapshot);
	}

	/** Remove every node and listener owned by the panel. */
	destroy(): void {
		this.capturePresentationState();
		this.parent.empty();
		this.snapshot = null;
		this.treeEl = null;
		this.workspaceEl = null;
		this.detailEl = null;
	}

	private renderHeader(root: HTMLElement, snapshot: WorkbenchSessionSnapshot): void {
		const header = root.createDiv({ cls: 'dtf-workbench-map-header' });
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.gap = '0.5em';
		header.style.flexWrap = 'wrap';
		header.style.marginBottom = '0.6em';
		header.style.flex = '0 0 auto';

		const heading = header.createDiv({ cls: 'dtf-workbench-map-heading' });
		const title = heading.createEl('h3', {
			cls: 'dtf-workbench-map-title',
			text: 'Explore your vault',
		});
		title.style.margin = '0';
		heading.createDiv({
			cls: 'dtf-workbench-surface-intro dtf-workbench-map-intro',
			text: 'Find recognizable organizational systems and inspect what your currently enabled rules would produce. This view does not change your vault.',
		});

		const controls = header.createDiv({ cls: 'dtf-workbench-map-controls' });
		controls.style.display = 'flex';
		controls.style.alignItems = 'center';
		controls.style.gap = '0.4em';
		controls.style.flexWrap = 'wrap';
		this.renderModeToggle(controls, snapshot.state.mapMode);

		const selected = snapshot.organizationalSystems.cards.find((card) =>
			card.occurrenceKey === snapshot.state.selectedSystemInstanceKey) ?? null;
		const primary = controls.createEl('button', {
			text: selected?.status === 'actionable'
				? 'Choose where this organizational system applies'
				: selected
					? 'Choose a ready organizational system'
					: 'Choose an organizational system',
		});
		primary.addClass('mod-cta');
		primary.dataset.dtfMapPrimaryAction = '1';
		primary.addEventListener('click', () => {
			if (selected?.status === 'actionable') {
				this.callbacks.onChooseBranchInScope?.(selected.anchorPath);
			} else {
				this.callbacks.onOpenSystemsBrowser?.();
			}
		});

		const refreshBtn = controls.createEl('button', { text: 'Refresh' });
		refreshBtn.setAttr('aria-label', 'Re-scan the vault');
		refreshBtn.addEventListener('click', () => void this.callbacks.onRefresh?.());
	}

	private renderModeToggle(parent: HTMLElement, activeMode: WorkbenchMapMode): void {
		const group = parent.createDiv();
		group.dataset.dtfModeToggle = '1';
		group.setAttr('role', 'group');
		group.setAttr('aria-label', 'Folder display');
		group.style.display = 'inline-flex';
		group.style.border = '1px solid var(--background-modifier-border)';
		group.style.borderRadius = '6px';
		group.style.overflow = 'hidden';

		const modes: Array<{
			mode: WorkbenchMapMode;
			label: string;
			shortLabel: string;
		}> = [
			{ mode: 'detected', label: 'Organizational systems', shortLabel: 'Org systems' },
			{ mode: 'rules', label: 'Active rules', shortLabel: 'Rules' },
			{ mode: 'both', label: 'Both', shortLabel: 'Both' },
		];
		for (const { mode, label, shortLabel } of modes) {
			const button = group.createEl('button');
			button.createSpan({ cls: 'dtf-map-mode-label-full', text: label });
			button.createSpan({ cls: 'dtf-map-mode-label-short', text: shortLabel });
			button.dataset.dtfMode = mode;
			button.setAttr('aria-label', label);
			button.title = label;
			button.setAttr('aria-pressed', String(mode === activeMode));
			button.style.border = 'none';
			button.style.borderRadius = '0';
			button.style.boxShadow = 'none';
			button.style.fontSize = '0.82em';
			button.style.padding = '0.25em 0.6em';
			if (mode === activeMode) {
				button.style.background = 'var(--interactive-accent)';
				button.style.color = 'var(--text-on-accent)';
			} else {
				button.style.background = 'var(--background-secondary)';
				button.style.color = 'var(--text-normal)';
			}
			button.addEventListener('click', () => this.setMapMode(mode));
		}
	}

	private renderModeExplanation(parent: HTMLElement, mode: WorkbenchMapMode): void {
		const explanations: Record<WorkbenchMapMode, string> = {
			detected: 'Organizational systems shows the folders that identify each recognized structure. Recognition evidence is not an installed rule.',
			rules: 'Active rules shows predicted output from enabled installed rules.',
			both: 'Both shows organizational system evidence and enabled-rule output as separate annotations on the same folders.',
		};
		const disclosure = parent.createEl('details', {
			cls: 'dtf-workbench-map-mode-explanation',
		});
		disclosure.dataset.dtfMapModeExplanation = mode;
		disclosure.createEl('summary', { text: 'How this view works' });
		disclosure.createDiv({ text: explanations[mode] });
	}

	private renderStats(root: HTMLElement, snapshot: WorkbenchSessionSnapshot): void {
		const statBar = root.createDiv({ cls: 'dtf-workbench-map-stats' });
		statBar.setAttr('aria-label', 'Explore summary');
		this.makeStat(statBar, 'covered', snapshot.stats.coveredFolderCount, 'Folders your rules cover');
		this.makeStat(statBar, 'conflicts', snapshot.stats.installedConflictFolderCount, 'Rule conflicts');
		this.makeStat(statBar, 'matched', snapshot.stats.matchedFolderCount, 'Folders matched');
		this.makeStat(statBar, 'systems', snapshot.stats.surfacedPackCount, 'Organizational systems recognized');
		this.makeStat(statBar, 'folders', snapshot.stats.folderCount, 'Vault folders');
	}

	private renderTree(
		root: HTMLElement,
		snapshot: WorkbenchSessionSnapshot,
		tree: AnnotatedTree,
	): void {
		const treeContainer = root.createDiv({ cls: 'dtf-workbench-map-tree' });
		this.treeEl = treeContainer;
		treeContainer.dataset.dtfWorkbenchMap = '1';
		treeContainer.addEventListener('scroll', () => {
			this.presentationState = {
				...this.presentationState,
				scrollTop: treeContainer.scrollTop,
			};
			this.emitPresentationState();
		}, { passive: true });

		const mode = snapshot.state.mapMode;
		const hasDetection = snapshot.hitMap.hitsByPath.size > 0;
		const hasRuleCoverage = snapshot.stats.coveredFolderCount > 0;
		const nothingToShow =
			(mode === 'detected' && !hasDetection)
			|| (mode === 'rules' && !hasRuleCoverage)
			|| (mode === 'both' && !hasDetection && !hasRuleCoverage);

		if (nothingToShow) {
			this.renderEmptyState(treeContainer, mode);
			return;
		}

		renderAnnotatedTree(treeContainer, tree, {
			expandToDepth: 2,
			maxChipsPerFolder: 1,
			expandedPaths: new Set(this.presentationState.expandedPaths ?? []),
			onFolderExpansionChange: (path, expanded) => {
				this.presentationState = {
					...this.presentationState,
					expandedPaths: setPathExpanded(
						this.presentationState.expandedPaths ?? [],
						path,
						expanded,
					),
				};
				this.emitPresentationState();
			},
			expandedRelationPaths: new Set(this.presentationState.expandedRelationPaths),
			onRelationExpansionChange: (path, expanded) => {
				this.presentationState = {
					...this.presentationState,
					expandedRelationPaths: setPathExpanded(
						this.presentationState.expandedRelationPaths,
						path,
						expanded,
					),
				};
				this.emitPresentationState();
				this.render(snapshot);
			},
			folderRuleView: new Map(snapshot.folderRuleView),
			annotationMode: mode,
			onFolderClick: (path) => {
				this.presentationState = { ...this.presentationState, focusPath: path };
				this.emitPresentationState();
				this.setDetailPath(path);
			},
			onFolderContextMenu: (path, _name, event) => this.showFolderMenu(path, event),
			selectedOccurrenceKey: snapshot.state.selectedSystemInstanceKey,
			onOccurrenceActivate: (occurrenceKey) => this.openSystemOccurrence(occurrenceKey),
		});
	}

	private renderEmptyState(parent: HTMLElement, mode: WorkbenchMapMode): void {
		const empty = parent.createDiv();
		empty.style.padding = '1.5em 1em';
		empty.style.textAlign = 'center';
		empty.style.color = 'var(--text-muted)';
		if (mode === 'rules') {
			empty.createEl('p', { text: 'No folders are covered by your installed rules.' });
			empty.createEl('p', {
				text: 'Add or enable rules, then refresh — or switch to organizational systems.',
			}).style.fontSize = '0.85em';
		} else {
			empty.createEl('p', { text: 'No organizational systems recognized in this vault.' });
			empty.createEl('p', {
				text: 'Add folders that follow a known organizational system, then refresh.',
			}).style.fontSize = '0.85em';
		}
	}

	private renderFolderDetail(path: string | null): void {
		const snapshot = this.snapshot;
		const detail = this.detailEl;
		if (!snapshot || !detail) return;

		detail.empty();
		detail.style.display = path === null ? 'none' : 'block';
		detail.toggleClass('is-open', path !== null);
		this.workspaceEl?.toggleClass('has-open-inspector', path !== null);
		if (path === null) {
			delete detail.dataset.dtfInspectedPath;
			detail.setAttr('aria-hidden', 'true');
			return;
		}

		detail.removeAttribute('aria-hidden');
		detail.dataset.dtfInspectedPath = path;
		const entry = snapshot.folderRuleView.get(path);

		const headRow = detail.createDiv({ cls: 'dtf-workbench-folder-detail-head' });
		headRow.style.display = 'flex';
		headRow.style.justifyContent = 'space-between';
		headRow.style.alignItems = 'baseline';
		headRow.style.gap = '0.5em';
		renderFullPath(headRow, path, {
			role: 'map-inspected-folder',
			label: 'Folder',
		});
		const closeBtn = headRow.createEl('button', { text: 'Close' });
		closeBtn.style.flex = '0 0 auto';
		closeBtn.setAttr('aria-label', 'Close folder inspector');
		closeBtn.addEventListener('click', () => this.closeFolderDetail());

		this.renderRelatedOrganizationalSystems(detail, path, snapshot);

		if (!entry?.winnerRuleId) {
			const none = detail.createDiv({ text: 'No active rule applies to this folder.' });
			none.style.color = 'var(--text-muted)';
			none.style.marginTop = '0.4em';
			none.style.fontSize = '0.9em';
		} else {
			this.renderRuleDetail(detail, entry, snapshot);
		}

		this.renderDetailActions(detail, path, entry);
	}

	private renderRelatedOrganizationalSystems(
		parent: HTMLElement,
		path: string,
		snapshot: WorkbenchSessionSnapshot,
	): void {
		const cardsByOccurrence = new Map(
			snapshot.organizationalSystems.cards.map((card) => [card.occurrenceKey, card] as const),
		);
		const related = collectOccurrenceRelations(
			snapshot.allEvidenceHitsByPath.get(path) ?? [],
		).flatMap((relation) => {
			const card = cardsByOccurrence.get(relation.occurrenceKey);
			return card ? [{ relation: relation.relation, card }] : [];
		});

		const section = parent.createDiv({ cls: 'dtf-workbench-folder-systems' });
		section.dataset.dtfFolderOrganizationalSystems = '1';
		section.style.marginTop = '0.6em';
		section.createDiv({
			cls: 'dtf-workbench-folder-systems-heading',
			text: 'Organizational systems related to this folder',
		});

		if (related.length === 0) {
			const empty = section.createDiv({
				cls: 'dtf-workbench-folder-systems-empty',
				text: 'No organizational system evidence is attached to this folder.',
			});
			empty.style.color = 'var(--text-muted)';
			empty.style.fontSize = '0.85em';
			return;
		}

		const list = section.createDiv({ cls: 'dtf-workbench-folder-system-list' });
		list.style.display = 'grid';
		list.style.gap = '0.35em';
		for (const { relation, card } of related) {
			this.renderRelatedOrganizationalSystem(list, card, relation);
		}
	}

	private renderRelatedOrganizationalSystem(
		parent: HTMLElement,
		card: OrganizationalSystemCard,
		relation: 'member' | 'support',
	): void {
		const row = parent.createEl('button', { cls: 'dtf-workbench-folder-system' });
		row.dataset.dtfFolderSystemOccurrenceKey = card.occurrenceKey;
		row.dataset.dtfRelation = relation;
		row.dataset.dtfSystemStatus = card.status;
		row.style.width = '100%';
		row.style.height = 'auto';
		row.style.textAlign = 'left';
		row.style.whiteSpace = 'normal';
		row.style.padding = '0.45em 0.55em';

		const identity = row.createSpan({ cls: 'dtf-workbench-folder-system-identity' });
		identity.style.display = 'flex';
		identity.style.alignItems = 'center';
		identity.style.gap = '0.4em';
		identity.style.flexWrap = 'wrap';
		const markerPresentation = describeOrganizationalSystemMarker(card.occurrenceKey);
		const marker = identity.createSpan({ cls: 'dtf-organizational-system-marker' });
		marker.dataset.dtfOrganizationalSystemMarker = markerPresentation.occurrenceKey;
		marker.setAttr('aria-hidden', 'true');
		marker.style.display = 'inline-block';
		marker.style.width = '0.65em';
		marker.style.height = '0.65em';
		marker.style.flex = '0 0 auto';
		marker.style.borderRadius = '999px';
		marker.style.backgroundColor = markerPresentation.colorToken;
		identity.createSpan({
			cls: 'dtf-workbench-folder-system-name',
			text: card.packName,
		}).style.fontWeight = '600';
		identity.createSpan({
			cls: 'dtf-workbench-folder-system-relation',
			text: relation === 'support' ? 'Supports' : 'Identifies',
		});
		identity.createSpan({
			cls: `dtf-workbench-folder-system-status is-${card.status}`,
			text: organizationalSystemStatusLabel(card.status),
		});
		renderSemanticPath(row, card.anchorPath, {
			role: 'folder-system-recognition-path',
			focusLabel: 'Recognized here',
			variant: 'compact',
		});
		const recognitionPath = card.anchorPath || 'vault root';
		row.setAttr(
			'aria-label',
			`${relation === 'support' ? 'Supports' : 'Identifies'} ${card.packName}. `
			+ `${organizationalSystemStatusLabel(card.status)}. Recognized here: ${recognitionPath}. `
			+ 'Open this exact organizational system without changing where rules apply.',
		);
		row.addEventListener('click', () => this.openSystemOccurrence(card.occurrenceKey));
	}

	private renderRuleDetail(
		parent: HTMLElement,
		entry: FolderRuleEntry,
		snapshot: WorkbenchSessionSnapshot,
	): void {
		const winnerRow = parent.createDiv();
		winnerRow.style.marginTop = '0.5em';
		winnerRow.style.fontSize = '0.9em';
		winnerRow.createSpan({ text: 'Rule currently used: ' }).style.color = 'var(--text-muted)';
		winnerRow.createSpan({ text: entry.winnerRuleName ?? entry.winnerRuleId ?? '' }).style.fontWeight = '600';

		const tagsRow = parent.createDiv();
		tagsRow.style.marginTop = '0.35em';
		tagsRow.style.fontSize = '0.9em';
		tagsRow.style.display = 'flex';
		tagsRow.style.flexWrap = 'wrap';
		tagsRow.style.alignItems = 'center';
		tagsRow.style.gap = '0.3em';
		tagsRow.createSpan({ text: 'Tags this rule would create: ' }).style.color = 'var(--text-muted)';
		if (entry.emittedTags.length === 0) {
			tagsRow.createSpan({ text: '(no tag — opaque)' }).style.color = 'var(--text-muted)';
		} else {
			for (const tag of entry.emittedTags) {
				const chip = tagsRow.createEl('code', { text: tag });
				chip.style.padding = '0.05em 0.4em';
				chip.style.background = 'rgba(40, 140, 70, 0.15)';
				chip.style.color = 'var(--text-success, rgb(40, 140, 70))';
				chip.style.borderRadius = '4px';
			}
		}

		const matchRow = parent.createDiv();
		matchRow.style.marginTop = '0.35em';
		matchRow.style.fontSize = '0.9em';
		const names = entry.matchingRuleIds.map((id) => snapshot.ruleNamesById.get(id) ?? id);
		matchRow.createSpan({
			text: `Matching enabled rule${names.length === 1 ? '' : 's'} (${names.length}): `,
		}).style.color = 'var(--text-muted)';
		matchRow.createSpan({ text: names.join(', ') });

		if (entry.conflict) {
			const conflictRow = parent.createDiv();
			conflictRow.style.marginTop = '0.4em';
			conflictRow.style.fontSize = '0.85em';
			conflictRow.style.color = 'rgb(200, 60, 60)';
			conflictRow.setText(
				`Conflict: ${names.length} rules match this folder. `
				+ `"${entry.winnerRuleName ?? entry.winnerRuleId}" wins by precedence.`,
			);
		}
	}

	private renderDetailActions(
		parent: HTMLElement,
		path: string,
		entry: FolderRuleEntry | undefined,
	): void {
		const actions = parent.createDiv({ cls: 'dtf-workbench-folder-actions' });
		actions.style.display = 'flex';
		actions.style.gap = '0.4em';
		actions.style.flexWrap = 'wrap';
		actions.style.marginTop = '0.5em';
		actions.createDiv({
			cls: 'dtf-workbench-action-heading',
			text: 'For this folder',
		});

		if (entry?.winnerRuleId) {
			const settingsBtn = actions.createEl('button', {
				text: 'Review winning rule in settings',
			});
			settingsBtn.dataset.dtfOpenWinningRuleSettings = '1';
			settingsBtn.addEventListener('click', () => {
				this.callbacks.onOpenSettings?.(entry.winnerRuleId ?? undefined);
			});
		}

		const scopeBtn = actions.createEl('button', {
			text: 'Organize this folder and everything below',
		});
		scopeBtn.dataset.dtfChooseBranchInScope = '1';
		scopeBtn.addEventListener('click', () => this.callbacks.onChooseBranchInScope?.(path));
	}

	private capturePresentationState(): void {
		if (this.treeEl) {
			this.presentationState = {
				...this.presentationState,
				scrollTop: this.treeEl.scrollTop,
			};
		}
		this.focusAfterRenderPath = null;
		const active = this.parent.ownerDocument.activeElement;
		if (active instanceof HTMLElement && this.parent.contains(active)) {
			this.focusAfterRenderPath = active
				.closest<HTMLElement>('[data-dtf-folder-path]')
				?.dataset.dtfFolderPath ?? null;
		}
		this.emitPresentationState();
	}

	private restorePresentationState(): void {
		if (this.treeEl) this.treeEl.scrollTop = this.presentationState.scrollTop;
		const focusPath = this.focusAfterRenderPath;
		this.focusAfterRenderPath = null;
		if (focusPath === null) return;
		requestAnimationFrame(() => this.findFolderItem(focusPath)?.focus());
	}

	private emitPresentationState(): void {
		this.callbacks.onPresentationStateChange?.({
			...this.presentationState,
			expandedPaths: this.presentationState.expandedPaths === null
				? null
				: [...this.presentationState.expandedPaths],
			expandedRelationPaths: [...this.presentationState.expandedRelationPaths],
		});
	}

	private openSystemOccurrence(occurrenceKey: string): void {
		if (this.callbacks.onOpenSystemOccurrence) {
			this.callbacks.onOpenSystemOccurrence(occurrenceKey);
			return;
		}
		this.callbacks.onSelectSystem?.(occurrenceKey);
		this.callbacks.onOpenSystemsBrowser?.();
	}

	private closeFolderDetail(): void {
		const focusPath = this.presentationState.focusPath;
		this.setDetailPath(null);
		if (focusPath === null) return;
		requestAnimationFrame(() => this.findFolderItem(focusPath)?.focus());
	}

	private findFolderItem(path: string): HTMLElement | null {
		return Array.from(this.parent.querySelectorAll<HTMLElement>('[data-dtf-folder-path]'))
			.find((item) => item.dataset.dtfFolderPath === path) ?? null;
	}

	private showFolderMenu(path: string, event: MouseEvent): void {
		const entry = this.snapshot?.folderRuleView.get(path);
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('Inspect this folder')
				.setIcon('search')
				.onClick(() => this.setDetailPath(path)),
		);
		if (entry?.winnerRuleId) {
			menu.addItem((item) =>
				item
					.setTitle('Review winning rule in settings')
					.setIcon('gear')
					.onClick(() => this.callbacks.onOpenSettings?.(entry.winnerRuleId ?? undefined)),
			);
		}
		menu.addItem((item) =>
			item
				.setTitle('Organize this folder and everything below')
				.setIcon('folder-tree')
				.onClick(() => this.callbacks.onChooseBranchInScope?.(path)),
		);

		menu.showAtMouseEvent(event);
	}

	private setMapMode(mode: WorkbenchMapMode): void {
		const snapshot = this.snapshot;
		if (!snapshot || snapshot.state.mapMode === mode) return;
		const state = { ...snapshot.state, mapMode: mode };
		this.render({ ...snapshot, state });
		this.callbacks.onStateChange?.(state);
	}

	private setDetailPath(path: string | null): void {
		const snapshot = this.snapshot;
		if (!snapshot || snapshot.state.detailPath === path) return;
		if (path !== null && this.presentationState.focusPath !== path) {
			this.presentationState = { ...this.presentationState, focusPath: path };
			this.emitPresentationState();
		}
		const state = { ...snapshot.state, detailPath: path };
		this.snapshot = { ...snapshot, state };
		this.renderFolderDetail(path);
		this.callbacks.onStateChange?.(state);
	}

	private makeStat(
		parent: HTMLElement,
		label: string,
		value: number,
		fullLabel: string,
	): void {
		const stat = parent.createSpan({ cls: 'dtf-workbench-map-stat' });
		stat.dataset.dtfMapStat = label;
		stat.setAttr('aria-label', `${fullLabel}: ${value}`);
		stat.title = `${fullLabel}: ${value}`;
		stat.createSpan({ cls: 'dtf-workbench-map-stat-value', text: String(value) });
		stat.createSpan({ cls: 'dtf-workbench-map-stat-label', text: label });
	}
}

function organizationalSystemStatusLabel(status: OrganizationalSystemCard['status']): string {
	return status === 'actionable' ? 'Ready' : 'More folders needed';
}

/** Functional convenience for hosts that do not need to retain a constructor seam. */
export function renderWorkbenchMapPanel(
	parent: HTMLElement,
	snapshot: WorkbenchSessionSnapshot,
	callbacks: WorkbenchMapPanelCallbacks = {},
): WorkbenchMapPanel {
	const panel = new WorkbenchMapPanel(parent, callbacks);
	panel.render(snapshot);
	return panel;
}

/** Pure sparse-tree construction shared by Map hosts and focused tests. */
export function buildWorkbenchMapTree(
	snapshot: WorkbenchSessionSnapshot,
	mode: WorkbenchMapMode = snapshot.state.mapMode,
): AnnotatedTree {
	if (mode === 'detected') {
		return buildAnnotatedTree([...snapshot.folderPaths], snapshot.hitMap);
	}

	const visibleHits = mode === 'both'
		? new Map(snapshot.hitMap.hitsByPath)
		: new Map<string, AnnotatedHit[]>();
	const hitMap: CrossPackHitMap = {
		...snapshot.hitMap,
		allSignals: [...snapshot.hitMap.allSignals],
		hitsByPath: visibleHits,
		actionableHitsByPath: visibleHits,
	};
	for (const [path, entry] of snapshot.folderRuleView) {
		if (entry.winnerRuleId && !hitMap.hitsByPath.has(path)) {
			hitMap.hitsByPath.set(path, []);
		}
	}
	return buildAnnotatedTree([...snapshot.folderPaths], hitMap);
}
