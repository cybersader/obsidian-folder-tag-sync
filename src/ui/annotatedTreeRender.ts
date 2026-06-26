/**
 * annotatedTreeRender — a read-only renderer for the cross-pack annotated
 * vault tree (`AnnotatedTree` from `engine/detectionTree`).
 *
 * This is the DISPLAY half of the hierarchy-first view, extracted so the
 * big dockable Taxonomy Workbench pane can render the same sparse,
 * signal-annotated tree the detect modal shows — without dragging along the
 * modal's interactive machinery (per-folder checkboxes, scope-cover tinting,
 * scope badges). Those belong to the modal's *selection* flow; the pane only
 * shows the hierarchy.
 *
 * Two annotation layers ride on the same tree:
 *   - DETECTED systems — `AnnotatedTreeNode.hits` (what *could* apply), shown
 *     as outlined signal chips. This is the original layer.
 *   - MY RULES — an optional `folderRuleView` overlay (what the user's
 *     INSTALLED rules actually do), shown as a green "→ #tag" emission chip
 *     plus a red conflict dot. This is the "Sensing" layer.
 * The `annotationMode` option chooses which layer(s) paint; both can show at
 * once so the user reads "detected here, and my rule fires here" together.
 *
 * Deliberately NOT reusing `DetectVaultModal.renderTreeNode`: that method is
 * tightly coupled to the modal's selection state (selectedFolders, cover,
 * scopeColorByPath) and is covered by `scope-detect.e2e.ts`. Refactoring it
 * to be shareable risked regressing that passing E2E, so the read-only path
 * lives here as its own small, focused renderer.
 *
 * Pure-ish: takes a DOM container + an `AnnotatedTree` (+ a plain data overlay
 * and plain callbacks). No Obsidian APIs, no I/O, no plugin state — the view
 * constructs the `Menu` / settings navigation inside the callbacks it passes.
 */

import { colorForSignalIndex, type AnnotatedTree, type AnnotatedTreeNode } from '../engine/detectionTree';
import type { FolderRuleEntry } from '../engine/folderRuleView';

/** Which annotation layer(s) the rows paint. */
export type AnnotationMode = 'detected' | 'rules' | 'both';

export interface AnnotatedTreeRenderOptions {
	/**
	 * Depth (0-based) up to which nodes start expanded. Nodes deeper than this
	 * render collapsed by default. Default 1 (top level + its children open).
	 */
	expandToDepth?: number;
	/** Max signal chips to show inline per folder before collapsing to "+N". Default 3. */
	maxChipsPerFolder?: number;
	/**
	 * Per-folder "my rules" overlay keyed by full folder path. When provided
	 * (and the mode shows rules), covered folders get a green emission chip and
	 * a red conflict dot.
	 */
	folderRuleView?: Map<string, FolderRuleEntry>;
	/** Which annotation layer(s) to paint. Default 'detected' (legacy behavior). */
	annotationMode?: AnnotationMode;
	/** Called when a folder row is clicked — the view opens its drill-in detail. */
	onFolderClick?: (fullPath: string, name: string, evt: MouseEvent) => void;
	/** Called on a folder row's contextmenu — the view shows an Obsidian Menu. */
	onFolderContextMenu?: (fullPath: string, name: string, evt: MouseEvent) => void;
}

interface RenderCtx {
	expandToDepth: number;
	maxChips: number;
	folderRuleView?: Map<string, FolderRuleEntry>;
	showDetection: boolean;
	showRules: boolean;
	onFolderClick?: (fullPath: string, name: string, evt: MouseEvent) => void;
	onFolderContextMenu?: (fullPath: string, name: string, evt: MouseEvent) => void;
}

/**
 * Render the full annotated tree into `container`. Clears the container first.
 * Folders that matched a detection signal (or, in "rules" mode, that a rule
 * covers) read in full weight; ancestor-only folders are dimmed structure.
 * Non-hit branches are elided into "(N more, no matches)" badges. Folders with
 * children toggle open/closed on click; clicking any row also fires
 * `onFolderClick` so the view can open the folder's drill-in detail.
 */
export function renderAnnotatedTree(
	container: HTMLElement,
	tree: AnnotatedTree,
	options: AnnotatedTreeRenderOptions = {},
): void {
	container.empty();
	const mode = options.annotationMode ?? 'detected';
	const ctx: RenderCtx = {
		expandToDepth: options.expandToDepth ?? 1,
		maxChips: options.maxChipsPerFolder ?? 3,
		folderRuleView: options.folderRuleView,
		showDetection: mode !== 'rules',
		showRules: mode !== 'detected',
		onFolderClick: options.onFolderClick,
		onFolderContextMenu: options.onFolderContextMenu,
	};

	const childKeys = [...tree.root.children.keys()].sort();
	for (const key of childKeys) {
		renderNode(container, tree.root.children.get(key)!, 0, ctx);
	}

	if (tree.root.elidedChildCount > 0) {
		const elision = container.createDiv();
		elision.style.fontSize = '0.78em';
		elision.style.color = 'var(--text-faint)';
		elision.style.fontStyle = 'italic';
		elision.style.paddingTop = '0.3em';
		elision.setText(`… ${tree.root.elidedChildCount} top-level folder(s) with no matches`);
	}
}

function renderNode(
	parent: HTMLElement,
	node: AnnotatedTreeNode,
	depth: number,
	ctx: RenderCtx,
): void {
	const isDetectionHit = node.hits.length > 0;
	const ruleEntry = ctx.showRules ? ctx.folderRuleView?.get(node.fullPath) : undefined;
	const hasRuleWinner = Boolean(ruleEntry?.winnerRuleId);
	// A row reads in full weight if either annotation layer marks it.
	const emphasize = (ctx.showDetection && isDetectionHit) || hasRuleWinner;

	const row = parent.createDiv();
	row.classList.add('dtf-folder-row');
	row.dataset.dtfFolderPath = node.fullPath;
	row.style.display = 'flex';
	row.style.alignItems = 'center';
	row.style.gap = '0.35em';
	row.style.padding = '0.18em 0.3em';
	row.style.paddingLeft = `${depth * 1.0 + 0.2}em`;
	row.style.borderRadius = '3px';
	const interactive = node.children.size > 0 || Boolean(ctx.onFolderClick);
	row.style.cursor = interactive ? 'pointer' : 'default';
	row.style.userSelect = 'none';
	row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-modifier-hover)'; });
	row.addEventListener('mouseleave', () => { row.style.background = ''; });

	// Expansion arrow (blank when leaf, for alignment).
	const startsExpanded = depth < ctx.expandToDepth;
	const arrow = row.createSpan({ text: node.children.size > 0 ? (startsExpanded ? '▾' : '▸') : ' ' });
	arrow.style.minWidth = '0.8em';
	arrow.style.fontSize = '0.8em';
	arrow.style.color = 'var(--text-muted)';

	// Folder icon.
	row.createSpan({ text: '📁' }).style.fontSize = '0.92em';

	// Name — annotated folders read in full weight, ancestor structure is dimmed.
	const nameSpan = row.createSpan({ text: node.name });
	nameSpan.style.fontWeight = emphasize ? '600' : '400';
	if (!emphasize) nameSpan.style.color = 'var(--text-muted)';

	// ─── Detection-system chips (what COULD apply) ───────────────────────
	if (ctx.showDetection && isDetectionHit) {
		renderDetectionChips(row, node, ctx.maxChips);
	}

	// ─── "My rules" chips (what my INSTALLED rules actually do) ──────────
	if (hasRuleWinner && ruleEntry) {
		renderRuleEmission(row, ruleEntry);
	}

	// Children container — `data-dtf-tree-container` lets an "expand/collapse
	// all" affordance flip every subtree at once (same hook the modal uses).
	const childWrap = parent.createDiv();
	if (!startsExpanded) childWrap.style.display = 'none';
	childWrap.dataset.dtfTreeContainer = '1';
	const childKeys = [...node.children.keys()].sort();
	for (const key of childKeys) {
		renderNode(childWrap, node.children.get(key)!, depth + 1, ctx);
	}
	if (node.elidedChildCount > 0) {
		const elision = childWrap.createDiv();
		elision.style.paddingLeft = `${(depth + 1) * 1.0 + 0.2}em`;
		elision.style.fontSize = '0.76em';
		elision.style.color = 'var(--text-faint)';
		elision.style.fontStyle = 'italic';
		elision.setText(`… ${node.elidedChildCount} more, no matches`);
	}

	// Single row click handler: toggle expansion (folders with children) AND
	// open the drill-in detail. The two are orthogonal — expansion changes the
	// tree, the detail panel reports on the clicked folder.
	row.addEventListener('click', (e) => {
		if (node.children.size > 0) {
			const open = childWrap.style.display === 'none';
			childWrap.style.display = open ? '' : 'none';
			arrow.setText(open ? '▾' : '▸');
		}
		ctx.onFolderClick?.(node.fullPath, node.name, e);
	});

	if (ctx.onFolderContextMenu) {
		row.addEventListener('contextmenu', (e) => {
			e.preventDefault();
			ctx.onFolderContextMenu!(node.fullPath, node.name, e);
		});
	}
}

/**
 * Render the detection-system signal chips for a hit folder. Collapses to
 * "+N" past `maxChips` so wide hierarchies stay scannable.
 */
function renderDetectionChips(row: HTMLElement, node: AnnotatedTreeNode, maxChips: number): void {
	const chipWrap = row.createSpan();
	chipWrap.style.display = 'inline-flex';
	chipWrap.style.flexWrap = 'wrap';
	chipWrap.style.gap = '0.2em';
	chipWrap.style.marginLeft = '0.4em';
	const visible = node.hits.slice(0, maxChips);
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

/**
 * Render the "my rules" emission for a covered folder: a green "→ #tag" chip
 * (collapsing extra tags into "+N") plus a red conflict dot when 2+ rules
 * match. The chip carries a stable `data-dtf-rule-emission` hook for the E2E.
 */
function renderRuleEmission(row: HTMLElement, entry: FolderRuleEntry): void {
	const wrap = row.createSpan();
	wrap.style.display = 'inline-flex';
	wrap.style.alignItems = 'center';
	wrap.style.gap = '0.25em';
	wrap.style.marginLeft = '0.4em';

	const tags = entry.emittedTags;
	const headTag = tags[0] ?? '(no tag)';
	const chip = wrap.createSpan();
	chip.dataset.dtfRuleEmission = '1';
	chip.style.display = 'inline-flex';
	chip.style.alignItems = 'center';
	chip.style.gap = '0.2em';
	chip.style.padding = '0.05em 0.45em';
	chip.style.background = 'rgba(40, 140, 70, 0.15)';
	chip.style.color = 'var(--text-success, rgb(40, 140, 70))';
	chip.style.border = '1px solid rgba(40, 140, 70, 0.4)';
	chip.style.borderRadius = '999px';
	chip.style.fontSize = '0.72em';
	chip.style.fontFamily = 'var(--font-monospace)';
	chip.style.whiteSpace = 'nowrap';
	const label = tags.length > 1 ? `→ ${headTag} +${tags.length - 1}` : `→ ${headTag}`;
	chip.setText(label);
	chip.title = entry.winnerRuleName
		? `${entry.winnerRuleName} emits: ${tags.length ? tags.join(', ') : '(nothing)'}`
		: 'No tag emitted';

	if (entry.conflict) {
		const dot = wrap.createSpan();
		dot.dataset.dtfRuleConflict = '1';
		dot.style.display = 'inline-block';
		dot.style.width = '8px';
		dot.style.height = '8px';
		dot.style.borderRadius = '50%';
		dot.style.background = 'rgb(200, 60, 60)';
		dot.style.flex = '0 0 auto';
		dot.title =
			`Conflict: ${entry.matchingRuleIds.length} rules match — [${entry.matchingRuleIds.join(', ')}]. ` +
			`Predicted winner: ${entry.winnerRuleName ?? '(none)'}`;
	}
}
