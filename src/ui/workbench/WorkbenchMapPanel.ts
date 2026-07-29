import { Menu } from 'obsidian';
import {
	buildAnnotatedTree,
	type AnnotatedHit,
	type AnnotatedTree,
	type CrossPackHitMap,
} from '../../engine/detectionTree';
import type { FolderRuleEntry } from '../../engine/folderRuleView';
import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type {
	WorkbenchMapMode,
	WorkbenchState,
} from '../../workbench/workbenchState';
import { renderAnnotatedTree } from '../annotatedTreeRender';

export interface WorkbenchMapPanelCallbacks {
	/** Receives controlled Map state changes such as mode and folder detail. */
	onStateChange?: (state: WorkbenchState) => void;
	/** Requests a fresh WorkbenchSession snapshot. */
	onRefresh?: () => void | Promise<void>;
	/** Opens plugin settings, optionally focused on a rule. */
	onOpenSettings?: (ruleId?: string) => void;
	/** Routes the chosen folder branch into the Scope surface. */
	onChooseBranchInScope?: (path: string) => void;
	/** Presents the winning rule's emitted tags without running a sync. */
	onPreviewEmittedTags?: (path: string, tags: readonly string[]) => void;
	/** Focuses the occurrence shared with the persistent Organizational systems deck. */
	onSelectSystem?: (occurrenceKey: string) => void;
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
	private detailEl: HTMLElement | null = null;

	constructor(parent: HTMLElement, callbacks: WorkbenchMapPanelCallbacks = {}) {
		this.parent = parent;
		this.callbacks = callbacks;
	}

	render(snapshot: WorkbenchSessionSnapshot): void {
		this.snapshot = snapshot;
		this.parent.empty();

		const root = this.parent.createDiv({ cls: 'dtf-workbench-view' });
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.height = '100%';
		root.style.padding = '0.6em 0.8em';

		this.renderHeader(root, snapshot);
		this.renderStats(root, snapshot);
		this.renderTree(root, snapshot);

		const detail = root.createDiv();
		this.detailEl = detail;
		detail.dataset.dtfFolderDetail = '1';
		detail.style.flex = '0 0 auto';
		detail.style.marginTop = '0.6em';
		detail.style.maxHeight = '32%';
		detail.style.overflow = 'auto';
		this.renderFolderDetail(snapshot.state.detailPath);
	}

	/** Replace the immutable session input after the Workbench host refreshes. */
	update(snapshot: WorkbenchSessionSnapshot): void {
		this.render(snapshot);
	}

	/** Remove every node and listener owned by the panel. */
	destroy(): void {
		this.parent.empty();
		this.snapshot = null;
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

		const title = header.createEl('h3', {
			cls: 'dtf-workbench-map-title',
			text: 'Taxonomy Workbench map',
		});
		title.style.margin = '0';

		const controls = header.createDiv({ cls: 'dtf-workbench-map-controls' });
		controls.style.display = 'flex';
		controls.style.alignItems = 'center';
		controls.style.gap = '0.4em';
		controls.style.flexWrap = 'wrap';

		this.renderModeToggle(controls, snapshot.state.mapMode);

		const openSettingsBtn = controls.createEl('button', { text: 'Open settings' });
		openSettingsBtn.dataset.dtfOpenSettings = '1';
		openSettingsBtn.setAttr('aria-label', 'Open Folder Tag Sync settings');
		openSettingsBtn.addEventListener('click', () => this.callbacks.onOpenSettings?.());

		const refreshBtn = controls.createEl('button', { text: 'Refresh' });
		refreshBtn.setAttr('aria-label', 'Re-scan the vault');
		refreshBtn.addEventListener('click', () => {
			void this.callbacks.onRefresh?.();
		});
	}

	private renderModeToggle(parent: HTMLElement, activeMode: WorkbenchMapMode): void {
		const group = parent.createDiv();
		group.dataset.dtfModeToggle = '1';
		group.setAttr('role', 'group');
		group.setAttr('aria-label', 'Map annotation mode');
		group.style.display = 'inline-flex';
		group.style.border = '1px solid var(--background-modifier-border)';
		group.style.borderRadius = '6px';
		group.style.overflow = 'hidden';

		const modes: Array<{ mode: WorkbenchMapMode; label: string }> = [
			{ mode: 'detected', label: 'Detected systems' },
			{ mode: 'rules', label: 'My rules' },
			{ mode: 'both', label: 'Both' },
		];
		for (const { mode, label } of modes) {
			const button = group.createEl('button', { text: label });
			button.dataset.dtfMode = mode;
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

	private renderStats(root: HTMLElement, snapshot: WorkbenchSessionSnapshot): void {
		const statBar = root.createDiv({ cls: 'dtf-workbench-map-stats' });
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
		statBar.style.gap = '0.5em';
		statBar.style.marginBottom = '0.7em';
		statBar.style.flex = '0 0 auto';

		this.makeStat(statBar, 'Folders your rules cover', snapshot.stats.coveredFolderCount);
		this.makeStat(statBar, 'Rule conflicts', snapshot.stats.installedConflictFolderCount);
		this.makeStat(statBar, 'Folders matched', snapshot.stats.matchedFolderCount);
		this.makeStat(statBar, 'Systems detected', snapshot.stats.surfacedPackCount);
		this.makeStat(statBar, 'Vault folders', snapshot.stats.folderCount);
	}

	private renderTree(root: HTMLElement, snapshot: WorkbenchSessionSnapshot): void {
		const treeContainer = root.createDiv();
		treeContainer.dataset.dtfWorkbenchMap = '1';
		treeContainer.style.flex = '1 1 auto';
		treeContainer.style.overflow = 'auto';
		treeContainer.style.background = 'var(--background-secondary)';
		treeContainer.style.padding = '0.5em 0.6em';
		treeContainer.style.borderRadius = '6px';
		treeContainer.style.fontSize = '0.9em';
		treeContainer.style.minHeight = '0';

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

		const tree = buildWorkbenchMapTree(snapshot, mode);
		renderAnnotatedTree(treeContainer, tree, {
			expandToDepth: 2,
			folderRuleView: new Map(snapshot.folderRuleView),
			annotationMode: mode,
			onFolderClick: (path) => this.setDetailPath(path),
			onFolderContextMenu: (path, _name, event) => this.showFolderMenu(path, event),
			selectedOccurrenceKey: snapshot.state.selectedSystemInstanceKey,
			onOccurrenceClick: (occurrenceKey) => this.callbacks.onSelectSystem?.(occurrenceKey),
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
				text: 'Add or enable rules, then refresh — or switch to detected systems.',
			}).style.fontSize = '0.85em';
		} else {
			empty.createEl('p', { text: 'No organizational patterns detected in this vault.' });
			empty.createEl('p', {
				text: 'Add folders that follow a known system, then refresh.',
			}).style.fontSize = '0.85em';
		}
	}

	private renderFolderDetail(path: string | null): void {
		const snapshot = this.snapshot;
		const detail = this.detailEl;
		if (!snapshot || !detail) return;

		detail.empty();
		if (path === null) {
			detail.style.display = 'none';
			return;
		}

		const entry = snapshot.folderRuleView.get(path);
		detail.style.display = 'block';
		detail.style.padding = '0.6em 0.8em';
		detail.style.background = 'var(--background-secondary)';
		detail.style.borderRadius = '6px';
		detail.style.borderLeft = '3px solid var(--interactive-accent)';

		const headRow = detail.createDiv();
		headRow.style.display = 'flex';
		headRow.style.justifyContent = 'space-between';
		headRow.style.alignItems = 'baseline';
		headRow.style.gap = '0.5em';
		const pathEl = headRow.createEl('div', { text: displayPath(path) });
		pathEl.style.fontWeight = '600';
		pathEl.style.fontFamily = 'var(--font-monospace)';
		pathEl.style.wordBreak = 'break-all';
		const closeBtn = headRow.createEl('button', { text: 'Close' });
		closeBtn.style.flex = '0 0 auto';
		closeBtn.addEventListener('click', () => this.setDetailPath(null));

		if (!entry?.winnerRuleId) {
			const none = detail.createDiv({ text: 'No enabled rule covers this folder.' });
			none.style.color = 'var(--text-muted)';
			none.style.marginTop = '0.4em';
			none.style.fontSize = '0.9em';
		} else {
			this.renderRuleDetail(detail, entry, snapshot);
		}

		this.renderDetailActions(detail, path, entry);
	}

	private renderRuleDetail(
		parent: HTMLElement,
		entry: FolderRuleEntry,
		snapshot: WorkbenchSessionSnapshot,
	): void {
		const winnerRow = parent.createDiv();
		winnerRow.style.marginTop = '0.5em';
		winnerRow.style.fontSize = '0.9em';
		winnerRow.createSpan({ text: 'Winning rule: ' }).style.color = 'var(--text-muted)';
		winnerRow.createSpan({ text: entry.winnerRuleName ?? entry.winnerRuleId ?? '' }).style.fontWeight = '600';

		const tagsRow = parent.createDiv();
		tagsRow.style.marginTop = '0.35em';
		tagsRow.style.fontSize = '0.9em';
		tagsRow.style.display = 'flex';
		tagsRow.style.flexWrap = 'wrap';
		tagsRow.style.alignItems = 'center';
		tagsRow.style.gap = '0.3em';
		tagsRow.createSpan({ text: 'Would emit: ' }).style.color = 'var(--text-muted)';
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
			text: `Matching rule${names.length === 1 ? '' : 's'} (${names.length}): `,
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
		const actions = parent.createDiv();
		actions.style.display = 'flex';
		actions.style.gap = '0.4em';
		actions.style.flexWrap = 'wrap';
		actions.style.marginTop = '0.5em';

		const settingsBtn = actions.createEl('button', {
			text: entry?.winnerRuleId ? 'Open settings for the winning rule' : 'Open settings',
		});
		settingsBtn.addEventListener('click', () => {
			this.callbacks.onOpenSettings?.(entry?.winnerRuleId ?? undefined);
		});

		const previewBtn = actions.createEl('button', { text: 'Preview emitted tags' });
		previewBtn.dataset.dtfPreviewEmittedTags = '1';
		previewBtn.addEventListener('click', () => this.previewEmittedTags(path));

		const scopeBtn = actions.createEl('button', { text: 'Choose this branch in scope' });
		scopeBtn.dataset.dtfChooseBranchInScope = '1';
		scopeBtn.addEventListener('click', () => this.callbacks.onChooseBranchInScope?.(path));
	}

	private showFolderMenu(path: string, event: MouseEvent): void {
		const entry = this.snapshot?.folderRuleView.get(path);
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('Show rules affecting this folder')
				.setIcon('search')
				.onClick(() => this.setDetailPath(path)),
		);
		menu.addItem((item) =>
			item
				.setTitle('Open Folder Tag Sync settings')
				.setIcon('gear')
				.onClick(() => this.callbacks.onOpenSettings?.(entry?.winnerRuleId ?? undefined)),
		);
		menu.addItem((item) =>
			item
				.setTitle('Preview emitted tags')
				.setIcon('tag')
				.onClick(() => this.previewEmittedTags(path)),
		);
		menu.addItem((item) =>
			item
				.setTitle('Choose this branch in scope')
				.setIcon('folder-tree')
				.onClick(() => this.callbacks.onChooseBranchInScope?.(path)),
		);

		menu.showAtMouseEvent(event);
	}

	private previewEmittedTags(path: string): void {
		const tags = this.snapshot?.folderRuleView.get(path)?.emittedTags ?? [];
		this.callbacks.onPreviewEmittedTags?.(path, tags);
		this.setDetailPath(path);
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
		const state = { ...snapshot.state, detailPath: path };
		this.snapshot = { ...snapshot, state };
		this.renderFolderDetail(path);
		this.callbacks.onStateChange?.(state);
	}

	private makeStat(parent: HTMLElement, label: string, value: number): void {
		const card = parent.createDiv();
		card.style.padding = '0.4em 0.6em';
		card.style.background = 'var(--background-secondary)';
		card.style.borderRadius = '6px';
		const valueEl = card.createEl('div', { text: String(value) });
		valueEl.style.fontSize = '1.2em';
		valueEl.style.fontWeight = '600';
		valueEl.style.lineHeight = '1.1';
		const labelEl = card.createEl('div', { text: label });
		labelEl.style.fontSize = '0.75em';
		labelEl.style.color = 'var(--text-muted)';
	}
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

function displayPath(path: string): string {
	return path || '(vault root)';
}
