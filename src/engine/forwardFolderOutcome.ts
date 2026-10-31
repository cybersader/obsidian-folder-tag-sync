import type { MappingRule } from '../types/settings';
import { applyRuleForward } from './applyTransfer';
import { findMatchingRules, selectBestMatch, type RuleMatch } from './ruleMatcher';

export function isDegenerateForwardTag(tag: string): boolean {
	const body = tag.startsWith('#') ? tag.slice(1) : tag;
	return body === '' || body.split('/').some((segment) => segment === '' || /^[-_]+$/.test(segment));
}
export interface ForwardFolderOutcome {
	state: 'no-match' | 'empty' | 'invalid' | 'valid';
	winner: MappingRule | null;
	matches: RuleMatch[];
	tags: string[];
	error: string | null;
}
/** Shared with outline review; an invalid winner is never replaced by a runner-up. */
export function evaluateForwardFolder(
	folderPath: string, rules: readonly MappingRule[], precedence: readonly string[] = [],
): ForwardFolderOutcome {
	const matches = findMatchingRules(folderPath, [...rules], {
		input: folderPath, matchType: 'folder', direction: 'folder-to-tag',
	});
	const winner = selectBestMatch(matches, [...precedence])?.rule ?? null;
	if (!winner) return { state: 'no-match', winner, matches, tags: [], error: null };
	try {
		const tags = applyRuleForward(folderPath, winner).tags;
		const invalid = tags.some(isDegenerateForwardTag);
		return { state: tags.length === 0 ? 'empty' : invalid ? 'invalid' : 'valid', winner, matches, tags,
			error: invalid ? 'Matched rule produces unusable tag syntax. The live writer is not guaranteed to reject it.' : null };
	} catch (error) {
		return { state: 'invalid', winner, matches, tags: [], error: error instanceof Error && error.message.trim() !== '' ? error.message
			: typeof error === 'string' && error.trim() !== '' ? error : 'Rule output could not be generated.' };
	}
}
