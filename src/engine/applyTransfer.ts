/**
 * Coordination operations — the runtime of `TransferOp`.
 *
 * Background
 * ──────────
 * In classification theory, *coordination* is how concepts combine into a
 * descriptor.
 *
 *   - **Pre-coordinated** descriptors fuse concepts in the term itself —
 *     `projects/q4-roadmap` is one term carrying two concepts joined by
 *     subordination.
 *   - **Post-coordinated** descriptors apply concepts as separate terms —
 *     the same content carries `#projects` and `#q4-roadmap` independently.
 *
 * When two classification surfaces (here: a folder tree and a tag
 * vocabulary) carry overlapping content, a rule mediates between them by
 * naming a *recoordination*: how the source-side hierarchy is restructured
 * to fit the destination-side shape. Truncation, promotion, flattening,
 * aggregation, marker-only, and post-coordination are all standard
 * library-science recoordinations. `identity` and `opaque` are the
 * boundary cases (preserve everything; emit nothing).
 *
 * This module is the runtime that performs the recoordination. It is pure,
 * operates on segment lists (not strings), and is independent of the
 * transform pipeline (case / emoji / number-prefix), which is a separate
 * primitive-independent concern that runs *after* recoordination on each
 * resulting segment.
 *
 * Shape of the call
 * ─────────────────
 *   sync engine extracts the source-side path remainder
 *     ↓ split on '/'
 *   segment list:        ['Web', 'Tutorials', 'React', 'Hooks']
 *     ↓ applyTransfer
 *   segment lists:       [['web', 'tutorials-react-hooks']]   (one tag, depth 2 with aggregated tail)
 *                                or
 *                        [['web'], ['tutorials'], ['react'], ['hooks']]  (post-coordination — four tags)
 *     ↓ rejoin + transform pipeline + prepend entry
 *   emitted tag(s)
 */

import type { TransferOp } from '../types/typed';
import type { MappingRule, TransformConfig } from '../types/settings';
import { applyTransformPipeline } from '../transformers/pipeline';

export interface RecoordinationResult {
	/**
	 * One or more segment lists. Most ops produce exactly one — `identity`,
	 * `truncation`, `promotion-to-root`, `flattening-to-leaf`, `aggregation`,
	 * `marker-only`. Only `post-coordination` produces N. `opaque` produces
	 * zero.
	 */
	segmentLists: string[][];
	/**
	 * True iff this op intentionally produces zero output. Distinguishes
	 * "no tag because the folder is opaque" from "no tag because the input
	 * was empty".
	 */
	emptyByDesign: boolean;
	/**
	 * True iff the recoordination cannot be inverted to recover the source
	 * exactly. Used to surface a `bijective: false` annotation on the rule.
	 */
	lossy: boolean;
}

/**
 * Split a path string into segments, dropping empty leading/trailing entries.
 * `'a/b/c'` → `['a', 'b', 'c']`; `'a/'` → `['a']`; `''` → `[]`.
 */
export function splitSegments(path: string): string[] {
	return path.split('/').filter((s) => s.length > 0);
}

/**
 * Apply a transfer op to a segment list. Pure. The destination side's
 * recoordinated segments are returned; the caller rejoins, transforms, and
 * prepends the entry point.
 */
export function applyTransfer(segments: string[], transfer: TransferOp): RecoordinationResult {
	switch (transfer.op) {
		case 'identity':
			return one(segments, false);

		case 'truncation':
			return applyTruncation(segments, transfer);

		case 'marker-only':
			// Flat controlled-vocabulary term — source segments discarded.
			// The marker comes verbatim from the rule, so no transform pipeline
			// should mutate it; the sync engine bypasses transforms when this
			// op fires (see FolderToTagSync).
			return {
				segmentLists: [[transfer.marker]],
				emptyByDesign: false,
				lossy: true, // many folders → one term
			};

		case 'promotion-to-root':
			return one(segments.length > 0 ? [segments[0]] : [], true);

		case 'flattening-to-leaf':
			return one(segments.length > 0 ? [segments[segments.length - 1]] : [], true);

		case 'aggregation':
			return one([segments.join(transfer.separator)], true);

		case 'post-coordination':
			// N independent flat terms — one per source segment.
			return {
				segmentLists: segments.map((s) => [s]),
				emptyByDesign: false,
				lossy: true, // hierarchy lost; the destination is flat
			};

		case 'opaque':
			return { segmentLists: [], emptyByDesign: true, lossy: false };
	}
}

function one(segments: string[], lossy: boolean): RecoordinationResult {
	return { segmentLists: [segments], emptyByDesign: false, lossy };
}

// ─── High-level pipeline: rule + path → emitted tag(s) / folder(s) ───────
//
// This is the full library-science flow:
//
//     match → extract → recoordinate → transform → emit
//
// `applyRuleForward` runs it folder→tag using `rule.transfer`.
// `applyRuleInverse` runs it tag→folder using `rule.inverseTransfer`.
//
// Both are pure (no Obsidian, no I/O, no logging) — the sync engines call
// these and handle vault-side effects separately.

export interface ForwardResult {
	/** Emitted tag(s). Empty for opaque/non-matching rules. Multiple for post-coordination. */
	tags: string[];
	/** Whether the recoordination was lossy (for surfacing on the rule). */
	lossy: boolean;
}

export interface InverseResult {
	/** Emitted folder path. `null` for opaque/non-matching rules. */
	folder: string | null;
	lossy: boolean;
}

/**
 * Folder → tag(s). Applies `rule.transfer` (default: identity).
 *
 * Returns `[]` when the folder pattern doesn't match, or when the transfer
 * op is `opaque`. Returns multiple tags when the op is `post-coordination`.
 * Otherwise returns one tag.
 */
export function applyRuleForward(folderPath: string, rule: MappingRule): ForwardResult {
	// The pattern is a gate — does this rule apply to this path?
	// The entry point is the extractor — what part is the "remainder" we
	// recoordinate? Use the FULL folder path for extraction, not just the
	// portion the regex literally matched. (Patterns like `^Projects/` only
	// match the prefix; using `match[0]` would discard everything after.)
	const pattern = new RegExp(rule.folderPattern || '.*');
	if (!pattern.test(folderPath)) return { tags: [], lossy: false };

	let remainder = folderPath;
	if (rule.folderEntryPoint) {
		remainder = remainder.replace(new RegExp(`^${rule.folderEntryPoint}/?`), '');
	}

	const segments = splitSegments(remainder);
	const transferOp = rule.transfer ?? { op: 'identity' as const };
	const recoordinated = applyTransfer(segments, transferOp);

	if (recoordinated.emptyByDesign || recoordinated.segmentLists.length === 0) {
		return { tags: [], lossy: recoordinated.lossy };
	}

	const isMarker = transferOp.op === 'marker-only';
	const tags: string[] = [];

	for (const segList of recoordinated.segmentLists) {
		const joined = segList.join('/');
		const transformed =
			isMarker || !rule.tagTransforms
				? joined
				: applyTransformPipeline(joined, rule.tagTransforms, { isTagTransform: true });

		let tag: string;
		if (isMarker) {
			tag = transformed;
		} else if (rule.tagEntryPoint) {
			tag = transformed ? joinEntry(rule.tagEntryPoint, transformed) : rule.tagEntryPoint;
		} else {
			tag = transformed;
		}

		if (tag) tags.push(tag.startsWith('#') ? tag : `#${tag}`);
	}

	return { tags, lossy: recoordinated.lossy };
}

/**
 * Join an entry-point string with a recoordinated remainder, tolerant of
 * either trailing-slash or no-trailing-slash entry conventions. Both
 * `--cybersader/` + `10-projects` and `--cybersader` + `10-projects`
 * produce `--cybersader/10-projects`. Prevents `//` artifacts in tags.
 */
function joinEntry(entry: string, remainder: string): string {
	if (entry.endsWith('/')) return `${entry}${remainder}`;
	return `${entry}/${remainder}`;
}

/**
 * Tag → folder. Applies `rule.inverseTransfer` (or `rule.transfer` if no
 * inverse declared, or default identity).
 *
 * Returns `null` for non-matching tags or opaque-inverse rules. Otherwise
 * returns a single folder path. Even if the inverse is post-coordination,
 * we use the first emitted segment list — one tag can only place a file
 * in one folder.
 */
export function applyRuleInverse(tag: string, rule: MappingRule): InverseResult {
	let tagContent = tag.startsWith('#') ? tag.slice(1) : tag;

	if (rule.tagEntryPoint) {
		const entryPoint = rule.tagEntryPoint.startsWith('#')
			? rule.tagEntryPoint.slice(1)
			: rule.tagEntryPoint;
		tagContent = tagContent.replace(new RegExp(`^${entryPoint}/?`), '');
	}

	const segments = splitSegments(tagContent);
	const inverseOp = rule.inverseTransfer ?? rule.transfer ?? { op: 'identity' as const };
	const recoordinated = applyTransfer(segments, inverseOp);

	if (recoordinated.emptyByDesign || recoordinated.segmentLists.length === 0) {
		return { folder: null, lossy: recoordinated.lossy };
	}

	const segList = recoordinated.segmentLists[0];
	const joined = segList.join('/');

	const transformed = rule.folderTransforms
		? applyTransformPipeline(joined, rule.folderTransforms, { isTagTransform: false })
		: joined;

	const folderPath = rule.folderEntryPoint
		? transformed
			? joinEntry(rule.folderEntryPoint, transformed)
			: rule.folderEntryPoint
		: transformed;

	return { folder: folderPath || null, lossy: recoordinated.lossy };
}

function applyTruncation(
	segments: string[],
	transfer: Extract<TransferOp, { op: 'truncation' }>,
): RecoordinationResult {
	const N = transfer.depth;

	// Source already at or under the cap — no recoordination needed.
	if (segments.length <= N) {
		return one(segments, false);
	}

	const head = segments.slice(0, N);
	const tail = segments.slice(N);

	switch (transfer.tailHandling) {
		case 'drop':
			// Bijective up to depth N; deeper info is dropped. The depth-capped
			// regex generated by `deriveRule` typically prevents this branch
			// from being reached in practice (deeper paths don't match), but
			// hand-authored rules might use a looser pattern, so we honor it
			// here too.
			return one(head, true);

		case 'aggregate': {
			const sep = transfer.separator ?? '-';
			return one([...head, tail.join(sep)], true);
		}

		case 'flatten':
			return one([...head, tail[tail.length - 1]], true);
	}
}
