import type { MappingRule, TransformConfig } from '../types/settings';

/**
 * A deterministic, side-effect-free description of which selected rules should
 * be installed. IDs are reported in first-selected order.
 */
export interface RuleInstallPlan {
	/** Number of selected candidates supplied by the caller, including duplicates. */
	requestedCount: number;
	/** Number of distinct candidate IDs in the selection. */
	uniqueCount: number;
	/** Fresh, disabled copies of rules that are not already installed. */
	addedRules: MappingRule[];
	/** IDs of addedRules, in the same order. */
	addedRuleIds: string[];
	/** Distinct selected IDs that were already installed. */
	skippedExistingIds: string[];
	/** One entry for each duplicate selection skipped after its first occurrence. */
	skippedDuplicateIds: string[];
	/** Exact number of duplicate selection entries skipped. */
	skippedDuplicateCount: number;
	/** True only when at least one rule must be persisted. */
	needsPersistence: boolean;
}

/**
 * Plan installation of selected rule candidates without changing either input.
 *
 * Duplicate selected IDs collapse first-wins. Existing rule IDs are skipped,
 * regardless of the existing rule's enabled state. Every rule that will be
 * added is a detached copy and is forced disabled so installation cannot alter
 * runtime behavior until the user explicitly enables it.
 */
export function buildRuleInstallPlan(
	selectedCandidates: readonly MappingRule[],
	existingRules: readonly MappingRule[],
): RuleInstallPlan {
	const existingIds = new Set(existingRules.map((rule) => rule.id));
	const selectedIds = new Set<string>();
	const addedRules: MappingRule[] = [];
	const addedRuleIds: string[] = [];
	const skippedExistingIds: string[] = [];
	const skippedDuplicateIds: string[] = [];

	for (const candidate of selectedCandidates) {
		if (selectedIds.has(candidate.id)) {
			skippedDuplicateIds.push(candidate.id);
			continue;
		}

		selectedIds.add(candidate.id);
		if (existingIds.has(candidate.id)) {
			skippedExistingIds.push(candidate.id);
			continue;
		}

		const installed = cloneRule(candidate);
		installed.enabled = false;
		addedRules.push(installed);
		addedRuleIds.push(installed.id);
	}

	return {
		requestedCount: selectedCandidates.length,
		uniqueCount: selectedIds.size,
		addedRules,
		addedRuleIds,
		skippedExistingIds,
		skippedDuplicateIds,
		skippedDuplicateCount: skippedDuplicateIds.length,
		needsPersistence: addedRules.length > 0,
	};
}

/** Clone every mutable MappingRule branch so the install plan is fully detached. */
function cloneRule(rule: MappingRule): MappingRule {
	return {
		...rule,
		options: { ...rule.options },
		folderAnchor:
			typeof rule.folderAnchor === 'object' && rule.folderAnchor !== null
				? { ...rule.folderAnchor }
				: rule.folderAnchor,
		folderTransforms: cloneTransforms(rule.folderTransforms),
		tagTransforms: cloneTransforms(rule.tagTransforms),
		folder: rule.folder ? { ...rule.folder, axes: [...rule.folder.axes] } : undefined,
		tag: rule.tag ? { ...rule.tag } : undefined,
		transfer: rule.transfer ? { ...rule.transfer } : undefined,
		inverseTransfer: rule.inverseTransfer ? { ...rule.inverseTransfer } : undefined,
	};
}

function cloneTransforms(transforms: TransformConfig | undefined): TransformConfig | undefined {
	if (!transforms) return undefined;
	return {
		...transforms,
		customTransforms: transforms.customTransforms?.map((transform) => ({ ...transform })),
	};
}
