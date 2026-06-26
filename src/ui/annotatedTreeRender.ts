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
 * Deliberately NOT reusing `DetectVaultModal.renderTreeNode`: that method is
 * tightly coupled to the modal's selection state (selectedFolders, cover,
 * scopeColorByPath) and is covered by `scope-detect.e2e.ts`. Refactoring it
 * to be shareable risked regressing that passing E2E, so the read-only path
 * lives here as its own small, focused renderer. Both surfaces still draw the
 * same per-folder signal chips + elision badges; they just diverge on
 * interactivity.
 *
 * Pure-ish: takes a DOM container + an `AnnotatedTree` and paints rows. No
 * Obsidian APIs, no I/O, no plugin state.
 */

import { colorForSignalIndex, type AnnotatedTree, type AnnotatedTreeNode } from '../engine/detectionTree';

export interface AnnotatedTreeRenderOptions {
	/**
	 * Depth (0-based) up to which nodes start expanded. Nodes deeper than this
	 * render collapsed by default. Default 1 (top level + its children open).
	 */
	expandToDepth?: number;
	/** Max signal chips to show inline per folder before collapsing to "+N". Default 3. */
	maxChipsPerFolder?: number;
}

/**
 * Render the full annotated tree into `container`. Clears the container first.
 * Folders that matched ≥1 signal show their signal chips and read in full
 * weight; ancestor-only folders are dimmed structure. Non-hit branches are
 * elided into "(N more, no matches)" badges. Folders with children toggle
 * open/closed on click.
 */
export function renderAnnotatedTree(
	container: HTMLElement,
	tree: AnnotatedTree,
	options: AnnotatedTreeRenderOptions = {},
): void {
	container.empty();
	const expandToDepth = options.expandToDepth ?? 1;
	const maxChips = options.maxChipsPerFolder ?? 3;

	const childKeys = [...tree.root.children.keys()].sort();
	for (const key of childKeys) {
		renderNode(container, tree.root.children.get(key)!, 0, expandToDepth, maxChips);
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
	expandToDepth: number,
	maxChips: number,
): void {
	const isHit = node.hits.length > 0;

	const row = parent.createDiv();
	row.style.display = 'flex';
	row.style.alignItems = 'center';
	row.style.gap = '0.35em';
	row.style.padding = '0.18em 0.3em';
	row.style.paddingLeft = `${depth * 1.0 + 0.2}em`;
	row.style.borderRadius = '3px';
	row.style.cursor = node.children.size > 0 ? 'pointer' : 'default';
	row.style.userSelect = 'none';
	row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-modifier-hover)'; });
	row.addEventListener('mouseleave', () => { row.style.background = ''; });

	// Expansion arrow (blank when leaf, for alignment).
	const startsExpanded = depth < expandToDepth;
	const arrow = row.createSpan({ text: node.children.size > 0 ? (startsExpanded ? '▾' : '▸') : ' ' });
	arrow.style.minWidth = '0.8em';
	arrow.style.fontSize = '0.8em';
	arrow.style.color = 'var(--text-muted)';

	// Folder icon.
	row.createSpan({ text: '📁' }).style.fontSize = '0.92em';

	// Name — hit folders read in full weight, ancestor structure is dimmed.
	const nameSpan = row.createSpan({ text: node.name });
	nameSpan.style.fontWeight = isHit ? '600' : '400';
	if (!isHit) nameSpan.style.color = 'var(--text-muted)';

	// Per-folder signal chips. Collapse to "+N" past maxChips so wide
	// hierarchies stay scannable.
	if (isHit) {
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

	// Children container — `data-dtf-tree-container` lets an "expand/collapse
	// all" affordance flip every subtree at once (same hook the modal uses).
	const childWrap = parent.createDiv();
	if (!startsExpanded) childWrap.style.display = 'none';
	childWrap.dataset.dtfTreeContainer = '1';
	const childKeys = [...node.children.keys()].sort();
	for (const key of childKeys) {
		renderNode(childWrap, node.children.get(key)!, depth + 1, expandToDepth, maxChips);
	}
	if (node.elidedChildCount > 0) {
		const elision = childWrap.createDiv();
		elision.style.paddingLeft = `${(depth + 1) * 1.0 + 0.2}em`;
		elision.style.fontSize = '0.76em';
		elision.style.color = 'var(--text-faint)';
		elision.style.fontStyle = 'italic';
		elision.setText(`… ${node.elidedChildCount} more, no matches`);
	}

	if (node.children.size > 0) {
		row.addEventListener('click', () => {
			const open = childWrap.style.display === 'none';
			childWrap.style.display = open ? '' : 'none';
			arrow.setText(open ? '▾' : '▸');
		});
	}
}
