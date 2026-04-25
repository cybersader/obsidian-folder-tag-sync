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
	/**
	 * If the rule's folderPattern is invalid regex, set instead of crashing.
	 * Consumers should render a friendly error rather than treating this as
	 * "0 matches" (which would be a misleading diagnosis). When set, all
	 * other fields are zero/empty.
	 */
	invalidRegex?: { which: 'folder' | 'tag'; error: string };
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
	let folderPatternRegex: RegExp | null = null;
	if (rule.folderPattern) {
		try {
			folderPatternRegex = new RegExp(rule.folderPattern);
		} catch (err) {
			// Don't throw; preview is a UI-facing operation and a broken
			// regex is a configuration mistake, not a code bug. Return
			// early with invalidRegex so the caller can show a friendly
			// message.
			return {
				matchedFolders: [],
				emittedTags: [],
				samples: [],
				matchCount: 0,
				opaqueByDesign,
				invalidRegex: {
					which: 'folder',
					error: err instanceof Error ? err.message : String(err),
				},
			};
		}
	}

	for (const folder of folderPaths) {
		if (opaqueByDesign) {
			if (folderPatternRegex && folderPatternRegex.test(folder)) {
				matchedFolders.push(folder);
				if (samples.length < maxSamples) samples.push({ folder, tags: [] });
			}
			continue;
		}

		// applyRuleForward also constructs regexes (folderEntryPoint / tag
		// entry stripping). Defensive try/catch — the same regex error
		// would otherwise crash mid-loop and leave a half-rendered panel.
		let result;
		try {
			result = applyRuleForward(folder, rule);
		} catch (err) {
			return {
				matchedFolders: [],
				emittedTags: [],
				samples: [],
				matchCount: 0,
				opaqueByDesign,
				invalidRegex: {
					which: 'folder',
					error: err instanceof Error ? err.message : String(err),
				},
			};
		}
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
