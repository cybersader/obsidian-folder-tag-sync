import type { AnnotatedTree, AnnotatedTreeNode } from '../../engine/detectionTree';

export interface WorkbenchMapPresentationState {
	/** null means the tree has not yet initialized its default open depth. */
	expandedPaths: string[] | null;
	expandedRelationPaths: string[];
	scrollTop: number;
	focusPath: string | null;
}

export function createDefaultWorkbenchMapPresentationState(): WorkbenchMapPresentationState {
	return {
		expandedPaths: null,
		expandedRelationPaths: [],
		scrollTop: 0,
		focusPath: null,
	};
}

export function defaultExpandedPaths(
	tree: AnnotatedTree,
	expandToDepth: number,
): string[] {
	const expanded: string[] = [];
	for (const node of tree.root.children.values()) {
		collectDefaultExpandedPaths(node, 0, expandToDepth, expanded);
	}
	return expanded.sort();
}

export function reconcileWorkbenchMapPresentationState(
	state: WorkbenchMapPresentationState,
	validPaths: readonly string[],
): WorkbenchMapPresentationState {
	const valid = new Set(validPaths);
	return {
		expandedPaths: state.expandedPaths === null
			? null
			: uniqueSorted(state.expandedPaths.filter((path) => valid.has(path))),
		expandedRelationPaths: uniqueSorted(
			state.expandedRelationPaths.filter((path) => valid.has(path)),
		),
		scrollTop: Number.isFinite(state.scrollTop) && state.scrollTop > 0
			? state.scrollTop
			: 0,
		focusPath: state.focusPath !== null && valid.has(state.focusPath)
			? state.focusPath
			: null,
	};
}

export function setPathExpanded(
	paths: readonly string[],
	path: string,
	expanded: boolean,
): string[] {
	const next = new Set(paths);
	if (expanded) next.add(path);
	else next.delete(path);
	return [...next].sort();
}

function collectDefaultExpandedPaths(
	node: AnnotatedTreeNode,
	depth: number,
	expandToDepth: number,
	expanded: string[],
): void {
	if (node.children.size > 0 && depth < expandToDepth) {
		expanded.push(node.fullPath);
	}
	for (const child of node.children.values()) {
		collectDefaultExpandedPaths(child, depth + 1, expandToDepth, expanded);
	}
}

function uniqueSorted(values: readonly string[]): string[] {
	return [...new Set(values)].sort();
}
