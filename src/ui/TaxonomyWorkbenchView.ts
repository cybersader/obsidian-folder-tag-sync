/**
 * TaxonomyWorkbenchView — the big dockable pane for the Taxonomy Workbench.
 *
 * The detect-mode modal already renders the hierarchy-first annotated vault
 * tree, but a modal is cramped: it caps the tree at `max-height: 50vh` and
 * competes with the apply controls for space. Users have repeatedly asked for
 * the full hierarchy as a large surface they can dock and live in. This view
 * is that surface — an Obsidian `ItemView` (leaf/pane) that renders the WHOLE
 * vault folder hierarchy at full scale with TWO annotation layers per folder:
 *
 *   - DETECTED systems (from `detectPacks`) — what known organizational
 *     systems live here, i.e. what COULD apply.
 *   - MY RULES (from `computeFolderRuleView`) — what the user's INSTALLED
 *     rules actually do here: the winning rule, the tag it emits, and whether
 *     2+ rules conflict.
 *
 * SCOPE (this slice — "Sensing"): read-only on the rules. It senses + shows
 * (coverage + conflicts), lets the user drill into any folder, right-click for
 * actions, and round-trips to settings. NO snap / install / edit-rule
 * gestures — those land in a later slice. The detection + render logic is
 * shared with the modal via the engine and the `renderAnnotatedTree` helper.
 */

import { ItemView, Menu, Notice, WorkspaceLeaf } from 'obsidian';
import { detectPacks, type ManifestPackEntry } from '../engine/detectPacks';
import {
	buildAnnotatedTree,
	collectCrossPackHits,
	type AnnotatedTree,
	type CrossPackHitMap,
} from '../engine/detectionTree';
import { computeFolderRuleView, type FolderRuleEntry } from '../engine/folderRuleView';
import { renderAnnotatedTree, type AnnotationMode } from './annotatedTreeRender';
import { collectVaultFolderPaths } from '../utils/vaultFolders';
import bundledManifest from '../../rule-packs/manifest.json';
import type DynamicTagsFoldersPlugin from '../main';

export const TAXONOMY_WORKBENCH_VIEW = 'taxonomy-workbench-map';

interface ManifestFile {
	version: number;
	packs: Array<ManifestPackEntry & { file: string; description: string; ruleCount: number }>;
}

export class TaxonomyWorkbenchView extends ItemView {
	private readonly plugin: DynamicTagsFoldersPlugin;
	private treeContainer!: HTMLElement;
	private detailEl!: HTMLElement;

	/**
	 * Which annotation layer(s) paint on the tree. Defaults to 'both' so the
	 * "my rules" sensing layer is visible on first open without a toggle.
	 */
	private annotationMode: AnnotationMode = 'both';

	/** Cached per-folder rule view for the current render — drives the detail panel + menus. */
	private folderRuleView: Map<string, FolderRuleEntry> = new Map();
	/** Rule id → display name, for resolving matchingRuleIds in the drill-in detail. */
	private ruleNameById: Map<string, string> = new Map();

	constructor(leaf: WorkspaceLeaf, plugin: DynamicTagsFoldersPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TAXONOMY_WORKBENCH_VIEW;
	}

	getDisplayText(): string {
		return 'Taxonomy Workbench';
	}

	getIcon(): string {
		return 'layers';
	}

	async onOpen(): Promise<void> {
		this.renderAll();
	}

	async onClose(): Promise<void> {
		this.contentEl.empty();
	}

	/**
	 * Build (or rebuild) the entire pane: header + stat row + the full annotated
	 * vault tree + the drill-in detail area. Re-runnable so the "Refresh"
	 * affordance and the annotation-mode toggle can re-scan + re-paint.
	 */
	private renderAll(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('dtf-workbench-view');
		// Fill the pane and let the tree body own the scroll — this is the whole
		// point of the pane vs. the cramped modal: the entire hierarchy visible
		// on a big surface.
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.height = '100%';
		root.style.padding = '0.6em 0.8em';

		// ─── Scan: detection pass + "my rules" pass ───────────────────────
		const manifest = bundledManifest as ManifestFile;
		const folderPaths = collectVaultFolderPaths(this.app.vault.getRoot());
		const results = detectPacks(folderPaths, manifest.packs);
		const packNamesById = new Map(manifest.packs.map((p) => [p.id, p.name]));
		const hitMap: CrossPackHitMap = collectCrossPackHits(folderPaths, results, packNamesById);

		// "My rules" — what the user's INSTALLED rules actually do per folder.
		this.folderRuleView = computeFolderRuleView(
			folderPaths,
			this.plugin.settings.rules,
			this.plugin.settings.groupPrecedence,
		);
		this.ruleNameById = new Map(this.plugin.settings.rules.map((r) => [r.id, r.name]));

		let coveredFolders = 0;
		let conflictFolders = 0;
		for (const entry of this.folderRuleView.values()) {
			if (entry.winnerRuleId) coveredFolders++;
			if (entry.conflict) conflictFolders++;
		}

		const detectedPackIds = new Set<string>();
		for (const sig of hitMap.allSignals) detectedPackIds.add(sig.packId);

		// ─── Header (title + mode toggle + open settings + refresh) ───────
		const header = root.createDiv();
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.gap = '0.5em';
		header.style.flexWrap = 'wrap';
		header.style.marginBottom = '0.6em';
		header.style.flex = '0 0 auto';

		const title = header.createEl('h3', { text: 'Taxonomy Workbench map' });
		title.style.margin = '0';

		const controls = header.createDiv();
		controls.style.display = 'flex';
		controls.style.alignItems = 'center';
		controls.style.gap = '0.4em';
		controls.style.flexWrap = 'wrap';

		this.renderModeToggle(controls);

		const openSettingsBtn = controls.createEl('button', { text: 'Open settings' });
		openSettingsBtn.dataset.dtfOpenSettings = '1';
		openSettingsBtn.setAttr('aria-label', 'Open Folder Tag Sync settings');
		openSettingsBtn.addEventListener('click', () => this.openPluginSettings(null));

		const refreshBtn = controls.createEl('button', { text: 'Refresh' });
		refreshBtn.setAttr('aria-label', 'Re-scan the vault');
		refreshBtn.addEventListener('click', () => this.renderAll());

		// ─── Stat row (reuses the detect-modal stat-card style) ───────────
		const statBar = root.createDiv();
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
		statBar.style.gap = '0.5em';
		statBar.style.marginBottom = '0.7em';
		statBar.style.flex = '0 0 auto';
		this.makeStat(statBar, 'Folders your rules cover', coveredFolders);
		this.makeStat(statBar, 'Rule conflicts', conflictFolders);
		this.makeStat(statBar, 'Folders matched', hitMap.hitsByPath.size);
		this.makeStat(statBar, 'Systems detected', detectedPackIds.size);
		this.makeStat(statBar, 'Vault folders', folderPaths.length);

		// ─── Tree (fills remaining height, scrolls) ───────────────────────
		this.treeContainer = root.createDiv();
		this.treeContainer.dataset.dtfWorkbenchMap = '1';
		this.treeContainer.dataset.dtfDetectTree = '1';
		this.treeContainer.style.flex = '1 1 auto';
		this.treeContainer.style.overflow = 'auto';
		this.treeContainer.style.background = 'var(--background-secondary)';
		this.treeContainer.style.padding = '0.5em 0.6em';
		this.treeContainer.style.borderRadius = '6px';
		this.treeContainer.style.fontSize = '0.9em';
		this.treeContainer.style.minHeight = '0'; // let flex child shrink so overflow scrolls

		// Build the tree for the active mode. 'detected' keeps detection hits;
		// 'rules' keeps rule-covered folders; 'both' keeps the union — so each
		// layer's annotations always have a row to land on.
		const tree = this.buildTreeForMode(folderPaths, hitMap);
		const hasDetection = hitMap.hitsByPath.size > 0;
		const nothingToShow =
			(this.annotationMode === 'detected' && !hasDetection) ||
			(this.annotationMode === 'rules' && coveredFolders === 0) ||
			(this.annotationMode === 'both' && !hasDetection && coveredFolders === 0);

		if (nothingToShow) {
			this.renderEmptyState();
		} else {
			renderAnnotatedTree(this.treeContainer, tree, {
				expandToDepth: 2,
				folderRuleView: this.folderRuleView,
				annotationMode: this.annotationMode,
				onFolderClick: (path) => this.openFolderDetail(path),
				onFolderContextMenu: (path, _name, evt) => this.showFolderMenu(path, evt),
			});
		}

		// ─── Drill-in detail area (hidden until a folder is clicked) ──────
		this.detailEl = root.createDiv();
		this.detailEl.dataset.dtfFolderDetail = '1';
		this.detailEl.style.flex = '0 0 auto';
		this.detailEl.style.marginTop = '0.6em';
		this.detailEl.style.maxHeight = '32%';
		this.detailEl.style.overflow = 'auto';
		this.detailEl.style.display = 'none';
	}

	/**
	 * Segmented control switching the annotation focus: detected systems, my
	 * rules, or both. Selecting re-runs the render with the new mode.
	 */
	private renderModeToggle(parent: HTMLElement): void {
		const group = parent.createDiv();
		group.dataset.dtfModeToggle = '1';
		group.style.display = 'inline-flex';
		group.style.border = '1px solid var(--background-modifier-border)';
		group.style.borderRadius = '6px';
		group.style.overflow = 'hidden';

		const modes: Array<{ mode: AnnotationMode; label: string }> = [
			{ mode: 'detected', label: 'Detected systems' },
			{ mode: 'rules', label: 'My rules' },
			{ mode: 'both', label: 'Both' },
		];
		for (const { mode, label } of modes) {
			const btn = group.createEl('button', { text: label });
			btn.dataset.dtfMode = mode;
			btn.style.border = 'none';
			btn.style.borderRadius = '0';
			btn.style.boxShadow = 'none';
			btn.style.fontSize = '0.82em';
			btn.style.padding = '0.25em 0.6em';
			if (mode === this.annotationMode) {
				btn.style.background = 'var(--interactive-accent)';
				btn.style.color = 'var(--text-on-accent)';
			} else {
				btn.style.background = 'var(--background-secondary)';
				btn.style.color = 'var(--text-normal)';
			}
			btn.addEventListener('click', () => {
				if (this.annotationMode === mode) return;
				this.annotationMode = mode;
				this.renderAll();
			});
		}
	}

	/**
	 * Build the annotated tree for the active mode. The detection tree only
	 * keeps detection-hit folders + ancestors; to give the "my rules" layer a
	 * row to paint on, we augment the kept set with rule-covered folders (an
	 * entry with an empty hit array is still kept and rendered).
	 */
	private buildTreeForMode(folderPaths: string[], hitMap: CrossPackHitMap): AnnotatedTree {
		if (this.annotationMode === 'detected') {
			return buildAnnotatedTree(folderPaths, hitMap);
		}
		// 'rules' starts from an empty hit map; 'both' keeps detection hits.
		const augmented: CrossPackHitMap = {
			allSignals: hitMap.allSignals,
			hitsByPath: this.annotationMode === 'both' ? new Map(hitMap.hitsByPath) : new Map(),
		};
		for (const [path, entry] of this.folderRuleView) {
			if (entry.winnerRuleId && !augmented.hitsByPath.has(path)) {
				augmented.hitsByPath.set(path, []);
			}
		}
		return buildAnnotatedTree(folderPaths, augmented);
	}

	private renderEmptyState(): void {
		const empty = this.treeContainer.createDiv();
		empty.style.padding = '1.5em 1em';
		empty.style.textAlign = 'center';
		empty.style.color = 'var(--text-muted)';
		if (this.annotationMode === 'rules') {
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

	/**
	 * Open the drill-in detail for `path`: the folder path, the winning rule,
	 * the tags it emits, all matching rules, and a conflict note. Lightweight —
	 * a fixed panel at the bottom of the pane, not an inline tree injection.
	 */
	private openFolderDetail(path: string): void {
		const entry = this.folderRuleView.get(path);
		const el = this.detailEl;
		el.empty();
		el.style.display = 'block';
		el.style.padding = '0.6em 0.8em';
		el.style.background = 'var(--background-secondary)';
		el.style.borderRadius = '6px';
		el.style.borderLeft = '3px solid var(--interactive-accent)';

		// Header row: folder path + close button.
		const headRow = el.createDiv();
		headRow.style.display = 'flex';
		headRow.style.justifyContent = 'space-between';
		headRow.style.alignItems = 'baseline';
		headRow.style.gap = '0.5em';
		const pathEl = headRow.createEl('div', { text: path || '(vault root)' });
		pathEl.style.fontWeight = '600';
		pathEl.style.fontFamily = 'var(--font-monospace)';
		pathEl.style.wordBreak = 'break-all';
		const closeBtn = headRow.createEl('button', { text: 'Close' });
		closeBtn.style.flex = '0 0 auto';
		closeBtn.addEventListener('click', () => { el.style.display = 'none'; });

		if (!entry || !entry.winnerRuleId) {
			const none = el.createDiv({ text: 'No enabled rule covers this folder.' });
			none.style.color = 'var(--text-muted)';
			none.style.marginTop = '0.4em';
			none.style.fontSize = '0.9em';
			return;
		}

		// Winning rule.
		const winnerRow = el.createDiv();
		winnerRow.style.marginTop = '0.5em';
		winnerRow.style.fontSize = '0.9em';
		winnerRow.createSpan({ text: 'Winning rule: ' }).style.color = 'var(--text-muted)';
		winnerRow.createSpan({ text: entry.winnerRuleName ?? entry.winnerRuleId }).style.fontWeight = '600';

		// Emitted tags.
		const tagsRow = el.createDiv();
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
			for (const t of entry.emittedTags) {
				const chip = tagsRow.createEl('code', { text: t });
				chip.style.padding = '0.05em 0.4em';
				chip.style.background = 'rgba(40, 140, 70, 0.15)';
				chip.style.color = 'var(--text-success, rgb(40, 140, 70))';
				chip.style.borderRadius = '4px';
			}
		}

		// All matching rules.
		const matchRow = el.createDiv();
		matchRow.style.marginTop = '0.35em';
		matchRow.style.fontSize = '0.9em';
		const names = entry.matchingRuleIds.map((id) => this.ruleNameById.get(id) ?? id);
		matchRow.createSpan({
			text: `Matching rule${names.length === 1 ? '' : 's'} (${names.length}): `,
		}).style.color = 'var(--text-muted)';
		matchRow.createSpan({ text: names.join(', ') });

		// Conflict note.
		if (entry.conflict) {
			const conflictRow = el.createDiv();
			conflictRow.style.marginTop = '0.4em';
			conflictRow.style.fontSize = '0.85em';
			conflictRow.style.color = 'rgb(200, 60, 60)';
			conflictRow.setText(
				`Conflict: ${names.length} rules match this folder. ` +
				`"${entry.winnerRuleName ?? entry.winnerRuleId}" wins by precedence.`,
			);
		}

		// Open-settings shortcut (focuses the winning rule).
		const actions = el.createDiv();
		actions.style.marginTop = '0.5em';
		const settingsBtn = actions.createEl('button', { text: 'Open settings for the winning rule' });
		settingsBtn.addEventListener('click', () => this.openPluginSettings(entry.winnerRuleId));
	}

	/**
	 * Right-click menu on a folder row. Read-only on the rules: show the
	 * drill-in, jump to settings (focusing the winner), or report the emitted
	 * tags. Does NOT run a real sync.
	 */
	private showFolderMenu(path: string, evt: MouseEvent): void {
		const entry = this.folderRuleView.get(path);
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle('Show rules affecting this folder')
				.setIcon('search')
				.onClick(() => this.openFolderDetail(path)),
		);

		menu.addItem((item) =>
			item
				.setTitle('Open Folder Tag Sync settings')
				.setIcon('gear')
				.onClick(() => this.openPluginSettings(entry?.winnerRuleId ?? null)),
		);

		menu.addItem((item) =>
			item
				.setTitle('Preview sync for this folder')
				.setIcon('tag')
				.onClick(() => {
					const tags = entry?.emittedTags ?? [];
					if (entry?.winnerRuleId && tags.length > 0) {
						new Notice(`${path || '(vault root)'} → ${tags.join(', ')}`);
					} else {
						new Notice(`No rule emits tags for ${path || '(vault root)'}.`);
					}
					this.openFolderDetail(path);
				}),
		);

		menu.showAtMouseEvent(evt);
	}

	/**
	 * Map → Settings navigation. Opens the Obsidian settings window on the
	 * Folder Tag Sync tab. When a rule id is passed, the plugin stashes it as
	 * `focusRuleId` so `SettingsTab.display()` scrolls to + highlights that
	 * rule once.
	 */
	private openPluginSettings(focusRuleId: string | null): void {
		if (focusRuleId) this.plugin.focusRuleId = focusRuleId;
		const setting = (
			this.app as unknown as {
				setting?: { open: () => void; openTabById: (id: string) => unknown };
			}
		).setting;
		if (!setting) {
			new Notice('Could not open settings.');
			return;
		}
		setting.open();
		setting.openTabById(this.plugin.manifest.id);
	}

	// ─── Stat-card helper (mirrors DetectVaultModal.makeStat) ─────────────
	private makeStat(parent: HTMLElement, label: string, value: number): void {
		const card = parent.createDiv();
		card.style.padding = '0.4em 0.6em';
		card.style.background = 'var(--background-secondary)';
		card.style.borderRadius = '6px';
		const v = card.createEl('div', { text: String(value) });
		v.style.fontSize = '1.2em';
		v.style.fontWeight = '600';
		v.style.lineHeight = '1.1';
		const l = card.createEl('div', { text: label });
		l.style.fontSize = '0.75em';
		l.style.color = 'var(--text-muted)';
	}

}
