/**
 * Detect-mode modal — hierarchy-first view.
 *
 * The pack-centric layout (a card per detected pack, signals listed
 * inside) doesn't match how users actually think when they look at
 * detection results. They see a folder tree and want to know "what
 * patterns fired here?" — they don't care which plugin pack contributed
 * the signal.
 *
 * This modal presents one unified vault tree (sparse — only branches
 * with detection hits + their ancestors). Each folder row is annotated
 * with chips showing which signals fired there, drawn from any detected
 * pack. Selection happens per-folder; clicking Apply loads whichever
 * underlying packs were responsible for the selected folders' hits.
 *
 * Pack identity is invisible at the primary level — it surfaces as
 * tooltip text on chips, in the apply-summary, and in the suppressed-
 * pack notice. The user navigates their hierarchy; the plugin handles
 * the pack plumbing.
 */

import { App, Modal, Notice, TFolder } from 'obsidian';
import {
	detectPacks,
	findExclusivityConflicts,
	type ManifestPackEntry,
} from '../engine/detectPacks';
import {
	buildAnnotatedTree,
	collectCrossPackHits,
	colorForSignalIndex,
	type AnnotatedSignal,
	type AnnotatedTreeNode,
} from '../engine/detectionTree';
import { loadRulePackFromJSON } from '../engine/rulePackLoader';
import { minimalScopeCover, scopeRules } from '../engine/scopeRules';
import type { MappingRule } from '../types/settings';
import bundledManifest from '../../rule-packs/manifest.json';

interface ManifestFile {
	version: number;
	packs: Array<ManifestPackEntry & { file: string; description: string; ruleCount: number }>;
}

export class DetectVaultModal extends Modal {
	private readonly onApply: (rules: MappingRule[]) => void | Promise<void>;
	private selectedFolders = new Set<string>();
	private signalFilter: number | null = null; // globalIndex when set
	private treeContainer!: HTMLElement;
	private applyBtn!: HTMLButtonElement;
	private signalChips = new Map<number, HTMLElement>();
	private detectedPackIds = new Set<string>();

	constructor(app: App, onApply: (rules: MappingRule[]) => void | Promise<void>) {
		super(app);
		this.onApply = onApply;
	}

	async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('dtf-detect-modal');
		modalEl.style.width = 'min(900px, 95vw)';
		modalEl.style.maxHeight = '90vh';

		contentEl.createEl('h2', { text: 'Detect organizational systems' });

		const status = contentEl.createDiv();
		status.style.padding = '0.6em';
		status.style.fontStyle = 'italic';
		status.style.color = 'var(--text-muted)';
		status.setText('Scanning vault…');

		const manifest = bundledManifest as ManifestFile;
		const folderPaths = this.collectVaultFolders();
		const results = detectPacks(folderPaths, manifest.packs);
		const conflicts = findExclusivityConflicts(results, manifest.packs);

		// Build cross-pack hit map (suppressed packs excluded by the engine)
		const packNamesById = new Map(manifest.packs.map((p) => [p.id, p.name]));
		const hitMap = collectCrossPackHits(folderPaths, results, packNamesById);
		const tree = buildAnnotatedTree(folderPaths, hitMap);

		// Track detected pack ids — used at apply-time to load only the
		// packs whose signals fired on the selected folders.
		for (const sig of hitMap.allSignals) this.detectedPackIds.add(sig.packId);

		status.remove();

		// Empty state
		if (tree.totalHitFolders === 0) {
			const empty = contentEl.createDiv();
			empty.style.padding = '1em';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--text-muted)';
			empty.createEl('p', {
				text: 'No organizational patterns detected in this vault.',
			});
			return;
		}

		// ─── Stat bar ─────────────────────────────────────────────────
		const statBar = contentEl.createDiv();
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
		statBar.style.gap = '0.5em';
		statBar.style.marginBottom = '0.7em';
		this.makeStat(statBar, 'Folders matched', tree.totalHitFolders);
		this.makeStat(statBar, 'Patterns detected', hitMap.allSignals.length);
		this.makeStat(statBar, 'Vault folders', tree.totalVaultFolders);
		this.makeStat(statBar, 'Systems', this.detectedPackIds.size);

		// ─── Exclusivity warnings ─────────────────────────────────────
		if (conflicts.length > 0) {
			const warn = contentEl.createDiv();
			warn.style.padding = '0.55em 0.7em';
			warn.style.background = 'var(--background-modifier-error-hover)';
			warn.style.borderLeft = '3px solid var(--text-error)';
			warn.style.borderRadius = '4px';
			warn.style.marginBottom = '0.6em';
			warn.style.fontSize = '0.88em';
			const text = conflicts
				.map((c) => `${packNamesById.get(c.packA) ?? c.packA} ↔ ${packNamesById.get(c.packB) ?? c.packB}`)
				.join(', ');
			warn.createSpan({ text: `⚠ Conflicting systems detected: ${text}. ` })
				.style.fontWeight = '500';
			warn.createSpan({ text: 'Selecting folders affected by both will apply rules from both packs.' });
		}

		// ─── Suppressed-pack notice ───────────────────────────────────
		const suppressed = results.filter((r) => r.suppressedByMissingParent);
		if (suppressed.length > 0) {
			const sup = contentEl.createDiv();
			sup.style.padding = '0.4em 0.6em';
			sup.style.fontSize = '0.83em';
			sup.style.color = 'var(--text-muted)';
			sup.style.fontStyle = 'italic';
			sup.style.marginBottom = '0.4em';
			const names = suppressed
				.map((s) => packNamesById.get(s.packId) ?? s.packId)
				.join(', ');
			sup.setText(
				`Note: ${suppressed.length} pack(s) suppressed (parent pattern not detected): ${names}. They are not included in the tree below.`,
			);
		}

		// ─── Pattern legend (signal chips) ────────────────────────────
		const legendLabel = contentEl.createDiv({ text: 'Patterns detected (click to filter):' });
		legendLabel.style.fontSize = '0.85em';
		legendLabel.style.color = 'var(--text-muted)';
		legendLabel.style.marginBottom = '0.3em';

		const legend = contentEl.createDiv();
		legend.style.display = 'flex';
		legend.style.flexWrap = 'wrap';
		legend.style.gap = '0.3em';
		legend.style.marginBottom = '0.7em';
		legend.style.padding = '0.4em 0.5em';
		legend.style.background = 'var(--background-modifier-form-field)';
		legend.style.borderRadius = '6px';

		// "All patterns" reset chip
		const allChip = this.makeSignalChip(legend, null, 'All patterns', null, hitMap.allSignals.length);
		allChip.addEventListener('click', () => this.setSignalFilter(null));

		// Per-signal chips
		for (const sig of hitMap.allSignals) {
			const count = this.countHitsForSignal(hitMap.hitsByPath, sig.globalIndex);
			const chip = this.makeSignalChip(legend, sig, sig.label, sig.packName, count);
			this.signalChips.set(sig.globalIndex, chip);
			chip.addEventListener('click', () => this.setSignalFilter(sig.globalIndex));
		}

		// ─── Toolbar ──────────────────────────────────────────────────
		const toolbar = contentEl.createDiv();
		toolbar.style.display = 'flex';
		toolbar.style.gap = '0.4em';
		toolbar.style.marginBottom = '0.5em';
		toolbar.style.flexWrap = 'wrap';

		const selectAllBtn = toolbar.createEl('button', { text: 'Select all hits' });
		selectAllBtn.addEventListener('click', () => {
			for (const path of hitMap.hitsByPath.keys()) this.selectedFolders.add(path);
			this.refreshTree();
			this.refreshApplyBtn();
		});
		const selectNoneBtn = toolbar.createEl('button', { text: 'Select none' });
		selectNoneBtn.addEventListener('click', () => {
			this.selectedFolders.clear();
			this.refreshTree();
			this.refreshApplyBtn();
		});
		const expandAllBtn = toolbar.createEl('button', { text: 'Expand all' });
		expandAllBtn.addEventListener('click', () => this.toggleAllFolders(true));
		const collapseAllBtn = toolbar.createEl('button', { text: 'Collapse all' });
		collapseAllBtn.addEventListener('click', () => this.toggleAllFolders(false));

		// ─── Tree ─────────────────────────────────────────────────────
		this.treeContainer = contentEl.createDiv();
		this.treeContainer.dataset.dtfDetectTree = '1';
		this.treeContainer.style.maxHeight = '50vh';
		this.treeContainer.style.overflow = 'auto';
		this.treeContainer.style.background = 'var(--background-secondary)';
		this.treeContainer.style.padding = '0.5em 0.6em';
		this.treeContainer.style.borderRadius = '6px';
		this.treeContainer.style.fontSize = '0.88em';
		this.treeContainer.style.marginBottom = '0.7em';
		(this.treeContainer as HTMLElement & { _annotatedTree?: typeof tree })._annotatedTree = tree;

		this.renderTree(tree);

		// ─── Apply actions ────────────────────────────────────────────
		const actions = contentEl.createDiv();
		actions.style.display = 'flex';
		actions.style.gap = '0.5em';
		actions.style.justifyContent = 'flex-end';
		actions.style.alignItems = 'center';
		actions.style.marginTop = '0.5em';

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.applyBtn = actions.createEl('button', { text: '' });
		this.applyBtn.addClass('mod-cta');
		this.refreshApplyBtn();
		this.applyBtn.addEventListener('click', async () => {
			await this.applySelected(manifest, hitMap);
		});
	}

	// ─── Stat-card helper ─────────────────────────────────────────────
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

	// ─── Signal-chip builder ──────────────────────────────────────────
	private makeSignalChip(
		parent: HTMLElement,
		signal: AnnotatedSignal | null,
		label: string,
		packName: string | null,
		count: number,
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

		const swatch = chip.createSpan();
		swatch.style.display = 'inline-block';
		swatch.style.width = '8px';
		swatch.style.height = '8px';
		swatch.style.borderRadius = '50%';
		swatch.style.background = signal ? colorForSignalIndex(signal.globalIndex) : 'var(--text-muted)';

		chip.createSpan({ text: label });

		const countSpan = chip.createSpan({ text: String(count) });
		countSpan.style.fontSize = '0.75em';
		countSpan.style.color = 'var(--text-muted)';
		countSpan.style.marginLeft = '0.15em';

		// Pack name as tooltip — invisible at primary level but available
		// for users who care to know the source. The data attribute is a stable
		// test/integration hook for the hierarchy-first detection surface.
		if (packName) chip.title = `From ${packName}`;
		if (signal) chip.dataset.dtfSignalPackId = signal.packId;
		return chip;
	}

	private countHitsForSignal(hitsByPath: Map<string, import('../engine/detectionTree').AnnotatedHit[]>, globalIndex: number): number {
		let n = 0;
		for (const hits of hitsByPath.values()) {
			if (hits.some((h) => h.signal.globalIndex === globalIndex)) n++;
		}
		return n;
	}

	private setSignalFilter(globalIndex: number | null): void {
		this.signalFilter = globalIndex;
		// Update chip outlines
		for (const [idx, el] of this.signalChips) {
			el.style.outline = idx === globalIndex ? '2px solid var(--interactive-accent)' : '';
			el.style.opacity = globalIndex !== null && idx !== globalIndex ? '0.45' : '1';
		}
		// Re-render tree with filter applied
		this.refreshTree();
	}

	private refreshTree(): void {
		const tree = (this.treeContainer as HTMLElement & { _annotatedTree?: import('../engine/detectionTree').AnnotatedTree })._annotatedTree;
		if (tree) this.renderTree(tree);
	}

	private renderTree(tree: import('../engine/detectionTree').AnnotatedTree): void {
		this.treeContainer.empty();
		// Pre-compute the cover for visual tinting so each row knows whether
		// it's a scope point, inside a scope, or outside.
		const cover = minimalScopeCover([...this.selectedFolders]);
		const coverSet = new Set(cover);
		// Stable colour per scope index. When the user selects multiple
		// non-overlapping scopes, each scope's reach paints in a distinct
		// hue so they're visually separable in the tree.
		const scopeColorByPath = new Map<string, string>();
		cover.forEach((p, i) => {
			scopeColorByPath.set(p, scopeColorForIndex(i));
		});

		const childKeys = [...tree.root.children.keys()].sort();
		for (const key of childKeys) {
			this.renderTreeNode(this.treeContainer, tree.root.children.get(key)!, 0, coverSet, cover, scopeColorByPath);
		}
		if (tree.root.elidedChildCount > 0) {
			const elision = this.treeContainer.createDiv();
			elision.style.fontSize = '0.78em';
			elision.style.color = 'var(--text-faint)';
			elision.style.fontStyle = 'italic';
			elision.style.paddingTop = '0.3em';
			elision.setText(`… ${tree.root.elidedChildCount} top-level folder(s) with no matches`);
		}
	}

	/**
	 * Decide whether a folder path is INSIDE any cover scope. A path is
	 * inside scope S iff S is a strict ancestor (segment-aligned). Used to
	 * paint the "scope reach" tint into descendant rows.
	 */
	private isInsideAnyScope(path: string, cover: string[]): boolean {
		for (const s of cover) {
			if (s === '') continue;
			if (path === s) continue; // scope point itself, not "inside"
			if (path.startsWith(s + '/')) return true;
		}
		return false;
	}

	/** Find which cover scope contains this path (most specific wins). */
	private scopeContaining(path: string, cover: string[]): string | null {
		let bestMatch: string | null = null;
		let bestLen = -1;
		for (const s of cover) {
			if (s === '') continue;
			if (path === s) return s; // exact scope point
			if (path.startsWith(s + '/') && s.length > bestLen) {
				bestMatch = s;
				bestLen = s.length;
			}
		}
		return bestMatch;
	}

	/**
	 * True iff path is a "covered" descendant — i.e. a checkbox-selected
	 * folder that the cover algorithm absorbed because an ancestor was
	 * also selected. Used to dim its row visually so the user understands
	 * "your selection here is redundant; the outer scope already covers it."
	 */
	private isAbsorbedSelection(path: string, coverSet: Set<string>): boolean {
		return this.selectedFolders.has(path) && !coverSet.has(path);
	}

	private renderTreeNode(parent: HTMLElement, node: AnnotatedTreeNode, depth: number, coverSet: Set<string>, cover: string[], scopeColorByPath: Map<string, string>): void {
		const isHit = node.hits.length > 0;
		const filterMatch =
			this.signalFilter === null ||
			node.hits.some((h) => h.signal.globalIndex === this.signalFilter);
		const isScopePoint = coverSet.has(node.fullPath);
		const isInsideScope = this.isInsideAnyScope(node.fullPath, cover);
		const isAbsorbed = this.isAbsorbedSelection(node.fullPath, coverSet);
		// Resolve the colour this row should use for its scope tint. A
		// scope point uses its own colour; descendants use the colour of
		// the most-specific containing scope so multi-scope selections
		// stay visually separable.
		const containingScope = isScopePoint ? node.fullPath : this.scopeContaining(node.fullPath, cover);
		const scopeColor = containingScope ? scopeColorByPath.get(containingScope) ?? 'var(--interactive-accent)' : 'var(--interactive-accent)';

		const row = parent.createDiv();
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '0.35em';
		row.style.padding = '0.18em 0.3em';
		row.style.paddingLeft = `${depth * 1.0}em`;
		row.style.borderRadius = '3px';
		row.style.cursor = node.children.size > 0 ? 'pointer' : 'default';
		row.style.userSelect = 'none';
		if (!filterMatch) row.style.opacity = '0.4';

		// Scope visual treatment: surprise-but-intuitive. Checking a folder
		// paints a coloured "scope reach" region into its subtree so the
		// user SEES exactly what their selection will cover, before they
		// click Apply.
		//   - Scope point (selected, kept by minimal cover):
		//       thick accent left border + tinted background + "[scope]" badge.
		//   - Inside-scope (descendant of a scope point, not selected):
		//       very faint accent background — visualises rule reach.
		//   - Absorbed selection (selected, but absorbed by a parent
		//     scope in the cover): dashed accent border + dim — tells
		//     the user "your check here is redundant."
		// HSL with low alpha works in any theme without needing the accent
		// CSS var to expose its RGB components. Each scope gets a stable
		// hue (golden-angle) so multi-scope selections are visually
		// separable.
		const tintBg = (alpha: number) => {
			// scopeColor is `hsl(H, S%, L%)` — slice into hsla(...)
			if (scopeColor.startsWith('hsl(')) return scopeColor.replace('hsl(', 'hsla(').replace(')', `, ${alpha})`);
			// Fallback: use accent variable with alpha layer
			return `rgba(var(--interactive-accent-rgb, 84, 132, 255), ${alpha})`;
		};
		const baseBg = isScopePoint
			? tintBg(0.20)
			: isInsideScope
				? tintBg(0.07)
				: '';
		if (baseBg) row.style.background = baseBg;
		if (isScopePoint) {
			row.style.borderLeft = `4px solid ${scopeColor}`;
			row.style.paddingLeft = `${depth * 1.0 + 0.1}em`;
		} else if (isAbsorbed) {
			row.style.borderLeft = `2px dashed ${scopeColor}`;
			row.style.paddingLeft = `${depth * 1.0 + 0.15}em`;
			row.style.opacity = '0.55';
		}
		// Hover preserves the scope tint so the visual region doesn't
		// flicker as the user moves through the tree.
		row.addEventListener('mouseenter', () => {
			row.style.background = baseBg ? tintBg(0.32) : 'var(--background-modifier-hover)';
		});
		row.addEventListener('mouseleave', () => { row.style.background = baseBg; });

		// Per-row checkbox: only meaningful for hit folders. Ancestor-only
		// folders don't get a checkbox; they're just structure.
		if (isHit) {
			const cb = row.createEl('input', { type: 'checkbox' });
			cb.checked = this.selectedFolders.has(node.fullPath);
			cb.addEventListener('click', (e) => e.stopPropagation());
			cb.addEventListener('change', () => {
				if (cb.checked) this.selectedFolders.add(node.fullPath);
				else this.selectedFolders.delete(node.fullPath);
				// Re-render so scope tints recompute live (the surprise: when
				// you check a box, you SEE the scope wrap the subtree).
				this.refreshTree();
				this.refreshApplyBtn();
			});
		} else {
			// Spacer to keep tree alignment
			const spacer = row.createSpan();
			spacer.style.display = 'inline-block';
			spacer.style.width = '13px';
		}

		// Expansion arrow
		const startsExpanded = depth < 1;
		const arrow = row.createSpan({ text: node.children.size > 0 ? (startsExpanded ? '▾' : '▸') : ' ' });
		arrow.style.minWidth = '0.8em';
		arrow.style.fontSize = '0.8em';
		arrow.style.color = 'var(--text-muted)';

		// Folder icon
		row.createSpan({ text: '📁' }).style.fontSize = '0.92em';

		// Name
		const nameSpan = row.createSpan({ text: node.name });
		nameSpan.style.fontWeight = isHit ? '600' : '400';
		if (!isHit) nameSpan.style.color = 'var(--text-muted)';

		// Scope badge — explicit label so the user knows exactly what's
		// happening: this folder is the entry point for the rules. Uses
		// the scope's distinctive colour so multi-scope selections are
		// visually parsable.
		if (isScopePoint) {
			const badge = row.createSpan({ text: 'scope' });
			badge.style.fontSize = '0.65em';
			badge.style.padding = '0.05em 0.4em';
			badge.style.background = scopeColor;
			badge.style.color = 'white';
			badge.style.borderRadius = '999px';
			badge.style.marginLeft = '0.35em';
			badge.style.fontWeight = '600';
			badge.style.letterSpacing = '0.04em';
			badge.style.textTransform = 'uppercase';
			badge.title = `Rules will be entry-pointed at "${node.fullPath}". The tinted region below shows reach.`;
		} else if (isAbsorbed) {
			const badge = row.createSpan({ text: '↑ absorbed' });
			badge.style.fontSize = '0.65em';
			badge.style.color = 'var(--text-muted)';
			badge.style.marginLeft = '0.35em';
			badge.style.fontStyle = 'italic';
			badge.title = 'A parent folder is also selected as a scope; this selection is absorbed by it.';
		}

		// Per-folder signal chips. Show every annotation; if a folder is
		// claimed by 4+ signals, collapse to "+N" so the row stays compact.
		if (isHit) {
			const chipWrap = row.createSpan();
			chipWrap.style.display = 'inline-flex';
			chipWrap.style.flexWrap = 'wrap';
			chipWrap.style.gap = '0.2em';
			chipWrap.style.marginLeft = '0.4em';
			const visible = node.hits.slice(0, 3);
			for (const hit of visible) {
				const chip = chipWrap.createSpan();
				chip.style.display = 'inline-flex';
				chip.style.alignItems = 'center';
				chip.style.gap = '0.2em';
				chip.style.padding = '0.05em 0.4em';
				chip.style.background = 'var(--background-primary-alt)';
				chip.style.border = `1px solid ${colorForSignalIndex(hit.signal.globalIndex)}`;
				chip.style.borderRadius = '999px';
				chip.style.fontSize = '0.72em';
				chip.title = `${hit.signal.label} (from ${hit.signal.packName})`;
				const dot = chip.createSpan();
				dot.style.display = 'inline-block';
				dot.style.width = '6px';
				dot.style.height = '6px';
				dot.style.borderRadius = '50%';
				dot.style.background = colorForSignalIndex(hit.signal.globalIndex);
				chip.createSpan({ text: hit.signal.label });
			}
			if (node.hits.length > visible.length) {
				const more = chipWrap.createSpan({ text: `+${node.hits.length - visible.length}` });
				more.style.fontSize = '0.72em';
				more.style.color = 'var(--text-muted)';
				more.title = node.hits
					.slice(visible.length)
					.map((h) => `${h.signal.label} (${h.signal.packName})`)
					.join('\n');
			}
		}

		// Children
		const childWrap = parent.createDiv();
		if (!startsExpanded) childWrap.style.display = 'none';
		childWrap.dataset.dtfTreeContainer = '1';
		const childKeys = [...node.children.keys()].sort();
		for (const key of childKeys) {
			this.renderTreeNode(childWrap, node.children.get(key)!, depth + 1, coverSet, cover, scopeColorByPath);
		}
		if (node.elidedChildCount > 0) {
			const elision = childWrap.createDiv();
			elision.style.paddingLeft = `${(depth + 1) * 1.0}em`;
			elision.style.fontSize = '0.76em';
			elision.style.color = 'var(--text-faint)';
			elision.style.fontStyle = 'italic';
			elision.setText(`… ${node.elidedChildCount} other folder(s), no matches`);
		}

		if (node.children.size > 0) {
			row.addEventListener('click', () => {
				const open = childWrap.style.display === 'none';
				childWrap.style.display = open ? '' : 'none';
				arrow.setText(open ? '▾' : '▸');
			});
		}
	}

	private toggleAllFolders(open: boolean): void {
		const containers = this.treeContainer.querySelectorAll<HTMLElement>('[data-dtf-tree-container]');
		containers.forEach((c) => { c.style.display = open ? '' : 'none'; });
	}

	private refreshApplyBtn(): void {
		const folderCount = this.selectedFolders.size;
		const cover = minimalScopeCover([...this.selectedFolders]);
		const scopedPacks = this.computeScopedPackPlan(cover);
		const totalRulesEstimate = scopedPacks.reduce((sum, sp) => sum + sp.packIds.size, 0);
		this.applyBtn.disabled = folderCount === 0;
		if (folderCount === 0) {
			this.applyBtn.setText('Apply (no folders selected)');
		} else if (cover.length === 1) {
			this.applyBtn.setText(`Apply (1 scope · ${totalRulesEstimate} pack-rule-set${totalRulesEstimate === 1 ? '' : 's'})`);
		} else {
			this.applyBtn.setText(`Apply (${cover.length} scopes · ${totalRulesEstimate} pack-rule-set${totalRulesEstimate === 1 ? '' : 's'})`);
		}
	}

	/**
	 * For each cover scope, find the pack IDs whose signals fired anywhere
	 * inside that scope (at-or-under). This is the set of packs whose rules
	 * we'll load and re-scope when the user applies.
	 *
	 * "At-or-under" semantics: selecting `Projects` means "I want pack rules
	 * scoped to the Projects branch even if the actual signal hit was at
	 * `Projects/01-Foo`." Without this, scoping would miss the case where
	 * the user selects an ancestor folder of the actual hit.
	 */
	private computeScopedPackPlan(cover: string[]): Array<{ scope: string; packIds: Set<string> }> {
		const tree = (this.treeContainer as HTMLElement & { _annotatedTree?: import('../engine/detectionTree').AnnotatedTree })._annotatedTree;
		if (!tree) return [];
		const plan: Array<{ scope: string; packIds: Set<string> }> = [];
		for (const scope of cover) {
			const ids = new Set<string>();
			const walk = (node: AnnotatedTreeNode): void => {
				const isInScope =
					scope === '' ||
					node.fullPath === scope ||
					node.fullPath.startsWith(scope + '/');
				if (isInScope) {
					for (const h of node.hits) ids.add(h.signal.packId);
				}
				for (const c of node.children.values()) walk(c);
			};
			walk(tree.root);
			if (ids.size > 0) plan.push({ scope, packIds: ids });
		}
		return plan;
	}

	private async applySelected(manifest: ManifestFile, _hitMap: import('../engine/detectionTree').CrossPackHitMap): Promise<void> {
		const cover = minimalScopeCover([...this.selectedFolders]);
		const plan = this.computeScopedPackPlan(cover);
		if (plan.length === 0) {
			new Notice('No folders selected.');
			return;
		}

		// Cache loaded packs by ID so we don't read the same JSON twice if
		// it appears in multiple scopes.
		const packCache = new Map<string, MappingRule[]>();
		const adapter = this.app.vault.adapter;
		const failed: string[] = [];
		for (const { packIds } of plan) {
			for (const packId of packIds) {
				if (packCache.has(packId)) continue;
				const packEntry = manifest.packs.find((p) => p.id === packId);
				if (!packEntry) continue;
				const path = `${this.app.vault.configDir}/plugins/folder-tag-sync/rule-packs/${packEntry.file}`;
				try {
					const json = await adapter.read(path);
					const result = loadRulePackFromJSON(json);
					if (!result.ok) {
						failed.push(`${packEntry.name}: ${result.errors[0]}`);
						continue;
					}
					packCache.set(packId, result.pack.rules);
				} catch (err) {
					failed.push(`${packEntry.name}: ${(err as Error).message}`);
				}
			}
		}

		if (failed.length > 0) {
			new Notice(`✗ Failed to load: ${failed.join('; ')}`);
			return;
		}

		// Build the final scoped rule list. For each (scope, packIds) plan
		// entry, take each pack's rules and run them through scopeRules
		// with the current scope path. The scope === '' branch is a no-op
		// in scopeRules, preserving the original behaviour for vault-root
		// scope selections.
		const allRules: MappingRule[] = [];
		for (const { scope, packIds } of plan) {
			for (const packId of packIds) {
				const rules = packCache.get(packId);
				if (!rules) continue;
				allRules.push(...scopeRules(rules, scope));
			}
		}

		await this.onApply(allRules);
		new Notice(
			`✓ Applied ${allRules.length} rule(s) across ${plan.length} scope${plan.length === 1 ? '' : 's'}`,
		);
		this.close();
	}

	private collectVaultFolders(): string[] {
		const out: string[] = [];
		const walk = (folder: TFolder) => {
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

	onClose(): void {
		this.contentEl.empty();
	}
}

/**
 * Deterministic colour per scope index — golden-angle hue rotation gives
 * well-spaced colours for any number of scopes. Used to paint the scope
 * tint in the detection tree so multi-scope selections stay visually
 * separable. Slightly more saturated than the signal-chip colours so the
 * scope regions read clearly even at low alpha.
 */
function scopeColorForIndex(index: number): string {
	const hue = (index * 137.508 + 200) % 360; // offset so first scope isn't red
	return `hsl(${hue.toFixed(0)}, 72%, 52%)`;
}
