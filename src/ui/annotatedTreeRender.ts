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
 *     as colored SWIMLANE RAILS in a fixed-width left gutter. Each rail is a
 *     thin vertical bar coloured by an organizational system (pack); the rails
 *     for a row run OUTER→INNER left-to-right, so nesting reads structurally
 *     ("PARA inside JD" = a JD rail then a PARA rail). A system applies to a
 *     folder if that folder OR any ancestor has a hit from it, so the rails
 *     form continuous vertical lanes down whichever subtree the system covers.
 *     The row itself is faintly tinted by the INNERMOST system's colour. This
 *     replaces the older stacked per-signal chips, which were visually noisy.
 *   - MY RULES — an optional `folderRuleView` overlay (what the user's
 *     INSTALLED rules actually do), shown as a single right-aligned green
 *     "→ #tag" emission chip plus a red conflict dot. This is the "Sensing"
 *     layer and is deliberately NOT railified — it is one winning rule per row.
 * The `annotationMode` option chooses which layer(s) paint; both can show at
 * once so the user reads "systems nest here, and my rule fires here" together.
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
 * The system-stack math (`analyzeSystemStacks`) is fully pure and unit-tested.
 */

import { colorForSignalIndex, type AnnotatedTree, type AnnotatedTreeNode } from '../engine/detectionTree';
import type { FolderRuleEntry } from '../engine/folderRuleView';

/** Which annotation layer(s) the rows paint. */
export type AnnotationMode = 'detected' | 'rules' | 'both';

/** One organizational-system (pack) rail in a folder row's left gutter. */
export interface SystemRail {
	/** Pack id — drives the `data-pack-id` hook and stable colour. */
	packId: string;
	/** Pack display name — the rail's hover tooltip. */
	packName: string;
	/** Stable per-pack colour (derived from the pack's lowest signal index). */
	color: string;
}

/** Result of the pure system-stack pre-pass over an annotated tree. */
export interface SystemStackAnalysis {
	/** Folder fullPath → its OUTER→INNER system rail stack. */
	stacksByPath: Map<string, SystemRail[]>;
	/** Deepest stack across the tree — sizes the fixed rail gutter. */
	maxDepth: number;
	/** Pack id → its stable colour. */
	colorByPackId: Map<string, string>;
}

const RAIL_WIDTH_PX = 3;
const RAIL_GAP_PX = 3;

/**
 * Pure pre-pass: for every folder in the annotated tree, compute the ORDERED
 * OUTER→INNER list of organizational systems (packs) that apply to it.
 *
 * A system applies to a folder if that folder OR any ancestor has a hit from
 * that pack. The stack is ordered shallowest-matching-ancestor first
 * (outermost) → this-folder's own new matches last (innermost), and a pack
 * appears exactly once, at its OUTERMOST matching depth. This is what encodes
 * "PARA inside JD": JD matched on an ancestor (outer rail), PARA matched here
 * (inner rail).
 *
 * The ancestor system-set is threaded down the recursion; a pack already in
 * the inherited set is skipped (kept at its outer depth). New packs first
 * matched at a node are appended in stable colour order so the rail layout is
 * deterministic. Colours are stable per pack (lowest globalIndex among its
 * signals → `colorForSignalIndex`), so the same lane keeps one hue everywhere.
 */
export function analyzeSystemStacks(root: AnnotatedTreeNode): SystemStackAnalysis {
	// Pass 1: per-pack display name + representative (lowest) signal index.
	const packMeta = new Map<string, { name: string; minIndex: number }>();
	const collectMeta = (node: AnnotatedTreeNode): void => {
		for (const hit of node.hits) {
			const sig = hit.signal;
			const cur = packMeta.get(sig.packId);
			if (!cur) packMeta.set(sig.packId, { name: sig.packName, minIndex: sig.globalIndex });
			else if (sig.globalIndex < cur.minIndex) cur.minIndex = sig.globalIndex;
		}
		for (const child of node.children.values()) collectMeta(child);
	};
	collectMeta(root);

	const colorByPackId = new Map<string, string>();
	for (const [packId, meta] of packMeta) colorByPackId.set(packId, colorForSignalIndex(meta.minIndex));

	// Pass 2: thread the inherited (outer) stack down; append this node's new
	// (inner) matches; record per-path stacks + the deepest stack overall.
	const stacksByPath = new Map<string, SystemRail[]>();
	let maxDepth = 0;
	const walk = (node: AnnotatedTreeNode, inherited: SystemRail[]): void => {
		const seen = new Set(inherited.map((r) => r.packId));
		const newPackIds: string[] = [];
		for (const hit of node.hits) {
			const pid = hit.signal.packId;
			if (seen.has(pid)) continue;
			seen.add(pid);
			newPackIds.push(pid);
		}
		// Stable order for systems first matched at this same depth.
		newPackIds.sort((a, b) => packMeta.get(a)!.minIndex - packMeta.get(b)!.minIndex);
		const local: SystemRail[] = [...inherited];
		for (const pid of newPackIds) {
			local.push({ packId: pid, packName: packMeta.get(pid)!.name, color: colorByPackId.get(pid)! });
		}
		if (node.fullPath !== '') stacksByPath.set(node.fullPath, local);
		if (local.length > maxDepth) maxDepth = local.length;
		for (const child of node.children.values()) walk(child, local);
	};
	walk(root, []);

	return { stacksByPath, maxDepth, colorByPackId };
}

export interface AnnotatedTreeRenderOptions {
	/**
	 * Depth (0-based) up to which nodes start expanded. Nodes deeper than this
	 * render collapsed by default. Default 1 (top level + its children open).
	 */
	expandToDepth?: number;
	/**
	 * Legacy chip cap — ignored now that detected systems render as rails (which
	 * never collapse to "+N"). Kept on the interface so existing callers compile.
	 */
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
	folderRuleView?: Map<string, FolderRuleEntry>;
	showDetection: boolean;
	showRules: boolean;
	/** Per-path system rail stacks (only consulted when showDetection). */
	stacksByPath: Map<string, SystemRail[]>;
	/** Fixed rail-gutter width in px (0 when no systems / not showing detection). */
	gutterWidth: number;
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
	const showDetection = mode !== 'rules';
	const analysis = analyzeSystemStacks(tree.root);
	const ctx: RenderCtx = {
		expandToDepth: options.expandToDepth ?? 1,
		folderRuleView: options.folderRuleView,
		showDetection,
		showRules: mode !== 'detected',
		stacksByPath: analysis.stacksByPath,
		gutterWidth: showDetection ? analysis.maxDepth * (RAIL_WIDTH_PX + RAIL_GAP_PX) : 0,
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
	const stack = ctx.showDetection ? ctx.stacksByPath.get(node.fullPath) ?? [] : [];
	const innermost = stack.length > 0 ? stack[stack.length - 1] : undefined;
	// A row reads in full weight if either annotation layer marks it.
	const emphasize = (ctx.showDetection && isDetectionHit) || hasRuleWinner;
	const interactive = node.children.size > 0 || Boolean(ctx.onFolderClick);

	const row = parent.createDiv();
	row.classList.add('dtf-folder-row');
	row.dataset.dtfFolderPath = node.fullPath;
	row.style.display = 'flex';
	row.style.alignItems = 'stretch';
	row.style.cursor = interactive ? 'pointer' : 'default';
	row.style.userSelect = 'none';

	// ─── Left swimlane-rail gutter (the DETECTED-systems nesting) ─────────
	// Fixed width so folder names line up across rows; rails are full-height
	// so they run as continuous vertical lanes down each system's subtree.
	if (ctx.showDetection && ctx.gutterWidth > 0) {
		const gutter = row.createDiv();
		gutter.dataset.dtfRailGutter = '1';
		gutter.style.flex = `0 0 ${ctx.gutterWidth}px`;
		gutter.style.width = `${ctx.gutterWidth}px`;
		gutter.style.display = 'flex';
		gutter.style.gap = `${RAIL_GAP_PX}px`;
		gutter.style.alignItems = 'stretch';
		gutter.style.justifyContent = 'flex-start';
		gutter.style.overflow = 'hidden';
		for (const rail of stack) {
			const bar = gutter.createDiv();
			bar.dataset.dtfSystemRail = '1';
			bar.dataset.packId = rail.packId;
			bar.style.flex = `0 0 ${RAIL_WIDTH_PX}px`;
			bar.style.width = `${RAIL_WIDTH_PX}px`;
			bar.style.alignSelf = 'stretch';
			bar.style.background = rail.color;
			bar.style.cursor = 'pointer';
			bar.style.transition = 'filter 0.1s ease';
			bar.title = rail.packName;
			bar.addEventListener('mouseenter', () => { bar.style.filter = 'brightness(1.25)'; });
			bar.addEventListener('mouseleave', () => { bar.style.filter = ''; });
		}
	}

	// ─── Row content (indented tree, right of the rail gutter) ────────────
	const content = row.createDiv();
	content.style.flex = '1 1 auto';
	content.style.minWidth = '0';
	content.style.display = 'flex';
	content.style.alignItems = 'center';
	content.style.gap = '0.35em';
	content.style.padding = '0.18em 0.3em';
	content.style.paddingLeft = `${depth * 1.0 + 0.2}em`;
	// Faint tint by the INNERMOST system's colour; restored after hover.
	const baseBg = innermost ? faintTint(innermost.color) : '';
	content.style.background = baseBg;
	row.addEventListener('mouseenter', () => { content.style.background = 'var(--background-modifier-hover)'; });
	row.addEventListener('mouseleave', () => { content.style.background = baseBg; });

	// Expansion arrow (blank when leaf, for alignment).
	const startsExpanded = depth < ctx.expandToDepth;
	const arrow = content.createSpan({ text: node.children.size > 0 ? (startsExpanded ? '▾' : '▸') : ' ' });
	arrow.style.flex = '0 0 auto';
	arrow.style.minWidth = '0.8em';
	arrow.style.fontSize = '0.8em';
	arrow.style.color = 'var(--text-muted)';

	// Folder icon.
	const icon = content.createSpan({ text: '📁' });
	icon.style.flex = '0 0 auto';
	icon.style.fontSize = '0.92em';

	// Name — annotated folders read in full weight, ancestor structure is dimmed.
	const nameSpan = content.createSpan({ text: node.name });
	nameSpan.style.fontWeight = emphasize ? '600' : '400';
	if (!emphasize) nameSpan.style.color = 'var(--text-muted)';
	nameSpan.style.whiteSpace = 'nowrap';
	nameSpan.style.overflow = 'hidden';
	nameSpan.style.textOverflow = 'ellipsis';

	// ─── "My rules" emission (single winning rule, right-aligned) ─────────
	if (hasRuleWinner && ruleEntry) {
		renderRuleEmission(content, ruleEntry);
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
		// Offset past the rail gutter so the badge lines up under child names.
		elision.style.paddingLeft = `calc(${ctx.gutterWidth}px + ${(depth + 1) * 1.0 + 0.2}em)`;
		elision.style.fontSize = '0.76em';
		elision.style.color = 'var(--text-faint)';
		elision.style.fontStyle = 'italic';
		elision.setText(`… ${node.elidedChildCount} more, no matches`);
	}

	// Single row click handler: toggle expansion (folders with children) AND
	// open the drill-in detail. The two are orthogonal — expansion changes the
	// tree, the detail panel reports on the clicked folder. Clicking a rail
	// bubbles here too, so a rail click also drills in.
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
 * Widen a `colorForSignalIndex` hue into a very-low-alpha tint for the row
 * background. The detection palette is always `hsl(H, S%, L%)`, so we swap to
 * `hsla(...)` with a faint alpha; anything unexpected falls back to a neutral
 * hover tint so the row never renders an invalid colour.
 */
function faintTint(color: string): string {
	if (color.startsWith('hsl(')) return color.replace('hsl(', 'hsla(').replace(')', ', 0.09)');
	return 'var(--background-modifier-hover)';
}

/**
 * Render the "my rules" emission for a covered folder: a green "→ #tag" chip
 * (collapsing extra tags into "+N") plus a red conflict dot when 2+ rules
 * match. Right-aligned (margin-left auto) so it reads opposite the left rails.
 * The chip carries a stable `data-dtf-rule-emission` hook for the E2E.
 */
function renderRuleEmission(row: HTMLElement, entry: FolderRuleEntry): void {
	const wrap = row.createSpan();
	wrap.style.display = 'inline-flex';
	wrap.style.alignItems = 'center';
	wrap.style.gap = '0.25em';
	wrap.style.marginLeft = 'auto';
	wrap.style.paddingLeft = '0.4em';
	wrap.style.flex = '0 0 auto';

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
