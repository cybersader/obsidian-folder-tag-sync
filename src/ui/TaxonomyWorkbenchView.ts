/**
 * TaxonomyWorkbenchView — the big dockable pane for the Taxonomy Workbench.
 *
 * The detect-mode modal already renders the hierarchy-first annotated vault
 * tree, but a modal is cramped: it caps the tree at `max-height: 50vh` and
 * competes with the apply controls for space. Users have repeatedly asked for
 * the full hierarchy as a large surface they can dock and live in. This view
 * is that surface — an Obsidian `ItemView` (leaf/pane) that renders the WHOLE
 * vault folder hierarchy at full scale with detected organizational systems
 * annotated on each folder.
 *
 * SCOPE (this slice): read-only DISPLAY only. It scans the vault, detects
 * known organizational systems, and paints the sparse annotated tree (hit
 * folders with their signal chips, ancestors dimmed, non-hit branches elided)
 * filling the pane height. No snap / drag / edit gestures — those land in a
 * later slice. The detection + render logic is shared with the modal via the
 * engine (`detectPacks`, `collectCrossPackHits`, `buildAnnotatedTree`) and the
 * read-only `renderAnnotatedTree` helper.
 */

import { ItemView, TFolder, WorkspaceLeaf } from 'obsidian';
import { detectPacks, type ManifestPackEntry } from '../engine/detectPacks';
import {
	buildAnnotatedTree,
	collectCrossPackHits,
	type AnnotatedTree,
	type CrossPackHitMap,
} from '../engine/detectionTree';
import { renderAnnotatedTree } from './annotatedTreeRender';
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
	 * vault tree. Re-runnable so the "Refresh" affordance can re-scan after the
	 * vault's folders change.
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

		// ─── Header (title + refresh) ─────────────────────────────────────
		const header = root.createDiv();
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.gap = '0.5em';
		header.style.marginBottom = '0.6em';
		header.style.flex = '0 0 auto';

		const title = header.createEl('h3', { text: 'Taxonomy Workbench map' });
		title.style.margin = '0';

		const refreshBtn = header.createEl('button', { text: 'Refresh' });
		refreshBtn.setAttr('aria-label', 'Re-scan the vault');
		refreshBtn.addEventListener('click', () => this.renderAll());

		// ─── Scan + detect ────────────────────────────────────────────────
		const manifest = bundledManifest as ManifestFile;
		const folderPaths = this.collectVaultFolders();
		const results = detectPacks(folderPaths, manifest.packs);
		const packNamesById = new Map(manifest.packs.map((p) => [p.id, p.name]));
		const hitMap: CrossPackHitMap = collectCrossPackHits(folderPaths, results, packNamesById);
		const tree: AnnotatedTree = buildAnnotatedTree(folderPaths, hitMap);

		const detectedPackIds = new Set<string>();
		for (const sig of hitMap.allSignals) detectedPackIds.add(sig.packId);

		// ─── Stat row (reuses the detect-modal stat-card style) ───────────
		const statBar = root.createDiv();
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
		statBar.style.gap = '0.5em';
		statBar.style.marginBottom = '0.7em';
		statBar.style.flex = '0 0 auto';
		this.makeStat(statBar, 'Folders matched', tree.totalHitFolders);
		this.makeStat(statBar, 'Patterns detected', hitMap.allSignals.length);
		this.makeStat(statBar, 'Vault folders', tree.totalVaultFolders);
		this.makeStat(statBar, 'Systems', detectedPackIds.size);

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

		if (tree.totalHitFolders === 0) {
			const empty = this.treeContainer.createDiv();
			empty.style.padding = '1.5em 1em';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--text-muted)';
			empty.createEl('p', {
				text: 'No organizational patterns detected in this vault.',
			});
			empty.createEl('p', {
				text: 'Add folders that follow a known system, then refresh.',
			}).style.fontSize = '0.85em';
			return;
		}

		renderAnnotatedTree(this.treeContainer, tree, { expandToDepth: 2 });
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

	/** Collect every folder path (relative to vault root) for detection. */
	private collectVaultFolders(): string[] {
		const out: string[] = [];
		const walk = (folder: TFolder): void => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					out.push(child.path);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());
		return out;
	}
}
