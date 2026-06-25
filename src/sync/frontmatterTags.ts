/**
 * Pure frontmatter tag read/write helpers (no Obsidian dependency).
 *
 * Why this module exists
 * ──────────────────────
 * `FolderToTagSync` used to read and write the `tags:` property with a single
 * greedy mega-regex `/tags:\s*\n?((?:\s{2}- .+\n?)*|\[.*?\])/`. That regex is
 * broken in two ways:
 *
 *   1. READ — the `\s*` after `tags:` eagerly consumes the newline *and* the
 *      two-space indent before the capture group, so the block-list branch
 *      `(?:\s{2}- .+\n?)*` can never match (the indent is already gone) and the
 *      capture falls through to empty. Net result: `extractTags` returned `[]`
 *      for EVERY shape — including the canonical block list the plugin writes
 *      itself. So a second sync of an already-tagged file never saw the tag and
 *      re-added it.
 *
 *   2. WRITE — `frontmatter.replace(regex, 'tags:\n  - x')` only matched
 *      `tags:\n  ` and left the old list value dangling immediately after the
 *      replacement, producing the corruption reported in issue #1:
 *      `  - work/projects/my-project- work/projects/my-project`.
 *
 * This module replaces that logic with a LINE-BASED parser/writer that:
 *   - reads inline scalars (`tags: a/b`), inline arrays (`tags: [a, b]`),
 *     and block lists (`tags:\n  - a\n  - b`), including blocks that sit
 *     before/after other top-level properties;
 *   - heals the two glued-duplicate corruption shapes (`<tag>- <tag>` and
 *     `<tag><tag>`) so a corrupted file self-heals to a clean block on the
 *     next write;
 *   - strips surrounding quotes, dedupes order-preserving, and never splits
 *     on `/` (nested tags survive);
 *   - on write, replaces the *whole* existing tags block by line span (never a
 *     regex substitution), so siblings are byte-preserved and nothing is left
 *     dangling.
 *
 * Mirrors the `frontmatterWitness.ts` pattern (pure, directly unit-testable).
 */

/**
 * Matches the top-level `tags:` (or singular `tag:`) key line. `^` anchors to
 * column 0 so indented keys (which would be nested under something else) are
 * never treated as the tags key. Capture group 2 is the inline value, if any.
 */
const TAGS_KEY_RE = /^(tags|tag)\s*:(.*)$/i;

/**
 * Matches a YAML block-list item line: indentation, a hyphen, then the value.
 * Indentation is REQUIRED — this is what Obsidian's Properties editor always
 * writes, and requiring it avoids ever consuming a column-0 `---` or a sibling
 * top-level key as if it were a list item. (Hand-authored zero-indent lists are
 * an accepted limitation — the metadata-cache fallback in the sync engine
 * covers them for the write decision.)
 */
const LIST_ITEM_RE = /^\s+-\s*(.*)$/;

/**
 * Strip a single layer of matching surrounding quotes (single or double).
 */
function stripQuotes(raw: string): string {
	const t = raw.trim();
	if (
		t.length >= 2 &&
		((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
	) {
		return t.slice(1, -1);
	}
	return t;
}

/**
 * Collapse an exact even-length doubling (`my-projectmy-project` →
 * `my-project`). This heals the inline-scalar / direct-concat corruption shape
 * where the same tag value was written twice back-to-back with no separator.
 *
 * Note: a legitimately doubled value (a tag a user literally named `abab`)
 * would also collapse — this is an accepted, rare risk on the *repair* path.
 * Nested tags are mostly safe because a separator (`foo/foo` → 7 chars) makes
 * the string odd-length, which never collapses; only the separator-less glue
 * (even length) does.
 */
function collapseDoubling(s: string): string {
	const n = s.length;
	if (n >= 2 && n % 2 === 0) {
		const half = n / 2;
		if (s.slice(0, half) === s.slice(half)) return s.slice(0, half);
	}
	return s;
}

/**
 * Split a single raw tag value into one or more healed tag tokens.
 *
 * Variant A (block-list replace glue): `<tag>- <tag>` — a hyphen followed by
 * whitespace cannot legally occur inside an Obsidian tag (tags have no
 * spaces), so it is an unambiguous boundary marker left by the broken
 * `replace`. Split on it.
 *
 * Variant B/C (inline-scalar concat glue): `<tag><tag>` — collapse exact
 * even-length doubling per `collapseDoubling`.
 *
 * A clean single tag (`work/projects/my-project`) passes through unchanged:
 * no `- ` boundary, and its halves differ so no doubling collapse.
 */
export function splitGluedTagValue(value: string): string[] {
	const v = value.trim();
	if (!v) return [];
	// Variant A — split on the illegal "- " (hyphen + whitespace) boundary.
	const parts = v
		.split(/\s*-\s+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	// Variant B/C — collapse direct doubling on each surviving piece.
	return parts.map((p) => collapseDoubling(p));
}

/**
 * Locate the line span [start, end) of the top-level tags block within a list
 * of frontmatter lines. For an inline value (scalar or array) the block is the
 * single key line. For an empty key line (`tags:`) the block extends across the
 * following indented list-item lines. Returns null when no tags key exists.
 */
function findTagsBlock(lines: string[]): { start: number; end: number } | null {
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(TAGS_KEY_RE);
		if (!m) continue;
		const inline = m[2].trim();
		if (inline.length > 0) {
			// Inline scalar or inline array — single-line block.
			return { start: i, end: i + 1 };
		}
		// Empty inline value — consume following indented list-item lines.
		let j = i + 1;
		while (j < lines.length && LIST_ITEM_RE.test(lines[j])) j++;
		return { start: i, end: j };
	}
	return null;
}

/**
 * Turn a list of raw tag values into a deduped, `#`-prefixed token list,
 * stripping quotes and healing glued corruption along the way.
 */
function normalizeValues(rawValues: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of rawValues) {
		const cleaned = stripQuotes(raw);
		for (const piece of splitGluedTagValue(cleaned)) {
			const token = piece.replace(/^#+/, '').trim();
			if (token && !seen.has(token)) {
				seen.add(token);
				out.push(`#${token}`);
			}
		}
	}
	return out;
}

/**
 * Parse the `tags:` (or `tag:`) property out of a frontmatter YAML string.
 *
 * Handles inline scalar, inline array, and block-list shapes; strips quotes;
 * splits + dedupes glued-duplicate corruption; preserves nested-slash tags.
 * Returns tags normalized to `#`-prefixed form (the contract the sync engine's
 * comparison and orphan-cleanup code depend on). Returns `[]` for a missing
 * key, an empty value, an empty array, or an unterminated multiline flow array
 * (the latter is the documented gap that the metadata-cache fallback covers).
 */
export function parseFrontmatterTags(frontmatter: string): string[] {
	if (!frontmatter || !frontmatter.trim()) return [];
	const lines = frontmatter.split('\n');
	const block = findTagsBlock(lines);
	if (!block) return [];

	const keyMatch = lines[block.start].match(TAGS_KEY_RE);
	if (!keyMatch) return [];
	const inline = keyMatch[2].trim();

	const rawValues: string[] = [];
	if (inline.length > 0) {
		if (inline.startsWith('[')) {
			// Inline flow array — must be closed on the same line. An
			// unterminated `[` (multiline flow array) yields no values here;
			// the sync engine's metadata-cache fallback handles that shape.
			const open = inline.indexOf('[');
			const close = inline.lastIndexOf(']');
			if (close > open) {
				const content = inline.slice(open + 1, close);
				if (content.trim().length > 0) {
					for (const part of content.split(',')) rawValues.push(part);
				}
			}
		} else {
			// Inline scalar — a single value (possibly a glued duplicate).
			rawValues.push(inline);
		}
	} else {
		// Block list — collect the indented list-item values.
		for (let i = block.start + 1; i < block.end; i++) {
			const lm = lines[i].match(LIST_ITEM_RE);
			if (lm) rawValues.push(lm[1]);
		}
	}

	return normalizeValues(rawValues);
}

/**
 * Write `tags` into a frontmatter YAML string, normalizing whatever shape was
 * there before into a clean block list.
 *
 * - Empty/blank frontmatter → returns a bare `tags:` block.
 * - Existing tags block (any shape) → replaced by whole-line span, so sibling
 *   properties are byte-preserved and no old value is left dangling.
 * - No tags key → a new block is appended, existing frontmatter intact.
 *
 * `tags` may be `#`-prefixed or not; the prefix is stripped for YAML output.
 * Input is deduped order-preserving. An empty result is written as `tags: []`.
 */
export function setFrontmatterTags(frontmatter: string, tags: string[]): string {
	const seen = new Set<string>();
	const clean: string[] = [];
	for (const t of tags) {
		const token = t.replace(/^#+/, '').trim();
		if (token && !seen.has(token)) {
			seen.add(token);
			clean.push(token);
		}
	}

	const blockLines =
		clean.length > 0 ? ['tags:', ...clean.map((t) => `  - ${t}`)] : ['tags: []'];

	if (!frontmatter || !frontmatter.trim()) {
		return blockLines.join('\n');
	}

	const lines = frontmatter.split('\n');
	const block = findTagsBlock(lines);
	if (block) {
		const before = lines.slice(0, block.start);
		const after = lines.slice(block.end);
		return [...before, ...blockLines, ...after].join('\n');
	}

	// No tags key present — append a fresh block, preserving existing content.
	return `${frontmatter.replace(/\n+$/, '')}\n${blockLines.join('\n')}`;
}
