/**
 * detectPacks — pure vault-shape detection for bundled organizational systems.
 *
 * Raw signal hits explain what matched. Detection occurrences decide whether a
 * local system instance is actionable, incomplete, or suppressed. The legacy
 * pack-level fields remain as compatibility summaries for existing consumers.
 */

import { matchesNormalized } from './folderNormalize';

export type DetectionEvidenceRelation = 'member' | 'support';
export type DetectionOccurrenceCountBy = 'roles' | 'folders';
export type DetectionOccurrenceStatus = 'actionable' | 'incomplete' | 'suppressed';
export type DetectionScopedUnderMode = 'local' | 'pack-global';
export type DetectionSuppressionReason = 'missing-local-parent';

export interface DetectionSignalResult {
	/** The signal definition that matched. */
	folderRegex: string;
	scope: 'name' | 'path' | 'leafName';
	label?: string;
	/** Stable semantic role shared by alternative regex definitions. */
	role?: string;
	/** How this signal participates in an occurrence. Default: member. */
	relation?: DetectionEvidenceRelation;
	/** Vault folders that matched this signal (capped to first 3 for display). */
	exampleMatches: string[];
}

/** One uncapped signal-folder match retained for occurrence extraction and UI evidence. */
export interface DetectionOccurrenceEvidence {
	folderPath: string;
	signalIndex: number;
	/** Stable identity of this signal definition inside its pack. */
	signalId: string;
	folderRegex: string;
	scope: 'name' | 'path' | 'leafName';
	label?: string;
	/** Explicit role, or a stable signal-index fallback when no role was declared. */
	role: string;
	relation: DetectionEvidenceRelation;
}

export interface DetectionOccurrence {
	/** Collision-safe identity derived only from pack id + normalized anchor path. */
	key: string;
	packId: string;
	packName: string;
	/** Common parent of member evidence. Empty string means vault root. */
	anchorPath: string;
	status: DetectionOccurrenceStatus;
	score: number;
	evidenceCount: number;
	minEvidence: number;
	countBy: DetectionOccurrenceCountBy;
	/** Complete, uncapped evidence attached to this occurrence. */
	evidence: DetectionOccurrenceEvidence[];
	memberPaths: string[];
	supportPaths: string[];
	/** Member roles declared by the pack but absent from this local occurrence. */
	missingRoles: string[];
	/** Present when this pack declares scopedUnder. */
	parentPackId?: string;
	/** Nearest actionable local parent occurrence, when local scoping succeeds. */
	parentOccurrenceKey?: string;
	scopedUnderMode?: DetectionScopedUnderMode;
	suppressionReason?: DetectionSuppressionReason;
}

export interface DetectionResult {
	packId: string;
	/** Strongest local occurrence score. Legacy hand-built values keep old semantics. */
	score: number;
	/** Compatibility diagnostic: distinct signal definitions hit anywhere in the vault. */
	signalsHit: number;
	/** Compatibility threshold retained from detection.minSignals. */
	minSignals: number;
	matchedSignals: DetectionSignalResult[];
	/** Complete uncapped evidence, including unattached support evidence. */
	rawEvidence?: DetectionOccurrenceEvidence[];
	/** Authoritative local actionability. Optional for hand-built/legacy values. */
	occurrences?: DetectionOccurrence[];
	/** When pack is scopedUnder another, the parent's id. */
	scopedUnder?: string;
	/** Compatibility summary: true only when every local occurrence is suppressed. */
	suppressedByMissingParent?: boolean;
}

/** Explicit occurrence buckets. A pack may contribute to more than one bucket. */
export interface DetectionOccurrencePartition {
	actionable: DetectionOccurrence[];
	incomplete: DetectionOccurrence[];
	suppressed: DetectionOccurrence[];
}

/**
 * Explicit pack-summary buckets for compatibility consumers. Occurrence-aware
 * consumers should prefer partitionDetectionOccurrences because one pack may
 * simultaneously have actionable, incomplete, and suppressed occurrences.
 */
export interface DetectionResultPartition {
	/** At least one actionable occurrence, or a surfaced legacy result. */
	surfaced: DetectionResult[];
	/** Alias of surfaced for planner call sites that speak in actionability. */
	actionable: DetectionResult[];
	/** No actionable/suppressed occurrence, or a below-threshold legacy result. */
	belowThreshold: DetectionResult[];
	/** No actionable occurrence and at least one suppressed occurrence. */
	suppressed: DetectionResult[];
}

/** Backwards-friendly shorter name for the same partition shape. */
export type DetectionPartition = DetectionResultPartition;

/** Stable, collision-safe identity for one pack occurrence. */
export function detectionOccurrenceKey(packId: string, anchorPath: string): string {
	return `occurrence:${encodeKeyPart(packId)}:${encodeKeyPart(normalizePath(anchorPath))}`;
}

/**
 * True when a result may authorize actions. New occurrence data is
 * authoritative; hand-built legacy values without occurrences retain the old
 * score/suppression interpretation.
 */
export function isSurfacedDetection(result: DetectionResult): boolean {
	if (result.occurrences !== undefined) {
		return result.occurrences.some((occurrence) => occurrence.status === 'actionable');
	}
	return result.score >= 1 && !result.suppressedByMissingParent;
}

/** Partition every occurrence from every result while preserving input order. */
export function partitionDetectionOccurrences(
	results: readonly DetectionResult[],
): DetectionOccurrencePartition {
	const actionable: DetectionOccurrence[] = [];
	const incomplete: DetectionOccurrence[] = [];
	const suppressed: DetectionOccurrence[] = [];

	for (const result of results) {
		for (const occurrence of result.occurrences ?? []) {
			if (occurrence.status === 'actionable') actionable.push(occurrence);
			else if (occurrence.status === 'suppressed') suppressed.push(occurrence);
			else incomplete.push(occurrence);
		}
	}

	return { actionable, incomplete, suppressed };
}

/** Partition pack summaries without re-scoring or mutating them. */
export function partitionDetectionResults(
	results: DetectionResult[],
): DetectionResultPartition {
	const surfaced: DetectionResult[] = [];
	const belowThreshold: DetectionResult[] = [];
	const suppressed: DetectionResult[] = [];

	for (const result of results) {
		if (result.occurrences !== undefined) {
			if (result.occurrences.some((occurrence) => occurrence.status === 'actionable')) {
				surfaced.push(result);
			} else if (result.occurrences.some((occurrence) => occurrence.status === 'suppressed')) {
				suppressed.push(result);
			} else {
				belowThreshold.push(result);
			}
		} else if (result.suppressedByMissingParent) {
			suppressed.push(result);
		} else if (result.score >= 1) {
			surfaced.push(result);
		} else {
			belowThreshold.push(result);
		}
	}

	return {
		surfaced,
		actionable: surfaced,
		belowThreshold,
		suppressed,
	};
}

// Manifest entry shape — minimal subset of what the manifest builder emits.
// Defined locally so the detector stays decoupled from the build artifact.
export interface ManifestPackEntry {
	id: string;
	name: string;
	axes?: string[];
	detection?: {
		anyOf: Array<{
			folderRegex: string;
			scope?: 'name' | 'path' | 'leafName';
			label?: string;
			relation?: DetectionEvidenceRelation;
			role?: string;
		}>;
		minSignals?: number;
		occurrence?: {
			countBy?: DetectionOccurrenceCountBy;
			minEvidence?: number;
		};
		scopedUnder?: string | null;
		scopedUnderMode?: DetectionScopedUnderMode;
	} | null;
}

const MAX_EXAMPLES = 3;

interface PackDetectionConfig {
	anyOf: NonNullable<NonNullable<ManifestPackEntry['detection']>['anyOf']>;
	minSignals?: number;
	occurrence?: {
		countBy?: DetectionOccurrenceCountBy;
		minEvidence?: number;
	};
	scopedUnder?: string | null;
	scopedUnderMode?: DetectionScopedUnderMode;
}

interface ScoredPack {
	result: DetectionResult;
	detection: PackDetectionConfig;
	/** Former global score, used only by the explicit pack-global escape hatch. */
	legacyGlobalScore: number;
}

interface MutableOccurrence extends DetectionOccurrence {
	/** Local evidence status before scopedUnder resolution. */
	localStatus: 'actionable' | 'incomplete';
}

/**
 * Score every pack against the vault and extract local occurrences. Results are
 * sorted with surfaced packs first, then by strongest local score descending.
 */
export function detectPacks(
	folderPaths: string[],
	manifest: ManifestPackEntry[],
): DetectionResult[] {
	const folders = folderPaths.map((path) => ({ path, leaf: leafOf(path) }));
	const scoredPacks: ScoredPack[] = [];

	for (const pack of manifest) {
		const detection = pack.detection;
		if (!detection || !detection.anyOf?.length) continue;

		const minSignals = positiveInteger(detection.minSignals, 1);
		const matchedSignals: DetectionSignalResult[] = [];
		const rawEvidence: DetectionOccurrenceEvidence[] = [];

		for (let signalIndex = 0; signalIndex < detection.anyOf.length; signalIndex++) {
			const signal = detection.anyOf[signalIndex];
			let regex: RegExp;
			try {
				regex = new RegExp(signal.folderRegex, 'i');
			} catch {
				continue; // loader/build validation normally catches this
			}

			const scope = signal.scope ?? 'name';
			const relation: DetectionEvidenceRelation = signal.relation === 'support'
				? 'support'
				: 'member';
			const role = resolvedRole(signal.role, signalIndex);
			const signalId = `signal:${signalIndex}`;
			const examples: string[] = [];

			for (const folder of folders) {
				const target = scope === 'path' ? folder.path : folder.leaf;
				if (!matchesNormalized(regex, target)) continue;
				if (examples.length < MAX_EXAMPLES) examples.push(folder.path);
				rawEvidence.push({
					folderPath: folder.path,
					signalIndex,
					signalId,
					folderRegex: signal.folderRegex,
					scope,
					label: signal.label,
					role,
					relation,
				});
			}

			if (examples.length > 0) {
				matchedSignals.push({
					folderRegex: signal.folderRegex,
					scope,
					label: signal.label,
					role: signal.role,
					relation,
					exampleMatches: examples,
				});
			}
		}

		if (matchedSignals.length === 0) continue;

		const countBy: DetectionOccurrenceCountBy = detection.occurrence?.countBy === 'folders'
			? 'folders'
			: 'roles';
		const minEvidence = positiveInteger(detection.occurrence?.minEvidence, minSignals);
		const occurrences = buildOccurrences(
			pack,
			detection,
			rawEvidence,
			countBy,
			minEvidence,
		);
		const strongestScore = occurrences.reduce(
			(maximum, occurrence) => Math.max(maximum, occurrence.score),
			0,
		);

		const result: DetectionResult = {
			packId: pack.id,
			score: strongestScore,
			signalsHit: matchedSignals.length,
			minSignals,
			matchedSignals,
			rawEvidence,
			occurrences,
			scopedUnder: detection.scopedUnder ?? undefined,
		};
		scoredPacks.push({
			result,
			detection,
			legacyGlobalScore: matchedSignals.length / minSignals,
		});
	}

	resolveScopedUnder(scoredPacks);

	for (const { result } of scoredPacks) {
		const occurrences = result.occurrences ?? [];
		result.suppressedByMissingParent = occurrences.length > 0
			&& occurrences.every((occurrence) => occurrence.status === 'suppressed')
				? true
				: undefined;
	}

	const results = scoredPacks.map(({ result }) => result);
	results.sort((a, b) => {
		const aSurfacing = isSurfacedDetection(a) ? 1 : 0;
		const bSurfacing = isSurfacedDetection(b) ? 1 : 0;
		if (aSurfacing !== bSurfacing) return bSurfacing - aSurfacing;
		return b.score - a.score;
	});
	return results;
}

function buildOccurrences(
	pack: ManifestPackEntry,
	detection: PackDetectionConfig,
	rawEvidence: DetectionOccurrenceEvidence[],
	countBy: DetectionOccurrenceCountBy,
	minEvidence: number,
): DetectionOccurrence[] {
	const declaredRoles = uniqueSorted(
		detection.anyOf
			.map((signal, index) => resolvedRole(signal.role, index)),
	);
	const byAnchor = new Map<string, MutableOccurrence>();

	for (const evidence of rawEvidence) {
		if (evidence.relation !== 'member') continue;
		const anchorPath = parentPath(evidence.folderPath);
		let occurrence = byAnchor.get(anchorPath);
		if (!occurrence) {
			occurrence = {
				key: detectionOccurrenceKey(pack.id, anchorPath),
				packId: pack.id,
				packName: pack.name,
				anchorPath,
				status: 'incomplete',
				localStatus: 'incomplete',
				score: 0,
				evidenceCount: 0,
				minEvidence,
				countBy,
				evidence: [],
				memberPaths: [],
				supportPaths: [],
				missingRoles: [],
			};
			byAnchor.set(anchorPath, occurrence);
		}
		occurrence.evidence.push(evidence);
	}

	for (const support of rawEvidence) {
		if (support.relation !== 'support') continue;
		const occurrence = nearestSupportOccurrence([...byAnchor.values()], support.folderPath);
		if (occurrence) occurrence.evidence.push(support);
	}

	for (const occurrence of byAnchor.values()) {
		const memberEvidence = occurrence.evidence.filter((evidence) => evidence.relation === 'member');
		const presentRoles = new Set(occurrence.evidence.map((evidence) => evidence.role));
		occurrence.memberPaths = uniqueSorted(memberEvidence.map((evidence) => evidence.folderPath));
		occurrence.supportPaths = uniqueSorted(
			occurrence.evidence
				.filter((evidence) => evidence.relation === 'support')
				.map((evidence) => evidence.folderPath),
		);
		occurrence.evidenceCount = countBy === 'folders'
			? uniqueSorted(occurrence.evidence.map((evidence) => evidence.folderPath)).length
			: presentRoles.size;
		occurrence.score = occurrence.evidenceCount / minEvidence;
		occurrence.localStatus = occurrence.score >= 1 ? 'actionable' : 'incomplete';
		occurrence.status = occurrence.localStatus;
		occurrence.missingRoles = declaredRoles.filter((role) => !presentRoles.has(role));
		occurrence.evidence.sort(compareEvidence);
	}

	return [...byAnchor.values()]
		.sort(compareOccurrences)
		.map(({ localStatus: _localStatus, ...occurrence }) => occurrence);
}

function nearestSupportOccurrence(
	occurrences: MutableOccurrence[],
	supportPath: string,
): MutableOccurrence | undefined {
	let best: MutableOccurrence | undefined;
	let bestRelationDepth = -1;
	let bestAnchorDepth = -1;

	for (const occurrence of occurrences) {
		const memberDepths = occurrence.evidence
			.filter((evidence) => evidence.relation === 'member')
			.filter((evidence) => isAncestorOrEqual(evidence.folderPath, supportPath))
			.map((evidence) => pathDepth(evidence.folderPath));
		const relationDepth = memberDepths.length > 0
			? Math.max(...memberDepths)
			: isAncestorOrEqual(occurrence.anchorPath, supportPath)
				? pathDepth(occurrence.anchorPath)
				: -1;
		if (relationDepth < 0) continue;

		const anchorDepth = pathDepth(occurrence.anchorPath);
		if (
			relationDepth > bestRelationDepth
			|| (relationDepth === bestRelationDepth && anchorDepth > bestAnchorDepth)
			|| (relationDepth === bestRelationDepth
				&& anchorDepth === bestAnchorDepth
				&& best !== undefined
				&& occurrence.key < best.key)
		) {
			best = occurrence;
			bestRelationDepth = relationDepth;
			bestAnchorDepth = anchorDepth;
		}
	}
	return best;
}

function resolveScopedUnder(scoredPacks: ScoredPack[]): void {
	const byPackId = new Map(scoredPacks.map((pack) => [pack.result.packId, pack] as const));
	const resolved = new Set<string>();
	const resolving = new Set<string>();

	const resolveOccurrence = (pack: ScoredPack, occurrence: DetectionOccurrence): void => {
		if (resolved.has(occurrence.key)) return;
		if (resolving.has(occurrence.key)) {
			occurrence.status = 'suppressed';
			occurrence.suppressionReason = 'missing-local-parent';
			resolved.add(occurrence.key);
			return;
		}
		resolving.add(occurrence.key);

		const parentPackId = pack.detection.scopedUnder ?? undefined;
		if (parentPackId) {
			const mode: DetectionScopedUnderMode = pack.detection.scopedUnderMode === 'pack-global'
				? 'pack-global'
				: 'local';
			occurrence.parentPackId = parentPackId;
			occurrence.scopedUnderMode = mode;
			const parentPack = byPackId.get(parentPackId);

			if (mode === 'pack-global') {
				if (!parentPack || parentPack.legacyGlobalScore < 1) {
					occurrence.status = 'suppressed';
					occurrence.suppressionReason = 'missing-local-parent';
				}
			} else {
				for (const parentOccurrence of parentPack?.result.occurrences ?? []) {
					resolveOccurrence(parentPack!, parentOccurrence);
				}
				const parentOccurrence = nearestLocalParent(
					parentPack?.result.occurrences ?? [],
					occurrence.anchorPath,
				);
				if (parentOccurrence) {
					occurrence.parentOccurrenceKey = parentOccurrence.key;
				} else {
					occurrence.status = 'suppressed';
					occurrence.suppressionReason = 'missing-local-parent';
				}
			}
		}

		resolving.delete(occurrence.key);
		resolved.add(occurrence.key);
	};

	for (const pack of scoredPacks) {
		for (const occurrence of pack.result.occurrences ?? []) {
			resolveOccurrence(pack, occurrence);
		}
	}
}

function nearestLocalParent(
	parentOccurrences: DetectionOccurrence[],
	childAnchorPath: string,
): DetectionOccurrence | undefined {
	return parentOccurrences
		.filter((occurrence) => occurrence.status === 'actionable')
		.filter((occurrence) => isAncestorOrEqual(occurrence.anchorPath, childAnchorPath))
		.sort((a, b) => {
			const byDepth = pathDepth(b.anchorPath) - pathDepth(a.anchorPath);
			return byDepth !== 0 ? byDepth : compareCodePoints(a.key, b.key);
		})[0];
}

function compareOccurrences(a: DetectionOccurrence, b: DetectionOccurrence): number {
	const byDepth = pathDepth(a.anchorPath) - pathDepth(b.anchorPath);
	return byDepth !== 0 ? byDepth : compareCodePoints(a.anchorPath, b.anchorPath);
}

function compareEvidence(
	a: DetectionOccurrenceEvidence,
	b: DetectionOccurrenceEvidence,
): number {
	const byPath = compareCodePoints(a.folderPath, b.folderPath);
	return byPath !== 0 ? byPath : a.signalIndex - b.signalIndex;
}

function resolvedRole(role: string | undefined, signalIndex: number): string {
	return role && role.length > 0 ? role : `signal:${signalIndex}`;
}

function positiveInteger(value: number | undefined, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) && value > 0
		? Math.max(1, Math.floor(value))
		: fallback;
}

function encodeKeyPart(value: string): string {
	return `${value.length}:${value}`;
}

function normalizePath(path: string): string {
	return path.replace(/\\/g, '/').replace(/\/{2,}/g, '/').replace(/^\/+|\/+$/g, '');
}

function leafOf(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf('/');
	return index === -1 ? normalized : normalized.slice(index + 1);
}

function parentPath(path: string): string {
	const normalized = normalizePath(path);
	const index = normalized.lastIndexOf('/');
	return index === -1 ? '' : normalized.slice(0, index);
}

function isAncestorOrEqual(ancestor: string, path: string): boolean {
	const normalizedAncestor = normalizePath(ancestor);
	const normalizedPath = normalizePath(path);
	return normalizedAncestor === ''
		|| normalizedPath === normalizedAncestor
		|| normalizedPath.startsWith(`${normalizedAncestor}/`);
}

function pathDepth(path: string): number {
	const normalized = normalizePath(path);
	return normalized === '' ? 0 : normalized.split('/').length;
}

function uniqueSorted(values: string[]): string[] {
	return [...new Set(values)].sort(compareCodePoints);
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

/** After detection, identify occurrence-local conflicts declared by exclusiveWith. */
export interface ExclusivityConflict {
	packA: string;
	packB: string;
	/** Present for occurrence-native conflicts; omitted by the legacy pack adapter. */
	anchorPath?: string;
	occurrenceAKey?: string;
	occurrenceBKey?: string;
}

export function findExclusivityConflicts(
	results: DetectionResult[],
	manifest: ManifestPackEntry[],
): ExclusivityConflict[] {
	const resultByPackId = new Map(results.map((result) => [result.packId, result] as const));
	const conflicts: ExclusivityConflict[] = [];
	const seenPairs = new Set<string>();

	for (const pack of manifest) {
		const exclusions = (pack as ManifestPackEntry & { exclusiveWith?: string[] }).exclusiveWith;
		for (const excludedPackId of exclusions ?? []) {
			const pairKey = [pack.id, excludedPackId].sort(compareCodePoints).join('|');
			if (seenPairs.has(pairKey)) continue;
			seenPairs.add(pairKey);

			const resultA = resultByPackId.get(pack.id);
			const resultB = resultByPackId.get(excludedPackId);
			if (!resultA || !resultB) continue;

			if (resultA.occurrences !== undefined && resultB.occurrences !== undefined) {
				const actionableA = resultA.occurrences.filter(
					(occurrence) => occurrence.status === 'actionable',
				);
				const actionableB = resultB.occurrences.filter(
					(occurrence) => occurrence.status === 'actionable',
				);
				for (const occurrenceA of actionableA) {
					for (const occurrenceB of actionableB) {
						if (occurrenceA.anchorPath !== occurrenceB.anchorPath) continue;
						conflicts.push({
							packA: pack.id,
							packB: excludedPackId,
							anchorPath: occurrenceA.anchorPath,
							occurrenceAKey: occurrenceA.key,
							occurrenceBKey: occurrenceB.key,
						});
					}
				}
				continue;
			}

			// Hand-built legacy values have no local occurrence identity, so preserve
			// the historical pack-level conflict adapter.
			if (isSurfacedDetection(resultA) && isSurfacedDetection(resultB)) {
				conflicts.push({ packA: pack.id, packB: excludedPackId });
			}
		}
	}
	return conflicts;
}
