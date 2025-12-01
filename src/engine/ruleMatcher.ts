/**
 * Rule matching and pattern evaluation engine
 *
 * Evaluates folder paths and tags against configured rules,
 * finding the best matching rule based on priority and pattern matching.
 */

import { MappingRule, RuleDirection } from '../types/settings';
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
	const confidence = calculateMatchConfidence(input, pattern);

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
 * Find the best matching rule based on priority and confidence
 * Returns the highest priority rule, breaking ties with confidence
 */
export function findBestMatch(
	input: string,
	rules: MappingRule[],
	context: RuleEvaluationContext
): RuleMatch | null {
	const matches = findMatchingRules(input, rules, context);

	if (matches.length === 0) {
		return null;
	}

	// Sort by priority (lower number = higher priority), then by confidence
	matches.sort((a, b) => {
		if (a.rule.priority !== b.rule.priority) {
			return a.rule.priority - b.rule.priority;
		}
		return b.confidence - a.confidence;
	});

	return matches[0];
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
 * Calculate match confidence based on pattern specificity
 * More specific patterns (less wildcards, more literal chars) = higher confidence
 */
function calculateMatchConfidence(input: string, pattern: string): number {
	// Base confidence
	let confidence = 0.5;

	// Exact match = highest confidence
	if (pattern === input) {
		return 1.0;
	}

	// Count wildcards (reduce confidence for each)
	const wildcardCount = (pattern.match(/\*/g) || []).length;
	const questionMarkCount = (pattern.match(/\?/g) || []).length;

	confidence -= wildcardCount * 0.1;
	confidence -= questionMarkCount * 0.05;

	// Longer patterns are generally more specific
	const patternLength = pattern.replace(/[*?]/g, '').length;
	const lengthRatio = patternLength / input.length;
	confidence += lengthRatio * 0.2;

	// Patterns with directory structure are more specific
	const slashCount = (pattern.match(/\//g) || []).length;
	confidence += slashCount * 0.05;

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
			errors.push(`Invalid folder pattern: ${error}`);
		}
	}

	if (rule.tagPattern) {
		try {
			patternToRegex(rule.tagPattern);
		} catch (error) {
			errors.push(`Invalid tag pattern: ${error}`);
		}
	}

	return {
		valid: errors.length === 0,
		errors
	};
}
