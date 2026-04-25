/**
 * Rule preview — applies a rule against a list of folder paths and reports
 * what it would do. Pure (no Obsidian, no I/O); the UI passes in the
 * vault's folder list and renders the result.
 *
 * Used by the settings tab: click a rule, see "this rule matches N folders
 * in your vault and would emit these tags. Sample: <folder> → <tag>."
 *
 * The library-science framing made visible — the user sees the runtime's
 * recoordination decision before committing, not after debug.log triage.
 */

import type { MappingRule } from '../types/settings';
import { applyRuleForward } from './applyTransfer';

export interface RulePreviewSample {
	folder: string;
	tags: string[];
}

export interface RulePreview {
	/** Folder paths in the vault that this rule's pattern matches. */
	matchedFolders: string[];
	/** Distinct tags the rule would emit across all matched folders. */
	emittedTags: string[];
	/** A few illustrative folder→tag(s) examples (sorted by folder, capped). */
	samples: RulePreviewSample[];
	/** Folders that would be tagged with at least one tag this rule emits. */
	matchCount: number;
	/**
	 * If the rule's transfer is `opaque`, it intentionally emits nothing.
	 * UI can show "this rule deliberately produces no tags" instead of
	 * "0 matches — broken rule".
	 */
	opaqueByDesign: boolean;
}

export interface PreviewOptions {
	/** Cap the number of samples returned. Default 5. */
	maxSamples?: number;
}

/**
 * Compute a preview of what `rule` would do against the given folder list.
 *
 * Empty match list → either the pattern doesn't match anything (likely a
 * misconfigured rule) or the rule's transfer is `opaque` (intentional).
 * The caller distinguishes via `opaqueByDesign`.
 */
export function previewRule(
	rule: MappingRule,
	folderPaths: string[],
	options: PreviewOptions = {},
): RulePreview {
	const maxSamples = options.maxSamples ?? 5;
	const matchedFolders: string[] = [];
	const tagSet = new Set<string>();
	const samples: RulePreviewSample[] = [];

	const opaqueByDesign = rule.transfer?.op === 'opaque';

	// For opaque rules, applyRuleForward returns `tags: []` whether the
	// pattern matched (intentional non-emission) or didn't match at all.
	// Re-check the pattern manually so we count rule-applicability accurately.
	const folderPatternRegex = rule.folderPattern ? new RegExp(rule.folderPattern) : null;

	for (const folder of folderPaths) {
		if (opaqueByDesign) {
			if (folderPatternRegex && folderPatternRegex.test(folder)) {
				matchedFolders.push(folder);
				if (samples.length < maxSamples) samples.push({ folder, tags: [] });
			}
			continue;
		}

		const result = applyRuleForward(folder, rule);
		if (result.tags.length === 0) continue;

		matchedFolders.push(folder);
		for (const t of result.tags) tagSet.add(t);

		if (samples.length < maxSamples) {
			samples.push({ folder, tags: result.tags });
		}
	}

	// Stable: sort by folder path
	matchedFolders.sort();
	samples.sort((a, b) => a.folder.localeCompare(b.folder));

	return {
		matchedFolders,
		emittedTags: [...tagSet].sort(),
		samples,
		matchCount: matchedFolders.length,
		opaqueByDesign,
	};
}
