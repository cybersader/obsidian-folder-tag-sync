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
 * Two explicit annotation layers ride on the same neutral tree:
 *   - DETECTED systems — occurrence-specific Member / Support chips derived
 *     from `AnnotatedTreeNode.hits`. A folder can relate to several anchored
 *     occurrences without turning arbitrary pack colours into status meaning.
 *   - MY RULES — an optional `folderRuleView` overlay (what the user's
 *     INSTALLED rules actually do), shown as a neutral emitted-tag result and
 *     a textual Conflict badge when several rules match.
 * The `annotationMode` option chooses which layer(s) render. Text and exact
 * occurrence identity carry meaning; colour is reserved for normal selection.
 *
 * Deliberately separate from `WorkbenchScopePanel`'s renderer: Scope is tightly
 * coupled to selection state (selected folders, minimal cover, scope colours),
 * while this path is read-only. Keeping the interaction models separate avoids
 * turning one tree component into a brittle matrix of configuration flags.
 *
 * Pure-ish: takes a DOM container + an `AnnotatedTree` (+ a plain data overlay
 * and plain callbacks). No Obsidian APIs, no I/O, no plugin state. Raw signal
 * hits are reduced to exact occurrence relations by a pure tested helper.
 */

import type { AnnotatedHit, AnnotatedTree, AnnotatedTreeNode } from '../engine/detectionTree';
import type { FolderRuleEntry } from '../engine/folderRuleView';
import { renderSemanticPath } from './workbench/SemanticPath';

/** Which annotation layer(s) the rows paint. */
export type AnnotationMode = 'detected' | 'rules' | 'both';

export interface OccurrenceRelationDescriptor {
	occurrenceKey: string;
	relation: 'member' | 'support';
	packName: string;
	anchorPath: string;
}

/** De-duplicate raw signal hits into the exact occurrence relations shown on one folder row. */
export function collectOccurrenceRelations(
	hits: readonly AnnotatedHit[],
): OccurrenceRelationDescriptor[] {
	const relations = new Map<string, OccurrenceRelationDescriptor>();
	for (const hit of hits) {
		if (!hit.occurrenceKey) continue;
		const relation = hit.relation ?? 'member';
		const key = `${hit.occurrenceKey.length}:${hit.occurrenceKey}:${relation}`;
		if (relations.has(key)) continue;
		relations.set(key, {
			occurrenceKey: hit.occurrenceKey,
			relation,
			packName: hit.signal.packName,
			anchorPath: hit.occurrenceAnchorPath || '',
		});
	}
	return [...relations.values()];
}

export interface AnnotatedTreeRenderOptions {
	/**
	 * Depth (0-based) up to which nodes start expanded. Nodes deeper than this
	 * render collapsed by default. Default 1 (top level + its children open).
	 */
	expandToDepth?: number;
	/** Legacy chip cap retained so existing callers compile. */
	maxChipsPerFolder?: number;
	/**
	 * Per-folder "my rules" overlay keyed by full folder path. When provided
	 * (and the mode shows rules), covered folders get a neutral emission result
	 * and an explicit Conflict badge when needed.
	 */
	folderRuleView?: Map<string, FolderRuleEntry>;
	/** Which annotation layer(s) to paint. Default 'detected' (legacy behavior). */
	annotationMode?: AnnotationMode;
	/** Called when a folder row is clicked — the view opens its drill-in detail. */
	onFolderClick?: (fullPath: string, name: string, evt: MouseEvent) => void;
	/** Called on a folder row's contextmenu — the view shows an Obsidian Menu. */
	onFolderContextMenu?: (fullPath: string, name: string, evt: MouseEvent) => void;
	/** Cross-surface organizational-system selection shown on typed relation chips. */
	selectedOccurrenceKey?: string | null;
	onOccurrenceClick?: (occurrenceKey: string) => void;
}

interface RenderCtx {
	expandToDepth: number;
	folderRuleView?: Map<string, FolderRuleEntry>;
	showDetection: boolean;
	showRules: boolean;
	onFolderClick?: (fullPath: string, name: string, evt: MouseEvent) => void;
	onFolderContextMenu?: (fullPath: string, name: string, evt: MouseEvent) => void;
	selectedOccurrenceKey?: string | null;
	onOccurrenceClick?: (occurrenceKey: string) => void;
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
	const ctx: RenderCtx = {
		expandToDepth: options.expandToDepth ?? 1,
		folderRuleView: options.folderRuleView,
		showDetection,
		showRules: mode !== 'detected',
		onFolderClick: options.onFolderClick,
		onFolderContextMenu: options.onFolderContextMenu,
		selectedOccurrenceKey: options.selectedOccurrenceKey,
		onOccurrenceClick: options.onOccurrenceClick,
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
	const interactive = node.children.size > 0 || Boolean(ctx.onFolderClick);

	const row = parent.createDiv();
	row.classList.add('dtf-folder-row');
	row.dataset.dtfFolderPath = node.fullPath;
	row.style.display = 'flex';
	row.style.alignItems = 'stretch';
	row.style.cursor = interactive ? 'pointer' : 'default';
	row.style.userSelect = 'none';

	// ─── Neutral row content ───────────────────────────────────────────────
	const content = row.createDiv();
	content.dataset.dtfFolderRowContent = '1';
	content.style.flex = '1 1 auto';
	content.style.minWidth = '0';
	content.style.display = 'flex';
	content.style.alignItems = 'center';
	content.style.gap = '0.35em';
	content.style.padding = '0.18em 0.3em';
	content.style.paddingLeft = `${depth * 1.0 + 0.2}em`;
	row.addEventListener('mouseenter', () => {
		content.style.background = 'var(--background-modifier-hover)';
	});
	row.addEventListener('mouseleave', () => {
		content.style.background = '';
	});

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
	nameSpan.style.flex = '1 1 auto';
	nameSpan.style.minWidth = '0';
	nameSpan.style.whiteSpace = 'nowrap';
	nameSpan.style.overflow = 'hidden';
	nameSpan.style.textOverflow = 'ellipsis';

	if (ctx.showDetection && node.hits.length > 0) {
		renderOccurrenceRelationChips(content, node, ctx);
	}

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
		elision.style.paddingLeft = `${(depth + 1) * 1.0 + 0.2}em`;
		elision.style.fontSize = '0.76em';
		elision.style.color = 'var(--text-faint)';
		elision.style.fontStyle = 'italic';
		elision.setText(`… ${node.elidedChildCount} more, no matches`);
	}

	// Single row click handler: toggle expansion (folders with children) AND
	// open the drill-in detail. The two are orthogonal — expansion changes the
	// tree while the detail panel reports on the clicked folder.
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

function renderOccurrenceRelationChips(
	parent: HTMLElement,
	node: AnnotatedTreeNode,
	ctx: RenderCtx,
): void {
	const relations = collectOccurrenceRelations(node.hits);
	if (relations.length === 0) return;

	const wrap = parent.createSpan({ cls: 'dtf-folder-occurrence-relations' });
	for (const descriptor of relations) {
		const { occurrenceKey, relation } = descriptor;
		const chip = wrap.createEl('button', { cls: 'dtf-folder-occurrence-chip' });
		chip.dataset.dtfOccurrenceKey = occurrenceKey;
		chip.dataset.dtfRelation = relation;
		chip.setAttr('aria-pressed', String(ctx.selectedOccurrenceKey === occurrenceKey));
		if (ctx.selectedOccurrenceKey === occurrenceKey) chip.addClass('is-selected');
		const fullAnchor = descriptor.anchorPath || 'vault root';
		chip.createSpan({
			cls: 'dtf-folder-occurrence-relation',
			text: relation === 'support' ? 'Support for' : 'Member of',
		});
		chip.createSpan({
			cls: 'dtf-folder-occurrence-system',
			text: descriptor.packName,
		});
		renderSemanticPath(chip, descriptor.anchorPath, {
			role: 'map-occurrence-anchor',
			focusLabel: 'System anchor',
			variant: 'compact',
		});
		chip.setAttr(
			'aria-label',
			`${relation === 'support' ? 'Support' : 'Member'} evidence for ${descriptor.packName}. System anchor: ${fullAnchor}.`,
		);
		chip.title = `${descriptor.packName} occurrence at ${fullAnchor}`;
		chip.addEventListener('click', (event) => {
			event.stopPropagation();
			ctx.onOccurrenceClick?.(occurrenceKey);
		});
	}
}

/**
 * Render the installed-rule result for a covered folder. The neutral tag chip
 * reports the predicted emission; a textual Conflict badge appears when two or
 * more rules match. Stable data hooks remain for real-Obsidian coverage.
 */
function renderRuleEmission(row: HTMLElement, entry: FolderRuleEntry): void {
	const wrap = row.createSpan({ cls: 'dtf-folder-rule-emission' });
	wrap.style.display = 'inline-flex';
	wrap.style.alignItems = 'center';
	wrap.style.gap = '0.25em';
	wrap.style.marginLeft = 'auto';
	wrap.style.paddingLeft = '0.4em';
	wrap.style.flex = '0 1 55%';
	wrap.style.minWidth = '0';
	wrap.style.maxWidth = '55%';

	const tags = entry.emittedTags;
	const headTag = tags[0] ?? '(no tag)';
	const chip = wrap.createSpan();
	chip.dataset.dtfRuleEmission = '1';
	chip.style.display = 'inline-flex';
	chip.style.alignItems = 'center';
	chip.style.gap = '0.2em';
	chip.style.padding = '0.05em 0.45em';
	chip.style.background = 'var(--background-secondary-alt)';
	chip.style.color = 'var(--text-muted)';
	chip.style.border = '1px solid var(--background-modifier-border)';
	chip.style.borderRadius = '999px';
	chip.style.fontSize = '0.72em';
	chip.style.fontFamily = 'var(--font-monospace)';
	chip.style.minWidth = '0';
	chip.style.maxWidth = '100%';
	chip.style.whiteSpace = 'nowrap';
	chip.style.overflow = 'hidden';
	chip.style.textOverflow = 'ellipsis';
	const label = tags.length > 1 ? `→ ${headTag} +${tags.length - 1}` : `→ ${headTag}`;
	chip.setText(label);
	chip.title = entry.winnerRuleName
		? `${entry.winnerRuleName} emits: ${tags.length ? tags.join(', ') : '(nothing)'}`
		: 'No tag emitted';

	if (entry.conflict) {
		const conflict = wrap.createSpan({ text: 'Conflict' });
		conflict.dataset.dtfRuleConflict = '1';
		conflict.style.display = 'inline-flex';
		conflict.style.alignItems = 'center';
		conflict.style.flex = '0 0 auto';
		conflict.style.padding = '0.05em 0.4em';
		conflict.style.border = '1px solid var(--background-modifier-border)';
		conflict.style.borderRadius = '999px';
		conflict.style.fontSize = '0.68em';
		conflict.style.fontWeight = '600';
		conflict.style.color = 'var(--text-warning)';
		conflict.title =
			`Conflict: ${entry.matchingRuleIds.length} rules match — [${entry.matchingRuleIds.join(', ')}]. ` +
			`Predicted winner: ${entry.winnerRuleName ?? '(none)'}`;
		conflict.setAttr('aria-label', conflict.title);
	}
}
