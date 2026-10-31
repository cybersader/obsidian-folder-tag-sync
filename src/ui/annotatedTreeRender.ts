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
import { describeOrganizationalSystemMarker } from './workbench/organizationalSystemMarker';
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

export interface OccurrenceRelationDisplay {
	visible: OccurrenceRelationDescriptor[];
	hiddenCount: number;
}

/** Preserve exact source order while deriving a compact collapsed subset. */
export function compactOccurrenceRelations(
	relations: readonly OccurrenceRelationDescriptor[],
	maxVisible: number,
	expanded: boolean,
	preferredOccurrenceKey: string | null = null,
): OccurrenceRelationDisplay {
	const ordered = [...relations];
	const preferredIndex = preferredOccurrenceKey === null
		? -1
		: ordered.findIndex((relation) =>
			relation.occurrenceKey === preferredOccurrenceKey);
	if (preferredIndex > 0) {
		const [preferred] = ordered.splice(preferredIndex, 1);
		if (preferred) ordered.unshift(preferred);
	}
	if (expanded) return { visible: ordered, hiddenCount: 0 };
	const limit = Math.max(1, Math.floor(maxVisible));
	return {
		visible: ordered.slice(0, limit),
		hiddenCount: Math.max(0, ordered.length - limit),
	};
}

export interface AnnotatedTreeRenderOptions {
	/**
	 * Depth (0-based) up to which nodes start expanded. Nodes deeper than this
	 * render collapsed by default. Default 1 (top level + its children open).
	 */
	expandToDepth?: number;
	/** Number of exact occurrence relations shown before a compact disclosure. */
	maxChipsPerFolder?: number;
	/** Controlled folder expansion paths. Falls back to expandToDepth when omitted. */
	expandedPaths?: ReadonlySet<string>;
	onFolderExpansionChange?: (path: string, expanded: boolean) => void;
	/** Controlled paths whose compact occurrence relations are fully disclosed. */
	expandedRelationPaths?: ReadonlySet<string>;
	onRelationExpansionChange?: (path: string, expanded: boolean) => void;
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
	/** Focuses and opens the exact occurrence represented by an activated relation. */
	onOccurrenceActivate?: (occurrenceKey: string) => void;
}

interface RenderCtx {
	expandToDepth: number;
	maxChipsPerFolder: number;
	expandedPaths?: ReadonlySet<string>;
	onFolderExpansionChange?: (path: string, expanded: boolean) => void;
	expandedRelationPaths?: ReadonlySet<string>;
	onRelationExpansionChange?: (path: string, expanded: boolean) => void;
	folderRuleView?: Map<string, FolderRuleEntry>;
	showDetection: boolean;
	showRules: boolean;
	onFolderClick?: (fullPath: string, name: string, evt: MouseEvent) => void;
	onFolderContextMenu?: (fullPath: string, name: string, evt: MouseEvent) => void;
	selectedOccurrenceKey?: string | null;
	onOccurrenceActivate?: (occurrenceKey: string) => void;
}

/**
 * Render the full annotated tree into `container`. Clears the container first.
 * Folders that matched a detection signal (or, in "rules" mode, that a rule
 * covers) read in full weight; ancestor-only folders are dimmed structure.
 * Non-hit branches are elided into "(N more, no matches)" badges. Disclosure
 * buttons and keyboard arrows own expansion; folder-row activation only fires
 * `onFolderClick`, so opening detail cannot also rearrange the hierarchy.
 */
export function renderAnnotatedTree(
	container: HTMLElement,
	tree: AnnotatedTree,
	options: AnnotatedTreeRenderOptions = {},
): void {
	container.empty();
	container.setAttr('role', 'tree');
	container.setAttr('aria-label', 'Vault folder hierarchy');
	const mode = options.annotationMode ?? 'detected';
	const showDetection = mode !== 'rules';
	const ctx: RenderCtx = {
		expandToDepth: options.expandToDepth ?? 1,
		maxChipsPerFolder: options.maxChipsPerFolder ?? 1,
		expandedPaths: options.expandedPaths,
		onFolderExpansionChange: options.onFolderExpansionChange,
		expandedRelationPaths: options.expandedRelationPaths,
		onRelationExpansionChange: options.onRelationExpansionChange,
		folderRuleView: options.folderRuleView,
		showDetection,
		showRules: mode !== 'detected',
		onFolderClick: options.onFolderClick,
		onFolderContextMenu: options.onFolderContextMenu,
		selectedOccurrenceKey: options.selectedOccurrenceKey,
		onOccurrenceActivate: options.onOccurrenceActivate,
	};

	const childKeys = [...tree.root.children.keys()].sort();
	for (const key of childKeys) {
		renderNode(container, tree.root.children.get(key)!, 0, ctx);
	}
	container.querySelector<HTMLElement>('[role="treeitem"]')?.setAttr('tabindex', '0');

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
	const emphasize = (ctx.showDetection && isDetectionHit) || hasRuleWinner;
	const hasChildren = node.children.size > 0;
	let expanded = hasChildren && (ctx.expandedPaths
		? ctx.expandedPaths.has(node.fullPath)
		: depth < ctx.expandToDepth);

	const item = parent.createDiv({ cls: 'dtf-tree-item' });
	item.dataset.dtfFolderPath = node.fullPath;
	item.setAttr('role', 'treeitem');
	item.setAttr('aria-level', String(depth + 1));
	item.tabIndex = -1;
	item.addEventListener('focus', () => {
		const tree = item.closest<HTMLElement>('[role="tree"]');
		if (!tree) return;
		for (const treeItem of Array.from(
			tree.querySelectorAll<HTMLElement>('[role="treeitem"]'),
		)) {
			treeItem.tabIndex = treeItem === item ? 0 : -1;
		}
	});
	if (hasChildren) item.setAttr('aria-expanded', String(expanded));

	const content = item.createDiv({ cls: 'dtf-folder-row' });
	content.dataset.dtfFolderRowContent = '1';
	content.style.paddingLeft = `${depth * 1.0 + 0.2}em`;
	content.style.cursor = ctx.onFolderClick ? 'pointer' : 'default';

	const childWrap = item.createDiv({ cls: 'dtf-tree-children' });
	childWrap.dataset.dtfTreeContainer = '1';
	childWrap.setAttr('role', 'group');
	childWrap.style.display = expanded ? '' : 'none';

	const setExpanded = (open: boolean): void => {
		if (!hasChildren || expanded === open) return;
		expanded = open;
		childWrap.style.display = open ? '' : 'none';
		item.setAttr('aria-expanded', String(open));
		if (disclosure) {
			disclosure.setText(open ? '▾' : '▸');
			disclosure.setAttr('aria-label', `${open ? 'Collapse' : 'Expand'} ${node.name}`);
			disclosure.setAttr('aria-expanded', String(open));
		}
		ctx.onFolderExpansionChange?.(node.fullPath, open);
	};

	let disclosure: HTMLButtonElement | null = null;
	if (hasChildren) {
		disclosure = content.createEl('button', {
			cls: 'dtf-folder-disclosure',
			text: expanded ? '▾' : '▸',
			attr: {
				'aria-label': `${expanded ? 'Collapse' : 'Expand'} ${node.name}`,
				'aria-expanded': String(expanded),
			},
		});
		disclosure.addEventListener('click', (event) => {
			event.stopPropagation();
			setExpanded(!expanded);
		});
	} else {
		content.createSpan({ cls: 'dtf-folder-disclosure-spacer', text: ' ' });
	}

	content.createSpan({ cls: 'dtf-folder-icon', text: '📁' });
	const nameSpan = content.createSpan({ cls: 'dtf-folder-name', text: node.name });
	nameSpan.style.fontWeight = emphasize ? '600' : '400';
	if (!emphasize) nameSpan.style.color = 'var(--text-muted)';

	if (ctx.showDetection && node.hits.length > 0) {
		renderOccurrenceRelationChips(content, node, ctx);
	}
	if (hasRuleWinner && ruleEntry) {
		renderRuleEmission(content, ruleEntry);
	}

	const childKeys = [...node.children.keys()].sort();
	for (const key of childKeys) {
		renderNode(childWrap, node.children.get(key)!, depth + 1, ctx);
	}
	if (node.elidedChildCount > 0) {
		const elision = childWrap.createDiv({ cls: 'dtf-tree-elision' });
		elision.style.paddingLeft = `${(depth + 1) * 1.0 + 0.2}em`;
		elision.setText(`… ${node.elidedChildCount} more, no matches`);
	}

	item.addEventListener('click', (event) => {
		const target = event.target;
		if (target !== item && (!(target instanceof Node) || !content.contains(target))) return;
		item.focus();
		ctx.onFolderClick?.(node.fullPath, node.name, event);
	});
	item.addEventListener('keydown', (event) => {
		if (event.target !== item) return;
		if (event.key === 'ArrowRight' && hasChildren) {
			event.preventDefault();
			if (!expanded) setExpanded(true);
			else childWrap.querySelector<HTMLElement>('[role="treeitem"]')?.focus();
			return;
		}
		if (event.key === 'ArrowLeft') {
			event.preventDefault();
			if (hasChildren && expanded) setExpanded(false);
			else item.parentElement?.closest<HTMLElement>('[role="treeitem"]')?.focus();
			return;
		}
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp'
			|| event.key === 'Home' || event.key === 'End') {
			event.preventDefault();
			focusVisibleTreeItem(item, event.key);
			return;
		}
		if (event.key === 'Enter' || event.key === ' ') {
			event.preventDefault();
			ctx.onFolderClick?.(node.fullPath, node.name, event as unknown as MouseEvent);
		}
	});

	if (ctx.onFolderContextMenu) {
		item.addEventListener('contextmenu', (event) => {
			const target = event.target;
			if (target !== item && (!(target instanceof Node) || !content.contains(target))) return;
			event.preventDefault();
			ctx.onFolderContextMenu!(node.fullPath, node.name, event);
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

	const expanded = ctx.expandedRelationPaths?.has(node.fullPath) ?? false;
	const display = compactOccurrenceRelations(
		relations,
		ctx.maxChipsPerFolder,
		expanded,
		ctx.selectedOccurrenceKey ?? null,
	);
	const wrap = parent.createSpan({ cls: 'dtf-folder-occurrence-relations' });
	wrap.dataset.dtfOccurrenceRelationsExpanded = String(expanded);
	if (!expanded) wrap.addClass('is-compact');

	for (const descriptor of display.visible) {
		const { occurrenceKey, relation } = descriptor;
		const chip = wrap.createEl('button', { cls: 'dtf-folder-occurrence-chip' });
		chip.dataset.dtfOccurrenceKey = occurrenceKey;
		chip.dataset.dtfRelation = relation;
		chip.setAttr('aria-pressed', String(ctx.selectedOccurrenceKey === occurrenceKey));
		if (ctx.selectedOccurrenceKey === occurrenceKey) chip.addClass('is-selected');
		const fullAnchor = descriptor.anchorPath || 'vault root';
		const markerPresentation = describeOrganizationalSystemMarker(occurrenceKey);
		const marker = chip.createSpan({ cls: 'dtf-organizational-system-marker' });
		marker.dataset.dtfOrganizationalSystemMarker = markerPresentation.occurrenceKey;
		marker.setAttr('aria-hidden', 'true');
		marker.style.display = 'inline-block';
		marker.style.width = '0.6em';
		marker.style.height = '0.6em';
		marker.style.flex = '0 0 auto';
		marker.style.borderRadius = '999px';
		marker.style.backgroundColor = markerPresentation.colorToken;
		chip.createSpan({
			cls: 'dtf-folder-occurrence-relation',
			text: relation === 'support' ? 'Supports' : 'Identifies',
		});
		chip.createSpan({
			cls: 'dtf-folder-occurrence-system',
			text: descriptor.packName,
		});
		renderSemanticPath(chip, descriptor.anchorPath, {
			role: 'map-occurrence-anchor',
			focusLabel: 'Recognized here',
			variant: 'compact',
		});
		chip.setAttr(
			'aria-label',
			`${relation === 'support' ? 'Supports' : 'Identifies'} ${descriptor.packName}. `
			+ `Organizational system recognized here: ${fullAnchor}.`,
		);
		chip.title = `${descriptor.packName} organizational system recognized at ${fullAnchor}`;
		chip.addEventListener('click', (event) => {
			event.stopPropagation();
			ctx.onOccurrenceActivate?.(occurrenceKey);
		});
	}

	if (relations.length > ctx.maxChipsPerFolder) {
		const toggle = wrap.createEl('button', {
			cls: 'dtf-folder-occurrence-more',
			text: expanded
				? 'Show fewer'
				: `+${display.hiddenCount} organizational system${display.hiddenCount === 1 ? '' : 's'}`,
		});
		toggle.dataset.dtfOccurrenceRelationsToggle = node.fullPath;
		toggle.setAttr('aria-expanded', String(expanded));
		toggle.setAttr('aria-label', expanded
			? `Show fewer organizational systems for ${node.name}`
			: `Show ${display.hiddenCount} more organizational system${display.hiddenCount === 1 ? '' : 's'} for ${node.name}`);
		toggle.addEventListener('click', (event) => {
			event.stopPropagation();
			ctx.onRelationExpansionChange?.(node.fullPath, !expanded);
		});
	}
}

function focusVisibleTreeItem(
	current: HTMLElement,
	key: 'ArrowDown' | 'ArrowUp' | 'Home' | 'End',
): void {
	const tree = current.closest<HTMLElement>('[role="tree"]');
	if (!tree) return;
	const items = Array.from(tree.querySelectorAll<HTMLElement>('[role="treeitem"]'))
		.filter((item) => isVisibleTreeItem(item, tree));
	if (items.length === 0) return;
	const currentIndex = items.indexOf(current);
	const targetIndex = key === 'Home'
		? 0
		: key === 'End'
			? items.length - 1
			: Math.max(0, Math.min(
				items.length - 1,
				currentIndex + (key === 'ArrowDown' ? 1 : -1),
			));
	items[targetIndex]?.focus();
}

function isVisibleTreeItem(item: HTMLElement, tree: HTMLElement): boolean {
	let parent = item.parentElement;
	while (parent && parent !== tree) {
		if (parent.dataset.dtfTreeContainer === '1' && parent.style.display === 'none') {
			return false;
		}
		parent = parent.parentElement;
	}
	return true;
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
