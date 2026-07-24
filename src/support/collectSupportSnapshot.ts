import { detectPacks, type DetectionResult, type ManifestPackEntry } from '../engine/detectPacks';
import {
	collectCrossPackHits,
	type AnnotatedSignal,
} from '../engine/detectionTree';
import {
	computeFolderRuleEntry,
	type FolderRuleEntry,
} from '../engine/folderRuleView';
import type {
	DynamicTagsFoldersSettings,
	MappingRule,
} from '../types/settings';
import {
	collectVaultFolderPaths,
	type VaultFolderLike,
} from '../utils/vaultFolders';

export const SUPPORT_SNAPSHOT_SCHEMA_VERSION = 1 as const;
const MAX_DETAILED_FOLDER_DIAGNOSTICS = 2_000;

export interface SupportPlatformInfo {
	kind: 'desktop' | 'mobile' | 'unknown';
	os?: 'windows' | 'macos' | 'linux' | 'android' | 'ios' | 'unknown';
	isDesktopApp?: boolean;
	isMobileApp?: boolean;
}

export interface SupportVaultLike {
	getRoot(): VaultFolderLike;
	getMarkdownFiles(): readonly unknown[];
}

export interface SupportAppLike {
	vault: SupportVaultLike;
}

export interface DetectionSummary {
	resultCount: number;
	surfacedPackIds: string[];
	belowThresholdPackIds: string[];
	suppressedPackIds: string[];
	matchedSignalCount: number;
	matchedFolderCount: number;
	folderDetailsIncluded: number;
	folderDetailsOmitted: number;
}

export interface DetectionHitDetail {
	folderPath: string;
	hits: Array<{
		packId: string;
		signalLabel: string;
		signalRegex: string;
		scope: 'name' | 'path' | 'leafName';
	}>;
}

export interface DetectionDiagnostics {
	summary: DetectionSummary;
	details: {
		results: DetectionResult[];
		signals: AnnotatedSignal[];
		hitsByFolder: DetectionHitDetail[];
	};
}

export interface InstalledRuleSummary {
	installedRuleCount: number;
	enabledRuleCount: number;
	enabledForwardRuleCount: number;
	coveredFolderCount: number;
	uncoveredFolderCount: number;
	conflictFolderCount: number;
	folderDetailsIncluded: number;
	folderDetailsOmitted: number;
}

export interface FolderRuleDetail extends FolderRuleEntry {
	folderPath: string;
}

export interface RuleCoverageDetail {
	ruleId: string;
	ruleName: string;
	enabled: boolean;
	direction: MappingRule['direction'];
	winningFolderCount: number;
	matchingFolderCount: number;
	conflictFolderCount: number;
}

export interface InstalledRuleDiagnostics {
	summary: InstalledRuleSummary;
	details: {
		folders: FolderRuleDetail[];
		rules: RuleCoverageDetail[];
	};
}

export interface SupportSnapshot {
	schemaVersion: typeof SUPPORT_SNAPSHOT_SCHEMA_VERSION;
	runtime: {
		manifest: Record<string, unknown>;
		platform: SupportPlatformInfo;
	};
	configuration: DynamicTagsFoldersSettings;
	vault: {
		folderPaths: string[];
		markdownFileCount: number;
	};
	diagnostics: {
		detection: DetectionDiagnostics;
		installedRules: InstalledRuleDiagnostics;
	};
	/** Parsed entries only. Reading or parsing the debug file belongs to UI wiring. */
	debugEntries: unknown[];
}

export interface CollectSupportSnapshotInput {
	app: SupportAppLike;
	settings: DynamicTagsFoldersSettings;
	pluginManifest: Readonly<object>;
	platform: Readonly<SupportPlatformInfo>;
	packManifest: readonly ManifestPackEntry[];
	debugEntries?: readonly unknown[];
}

export interface CollectSupportSnapshotAsyncOptions {
	/** Number of folders evaluated before yielding back to Obsidian's UI loop. */
	chunkSize?: number;
	/** Test seam for yielding. Defaults to a zero-delay timer. */
	yieldControl?: () => Promise<void>;
	/** Lets a closed or superseded modal stop an in-progress scan early. */
	isCancelled?: () => boolean;
}

/**
 * Collect one immutable-input snapshot that can be serialized repeatedly in
 * readable or anonymized mode without touching the vault again.
 */
export function collectSupportSnapshot(input: CollectSupportSnapshotInput): SupportSnapshot {
	const folderPaths = collectVaultFolderPaths(input.app.vault.getRoot());
	const detectionResults = detectPacks(folderPaths, [...input.packManifest]);
	const packNamesById = new Map(input.packManifest.map((pack) => [pack.id, pack.name]));
	const crossPackHits = collectCrossPackHits(folderPaths, detectionResults, packNamesById);
	const installedRules = buildInstalledRuleDiagnostics(
		folderPaths,
		input.settings.rules,
		input.settings.groupPrecedence,
	);

	return assembleSupportSnapshot(
		input,
		folderPaths,
		detectionResults,
		crossPackHits,
		installedRules,
	);
}

/**
 * UI-oriented collector that yields while evaluating installed rules. The
 * synchronous collector remains available for pure callers and tests.
 */
export async function collectSupportSnapshotAsync(
	input: CollectSupportSnapshotInput,
	options: CollectSupportSnapshotAsyncOptions = {},
): Promise<SupportSnapshot> {
	const stableInput: CollectSupportSnapshotInput = {
		...input,
		settings: cloneJsonish(input.settings),
	};
	const folderPaths = collectVaultFolderPaths(stableInput.app.vault.getRoot());
	const detectionResults = detectPacks(folderPaths, [...stableInput.packManifest]);
	const packNamesById = new Map(stableInput.packManifest.map((pack) => [pack.id, pack.name]));
	const crossPackHits = collectCrossPackHits(folderPaths, detectionResults, packNamesById);
	const installedRules = await buildInstalledRuleDiagnosticsAsync(
		folderPaths,
		stableInput.settings.rules,
		stableInput.settings.groupPrecedence,
		options,
	);

	return assembleSupportSnapshot(
		stableInput,
		folderPaths,
		detectionResults,
		crossPackHits,
		installedRules,
	);
}

function assembleSupportSnapshot(
	input: CollectSupportSnapshotInput,
	folderPaths: string[],
	detectionResults: DetectionResult[],
	crossPackHits: ReturnType<typeof collectCrossPackHits>,
	installedRules: InstalledRuleDiagnostics,
): SupportSnapshot {
	return {
		schemaVersion: SUPPORT_SNAPSHOT_SCHEMA_VERSION,
		runtime: {
			manifest: cloneJsonish(input.pluginManifest) as Record<string, unknown>,
			platform: cloneJsonish(input.platform),
		},
		configuration: cloneJsonish(input.settings),
		vault: {
			folderPaths: [...folderPaths],
			markdownFileCount: input.app.vault.getMarkdownFiles().length,
		},
		diagnostics: {
			detection: buildDetectionDiagnostics(detectionResults, crossPackHits),
			installedRules,
		},
		debugEntries: cloneJsonish([...(input.debugEntries ?? [])]),
	};
}

function buildDetectionDiagnostics(
	results: DetectionResult[],
	hitMap: ReturnType<typeof collectCrossPackHits>,
): DetectionDiagnostics {
	const surfacedPackIds: string[] = [];
	const belowThresholdPackIds: string[] = [];
	const suppressedPackIds: string[] = [];

	for (const result of results) {
		if (result.suppressedByMissingParent) suppressedPackIds.push(result.packId);
		else if (result.score >= 1) surfacedPackIds.push(result.packId);
		else belowThresholdPackIds.push(result.packId);
	}

	const sortedFolderHits = [...hitMap.hitsByPath.entries()]
		.sort(([a], [b]) => compareCodePoints(a, b));
	const hitsByFolder: DetectionHitDetail[] = sortedFolderHits
		.slice(0, MAX_DETAILED_FOLDER_DIAGNOSTICS)
		.map(([folderPath, hits]) => ({
			folderPath,
			hits: hits.map((hit) => ({
				packId: hit.signal.packId,
				signalLabel: hit.signal.label,
				signalRegex: hit.signal.regex,
				scope: hit.signal.scope,
			})),
		}));

	return {
		summary: {
			resultCount: results.length,
			surfacedPackIds,
			belowThresholdPackIds,
			suppressedPackIds,
			matchedSignalCount: hitMap.allSignals.length,
			matchedFolderCount: hitMap.hitsByPath.size,
			folderDetailsIncluded: hitsByFolder.length,
			folderDetailsOmitted: hitMap.hitsByPath.size - hitsByFolder.length,
		},
		details: {
			results: cloneJsonish(results),
			signals: cloneJsonish(hitMap.allSignals),
			hitsByFolder,
		},
	};
}

interface InstalledRuleAccumulator {
	coveredFolderCount: number;
	conflictFolderCount: number;
	folders: FolderRuleDetail[];
	winningCounts: Map<string, number>;
	matchingCounts: Map<string, number>;
	conflictCounts: Map<string, number>;
}

function buildInstalledRuleDiagnostics(
	folderPaths: string[],
	rules: MappingRule[],
	groupPrecedence?: string[],
): InstalledRuleDiagnostics {
	const accumulator = createInstalledRuleAccumulator();
	for (const folderPath of folderPaths) {
		accumulateFolderRule(
			accumulator,
			folderPath,
			computeFolderRuleEntry(folderPath, rules, groupPrecedence),
		);
	}
	return finishInstalledRuleDiagnostics(accumulator, folderPaths.length, rules);
}

async function buildInstalledRuleDiagnosticsAsync(
	folderPaths: string[],
	rules: MappingRule[],
	groupPrecedence: string[] | undefined,
	options: CollectSupportSnapshotAsyncOptions,
): Promise<InstalledRuleDiagnostics> {
	const requestedChunkSize = options.chunkSize ?? 250;
	const chunkSize = Number.isFinite(requestedChunkSize)
		? Math.max(1, Math.floor(requestedChunkSize))
		: 250;
	const yieldControl = options.yieldControl
		?? (() => new Promise<void>((resolve) => setTimeout(resolve, 0)));
	const accumulator = createInstalledRuleAccumulator();

	throwIfCollectionCancelled(options);
	for (let index = 0; index < folderPaths.length; index++) {
		if (index > 0 && index % chunkSize === 0) {
			throwIfCollectionCancelled(options);
			await yieldControl();
			throwIfCollectionCancelled(options);
		}
		const folderPath = folderPaths[index];
		accumulateFolderRule(
			accumulator,
			folderPath,
			computeFolderRuleEntry(folderPath, rules, groupPrecedence),
		);
	}
	throwIfCollectionCancelled(options);
	return finishInstalledRuleDiagnostics(accumulator, folderPaths.length, rules);
}

function createInstalledRuleAccumulator(): InstalledRuleAccumulator {
	return {
		coveredFolderCount: 0,
		conflictFolderCount: 0,
		folders: [],
		winningCounts: new Map(),
		matchingCounts: new Map(),
		conflictCounts: new Map(),
	};
}

function accumulateFolderRule(
	accumulator: InstalledRuleAccumulator,
	folderPath: string,
	entry: FolderRuleEntry,
): void {
	if (entry.winnerRuleId !== null) {
		accumulator.coveredFolderCount++;
		accumulator.winningCounts.set(
			entry.winnerRuleId,
			(accumulator.winningCounts.get(entry.winnerRuleId) ?? 0) + 1,
		);
	}
	if (entry.conflict) accumulator.conflictFolderCount++;

	for (const ruleId of entry.matchingRuleIds) {
		accumulator.matchingCounts.set(
			ruleId,
			(accumulator.matchingCounts.get(ruleId) ?? 0) + 1,
		);
		if (entry.conflict) {
			accumulator.conflictCounts.set(
				ruleId,
				(accumulator.conflictCounts.get(ruleId) ?? 0) + 1,
			);
		}
	}

	if (accumulator.folders.length < MAX_DETAILED_FOLDER_DIAGNOSTICS) {
		accumulator.folders.push({ folderPath, ...cloneJsonish(entry) });
	}
}

function finishInstalledRuleDiagnostics(
	accumulator: InstalledRuleAccumulator,
	folderCount: number,
	rules: MappingRule[],
): InstalledRuleDiagnostics {
	const ruleDetails: RuleCoverageDetail[] = rules.map((rule) => ({
		ruleId: rule.id,
		ruleName: rule.name,
		enabled: rule.enabled,
		direction: rule.direction,
		winningFolderCount: accumulator.winningCounts.get(rule.id) ?? 0,
		matchingFolderCount: accumulator.matchingCounts.get(rule.id) ?? 0,
		conflictFolderCount: accumulator.conflictCounts.get(rule.id) ?? 0,
	}));

	return {
		summary: {
			installedRuleCount: rules.length,
			enabledRuleCount: rules.filter((rule) => rule.enabled).length,
			enabledForwardRuleCount: rules.filter(
				(rule) => rule.enabled && rule.direction !== 'tag-to-folder',
			).length,
			coveredFolderCount: accumulator.coveredFolderCount,
			uncoveredFolderCount: folderCount - accumulator.coveredFolderCount,
			conflictFolderCount: accumulator.conflictFolderCount,
			folderDetailsIncluded: accumulator.folders.length,
			folderDetailsOmitted: folderCount - accumulator.folders.length,
		},
		details: {
			folders: accumulator.folders,
			rules: ruleDetails,
		},
	};
}

function throwIfCollectionCancelled(options: CollectSupportSnapshotAsyncOptions): void {
	if (options.isCancelled?.()) throw new Error('Support bundle collection cancelled');
}

function cloneJsonish<T>(value: T, seen = new Map<object, unknown>()): T {
	if (value === null || typeof value !== 'object') return value;
	if (value instanceof Date) return value.toISOString() as T;
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

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
