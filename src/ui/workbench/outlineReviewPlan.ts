import type { CrossPackHitMap } from '../../engine/detectionTree';
import { applyRuleForward } from '../../engine/applyTransfer';
import { findMatchingRules, selectBestMatch } from '../../engine/ruleMatcher';
import type { CandidateRow } from '../../engine/scanAndSnapPlan';
import { buildScopePackPlan, type ScopePackDeployment, type ScopePackPlan } from '../../engine/scopePackPlan';
import type { MappingRule } from '../../types/settings';
import { isDegenerateTag } from './workbenchOutlinePresentation';

export type OutlineRuleInstallStatus = 'new' | 'saved' | 'changed';
export type OutlineRuleOutputState = 'no-match' | 'empty' | 'invalid' | 'valid';
export type OutlineComparisonChange = 'unchanged' | 'changed';
export type OutlineRuleOrigin = 'installed' | 'proposed' | null;

export interface OutlineReviewedRule {
	candidate: CandidateRow;
	rule: MappingRule;
	installStatus: OutlineRuleInstallStatus;
	installedRule: MappingRule | null;
}

export interface OutlineOccurrenceRuleMembership {
	occurrenceKey: string;
	ruleIds: string[];
}

export interface OutlineOccurrenceCoverage {
	occurrenceKey: string;
	anchorPath: string;
	matchingFolders: string[];
	coverageKind: 'all-current-folders';
}

export interface OutlineRuleOutcome {
	state: OutlineRuleOutputState;
	ruleId: string | null;
	ruleName: string | null;
	origin: OutlineRuleOrigin;
	tags: string[];
	error: string | null;
}

export interface OutlineFolderComparison {
	folderPath: string;
	current: OutlineRuleOutcome;
	hypothetical: OutlineRuleOutcome;
	change: OutlineComparisonChange;
}

export interface OutlineInvalidDraftOutput {
	ruleId: string;
	ruleName: string;
	folderPath: string;
	tags: string[];
	error: string;
}

export interface OutlineReviewPlanInput {
	selectedPaths: readonly string[];
	hitMap: Pick<CrossPackHitMap, 'hitsByPath'>
		& Partial<Pick<CrossPackHitMap, 'actionableHitsByPath'>>;
	excludedOccurrenceKeys: readonly string[];
	candidates: readonly CandidateRow[];
	installedRules: readonly MappingRule[];
	folderPaths: readonly string[];
	groupPrecedence?: readonly string[];
}

export interface OutlineReviewPlan {
	scopePlan: ScopePackPlan;
	deployments: ScopePackDeployment[];
	reviewedCandidates: CandidateRow[];
	reviewedRules: OutlineReviewedRule[];
	occurrenceRules: OutlineOccurrenceRuleMembership[];
	occurrenceCoverage: OutlineOccurrenceCoverage[];
	rulesForSave: MappingRule[];
	hypotheticalRules: MappingRule[];
	comparisons: OutlineFolderComparison[];
	invalidDraftOutputs: OutlineInvalidDraftOutput[];
	reviewedSystemCount: number;
	reviewedRuleCount: number;
	newRuleCount: number;
	savedRuleCount: number;
	changedRuleCount: number;
	canSave: boolean;
}

/**
 * Build the one reviewed selection consumed by outline coverage, comparison,
 * counts, confirmation, and persistence. Scope folders discover deployments;
 * exact occurrence exclusions then filter deployments and their candidate rows.
 */
export function buildOutlineReviewPlan(input: OutlineReviewPlanInput): OutlineReviewPlan {
	const scopePlan = buildScopePackPlan({
		selectedPaths: input.selectedPaths,
		hitMap: input.hitMap,
	});
	const excluded = new Set(input.excludedOccurrenceKeys);
	const deployments = scopePlan.deployments
		.filter((deployment) => !excluded.has(deployment.occurrenceKey));
	const selectedOccurrenceKeys = new Set(deployments.map((deployment) => deployment.occurrenceKey));
	const reviewedCandidates = input.candidates
		.filter((candidate) => selectedOccurrenceKeys.has(candidate.occurrenceKey));
	const installedById = new Map(input.installedRules.map((rule) => [rule.id, rule] as const));
	const reviewedRules = reviewedCandidates.map((candidate): OutlineReviewedRule => {
		const installedRule = installedById.get(candidate.rule.id) ?? null;
		return {
			candidate,
			rule: candidate.rule,
			installedRule,
			installStatus: installedRule === null
				? 'new'
				: rulesEquivalentForInstall(candidate.rule, installedRule) ? 'saved' : 'changed',
		};
	});
	const rulesForSave = reviewedRules
		.filter((entry) => entry.installStatus === 'new')
		.map((entry) => entry.rule);
	const occurrenceRules = deployments.map((deployment) => ({
		occurrenceKey: deployment.occurrenceKey,
		ruleIds: reviewedRules
			.filter((entry) => entry.candidate.occurrenceKey === deployment.occurrenceKey)
			.map((entry) => entry.rule.id),
	}));
	const occurrenceCoverage = deployments.map((deployment) => ({
		occurrenceKey: deployment.occurrenceKey,
		anchorPath: deployment.anchorPath,
		matchingFolders: coverageForRules(
			input.folderPaths,
			reviewedRules
				.filter((entry) => entry.candidate.occurrenceKey === deployment.occurrenceKey)
				.map((entry) => entry.rule),
		),
		coverageKind: 'all-current-folders' as const,
	}));
	const hypotheticalRules = [
		...input.installedRules,
		...rulesForSave.map((rule) => ({ ...rule, enabled: true })),
	];
	const comparisons = evaluateOutlineRuleSet(
		input.folderPaths,
		input.installedRules,
		rulesForSave,
		input.groupPrecedence ?? [],
	);
	const invalidDraftOutputs = collectInvalidDraftOutputs(input.folderPaths, rulesForSave);
	const newRuleCount = rulesForSave.length;
	const savedRuleCount = reviewedRules.filter((entry) => entry.installStatus === 'saved').length;
	const changedRuleCount = reviewedRules.filter((entry) => entry.installStatus === 'changed').length;

	return {
		scopePlan,
		deployments,
		reviewedCandidates,
		reviewedRules,
		occurrenceRules,
		occurrenceCoverage,
		rulesForSave,
		hypotheticalRules,
		comparisons,
		invalidDraftOutputs,
		reviewedSystemCount: deployments.length,
		reviewedRuleCount: reviewedRules.length,
		newRuleCount,
		savedRuleCount,
		changedRuleCount,
		canSave: newRuleCount > 0 && invalidDraftOutputs.length === 0,
	};
}

/** Compare rule content as installation sees it: the persisted copy is forced disabled. */
export function rulesEquivalentForInstall(candidate: MappingRule, installed: MappingRule): boolean {
	return stableStringify({ ...candidate, enabled: false })
		=== stableStringify({ ...installed, enabled: false });
}

/**
 * Evaluate current behavior beside the exact post-save hypothetical behavior.
 * Existing same-ID rules remain authoritative because installation skips them;
 * disabled installed rules remain present but do not participate.
 */
export function evaluateOutlineRuleSet(
	folderPaths: readonly string[],
	installedRules: readonly MappingRule[],
	proposedRules: readonly MappingRule[],
	groupPrecedence: readonly string[],
): OutlineFolderComparison[] {
	const installedIds = new Set(installedRules.map((rule) => rule.id));
	const exactNewProposals = proposedRules
		.filter((rule) => !installedIds.has(rule.id))
		.map((rule) => ({ ...rule, enabled: true }));
	const hypotheticalRules = [...installedRules, ...exactNewProposals];
	const proposedIds = new Set(exactNewProposals.map((rule) => rule.id));

	return folderPaths
		.map((folderPath) => {
			const current = evaluateFolder(folderPath, installedRules, new Set(), groupPrecedence);
			const hypothetical = evaluateFolder(folderPath, hypotheticalRules, proposedIds, groupPrecedence);
			return {
				folderPath,
				current,
				hypothetical,
				change: sameOutcome(current, hypothetical) ? 'unchanged' as const : 'changed' as const,
			};
		})
		.filter((comparison) => comparison.current.state !== 'no-match'
			|| comparison.hypothetical.state !== 'no-match');
}

function evaluateFolder(
	folderPath: string,
	rules: readonly MappingRule[],
	proposedIds: ReadonlySet<string>,
	groupPrecedence: readonly string[],
): OutlineRuleOutcome {
	const matches = findMatchingRules(folderPath, [...rules], {
		input: folderPath,
		matchType: 'folder',
		direction: 'folder-to-tag',
	});
	const winner = selectBestMatch(matches, [...groupPrecedence]);
	if (!winner) return noMatchOutcome();
	const origin: Exclude<OutlineRuleOrigin, null> = proposedIds.has(winner.rule.id)
		? 'proposed'
		: 'installed';
	try {
		const tags = applyRuleForward(folderPath, winner.rule).tags;
		if (tags.length === 0) {
			return outcome('empty', winner.rule, origin, [], null);
		}
		if (tags.some(isDegenerateTag)) {
			return outcome(
				'invalid', winner.rule, origin, tags,
				'Matched rule produces unusable tag syntax.',
			);
		}
		return outcome('valid', winner.rule, origin, tags, null);
	} catch (error) {
		return outcome('invalid', winner.rule, origin, [], errorMessage(error));
	}
}

function collectInvalidDraftOutputs(
	folderPaths: readonly string[],
	draftRules: readonly MappingRule[],
): OutlineInvalidDraftOutput[] {
	const invalid: OutlineInvalidDraftOutput[] = [];
	for (const draft of draftRules) {
		for (const folderPath of folderPaths) {
			const matches = findMatchingRules(folderPath, [{ ...draft, enabled: true }], {
				input: folderPath,
				matchType: 'folder',
				direction: 'folder-to-tag',
			});
			if (matches.length === 0) continue;
			try {
				const tags = applyRuleForward(folderPath, draft).tags;
				if (tags.length === 0 || !tags.some(isDegenerateTag)) continue;
				invalid.push({
					ruleId: draft.id,
					ruleName: draft.name,
					folderPath,
					tags,
					error: 'Matched rule produces unusable tag syntax.',
				});
			} catch (error) {
				invalid.push({
					ruleId: draft.id,
					ruleName: draft.name,
					folderPath,
					tags: [],
					error: errorMessage(error),
				});
			}
		}
	}
	return invalid;
}

function coverageForRules(folderPaths: readonly string[], rules: readonly MappingRule[]): string[] {
	return folderPaths.filter((folderPath) => rules.some((rule) =>
		findMatchingRules(folderPath, [{ ...rule, enabled: true }], {
			input: folderPath,
			matchType: 'folder',
			direction: 'folder-to-tag',
		}).length > 0));
}

function outcome(
	state: Exclude<OutlineRuleOutputState, 'no-match'>,
	rule: MappingRule,
	origin: Exclude<OutlineRuleOrigin, null>,
	tags: string[],
	error: string | null,
): OutlineRuleOutcome {
	return {
		state,
		ruleId: rule.id,
		ruleName: rule.name,
		origin,
		tags,
		error,
	};
}

function noMatchOutcome(): OutlineRuleOutcome {
	return {
		state: 'no-match',
		ruleId: null,
		ruleName: null,
		origin: null,
		tags: [],
		error: null,
	};
}

function sameOutcome(a: OutlineRuleOutcome, b: OutlineRuleOutcome): boolean {
	return a.state === b.state && JSON.stringify(a.tags) === JSON.stringify(b.tags);
}

function stableStringify(value: unknown): string {
	return JSON.stringify(sortJson(value));
}

function sortJson(value: unknown): unknown {
	if (Array.isArray(value)) return value.map(sortJson);
	if (value === null || typeof value !== 'object') return value;
	const sorted: Record<string, unknown> = {};
	for (const key of Object.keys(value as Record<string, unknown>).sort()) {
		const child = (value as Record<string, unknown>)[key];
		if (child !== undefined) sorted[key] = sortJson(child);
	}
	return sorted;
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== '') return error.message;
	if (typeof error === 'string' && error.trim() !== '') return error;
	return 'Rule output could not be generated.';
}
