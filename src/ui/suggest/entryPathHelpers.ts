/**
 * Pure source-list helpers for EntryPathSuggest. Extracted from the
 * suggester class so they're unit-testable without DOM / Obsidian
 * runtime imports.
 */

const MAX_VISIBLE = 30;

/**
 * Build the source list for the FOLDER entry suggester. Walks the vault
 * folder tree once and returns paths sorted alphabetically. Excludes the
 * empty root.
 */
export function collectFolderSources(folders: string[]): string[] {
	return [...folders].sort((a, b) => a.localeCompare(b));
}

/**
 * Build the source list for the TAG entry suggester. Takes Obsidian's
 * metadataCache.getTags() output (`Record<string, count>` of `#tag`
 * strings) and expands each tag into its prefix variants:
 *
 *   `#-clip/web/react` → `-clip`, `-clip/web`, `-clip/web/react`
 *
 * Why expand: a user typing `-c` should be able to land at `-clip` (a
 * prefix), not just at the leaf `-clip/web/react`. Each prefix is then
 * a candidate `tagEntry`. Dedupes + sorts shortest-first so typing a
 * short query surfaces the entry-point form before its descendants.
 */
export function collectTagSources(tagsRecord: Record<string, number>): string[] {
	const set = new Set<string>();
	for (const fullTag of Object.keys(tagsRecord)) {
		// Strip leading '#'
		const tag = fullTag.startsWith('#') ? fullTag.slice(1) : fullTag;
		if (!tag) continue;
		const segments = tag.split('/');
		for (let i = 1; i <= segments.length; i += 1) {
			set.add(segments.slice(0, i).join('/'));
		}
	}
	return [...set].sort((a, b) => {
		// Shortest first, then alphabetical within same length
		if (a.length !== b.length) return a.length - b.length;
		return a.localeCompare(b);
	});
}

/**
 * Rank a query against a source list — pure, identical to the matching
 * the class uses inside getSuggestions(). Exposed for unit testing.
 *
 * Empty query → first MAX_VISIBLE items in source order.
 * Non-empty → case-insensitive: prefix matches first, then substring.
 */
export function rankSuggestions(query: string, sources: string[]): string[] {
	const q = query.trim().toLowerCase();
	if (!q) return sources.slice(0, MAX_VISIBLE);

	const prefixHits: string[] = [];
	const substringHits: string[] = [];
	for (const item of sources) {
		const lower = item.toLowerCase();
		if (lower.startsWith(q)) {
			prefixHits.push(item);
		} else if (lower.includes(q)) {
			substringHits.push(item);
		}
		if (prefixHits.length + substringHits.length >= MAX_VISIBLE * 2) break;
	}
	return [...prefixHits, ...substringHits].slice(0, MAX_VISIBLE);
}
