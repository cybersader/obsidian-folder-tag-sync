/**
 * Per-folder rule view — the folder-major companion to `ruleCoverage`.
 *
 * `ruleCoverage` answers the rule-major question "for rule R, which folders
 * does it touch?". This module answers the transpose, folder-major: "for
 * folder F, which of my installed rules WINS, what tag does it emit, which
 * rules also match, and is there a conflict?".
 *
 * The Taxonomy Workbench map needs the folder-major shape so it can annotate
 * each folder ROW with what the user's installed rules actually do — distinct
 * from the detection-system chips that show what *could* apply. Where the
 * detection layer answers "what organizational systems live here", this layer
 * answers "what will my rules emit here".
 *
 * It reuses the production matcher (`findBestMatch` / `findMatchingRules`) and
 * the forward engine (`applyRuleForward`), so the map reflects the SAME
 * resolution the sync engine performs — group precedence first, then
 * specificity, then priority as the tiebreak — and the same recoordinated
 * emission. Pure: no Obsidian, no I/O. The caller passes the vault's folder
 * list, the rules, and the optional group-precedence order.
 */

import type { MappingRule } from '../types/settings';
import { findBestMatch, findMatchingRules, type RuleEvaluationContext } from './ruleMatcher';
import { applyRuleForward } from './applyTransfer';

export interface FolderRuleEntry {
	/** Id of the rule that wins forward resolution for this folder; null when none matches. */
	winnerRuleId: string | null;
	/** Display name of the winning rule; null when no rule matches. */
	winnerRuleName: string | null;
	/** Tags the winning rule would emit for this folder (empty for opaque / no winner). */
	emittedTags: string[];
	/** Ids of EVERY enabled forward rule whose pattern matches this folder. */
	matchingRuleIds: string[];
	/** True when 2+ enabled forward rules match — the row is ambiguous. */
	conflict: boolean;
}

/**
 * Compute the folder-major rule view across `folderPaths`. For each folder:
 *
 *   - winner        = `findBestMatch` (group precedence → specificity → priority)
 *   - emittedTags   = `applyRuleForward(folder, winner)`
 *   - matchingRuleIds = every enabled forward rule whose pattern matches
 *   - conflict      = `matchingRuleIds.length >= 2`
 *
 * Only the FORWARD direction (folder-to-tag / bidirectional) participates —
 * tag-to-folder rules don't emit tags from folders, so they never win or
 * conflict here. Folders no forward rule matches get a null-winner entry so
 * the caller can render "no rule covers this folder" without a second lookup.
 */
export function computeFolderRuleView(
	folderPaths: string[],
	rules: MappingRule[],
	groupPrecedence?: string[],
): Map<string, FolderRuleEntry> {
	const view = new Map<string, FolderRuleEntry>();

	for (const folderPath of folderPaths) {
		// `direction: 'folder-to-tag'` includes bidirectional rules and excludes
		// pure tag-to-folder rules (see evaluateRule's direction gate).
		const context: RuleEvaluationContext = {
			input: folderPath,
			matchType: 'folder',
			direction: 'folder-to-tag',
		};

		const matches = findMatchingRules(folderPath, rules, context);
		const matchingRuleIds = matches.map((m) => m.rule.id);

		const best = findBestMatch(folderPath, rules, context, groupPrecedence);

		let emittedTags: string[] = [];
		if (best) {
			try {
				emittedTags = applyRuleForward(folderPath, best.rule).tags;
			} catch {
				// A misconfigured rule (bad regex in entry stripping, etc.) shouldn't
				// crash the whole view — treat it as "winner found, emits nothing".
				emittedTags = [];
			}
		}

		view.set(folderPath, {
			winnerRuleId: best ? best.rule.id : null,
			winnerRuleName: best ? best.rule.name : null,
			emittedTags,
			matchingRuleIds,
			conflict: matchingRuleIds.length >= 2,
		});
	}

	return view;
}
