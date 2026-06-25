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
 *     multiline flow arrays (`tags: [\n  a\n]`), and block lists
 *     (`tags:\n  - a\n  - b`), including blocks that sit before/after other
 *     top-level properties;
 *   - heals the issue-#1 `<tag>- <tag>` glue corruption (a `- ` / `, ` sequence
 *     is illegal inside a real Obsidian tag, so it's an unambiguous corruption
 *     marker) WITHOUT touching clean values;
 *   - strips surrounding quotes and trailing `# comments`, dedupes
 *     order-preserving, and never splits on `/` (nested tags survive);
 *   - ignores bare YAML null/bool/number scalars (`tags: null` ⇒ no tags, the
 *     same as Obsidian);
 *   - on write, replaces ALL existing tags blocks (any shape, any count) by line
 *     span with a single clean block — never a regex substitution — so siblings
 *     are byte-preserved, nothing is left dangling, and duplicate `tags:` keys
 *     collapse into one.
 *
 * Line endings: callers normally feed LF (the sync engine normalizes CRLF / BOM
 * before delegating here), but these helpers also normalize `\r\n` / lone `\r`
 * defensively so a direct CRLF call still parses/writes correctly.
 *
 * What this module deliberately does NOT do
 * ─────────────────────────────────────────
 * The separator-less doubling shapes (`my-projectmy-project`,
 * `my-projectmy-projectmy-project`) are NOT auto-healed. A blind even-length
 * "halve it" heuristic cannot distinguish the corruption `bonbon` (from
 * `bon`+`bon`) from the legitimate tag `bonbon`, so it silently destroyed real
 * user tags (`2020`→`20`, `couscous`→`cous`) on every read. Only the
 * unambiguous separator-bearing variant-A glue is repaired; the separator-less
 * variants are an accepted, documented limitation (the value is treated as a
 * single literal tag — lossless, never corrupting).
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
 * Matches an indented full-line YAML comment (`  # …`) sitting inside a block.
 * Such a line is skipped while walking a block so it never hides the list items
 * that follow it. Only *indented* comments are absorbed — a column-0 comment is
 * left alone so it can't be swallowed (and lost on write) from between two
 * top-level properties.
 */
const INDENTED_COMMENT_RE = /^\s+#/;

/**
 * Normalize CRLF / lone-CR line endings to LF. Correctness (a single, valid
 * frontmatter block) is prioritized over preserving the original CRLF style.
 */
function normalizeNewlines(s: string): string {
	return s.replace(/\r\n?/g, '\n');
}

/**
 * True when a value is wrapped in a single matching pair of quotes.
 */
function isQuoted(raw: string): boolean {
	const t = raw.trim();
	return (
		t.length >= 2 &&
		((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'")))
	);
}

/**
 * Strip a single layer of matching surrounding quotes (single or double).
 */
function stripQuotes(raw: string): string {
	const t = raw.trim();
	if (isQuoted(t)) {
		return t.slice(1, -1);
	}
	return t;
}

/**
 * Strip a trailing YAML `# comment` from an unquoted value. A comment requires
 * whitespace before the `#` AND non-whitespace content before that (so a leading
 * `#alpha` — a `#`-prefixed tag — and a bare `#comment`-only value are left for
 * the caller to decide on, and aren't mangled here). Quoted values are returned
 * untouched.
 */
function stripInlineComment(raw: string): string {
	if (isQuoted(raw)) return raw;
	return raw.replace(/(\S)\s+#.*$/, '$1');
}

/**
 * True for a bare (unquoted) YAML scalar that is NOT a tag: `null`, `~`,
 * `true`/`false`, or a number. Obsidian treats `tags: null` (and friends) as an
 * empty tag list, so we do too. This is applied ONLY to an inline scalar value
 * of the `tags:` key — block-list items are never filtered, so a numeric tag
 * written as `- 2020` is preserved.
 */
function isBareEmptyScalar(value: string): boolean {
	const t = value.trim();
	if (t === '') return true;
	if (/^(null|~|true|false)$/i.test(t)) return true;
	if (/^[+-]?(?:\d+\.?\d*|\.\d+)(?:[eE][+-]?\d+)?$/.test(t)) return true;
	return false;
}

/**
 * Net `[` − `]` count on a line, used to track flow-array bracket depth across
 * lines (Obsidian/YAML tags never contain literal brackets, so a raw count is
 * safe here).
 */
function bracketDelta(line: string): number {
	let delta = 0;
	for (const ch of line) {
		if (ch === '[') delta++;
		else if (ch === ']') delta--;
	}
	return delta;
}

/**
 * Split a single raw tag value into one or more healed tag tokens.
 *
 * The only corruption shape healed here is the issue-#1 block-list "replace"
 * glue: `<tag>- <tag>` (and the comma variant `<tag>, <tag>`). A hyphen or comma
 * followed by whitespace cannot legally occur inside an Obsidian tag (tags have
 * no spaces), so it's an unambiguous boundary marker left by the old broken
 * `replace`. We split on it and dedupe the pieces, so
 * `work/projects/my-project- work/projects/my-project` heals back to a single
 * `work/projects/my-project`.
 *
 * A clean value (`work/projects/my-project`, `my-project`, `bonbon`, `2020`)
 * has no such boundary and passes through unchanged. Separator-less doubling is
 * intentionally NOT collapsed — see the module header.
 */
export function splitGluedTagValue(value: string): string[] {
	const v = value.trim();
	if (!v) return [];
	const parts = v
		.split(/\s*[-,]\s+/)
		.map((p) => p.trim())
		.filter((p) => p.length > 0);
	// Dedupe order-preserving so `<tag>- <tag>` collapses to a single tag.
	const seen = new Set<string>();
	const out: string[] = [];
	for (const p of parts) {
		if (!seen.has(p)) {
			seen.add(p);
			out.push(p);
		}
	}
	return out;
}

/**
 * Locate the line span [start, end) of EVERY top-level tags block in a list of
 * frontmatter lines (there should be one, but duplicate `tags:` keys are healed
 * by reading/collapsing all of them).
 *
 * - Inline scalar / single-line inline array → the single key line.
 * - Multiline flow array (`tags: [` … `]`) → the key line through the line that
 *   closes the bracket (so a write replaces the whole thing, never leaving a
 *   dangling `]`).
 * - Empty key line (`tags:`) → the key line plus the following indented
 *   list-item and indented-comment lines.
 */
function findAllTagsBlocks(lines: string[]): Array<{ start: number; end: number }> {
	const blocks: Array<{ start: number; end: number }> = [];
	for (let i = 0; i < lines.length; i++) {
		const m = lines[i].match(TAGS_KEY_RE);
		if (!m) continue;
		const inline = m[2].trim();
		if (inline.length > 0) {
			if (inline.startsWith('[') && bracketDelta(lines[i]) > 0) {
				// Multiline flow array — consume lines until bracket depth returns
				// to zero (the matching `]`).
				let depth = bracketDelta(lines[i]);
				let j = i + 1;
				while (j < lines.length && depth > 0) {
					depth += bracketDelta(lines[j]);
					j++;
				}
				blocks.push({ start: i, end: j });
				i = j - 1;
				continue;
			}
			// Inline scalar or single-line inline array.
			blocks.push({ start: i, end: i + 1 });
			continue;
		}
		// Empty inline value — consume following indented list-item / comment lines.
		let j = i + 1;
		while (
			j < lines.length &&
			(LIST_ITEM_RE.test(lines[j]) || INDENTED_COMMENT_RE.test(lines[j]))
		) {
			j++;
		}
		blocks.push({ start: i, end: j });
		i = j - 1;
	}
	return blocks;
}

/**
 * Pull the raw (un-normalized) tag values out of a single tags block.
 */
function extractBlockRawValues(
	lines: string[],
	block: { start: number; end: number },
): string[] {
	const out: string[] = [];
	const m = lines[block.start].match(TAGS_KEY_RE);
	if (!m) return out;
	const inline = m[2].trim();

	if (inline.length > 0) {
		if (inline.startsWith('[')) {
			// Flow array — gather content across the (possibly multiline) span and
			// read between the outermost brackets. Items may be comma- or
			// newline-separated.
			let content = inline;
			for (let i = block.start + 1; i < block.end; i++) {
				content += '\n' + lines[i];
			}
			const open = content.indexOf('[');
			const close = content.lastIndexOf(']');
			if (close > open) {
				const inner = content.slice(open + 1, close);
				if (inner.trim().length > 0) {
					for (const part of inner.split(/[,\n]/)) {
						if (part.trim().length > 0) out.push(part);
					}
				}
			}
		} else {
			// Inline scalar — a bare null/bool/number is not a tag (Obsidian treats
			// `tags: null` as empty). Quoted scalars are explicit strings and kept.
			const scalar = stripInlineComment(inline);
			if (isQuoted(scalar) || !isBareEmptyScalar(scalar)) {
				out.push(inline);
			}
		}
	} else {
		// Block list — collect the indented list-item values (comment lines, which
		// are part of the span but don't match LIST_ITEM_RE, are skipped).
		for (let i = block.start + 1; i < block.end; i++) {
			const lm = lines[i].match(LIST_ITEM_RE);
			if (lm) out.push(lm[1]);
		}
	}
	return out;
}

/**
 * Turn a list of raw tag values into a deduped, `#`-prefixed token list,
 * stripping quotes and trailing comments and healing the variant-A glue.
 */
function normalizeValues(rawValues: string[]): string[] {
	const seen = new Set<string>();
	const out: string[] = [];
	for (const raw of rawValues) {
		const decommented = stripInlineComment(raw);
		const cleaned = stripQuotes(decommented);
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
 * Handles inline scalar, inline array, multiline flow array, and block-list
 * shapes; strips quotes and trailing comments; heals the variant-A glue;
 * preserves nested-slash tags; ignores bare null/bool/number scalars; unions
 * duplicate `tags:` keys. Returns tags normalized to `#`-prefixed form (the
 * contract the sync engine's comparison and orphan-cleanup code depend on).
 * Returns `[]` for a missing key, an empty value, or an empty array.
 */
export function parseFrontmatterTags(frontmatter: string): string[] {
	if (!frontmatter || !frontmatter.trim()) return [];
	const lines = normalizeNewlines(frontmatter).split('\n');
	const blocks = findAllTagsBlocks(lines);
	if (blocks.length === 0) return [];

	const rawValues: string[] = [];
	for (const block of blocks) {
		for (const v of extractBlockRawValues(lines, block)) rawValues.push(v);
	}
	return normalizeValues(rawValues);
}

/**
 * Write `tags` into a frontmatter YAML string, normalizing whatever shape was
 * there before into a single clean block list.
 *
 * - Empty/blank frontmatter → returns a bare `tags:` block.
 * - Existing tags block(s) (any shape, including duplicate keys / multiline flow
 *   arrays) → ALL replaced by a single whole-line-span block, so sibling
 *   properties are byte-preserved, no old value is left dangling, and duplicate
 *   `tags:` keys collapse into one.
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

	const normalized = normalizeNewlines(frontmatter);
	const lines = normalized.split('\n');
	const blocks = findAllTagsBlocks(lines);

	if (blocks.length > 0) {
		const inBlock = (idx: number) =>
			blocks.some((b) => idx >= b.start && idx < b.end);
		const result: string[] = [];
		let inserted = false;
		for (let i = 0; i < lines.length; i++) {
			if (inBlock(i)) {
				// Insert the new block once (at the first block line), drop every
				// other tags-block line — this collapses duplicate keys too.
				if (!inserted) {
					result.push(...blockLines);
					inserted = true;
				}
				continue;
			}
			result.push(lines[i]);
		}
		return result.join('\n');
	}

	// No tags key present — append a fresh block, preserving existing content.
	return `${normalized.replace(/\n+$/, '')}\n${blockLines.join('\n')}`;
}
