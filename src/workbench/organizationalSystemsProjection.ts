import type {
	DetectionOccurrence,
	DetectionOccurrenceEvidence,
	DetectionResult,
} from '../engine/detectPacks';
import {
	sortCandidatesByConflict,
	sortCandidatesByNoise,
	type CandidateRow,
} from '../engine/scanAndSnapPlan';
import type { MappingRule } from '../types/settings';
import type { CandidateSort } from './workbenchState';

const DEFAULT_RULE_GROUP = '__default__';

export const UNGROUPED_RULE_LAYER_LABEL = 'Ungrouped' as const;

export interface OrganizationalSystemsProjectionInput {
	/** Occurrence-native detection results. One card is produced per occurrence. */
	detectionResults: readonly DetectionResult[];
	/** Candidate rows retain their exact planner-supplied occurrence provenance. */
	candidates?: readonly CandidateRow[];
	/** Current installed rules. No provenance is added to or inferred onto these rules. */
	installedRules: readonly MappingRule[];
	/** Highest-precedence named rule group first. */
	groupPrecedence?: readonly string[];
	/** Candidate ordering is applied independently inside each occurrence group. */
	candidateSort?: CandidateSort;
}

export interface OrganizationalSystemCard {
	key: string;
	occurrenceKey: string;
	packId: string;
	packName: string;
	anchorPath: string;
	status: DetectionOccurrence['status'];
	score: number;
	evidenceCount: number;
	minEvidence: number;
	countBy: DetectionOccurrence['countBy'];
	evidence: DetectionOccurrenceEvidence[];
	memberPaths: string[];
	supportPaths: string[];
	missingRoles: string[];
	parentPackId?: string;
	parentOccurrenceKey?: string;
	scopedUnderMode?: DetectionOccurrence['scopedUnderMode'];
	suppressionReason?: DetectionOccurrence['suppressionReason'];
}

export interface ExactCandidateProvenance {
	certainty: 'exact';
	occurrenceKey: string;
	sourcePackId: string;
	sourcePackName: string;
	anchorPath: string;
}

export interface OccurrenceCandidateGroup {
	key: string;
	occurrenceKey: string;
	provenance: ExactCandidateProvenance;
	rows: CandidateRow[];
}

export interface InferredRuleLayerAssociation {
	certainty: 'inferred';
	occurrenceKeys: string[];
}

export interface UnknownRuleLayerAssociation {
	certainty: 'unknown';
	occurrenceKeys: [];
	reason: 'no-durable-provenance';
}

export type RuleLayerAssociation =
	| InferredRuleLayerAssociation
	| UnknownRuleLayerAssociation;

export interface RuleLayer {
	key: string;
	/** null means the runtime fallback group (`__default__`). */
	group: string | null;
	label: string;
	/** Index in groupPrecedence, or null for an unlisted/fallback layer. */
	precedenceIndex: number | null;
	rules: MappingRule[];
	/** Association only: never ownership. */
	association: RuleLayerAssociation;
}

export interface ScopedUnderRelation {
	kind: 'scoped-under';
	certainty: 'exact';
	childOccurrenceKey: string;
	parentOccurrenceKey: string;
}

export interface CandidateSourceRelation {
	kind: 'candidate-source';
	certainty: 'exact';
	occurrenceKey: string;
	candidateGroupKey: string;
	sourcePackId: string;
	anchorPath: string;
}

export interface InferredInstalledAssociationRelation {
	kind: 'installed-association';
	certainty: 'inferred';
	occurrenceKey: string;
	ruleLayerKey: string;
	basis: 'shared-rule-group' | 'group-matches-pack-id';
}

export interface UnknownInstalledAssociationRelation {
	kind: 'installed-association';
	certainty: 'unknown';
	occurrenceKey: null;
	ruleLayerKey: string;
	basis: 'no-durable-provenance';
}

export type OrganizationalSystemRelation =
	| ScopedUnderRelation
	| CandidateSourceRelation
	| InferredInstalledAssociationRelation
	| UnknownInstalledAssociationRelation;

export interface OrganizationalSystemsProjection {
	cards: OrganizationalSystemCard[];
	candidateGroups: OccurrenceCandidateGroup[];
	ruleLayers: RuleLayer[];
	relations: OrganizationalSystemRelation[];
}

/**
 * Build the read-only Organizational systems deck model.
 *
 * Candidate-to-occurrence provenance comes directly from CandidateRow and is
 * exact. Installed rules do not carry durable pack/deployment provenance, so a
 * rule layer can only be associated by a shared group name (inferred) or left
 * visibly unknown. The projection never claims that a system occurrence owns
 * an installed rule.
 */
export function buildOrganizationalSystemsProjection(
	input: OrganizationalSystemsProjectionInput,
): OrganizationalSystemsProjection {
	const cards = buildCards(input.detectionResults);
	const candidateGroups = buildCandidateGroups(
		input.candidates ?? [],
		input.candidateSort ?? 'noise',
		cards,
	);
	const relations: OrganizationalSystemRelation[] = [];

	for (const card of cards) {
		if (card.parentOccurrenceKey) {
			relations.push({
				kind: 'scoped-under',
				certainty: 'exact',
				childOccurrenceKey: card.occurrenceKey,
				parentOccurrenceKey: card.parentOccurrenceKey,
			});
		}
	}

	for (const group of candidateGroups) {
		relations.push({
			kind: 'candidate-source',
			certainty: 'exact',
			occurrenceKey: group.occurrenceKey,
			candidateGroupKey: group.key,
			sourcePackId: group.provenance.sourcePackId,
			anchorPath: group.provenance.anchorPath,
		});
	}

	const ruleLayers = buildRuleLayers(
		input.installedRules,
		input.groupPrecedence ?? [],
		cards,
		candidateGroups,
		relations,
	);

	return { cards, candidateGroups, ruleLayers, relations };
}

/** Backwards-friendly projection verb for callers that do not use builder naming. */
export const projectOrganizationalSystems = buildOrganizationalSystemsProjection;

function buildCards(results: readonly DetectionResult[]): OrganizationalSystemCard[] {
	const cardsByOccurrence = new Map<string, OrganizationalSystemCard>();
	for (const result of results) {
		for (const occurrence of result.occurrences ?? []) {
			if (cardsByOccurrence.has(occurrence.key)) continue;
			cardsByOccurrence.set(occurrence.key, cardFromOccurrence(occurrence));
		}
	}
	return [...cardsByOccurrence.values()].sort(compareCards);
}

function cardFromOccurrence(occurrence: DetectionOccurrence): OrganizationalSystemCard {
	return {
		key: `system-card:${occurrence.key}`,
		occurrenceKey: occurrence.key,
		packId: occurrence.packId,
		packName: occurrence.packName,
		anchorPath: occurrence.anchorPath,
		status: occurrence.status,
		score: occurrence.score,
		evidenceCount: occurrence.evidenceCount,
		minEvidence: occurrence.minEvidence,
		countBy: occurrence.countBy,
		evidence: occurrence.evidence.map((evidence) => ({ ...evidence })),
		memberPaths: [...occurrence.memberPaths],
		supportPaths: [...occurrence.supportPaths],
		missingRoles: [...occurrence.missingRoles],
		...(occurrence.parentPackId ? { parentPackId: occurrence.parentPackId } : {}),
		...(occurrence.parentOccurrenceKey
			? { parentOccurrenceKey: occurrence.parentOccurrenceKey }
			: {}),
		...(occurrence.scopedUnderMode
			? { scopedUnderMode: occurrence.scopedUnderMode }
			: {}),
		...(occurrence.suppressionReason
			? { suppressionReason: occurrence.suppressionReason }
			: {}),
	};
}

function buildCandidateGroups(
	candidates: readonly CandidateRow[],
	sort: CandidateSort,
	cards: readonly OrganizationalSystemCard[],
): OccurrenceCandidateGroup[] {
	const rowsByOccurrence = new Map<string, CandidateRow[]>();
	for (const candidate of candidates) {
		const rows = rowsByOccurrence.get(candidate.occurrenceKey);
		if (rows) rows.push(candidate);
		else rowsByOccurrence.set(candidate.occurrenceKey, [candidate]);
	}

	const cardOrder = new Map(cards.map((card, index) => [card.occurrenceKey, index] as const));
	const groups = [...rowsByOccurrence.entries()].map(([occurrenceKey, rows]) => {
		const sortedRows = sort === 'conflict'
			? sortCandidatesByConflict(rows)
			: sortCandidatesByNoise(rows);
		const first = sortedRows[0];
		return {
			key: candidateGroupKey(occurrenceKey),
			occurrenceKey,
			provenance: {
				certainty: 'exact' as const,
				occurrenceKey,
				sourcePackId: first.sourcePackId,
				sourcePackName: first.sourcePackName,
				anchorPath: first.anchorPath,
			},
			rows: sortedRows,
		};
	});

	return groups.sort((a, b) => {
		const aOrder = cardOrder.get(a.occurrenceKey);
		const bOrder = cardOrder.get(b.occurrenceKey);
		if (aOrder !== undefined || bOrder !== undefined) {
			if (aOrder === undefined) return 1;
			if (bOrder === undefined) return -1;
			if (aOrder !== bOrder) return aOrder - bOrder;
		}
		const anchorDiff = comparePaths(a.provenance.anchorPath, b.provenance.anchorPath);
		if (anchorDiff !== 0) return anchorDiff;
		const packDiff = compareCodePoints(a.provenance.sourcePackId, b.provenance.sourcePackId);
		return packDiff !== 0 ? packDiff : compareCodePoints(a.occurrenceKey, b.occurrenceKey);
	});
}

function buildRuleLayers(
	installedRules: readonly MappingRule[],
	groupPrecedence: readonly string[],
	cards: readonly OrganizationalSystemCard[],
	candidateGroups: readonly OccurrenceCandidateGroup[],
	relations: OrganizationalSystemRelation[],
): RuleLayer[] {
	const rulesByGroup = new Map<string, MappingRule[]>();
	for (const rule of installedRules) {
		const runtimeGroup = rule.group ?? DEFAULT_RULE_GROUP;
		const rules = rulesByGroup.get(runtimeGroup);
		if (rules) rules.push(rule);
		else rulesByGroup.set(runtimeGroup, [rule]);
	}

	const explicitRanks = new Map<string, number>();
	for (const group of groupPrecedence) {
		if (group === DEFAULT_RULE_GROUP || explicitRanks.has(group)) continue;
		explicitRanks.set(group, explicitRanks.size);
	}

	const candidateOccurrencesByGroup = new Map<string, Set<string>>();
	for (const candidateGroup of candidateGroups) {
		for (const row of candidateGroup.rows) {
			const runtimeGroup = row.rule.group ?? DEFAULT_RULE_GROUP;
			if (runtimeGroup === DEFAULT_RULE_GROUP) continue;
			let occurrenceKeys = candidateOccurrencesByGroup.get(runtimeGroup);
			if (!occurrenceKeys) {
				occurrenceKeys = new Set<string>();
				candidateOccurrencesByGroup.set(runtimeGroup, occurrenceKeys);
			}
			occurrenceKeys.add(candidateGroup.occurrenceKey);
		}
	}

	const layers = [...rulesByGroup.entries()].map(([runtimeGroup, rules]) => {
		const group = runtimeGroup === DEFAULT_RULE_GROUP ? null : runtimeGroup;
		const key = ruleLayerKey(runtimeGroup);
		const inferredBasisByOccurrence = new Map<
			string,
			InferredInstalledAssociationRelation['basis']
		>();

		if (group !== null) {
			for (const occurrenceKey of candidateOccurrencesByGroup.get(group) ?? []) {
				inferredBasisByOccurrence.set(occurrenceKey, 'shared-rule-group');
			}
			for (const card of cards) {
				if (card.packId === group && !inferredBasisByOccurrence.has(card.occurrenceKey)) {
					inferredBasisByOccurrence.set(card.occurrenceKey, 'group-matches-pack-id');
				}
			}
		}

		const occurrenceKeys = [...inferredBasisByOccurrence.keys()].sort(compareCodePoints);
		const association: RuleLayerAssociation = occurrenceKeys.length > 0
			? { certainty: 'inferred', occurrenceKeys }
			: {
				certainty: 'unknown',
				occurrenceKeys: [],
				reason: 'no-durable-provenance',
			};

		if (association.certainty === 'inferred') {
			for (const occurrenceKey of occurrenceKeys) {
				relations.push({
					kind: 'installed-association',
					certainty: 'inferred',
					occurrenceKey,
					ruleLayerKey: key,
					basis: inferredBasisByOccurrence.get(occurrenceKey)!,
				});
			}
		} else {
			relations.push({
				kind: 'installed-association',
				certainty: 'unknown',
				occurrenceKey: null,
				ruleLayerKey: key,
				basis: 'no-durable-provenance',
			});
		}

		return {
			key,
			group,
			label: group ?? UNGROUPED_RULE_LAYER_LABEL,
			precedenceIndex: group === null ? null : explicitRanks.get(group) ?? null,
			rules: [...rules].sort(compareRules),
			association,
		};
	});

	return layers.sort((a, b) => {
		if (a.group === null || b.group === null) {
			if (a.group === null && b.group === null) return 0;
			return a.group === null ? 1 : -1;
		}
		if (a.precedenceIndex !== null || b.precedenceIndex !== null) {
			if (a.precedenceIndex === null) return 1;
			if (b.precedenceIndex === null) return -1;
			if (a.precedenceIndex !== b.precedenceIndex) {
				return a.precedenceIndex - b.precedenceIndex;
			}
		}
		return compareCodePoints(a.group, b.group);
	});
}

function candidateGroupKey(occurrenceKey: string): string {
	return `candidate-group:${encodeKeyPart(occurrenceKey)}`;
}

function ruleLayerKey(runtimeGroup: string): string {
	return `rule-layer:${encodeKeyPart(runtimeGroup)}`;
}

function encodeKeyPart(value: string): string {
	return `${value.length}:${value}`;
}

function compareCards(a: OrganizationalSystemCard, b: OrganizationalSystemCard): number {
	const anchorDiff = comparePaths(a.anchorPath, b.anchorPath);
	if (anchorDiff !== 0) return anchorDiff;
	const packNameDiff = compareCodePoints(a.packName, b.packName);
	if (packNameDiff !== 0) return packNameDiff;
	const packIdDiff = compareCodePoints(a.packId, b.packId);
	return packIdDiff !== 0 ? packIdDiff : compareCodePoints(a.occurrenceKey, b.occurrenceKey);
}

function comparePaths(a: string, b: string): number {
	const depthDiff = pathDepth(a) - pathDepth(b);
	return depthDiff !== 0 ? depthDiff : compareCodePoints(a, b);
}

function pathDepth(path: string): number {
	return path === '' ? 0 : path.split('/').length;
}

function compareRules(a: MappingRule, b: MappingRule): number {
	if (a.priority !== b.priority) return a.priority - b.priority;
	const nameDiff = compareCodePoints(a.name, b.name);
	return nameDiff !== 0 ? nameDiff : compareCodePoints(a.id, b.id);
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
