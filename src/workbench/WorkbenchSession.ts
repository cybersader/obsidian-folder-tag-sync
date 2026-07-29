import bundledManifest from '../../rule-packs/manifest.json';
import {
	detectPacks,
	findExclusivityConflicts,
	partitionDetectionOccurrences,
	partitionDetectionResults,
	type DetectionOccurrence,
	type DetectionResult,
	type ExclusivityConflict,
	type ManifestPackEntry,
} from '../engine/detectPacks';
import {
	collectCrossPackHits,
	type AnnotatedHit,
	type AnnotatedSignal,
	type CrossPackHitMap,
} from '../engine/detectionTree';
import {
	computeFolderRuleView,
	type FolderRuleEntry,
} from '../engine/folderRuleView';
import {
	buildScanAndSnapPlan,
	sortCandidatesByConflict,
	sortCandidatesByNoise,
	type ScanAndSnapPlan,
} from '../engine/scanAndSnapPlan';
import {
	buildScopePackPlan,
	type ScopePackPlan,
} from '../engine/scopePackPlan';
import type { DynamicTagsFoldersSettings, MappingRule } from '../types/settings';
import {
	collectVaultFolderPaths,
	type VaultFolderLike,
} from '../utils/vaultFolders';
import bundledRulePackRepository, {
	type BundledRulePackGetResult,
	type BundledRulePackRepositoryError,
} from './BundledRulePackRepository';
import {
	buildOrganizationalSystemsProjection,
	type OrganizationalSystemsProjection,
} from './organizationalSystemsProjection';
import {
	createDefaultWorkbenchState,
	reconcileWorkbenchState,
	resolveSelectedCandidateKeys,
	validateWorkbenchState,
	type WorkbenchState,
} from './workbenchState';

export const WORKBENCH_SESSION_CANCELLED_CODE = 'WORKBENCH_SESSION_CANCELLED' as const;

export class WorkbenchSessionCancelledError extends Error {
	readonly code = WORKBENCH_SESSION_CANCELLED_CODE;

	constructor() {
		super('Workbench session collection cancelled');
		this.name = 'WorkbenchSessionCancelledError';
	}
}

export function isWorkbenchSessionCancelledError(
	error: unknown,
): error is WorkbenchSessionCancelledError {
	return error instanceof WorkbenchSessionCancelledError
		|| (error instanceof Error
			&& (error as Error & { code?: string }).code === WORKBENCH_SESSION_CANCELLED_CODE);
}

export interface WorkbenchVaultLike {
	getRoot(): VaultFolderLike;
}

export interface WorkbenchAppLike {
	vault: WorkbenchVaultLike;
}

export interface WorkbenchManifestEntry extends ManifestPackEntry {
	exclusiveWith?: string[];
}

export interface WorkbenchManifest {
	packs: readonly WorkbenchManifestEntry[];
}

export interface WorkbenchRulePackRepository {
	get(id: string): BundledRulePackGetResult;
}

export interface WorkbenchSessionSettings {
	rules: MappingRule[];
	groupPrecedence?: string[];
}

export interface WorkbenchSessionInput {
	/** Pass either a root directly or an app-like wrapper; no Obsidian import is required. */
	root?: VaultFolderLike;
	app?: WorkbenchAppLike;
	settings: WorkbenchSessionSettings | DynamicTagsFoldersSettings;
	manifest?: WorkbenchManifest;
	repository?: WorkbenchRulePackRepository;
	/** Monotonic revision of the folder/settings inputs represented by this snapshot. */
	sourceRevision?: number;
}

export interface WorkbenchSessionCollectOptions {
	/** Number of folders evaluated by the installed-rule engine per UI yield. */
	chunkSize?: number;
	/** Test/UI seam. Defaults to a zero-delay timer. */
	yieldControl?: () => Promise<void>;
	/** A view generation can cancel a closed or superseded collection. */
	isCancelled?: () => boolean;
}

export interface WorkbenchOccurrenceStats {
	totalCount: number;
	actionableCount: number;
	incompleteCount: number;
	suppressedCount: number;
	visibleCount: number;
}

export interface WorkbenchAggregateStats {
	folderCount: number;
	detectionResultCount: number;
	surfacedPackCount: number;
	belowThresholdPackCount: number;
	suppressedPackCount: number;
	matchedFolderCount: number;
	matchedSignalCount: number;
	exclusivityConflictCount: number;
	installedRuleCount: number;
	enabledRuleCount: number;
	coveredFolderCount: number;
	installedConflictFolderCount: number;
	candidateCount: number;
	touchingCandidateCount: number;
	candidateConflictCount: number;
	candidateExistingCollisionCount: number;
}

export interface WorkbenchSessionSnapshot {
	state: WorkbenchState;
	/** Folder/settings generation represented by every derived value below. */
	sourceRevision: number;
	folderPaths: readonly string[];
	detectionResults: readonly DetectionResult[];
	surfacedResults: readonly DetectionResult[];
	belowThresholdResults: readonly DetectionResult[];
	suppressedResults: readonly DetectionResult[];
	occurrences: readonly DetectionOccurrence[];
	actionableOccurrences: readonly DetectionOccurrence[];
	incompleteOccurrences: readonly DetectionOccurrence[];
	suppressedOccurrences: readonly DetectionOccurrence[];
	occurrenceStats: WorkbenchOccurrenceStats;
	/** Actionable-only compatibility view. */
	hitMap: CrossPackHitMap;
	/** Direct aliases for presentation and action consumers. */
	allEvidenceHitsByPath: ReadonlyMap<string, readonly AnnotatedHit[]>;
	actionableHitsByPath: ReadonlyMap<string, readonly AnnotatedHit[]>;
	organizationalSystems: OrganizationalSystemsProjection;
	conflicts: readonly ExclusivityConflict[];
	packNamesById: ReadonlyMap<string, string>;
	folderRuleView: ReadonlyMap<string, FolderRuleEntry>;
	ruleNamesById: ReadonlyMap<string, string>;
	stats: WorkbenchAggregateStats;
	loadedPackErrors: readonly BundledRulePackRepositoryError[];
	/** Present only while the Candidates surface is active. */
	candidatePlan: ScanAndSnapPlan | null;
	/** Present only for scope-selection candidate planning. */
	candidateScopePlan: ScopePackPlan | null;
	/** Resolved selection: null state selects all current keys; [] selects none. */
	selectedCandidateKeys: readonly string[];
}

interface StableCollectionInput {
	root: VaultFolderLike;
	settings: WorkbenchSessionSettings;
	manifest: WorkbenchManifest;
	repository: WorkbenchRulePackRepository;
	state: WorkbenchState;
	sourceRevision: number;
}

/** Nonvisual owner of one coherent Workbench scan/planning generation. */
export class WorkbenchSession {
	private readonly input: WorkbenchSessionInput;

	constructor(input: WorkbenchSessionInput) {
		this.input = input;
	}

	collect(
		state: unknown = createDefaultWorkbenchState(),
		options: WorkbenchSessionCollectOptions = {},
	): Promise<WorkbenchSessionSnapshot> {
		return collectWorkbenchSessionSnapshot(this.input, state, options);
	}

	collectSnapshot(
		state: unknown = createDefaultWorkbenchState(),
		options: WorkbenchSessionCollectOptions = {},
	): Promise<WorkbenchSessionSnapshot> {
		return this.collect(state, options);
	}
}

export async function collectWorkbenchSessionSnapshot(
	input: WorkbenchSessionInput,
	state: unknown = createDefaultWorkbenchState(),
	options: WorkbenchSessionCollectOptions = {},
): Promise<WorkbenchSessionSnapshot> {
	const stable = stabilizeInput(input, state);
	const chunkSize = normalizeChunkSize(options.chunkSize);
	const yieldControl = options.yieldControl
		?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));

	throwIfCancelled(options);
	const folderPaths = collectVaultFolderPaths(stable.root);
	const detectionResults = detectPacks(folderPaths, [...stable.manifest.packs]);
	const partition = partitionDetectionResults(detectionResults);
	const occurrencePartition = partitionDetectionOccurrences(detectionResults);
	const occurrences = detectionResults.flatMap((result) => result.occurrences ?? []);
	const packNamesById = new Map(
		stable.manifest.packs.map((pack) => [pack.id, pack.name] as const),
	);
	const hitMap = collectCrossPackHits(folderPaths, detectionResults, packNamesById);
	const conflicts = findExclusivityConflicts(detectionResults, [...stable.manifest.packs]);

	await yieldAndCheck(yieldControl, options);
	const folderRuleView = await computeFolderRuleViewAsync(
		folderPaths,
		stable.settings.rules,
		stable.settings.groupPrecedence,
		chunkSize,
		yieldControl,
		options,
	);
	const ruleNamesById = new Map(
		stable.settings.rules.map((rule) => [rule.id, rule.name] as const),
	);
	const deckWithoutCandidates = buildOrganizationalSystemsProjection({
		detectionResults,
		installedRules: stable.settings.rules,
		groupPrecedence: stable.settings.groupPrecedence,
		candidateSort: stable.state.candidates.sort,
	});
	const visibleSystemInstanceKeys = deckWithoutCandidates.cards
		.filter((card) => stable.state.preferences.showIncompleteSystems
			|| card.status !== 'incomplete')
		.map((card) => card.occurrenceKey);

	let reconciledState = reconcileWorkbenchState(stable.state, {
		validFolderPaths: folderPaths,
		validSignalIdentities: hitMap.allEvidenceSignals,
		validSystemInstanceKeys: visibleSystemInstanceKeys,
		validDetailPaths: folderPaths,
	});

	let candidatePlan: ScanAndSnapPlan | null = null;
	let candidateScopePlan: ScopePackPlan | null = null;
	let selectedCandidateKeys: string[] = [];
	const loadedPackErrors: BundledRulePackRepositoryError[] = [];

	if (reconciledState.surface === 'candidates') {
		await yieldAndCheck(yieldControl, options);
		const neededPackIds = new Set<string>();

		if (reconciledState.candidates.source === 'scope-selection') {
			candidateScopePlan = buildScopePackPlan({
				selectedPaths: reconciledState.scope.selectedPaths,
				hitMap,
			});
			for (const deployment of candidateScopePlan.deployments) {
				neededPackIds.add(deployment.packId);
			}
		} else {
			for (const result of partition.surfaced) neededPackIds.add(result.packId);
		}

		const packRulesById = loadPackRules(
			[...neededPackIds].sort(compareCodePoints),
			stable.repository,
			loadedPackErrors,
		);

		candidatePlan = buildScanAndSnapPlan({
			folderPaths,
			detectionResults: reconciledState.candidates.source === 'detected-instances'
				? detectionResults
				: undefined,
			deployments: reconciledState.candidates.source === 'scope-selection'
				? candidateScopePlan?.deployments ?? []
				: undefined,
			packRulesById,
			existingRules: stable.settings.rules,
			packNamesById,
			groupPrecedence: stable.settings.groupPrecedence,
		});
		candidatePlan = sortCandidatePlan(candidatePlan, reconciledState);

		const validCandidateKeys = candidatePlan.candidates.map((candidate) => candidate.key);
		reconciledState = reconcileWorkbenchState(reconciledState, { validCandidateKeys });
		selectedCandidateKeys = resolveSelectedCandidateKeys(
			reconciledState.candidates.selectedKeys,
			validCandidateKeys,
		);
		throwIfCancelled(options);
	}

	const organizationalSystems = buildOrganizationalSystemsProjection({
		detectionResults,
		candidates: candidatePlan?.candidates,
		installedRules: stable.settings.rules,
		groupPrecedence: stable.settings.groupPrecedence,
		candidateSort: reconciledState.candidates.sort,
	});
	const occurrenceStats: WorkbenchOccurrenceStats = {
		totalCount: occurrences.length,
		actionableCount: occurrencePartition.actionable.length,
		incompleteCount: occurrencePartition.incomplete.length,
		suppressedCount: occurrencePartition.suppressed.length,
		visibleCount: organizationalSystems.cards.filter((card) =>
			reconciledState.preferences.showIncompleteSystems
				|| card.status !== 'incomplete').length,
	};
	const stats = buildStats(
		folderPaths,
		detectionResults,
		partition.surfaced,
		partition.belowThreshold,
		partition.suppressed,
		hitMap,
		conflicts,
		stable.settings.rules,
		folderRuleView,
		candidatePlan,
	);

	const clonedHitMap = cloneHitMap(hitMap);
	return {
		state: freezeJsonish(reconciledState),
		sourceRevision: stable.sourceRevision,
		folderPaths: Object.freeze([...folderPaths]),
		detectionResults: freezeJsonish(detectionResults),
		surfacedResults: freezeJsonish(partition.surfaced),
		belowThresholdResults: freezeJsonish(partition.belowThreshold),
		suppressedResults: freezeJsonish(partition.suppressed),
		occurrences: freezeJsonish(occurrences),
		actionableOccurrences: freezeJsonish(occurrencePartition.actionable),
		incompleteOccurrences: freezeJsonish(occurrencePartition.incomplete),
		suppressedOccurrences: freezeJsonish(occurrencePartition.suppressed),
		occurrenceStats: Object.freeze(occurrenceStats),
		hitMap: clonedHitMap,
		allEvidenceHitsByPath: clonedHitMap.allEvidenceHitsByPath,
		actionableHitsByPath: clonedHitMap.actionableHitsByPath,
		organizationalSystems: freezeJsonish(organizationalSystems),
		conflicts: freezeJsonish(conflicts),
		packNamesById: freezeReadonlyMap(packNamesById),
		folderRuleView: freezeFolderRuleView(folderRuleView),
		ruleNamesById: freezeReadonlyMap(ruleNamesById),
		stats: Object.freeze(stats),
		loadedPackErrors: freezeJsonish(loadedPackErrors),
		candidatePlan: candidatePlan ? freezeJsonish(candidatePlan) : null,
		candidateScopePlan: candidateScopePlan ? freezeJsonish(candidateScopePlan) : null,
		selectedCandidateKeys: Object.freeze([...selectedCandidateKeys]),
	};
}

/** Shorter functional alias for non-class callers. */
export const collectWorkbenchSnapshot = collectWorkbenchSessionSnapshot;

function stabilizeInput(input: WorkbenchSessionInput, state: unknown): StableCollectionInput {
	const root = input.root ?? input.app?.vault.getRoot();
	if (!root) throw new Error('WorkbenchSession requires a vault root or app-like input');

	const manifest = cloneJsonish(
		input.manifest ?? (bundledManifest as unknown as WorkbenchManifest),
	);
	return {
		root,
		settings: cloneJsonish({
			rules: input.settings.rules,
			groupPrecedence: input.settings.groupPrecedence,
		}),
		manifest,
		repository: input.repository ?? bundledRulePackRepository,
		state: validateWorkbenchState(state),
		sourceRevision: normalizeSourceRevision(input.sourceRevision),
	};
}

async function computeFolderRuleViewAsync(
	folderPaths: string[],
	rules: MappingRule[],
	groupPrecedence: string[] | undefined,
	chunkSize: number,
	yieldControl: () => Promise<void>,
	options: WorkbenchSessionCollectOptions,
): Promise<Map<string, FolderRuleEntry>> {
	const view = new Map<string, FolderRuleEntry>();
	for (let start = 0; start < folderPaths.length; start += chunkSize) {
		throwIfCancelled(options);
		const chunk = folderPaths.slice(start, start + chunkSize);
		const chunkView = computeFolderRuleView(chunk, rules, groupPrecedence);
		for (const [path, entry] of chunkView) view.set(path, entry);
		if (start + chunkSize < folderPaths.length) {
			await yieldAndCheck(yieldControl, options);
		}
	}
	throwIfCancelled(options);
	return view;
}

function loadPackRules(
	packIds: string[],
	repository: WorkbenchRulePackRepository,
	errors: BundledRulePackRepositoryError[],
): Map<string, MappingRule[]> {
	const rulesById = new Map<string, MappingRule[]>();
	for (const packId of packIds) {
		const result = repository.get(packId);
		if (result.ok) rulesById.set(packId, result.pack.rules);
		else errors.push(cloneJsonish(result.error));
	}
	return rulesById;
}

function sortCandidatePlan(
	plan: ScanAndSnapPlan,
	state: WorkbenchState,
): ScanAndSnapPlan {
	return {
		...plan,
		candidates: state.candidates.sort === 'conflict'
			? sortCandidatesByConflict(plan.candidates)
			: sortCandidatesByNoise(plan.candidates),
	};
}

function buildStats(
	folderPaths: string[],
	detectionResults: DetectionResult[],
	surfaced: DetectionResult[],
	belowThreshold: DetectionResult[],
	suppressed: DetectionResult[],
	hitMap: CrossPackHitMap,
	conflicts: ExclusivityConflict[],
	rules: MappingRule[],
	folderRuleView: Map<string, FolderRuleEntry>,
	candidatePlan: ScanAndSnapPlan | null,
): WorkbenchAggregateStats {
	let coveredFolderCount = 0;
	let installedConflictFolderCount = 0;
	for (const entry of folderRuleView.values()) {
		if (entry.winnerRuleId !== null) coveredFolderCount++;
		if (entry.conflict) installedConflictFolderCount++;
	}

	return {
		folderCount: folderPaths.length,
		detectionResultCount: detectionResults.length,
		surfacedPackCount: surfaced.length,
		belowThresholdPackCount: belowThreshold.length,
		suppressedPackCount: suppressed.length,
		matchedFolderCount: hitMap.hitsByPath.size,
		matchedSignalCount: hitMap.allSignals.length,
		exclusivityConflictCount: conflicts.length,
		installedRuleCount: rules.length,
		enabledRuleCount: rules.filter((rule) => rule.enabled).length,
		coveredFolderCount,
		installedConflictFolderCount,
		candidateCount: candidatePlan?.summary.totalCandidates ?? 0,
		touchingCandidateCount: candidatePlan?.summary.touchingCandidates ?? 0,
		candidateConflictCount: candidatePlan?.summary.conflictingCandidates ?? 0,
		candidateExistingCollisionCount:
			candidatePlan?.summary.collidingWithExistingCandidates ?? 0,
	};
}

function cloneHitMap(hitMap: CrossPackHitMap): CrossPackHitMap {
	const cloneHits = (source: Map<string, AnnotatedHit[]>): Map<string, AnnotatedHit[]> => {
		const clone = new Map<string, AnnotatedHit[]>();
		for (const [path, hits] of source) {
			clone.set(path, freezeJsonish(hits) as AnnotatedHit[]);
		}
		return Object.freeze(clone);
	};
	const actionableHitsByPath = cloneHits(hitMap.actionableHitsByPath);
	return Object.freeze({
		allSignals: freezeJsonish(hitMap.allSignals) as AnnotatedSignal[],
		hitsByPath: actionableHitsByPath,
		allEvidenceSignals: freezeJsonish(hitMap.allEvidenceSignals) as AnnotatedSignal[],
		actionableSignals: freezeJsonish(hitMap.actionableSignals) as AnnotatedSignal[],
		allEvidenceHitsByPath: cloneHits(hitMap.allEvidenceHitsByPath),
		actionableHitsByPath,
	});
}

function freezeFolderRuleView(
	view: Map<string, FolderRuleEntry>,
): ReadonlyMap<string, FolderRuleEntry> {
	const clone = new Map<string, FolderRuleEntry>();
	for (const [path, entry] of view) clone.set(path, freezeJsonish(entry));
	return Object.freeze(clone);
}

function freezeReadonlyMap<K, V>(map: Map<K, V>): ReadonlyMap<K, V> {
	return Object.freeze(new Map(map));
}

function normalizeChunkSize(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 250;
	return Math.max(1, Math.floor(value));
}

function normalizeSourceRevision(value: number | undefined): number {
	if (value === undefined || !Number.isFinite(value)) return 0;
	return Math.max(0, Math.floor(value));
}

async function yieldAndCheck(
	yieldControl: () => Promise<void>,
	options: WorkbenchSessionCollectOptions,
): Promise<void> {
	throwIfCancelled(options);
	await yieldControl();
	throwIfCancelled(options);
}

function throwIfCancelled(options: WorkbenchSessionCollectOptions): void {
	if (options.isCancelled?.()) throw new WorkbenchSessionCancelledError();
}

function cloneJsonish<T>(value: T, seen = new Map<object, unknown>()): T {
	if (value === null || typeof value !== 'object') return value;
	if (seen.has(value)) return seen.get(value) as T;
	if (Array.isArray(value)) {
		const clone: unknown[] = [];
		seen.set(value, clone);
		for (const item of value) clone.push(cloneJsonish(item, seen));
		return clone as T;
	}
	const clone: Record<string, unknown> = {};
	seen.set(value, clone);
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		clone[key] = cloneJsonish(child, seen);
	}
	return clone as T;
}

function freezeJsonish<T>(value: T, seen = new WeakSet<object>()): T {
	if (value === null || typeof value !== 'object' || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value as Record<string, unknown>)) {
		freezeJsonish(child, seen);
	}
	return Object.freeze(value);
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
