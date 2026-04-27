/**
 * Rule matching and pattern evaluation engine
 *
 * Evaluates folder paths and tags against configured rules,
 * finding the best matching rule based on priority and pattern matching.
 */

import { MappingRule, RuleDirection } from '../types/settings';
import { FolderAnchor } from '../types/typed';
import { patternToRegex, matchesPattern } from '../transformers/regexTransformers';

export interface RuleMatch {
	rule: MappingRule;
	matchType: 'folder' | 'tag';
	matchedPattern: string;
	confidence: number; // 0-1, higher means more specific match
}

export interface RuleEvaluationContext {
	/** The folder path or tag being evaluated */
	input: string;

	/** Whether we're matching against folder patterns or tag patterns */
	matchType: 'folder' | 'tag';

	/** Direction filter (only return rules matching this direction) */
	direction?: RuleDirection;

	/** Whether to include disabled rules */
	includeDisabled?: boolean;
}

/**
 * Evaluate a single rule against input
 */
export function evaluateRule(
	input: string,
	rule: MappingRule,
	context: RuleEvaluationContext
): RuleMatch | null {
	// Skip disabled rules unless explicitly requested
	if (!rule.enabled && !context.includeDisabled) {
		return null;
	}

	// Check direction compatibility
	if (context.direction && rule.direction !== 'bidirectional' && rule.direction !== context.direction) {
		return null;
	}

	// Get the appropriate pattern based on match type
	const pattern = context.matchType === 'folder' ? rule.folderPattern : rule.tagPattern;

	if (!pattern) {
		return null;
	}

	// Check if input matches the pattern
	if (!matchesPattern(input, pattern)) {
		return null;
	}

	// Calculate match confidence (more specific patterns = higher confidence)
	// Pass folderAnchor for folder matches so anchor-aware bonuses apply.
	// Tag matches don't have an anchor concept (or it's implicitly root).
	const confidence = calculateMatchConfidence(
		input,
		pattern,
		context.matchType === 'folder' ? rule.folderAnchor : undefined
	);

	return {
		rule,
		matchType: context.matchType,
		matchedPattern: pattern,
		confidence
	};
}

/**
 * Find all rules that match the given input
 */
export function findMatchingRules(
	input: string,
	rules: MappingRule[],
	context: RuleEvaluationContext
): RuleMatch[] {
	const matches: RuleMatch[] = [];

	for (const rule of rules) {
		const match = evaluateRule(input, rule, context);
		if (match) {
			matches.push(match);
		}
	}

	return matches;
}

/**
 * Find the best matching rule with three-layer resolution: group precedence,
 * confidence (specificity), and priority as the tiebreak.
 *
 * F1 Step 3 added the group-precedence layer. The resolution order is now:
 *
 *   1. Partition matches by `MappingRule.group` (default `'__default__'`).
 *   2. Pick the highest-precedence group with at least one match. Group
 *      precedence is read from `groupPrecedence?: string[]` on settings;
 *      groups not in the list fall to lowest precedence (alphabetical
 *      tiebreak as a last resort).
 *   3. Within the winning group, sort by confidence descending — the
 *      Increment 1 Step 1+2 specificity-aware order.
 *   4. Priority is the within-group tiebreak when confidences are equal.
 *
 * The function reads `groupPrecedence` from the optional `groupPrecedence`
 * argument. When absent, group precedence defaults to alphabetical (so
 * behavior on a vault that hasn't authored a precedence order is stable).
 *
 * **Priority is now the within-group manual override tiebreak.** Cross-group
 * resolution uses the precedence list, not priority.
 */
export function findBestMatch(
	input: string,
	rules: MappingRule[],
	context: RuleEvaluationContext,
	groupPrecedence?: string[]
): RuleMatch | null {
	const matches = findMatchingRules(input, rules, context);

	if (matches.length === 0) {
		return null;
	}

	// === F1 Step 3 — Partition matches by group ===
	const byGroup = new Map<string, RuleMatch[]>();
	for (const match of matches) {
		const groupKey = match.rule.group ?? '__default__';
		if (!byGroup.has(groupKey)) {
			byGroup.set(groupKey, []);
		}
		byGroup.get(groupKey)!.push(match);
	}

	// === Sort groups by precedence ===
	// Groups in groupPrecedence get rank by their list position (lower index = higher precedence).
	// Groups not listed fall to lowest precedence with alphabetical tiebreak among themselves.
	const groupRank = (g: string): number => {
		if (groupPrecedence) {
			const idx = groupPrecedence.indexOf(g);
			if (idx !== -1) return idx;
		}
		// Unlisted: rank after all listed groups; sub-rank by alphabetical position
		const listedCount = groupPrecedence?.length ?? 0;
		return listedCount + 1; // shared "after-all-listed" bucket; alphabetical sort below distinguishes them
	};

	const groupsInOrder = Array.from(byGroup.keys()).sort((a, b) => {
		const rankDiff = groupRank(a) - groupRank(b);
		if (rankDiff !== 0) return rankDiff;
		// Tiebreak: alphabetical (deterministic and stable for ungrouped/unlisted rules)
		return a.localeCompare(b);
	});

	// === Within the winning group, apply the Step 1+2 specificity sort ===
	const winningGroup = groupsInOrder[0];
	const groupMatches = byGroup.get(winningGroup)!;

	groupMatches.sort((a, b) => {
		if (a.confidence !== b.confidence) {
			return b.confidence - a.confidence;
		}
		return a.rule.priority - b.rule.priority;
	});

	return groupMatches[0];
}

/**
 * Find all potential conflicts (multiple rules with same priority matching)
 */
export function findConflicts(
	input: string,
	rules: MappingRule[],
	context: RuleEvaluationContext
): RuleMatch[][] {
	const matches = findMatchingRules(input, rules, context);

	if (matches.length <= 1) {
		return [];
	}

	// Group by priority
	const byPriority = new Map<number, RuleMatch[]>();

	for (const match of matches) {
		const priority = match.rule.priority;
		if (!byPriority.has(priority)) {
			byPriority.set(priority, []);
		}
		byPriority.get(priority)!.push(match);
	}

	// Return groups with more than one rule
	const conflicts: RuleMatch[][] = [];
	for (const group of byPriority.values()) {
		if (group.length > 1) {
			conflicts.push(group);
		}
	}

	return conflicts;
}

/**
 * Calculate match confidence based on pattern specificity.
 *
 * Implements Formula 3 from the specificity-and-groups research entry:
 * heavier penalty for greedy wildcards, light penalty for capture groups
 * (named or anonymous), literal-character bonus capped at 0.3, anchor-aware
 * bonus when the rule declares a folder anchor.
 *
 * The output range is [0, 1]. The function is currently used as the
 * tiebreaker after priority in `findBestMatch`; Increment 1 Step 2 will
 * promote it to the primary sort key. This refactor preserves the
 * tiebreak contract — same output range, same monotonicity for the
 * canonical PARA / JD / SEACOW patterns — while improving the score's
 * fidelity for use as a primary key.
 *
 * **Exported** for the audit script (`scripts/audit-confidence-formula.ts`)
 * which compares the new formula's implied ordering against user-authored
 * priorities on shipped rule packs. Not part of the plugin's public API.
 *
 * @param input - The folder path or tag being evaluated
 * @param pattern - The rule's regex pattern (folderPattern or tagPattern)
 * @param anchor - Optional folder anchor; only meaningful for folder matches.
 *                When present, contributes the anchor-aware bonus.
 */
export function calculateMatchConfidence(
	input: string,
	pattern: string,
	anchor?: FolderAnchor
): number {
	// Exact-match shortcut — preserved from prior implementation
	if (pattern === input) {
		return 1.0;
	}

	let confidence = 0.5;

	// === Wildcard / capture-group penalties ===

	// Greedy regex wildcards (.* and .+) reduce specificity the most.
	// Each one signals "anything goes here" which makes the pattern less specific.
	const greedyWildcards = (pattern.match(/\.[*+]/g) || []).length;
	confidence -= greedyWildcards * 0.15;

	// Remaining bare `*` (glob-style or regex quantifier on a class).
	// Lighter penalty than greedy wildcards.
	const totalStars = (pattern.match(/\*/g) || []).length;
	const remainingStars = Math.max(0, totalStars - greedyWildcards);
	confidence -= remainingStars * 0.10;

	// Capture groups — anonymous `(...)` and named `(?<name>...)` — both reduce specificity
	// because they say "match arbitrary content here." Same weight regardless of named/anonymous.
	const anonCaptures = (pattern.match(/\([^?]/g) || []).length;
	const namedSlots = (pattern.match(/\(\?<\w+>/g) || []).length;
	const captureGroups = anonCaptures + namedSlots;
	confidence -= captureGroups * 0.05;

	// === Specificity bonuses ===

	// Literal character count (excluding regex metacharacters and capture-group syntax)
	// — bonus capped at 0.3. More literal characters = the pattern is more committed
	// to a specific shape. Named-capture prefixes `(?<name>` are stripped *first* so
	// the slot name doesn't inflate the literal count; then the remaining metacharacters
	// (including `<` and `>` from any other context) are stripped.
	const literalChars = pattern
		.replace(/\(\?<\w+>/g, '')                  // strip named-capture syntax including slot name
		.replace(/\(\?[:!=]/g, '')                  // strip non-capturing-group / lookahead prefixes
		.replace(/[\\^$.*+?(){}\[\]|<>]/g, '')      // strip remaining regex metachars + < >
		.length;
	confidence += Math.min(literalChars / 50, 0.3);

	// Slash count — path-depth specificity. A pattern matching `Projects/Web/Auth`
	// (3 slashes) is more specific than one matching `Projects` (0 slashes).
	const slashCount = (pattern.match(/\//g) || []).length;
	confidence += slashCount * 0.04;

	// === Anchor-aware bonus ===
	// Root-anchored rules are the most specific (they pin the rule to the vault root).
	// Under-prefix rules are slightly less specific (anchored to a parent path).
	// Any-segment rules and unanchored patterns get no bonus.
	if (anchor === 'root') {
		confidence += 0.10;
	} else if (typeof anchor === 'object' && anchor !== null && 'under' in anchor) {
		confidence += 0.08;
	}

	// Clamp to 0-1 range
	return Math.max(0, Math.min(1, confidence));
}

/**
 * Check if a rule is applicable for a given direction
 */
export function isRuleApplicable(
	rule: MappingRule,
	direction: RuleDirection
): boolean {
	return rule.direction === 'bidirectional' || rule.direction === direction;
}

/**
 * Get all rules applicable for folder-to-tag transformation
 */
export function getFolderToTagRules(rules: MappingRule[]): MappingRule[] {
	return rules.filter(r =>
		r.enabled &&
		r.folderPattern &&
		isRuleApplicable(r, 'folder-to-tag')
	);
}

/**
 * Get all rules applicable for tag-to-folder transformation
 */
export function getTagToFolderRules(rules: MappingRule[]): MappingRule[] {
	return rules.filter(r =>
		r.enabled &&
		r.tagPattern &&
		isRuleApplicable(r, 'tag-to-folder')
	);
}

/**
 * Validate a rule configuration
 */
export function validateRule(rule: MappingRule): {
	valid: boolean;
	errors: string[];
} {
	const errors: string[] = [];

	// Check basic fields
	if (!rule.id || rule.id.trim() === '') {
		errors.push('Rule must have a valid ID');
	}

	if (!rule.name || rule.name.trim() === '') {
		errors.push('Rule must have a name');
	}

	if (rule.priority < 0) {
		errors.push('Priority must be non-negative');
	}

	// Check direction-specific requirements
	if (rule.direction === 'folder-to-tag' || rule.direction === 'bidirectional') {
		if (!rule.folderPattern) {
			errors.push('Folder-to-tag rules must have a folder pattern');
		}
	}

	if (rule.direction === 'tag-to-folder' || rule.direction === 'bidirectional') {
		if (!rule.tagPattern) {
			errors.push('Tag-to-folder rules must have a tag pattern');
		}
	}

	// Validate patterns
	if (rule.folderPattern) {
		try {
			patternToRegex(rule.folderPattern);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`Invalid folder pattern: ${message}`);
		}
	}

	if (rule.tagPattern) {
		try {
			patternToRegex(rule.tagPattern);
		} catch (error) {
			const message = error instanceof Error ? error.message : String(error);
			errors.push(`Invalid tag pattern: ${message}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors
	};
}
