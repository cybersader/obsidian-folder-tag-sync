/**
 * Rule coverage analyzer — pure functions for "where do rules apply"
 * intuition. Powers per-rule coverage views, grouped vault previews, and
 * conflict detection.
 *
 * Forward coverage: given a rule + vault folder list, which folders match?
 * Inverse coverage: given a rule + vault tag list, which tags match?
 * Conflict map: across multiple rules, which folders/tags match more than one?
 *
 * Pure — no Obsidian, no I/O. Caller passes in folder paths and tag list.
 */

import type { MappingRule } from '../types/settings';
import { evaluateRule } from './ruleMatcher';
import { applyRuleForward } from './applyTransfer';

export interface RuleForwardCoverage {
	ruleId: string;
	ruleName: string;
	matchedFolderCount: number;
	matchedFolders: string[]; // capped to maxSamples
	sampleEmissions: Array<{ folder: string; tags: string[] }>; // capped
	totalMatched: number;
}

export interface RuleInverseCoverage {
	ruleId: string;
	ruleName: string;
	matchedTagCount: number;
	matchedTags: string[]; // capped
	totalMatched: number;
}

export interface ConflictEntry {
	folderPath: string;
	matchingRuleIds: string[]; // 2+ rules
}

export interface VaultCoverageReport {
	forwardCoverage: RuleForwardCoverage[]; // one per enabled folder-to-tag/bidirectional rule
	inverseCoverage: RuleInverseCoverage[]; // one per enabled tag-to-folder/bidirectional rule
	conflicts: ConflictEntry[]; // folders where 2+ rules match
	unmatchedFolders: string[]; // folders no rule touches (sample)
	totalFolders: number;
	totalTags: number;
}

/**
 * Compute coverage for a single rule against a vault folder list. Returns
 * matched-folder count + samples. For template rules with deeper-than-bare
 * matches, the sample emissions show what tags would emit.
 */
export function computeForwardCoverage(
	rule: MappingRule,
	folderPaths: string[],
	maxSamples = 20,
): RuleForwardCoverage {
	const matchedFolders: string[] = [];
	const sampleEmissions: Array<{ folder: string; tags: string[] }> = [];
	let totalMatched = 0;

	for (const folderPath of folderPaths) {
		const match = evaluateRule(folderPath, rule, {
			input: folderPath,
			matchType: 'folder',
		});
		if (!match) continue;
		totalMatched++;
		if (matchedFolders.length < maxSamples) {
			matchedFolders.push(folderPath);
			try {
				const result = applyRuleForward(folderPath, rule);
				if (result.tags.length > 0) {
					sampleEmissions.push({ folder: folderPath, tags: result.tags });
				}
			} catch { /* continue on errors */ }
		}
	}

	return {
		ruleId: rule.id,
		ruleName: rule.name,
		matchedFolderCount: totalMatched,
		matchedFolders,
		sampleEmissions,
		totalMatched,
	};
}

/**
 * Compute inverse coverage for a single rule against a vault tag list.
 * Tags matching the rule's tagPattern (or compiled tagTemplate regex) are
 * collected.
 */
export function computeInverseCoverage(
	rule: MappingRule,
	allTags: string[],
	maxSamples = 20,
): RuleInverseCoverage {
	const matchedTags: string[] = [];
	let totalMatched = 0;

	// Try matching with the tag as-is, then with `#` toggled if no match.
	// Some rules (template-shaped with `#` in the tag template) have a regex
	// that requires `#`; others (legacy regex rules without `#` in the
	// pattern) require it stripped. Tolerate both.
	for (const rawTag of allTags) {
		const stripped = rawTag.startsWith('#') ? rawTag.slice(1) : rawTag;
		const withHash = rawTag.startsWith('#') ? rawTag : `#${rawTag}`;
		const m1 = evaluateRule(rawTag, rule, { input: rawTag, matchType: 'tag' });
		const m2 = m1 ?? evaluateRule(stripped, rule, { input: stripped, matchType: 'tag' });
		const match = m2 ?? evaluateRule(withHash, rule, { input: withHash, matchType: 'tag' });
		if (!match) continue;
		totalMatched++;
		if (matchedTags.length < maxSamples) {
			matchedTags.push(rawTag);
		}
	}

	return {
		ruleId: rule.id,
		ruleName: rule.name,
		matchedTagCount: totalMatched,
		matchedTags,
		totalMatched,
	};
}

/**
 * Detect folders matched by 2+ rules — surfaces unintended overlap. Useful
 * when a user has imported multiple rule packs and wants to know whether
 * their structure conflicts.
 */
export function computeConflicts(
	rules: MappingRule[],
	folderPaths: string[],
): ConflictEntry[] {
	const conflicts: ConflictEntry[] = [];
	for (const folderPath of folderPaths) {
		const matchingRuleIds: string[] = [];
		for (const rule of rules) {
			if (!rule.enabled) continue;
			if (rule.direction === 'tag-to-folder') continue;
			const match = evaluateRule(folderPath, rule, {
				input: folderPath,
				matchType: 'folder',
			});
			if (match) matchingRuleIds.push(rule.id);
		}
		if (matchingRuleIds.length >= 2) {
			conflicts.push({ folderPath, matchingRuleIds });
		}
	}
	return conflicts;
}

/**
 * Vault-wide coverage report. Aggregates forward + inverse coverage for all
 * enabled rules, detects conflicts, lists folders with no matching rule.
 */
export function buildCoverageReport(
	rules: MappingRule[],
	folderPaths: string[],
	allTags: string[],
	maxSamples = 20,
): VaultCoverageReport {
	const forwardCoverage: RuleForwardCoverage[] = [];
	const inverseCoverage: RuleInverseCoverage[] = [];

	for (const rule of rules) {
		if (!rule.enabled) continue;
		if (rule.direction === 'folder-to-tag' || rule.direction === 'bidirectional') {
			forwardCoverage.push(computeForwardCoverage(rule, folderPaths, maxSamples));
		}
		if (rule.direction === 'tag-to-folder' || rule.direction === 'bidirectional') {
			inverseCoverage.push(computeInverseCoverage(rule, allTags, maxSamples));
		}
	}

	const conflicts = computeConflicts(rules, folderPaths);

	// Unmatched folders — sample of folders that no enabled rule touches
	const matchedSet = new Set<string>();
	for (const cov of forwardCoverage) {
		for (const f of cov.matchedFolders) matchedSet.add(f);
		// We only have samples; for total unmatched, we have to walk again
	}
	const unmatchedFolders: string[] = [];
	for (const folderPath of folderPaths) {
		let anyMatch = false;
		for (const rule of rules) {
			if (!rule.enabled) continue;
			if (rule.direction === 'tag-to-folder') continue;
			const match = evaluateRule(folderPath, rule, {
				input: folderPath,
				matchType: 'folder',
			});
			if (match) { anyMatch = true; break; }
		}
		if (!anyMatch && unmatchedFolders.length < maxSamples) {
			unmatchedFolders.push(folderPath);
		}
	}

	return {
		forwardCoverage,
		inverseCoverage,
		conflicts,
		unmatchedFolders,
		totalFolders: folderPaths.length,
		totalTags: allTags.length,
	};
}
