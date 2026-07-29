import type { AnnotatedHit, CrossPackHitMap } from './detectionTree';
import { detectionOccurrenceKey } from './detectPacks';
import { minimalScopeCover } from './scopeRules';

/** One actionable occurrence resolved to a concrete pack deployment. */
export interface ScopePackDeployment {
	packId: string;
	/** Stable occurrence identity retained through candidate production. */
	occurrenceKey: string;
	/** Relative vault path. Empty string means the vault root. */
	anchorPath: string;
}

/** Compatibility input: older explicit callers may omit occurrence identity. */
export interface ScopePackPlacement {
	packId: string;
	occurrenceKey?: string;
	anchorPath: string;
}

export interface ScopePackPlacementInput {
	placements: ScopePackPlacement[];
}

export interface ScopeSelectionPlanInput {
	/** User-selected relative vault paths. Empty string means the vault root. */
	selectedPaths: readonly string[];
	/** Actionable detection hits. `hitsByPath` is accepted as a legacy adapter. */
	hitMap: Pick<CrossPackHitMap, 'hitsByPath'>
		& Partial<Pick<CrossPackHitMap, 'actionableHitsByPath'>>;
}

export interface ScopePackPlan {
	/** Minimal non-overlapping user scopes in deterministic order. */
	scopePaths: string[];
	/** One deployment per detected pack instance found at-or-under each scope. */
	deployments: ScopePackDeployment[];
}

/**
 * Build a deterministic deployment plan from either explicit placements or a
 * Workbench folder selection.
 *
 * Selection planning first reduces overlapping paths with `minimalScopeCover`,
 * then includes every detected pack INSTANCE with a surfaced hit at-or-under
 * each surviving scope. A deployment is anchored at the hit cluster's shared
 * parent, not at the selected signal folder: selecting the direct `Projects`
 * PARA hit must install PARA at root rather than produce `Projects/Projects`.
 * Root (`''`) includes every surfaced instance in the vault.
 *
 * Explicit placements are already-resolved instance anchors. Planning removes
 * exact duplicates but preserves ancestor/descendant placements for the same
 * pack because root-anchored pack patterns do not cover a separately nested
 * instance of that pack.
 */
export function buildScopePackPlan(
	input: ScopePackPlacementInput | ScopeSelectionPlanInput | ScopePackPlacement[],
): ScopePackPlan {
	if (Array.isArray(input)) return planExplicitPlacements(input);
	if ('selectedPaths' in input) return planSelection(input);
	return planExplicitPlacements(input.placements);
}

function planSelection(input: ScopeSelectionPlanInput): ScopePackPlan {
	const scopePaths = minimalScopeCover([...new Set(input.selectedPaths)])
		.sort(compareScopePaths);
	const deploymentByKey = new Map<string, ScopePackDeployment>();
	const actionableHits = input.hitMap.actionableHitsByPath ?? input.hitMap.hitsByPath;

	for (const scopePath of scopePaths) {
		for (const [hitPath, hits] of actionableHits) {
			if (!isAtOrUnder(hitPath, scopePath)) continue;
			for (const hit of hits) {
				if (hit.occurrenceStatus && hit.occurrenceStatus !== 'actionable') continue;
				const deployment = deploymentFromHit(hit, hitPath);
				deploymentByKey.set(deploymentKey(deployment), deployment);
			}
		}
	}

	return {
		scopePaths,
		deployments: [...deploymentByKey.values()].sort(compareDeployments),
	};
}

function deploymentFromHit(hit: AnnotatedHit, hitPath: string): ScopePackDeployment {
	const anchorPath = hit.occurrenceAnchorPath ?? parentPath(hitPath);
	return {
		packId: hit.signal.packId,
		occurrenceKey: hit.occurrenceKey
			?? detectionOccurrenceKey(hit.signal.packId, anchorPath),
		anchorPath,
	};
}

function planExplicitPlacements(placements: ScopePackPlacement[]): ScopePackPlan {
	const deploymentByKey = new Map<string, ScopePackDeployment>();
	for (const placement of placements) {
		const normalized: ScopePackDeployment = {
			packId: placement.packId,
			occurrenceKey: placement.occurrenceKey
				?? detectionOccurrenceKey(placement.packId, placement.anchorPath),
			anchorPath: placement.anchorPath,
		};
		deploymentByKey.set(deploymentKey(normalized), normalized);
	}

	const deployments = [...deploymentByKey.values()].sort(compareDeployments);
	return {
		scopePaths: [...new Set(deployments.map((deployment) => deployment.anchorPath))]
			.sort(compareScopePaths),
		deployments,
	};
}

function deploymentKey(deployment: ScopePackDeployment): string {
	return deployment.occurrenceKey;
}

function compareDeployments(a: ScopePackDeployment, b: ScopePackDeployment): number {
	const byAnchor = compareScopePaths(a.anchorPath, b.anchorPath);
	if (byAnchor !== 0) return byAnchor;
	const byPack = compareCodePoints(a.packId, b.packId);
	return byPack !== 0 ? byPack : compareCodePoints(a.occurrenceKey, b.occurrenceKey);
}

function parentPath(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}

function isAtOrUnder(path: string, scope: string): boolean {
	return scope === '' || path === scope || path.startsWith(`${scope}/`);
}

function compareScopePaths(a: string, b: string): number {
	const depthA = pathDepth(a);
	const depthB = pathDepth(b);
	if (depthA !== depthB) return depthA - depthB;
	return compareCodePoints(a, b);
}

function pathDepth(path: string): number {
	return path === '' ? 0 : path.split('/').length;
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
