/**
 * Derivation — Layer 2 (typed spec) → Layer 1 (raw regex + TransformConfig).
 *
 * Pure. No Obsidian imports. The deliverable that lets a user describe their
 * mapping in typed terms once and stop hand-authoring regex. The sync engines
 * consume Layer 1 fields as before; they never see the typed model directly.
 *
 * Every derivation here is worked against the 6 hand-written rules in
 * `rule-packs/seacow-cyberbase.json` — see `derive.test.ts`.
 */

import type { MappingRule, TransformConfig } from '../types/settings';
import type {
	FolderClassifier,
	TagVocabulary,
	TransferOp,
	TypedRuleSpec,
} from '../types/typed';

// ─── Pattern derivation ───────────────────────────────────────────────────

/** Escape a string literal for safe inclusion in a regex. */
export function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Append `/` to an entry-point regex only if the entry doesn't already end
 * with `/`. Keeps `^-clip/` (entry `-clip`) vs `^/` (entry `/`) both correct.
 */
function separatorAfter(entry: string, rawEntry: string): string {
	return rawEntry.endsWith('/') ? '' : '/';
}

/**
 * The folder-side regex for a typed spec.
 *
 * For pre-coordinated transfers (identity, truncation-with-loose-tail,
 * promotion-to-root, flattening-to-leaf, post-coordination, aggregation,
 * opaque) the pattern is a simple anchor-prefix match — the sync engine
 * strips the entry point and transforms the remainder. For truncation with
 * `tailHandling: 'drop'`, the pattern also caps depth so paths deeper than
 * N do not match.
 */
export function deriveFolderPattern(spec: TypedRuleSpec): string {
	const entry = escapeRegex(spec.folderEntry);
	const sep = separatorAfter(entry, spec.folderEntry);
	const op = spec.transfer.op;

	if (op === 'marker-only') {
		// Folder side: any path under the entry point — including the entry
		// folder ITSELF — is tagged with the marker. (`Capture/Inbox` alone
		// is the folderPath of a file at `Capture/Inbox/today.md`, so the
		// rule must match the bare entry string too.)
		return `^${entry}(?:${sep}.*)?$`;
	}

	if (op === 'truncation' && spec.transfer.tailHandling === 'drop') {
		// Strict: match only paths whose depth beneath the entry is ≤ N.
		return buildDepthCappedPattern(entry, sep, spec.transfer.depth);
	}

	// All remaining ops: loose anchor-prefix that matches the bare entry
	// folder OR anything beneath it. Depth/shape semantics (if any) are
	// enforced by the transform pipeline, not the regex.
	//
	// `(?:${sep}|$)` covers both forms:
	//   `Projects`        — bare entry folder (no children yet)
	//   `Projects/Web`    — nested below entry
	// The previous `^${entry}${sep}` required a trailing separator, which
	// silently excluded the bare-entry case — users with a top-level
	// folder but no subfolders saw "0 matches" from the preview surfaces
	// and assumed the rule was broken.
	return `^${entry}(?:${sep}|$)`;
}

/**
 * The tag-side regex for a typed spec. Symmetric with deriveFolderPattern
 * except for marker-only (where the tag is fully anchored to the literal
 * marker, since it's a single controlled-vocabulary term).
 */
export function deriveTagPattern(spec: TypedRuleSpec): string {
	const entry = escapeRegex(spec.tagEntry);
	const sep = separatorAfter(entry, spec.tagEntry);
	const op = spec.transfer.op;

	if (op === 'marker-only') {
		// Tag is a single fixed term, fully anchored.
		return `^${escapeRegex(spec.transfer.marker)}$`;
	}

	if (op === 'truncation' && spec.transfer.tailHandling === 'drop') {
		return buildDepthCappedPattern(entry, sep, spec.transfer.depth);
	}

	return `^${entry}${sep}`;
}

/**
 * Build a pattern that matches `entry{sep}` plus up to `depth` path segments
 * and REJECTS deeper paths. `depth: 2` → matches `entry/a`, `entry/a/b`,
 * but NOT `entry/a/b/c`.
 */
function buildDepthCappedPattern(entry: string, sep: string, depth: number): string {
	if (depth <= 0) return `^${entry}${sep}?$`;
	const tail = '(?:/([^/]+))?'.repeat(Math.max(0, depth - 1));
	return `^${entry}${sep}([^/]+)${tail}$`;
}

// ─── Transform derivation ─────────────────────────────────────────────────

/**
 * Folder-side transform config. Defaults reflect common Obsidian conventions:
 *   - Title Case for folder names
 *   - keep emoji unless the folder classifier says folder names are emoji-prefixed
 *   - keep number prefixes (JD-compatible)
 * Per-rule overrides layer on top via `spec.transformOverrides.folderTransforms`.
 */
export function deriveFolderTransforms(spec: TypedRuleSpec): TransformConfig {
	const base: TransformConfig = {
		caseTransform: 'Title Case',
		emojiHandling: spec.folder.naming === 'emoji-prefixed' ? 'strip' : 'keep',
		numberPrefixHandling: 'keep',
	};
	return { ...base, ...(spec.transformOverrides?.folderTransforms ?? {}) };
}

/**
 * Tag-side transform config. Defaults:
 *   - kebab-case for tag names (standard Obsidian tag convention)
 *   - for marker-only ops, case transform is 'none' (the marker is fixed and
 *     authored verbatim — re-casing it would break the controlled vocabulary)
 *   - emoji and number-prefix handling: keep by default
 */
export function deriveTagTransforms(spec: TypedRuleSpec): TransformConfig {
	const isMarker = spec.transfer.op === 'marker-only';
	const base: TransformConfig = {
		caseTransform: isMarker ? 'none' : 'kebab-case',
		emojiHandling: 'keep',
		numberPrefixHandling: 'keep',
	};
	return { ...base, ...(spec.transformOverrides?.tagTransforms ?? {}) };
}

// ─── Cardinality / bijective inference ────────────────────────────────────

export function deriveCardinality(transfer: TransferOp): MappingRule['cardinality'] {
	switch (transfer.op) {
		case 'identity':
			return '1:1';
		case 'truncation':
			return transfer.tailHandling === 'drop' ? '1:1' : 'many:1';
		case 'marker-only':
			return 'many:1';
		case 'promotion-to-root':
			return 'many:1';
		case 'flattening-to-leaf':
			return 'many:1';
		case 'post-coordination':
			return '1:many';
		case 'aggregation':
			return '1:1';
		case 'opaque':
			return 'many:1';
	}
}

export function deriveBijective(transfer: TransferOp, inverseTransfer: TransferOp): boolean {
	// A mapping is bijective iff both directions preserve enough information
	// to reconstruct the other. The lossy ops are: marker-only, promotion-to-root,
	// flattening-to-leaf, opaque, aggregation-with-unknown-separator-in-names,
	// truncation with tailHandling = 'aggregate' or 'flatten'.
	const lossy = (op: TransferOp): boolean => {
		switch (op.op) {
			case 'identity':
				return false;
			case 'truncation':
				return op.tailHandling !== 'drop';
			case 'aggregation':
				// Aggregation is only reversible if the separator is guaranteed
				// not to appear inside folder names. We can't check that statically,
				// so we treat it as lossy.
				return true;
			case 'marker-only':
			case 'promotion-to-root':
			case 'flattening-to-leaf':
			case 'opaque':
				return true;
			case 'post-coordination':
				// Tag side becomes N independent tags; recovery depends on the
				// rule's knowledge of the axis — treat as lossy by default.
				return true;
		}
	};
	return !lossy(transfer) && !lossy(inverseTransfer);
}

// ─── The main entry point ─────────────────────────────────────────────────

/**
 * Compile a typed spec into a full MappingRule. The returned rule carries
 * BOTH the Layer 1 regex/transform fields (consumed by sync engines today)
 * AND the Layer 2 typed metadata (for UI surfacing in future phases).
 */
export function deriveRule(spec: TypedRuleSpec): MappingRule {
	const needsFolderSide = spec.direction !== 'tag-to-folder';
	const needsTagSide = spec.direction !== 'folder-to-tag';

	return {
		id: spec.id,
		name: spec.name,
		description: spec.description,
		enabled: spec.enabled,
		priority: spec.priority,
		direction: spec.direction,

		// Layer 1
		folderPattern: needsFolderSide ? deriveFolderPattern(spec) : undefined,
		folderEntryPoint: spec.folderEntry,
		folderTransforms: deriveFolderTransforms(spec),

		tagPattern: needsTagSide ? deriveTagPattern(spec) : undefined,
		tagEntryPoint: spec.tagEntry,
		tagTransforms: deriveTagTransforms(spec),

		options: spec.options,

		// Layer 2
		folder: spec.folder,
		tag: spec.tag,
		transfer: spec.transfer,
		inverseTransfer: spec.inverseTransfer,
		cardinality: deriveCardinality(spec.transfer),
		bijective: deriveBijective(spec.transfer, spec.inverseTransfer),
	};
}
