/**
 * Inference — Layer 1 → Layer 2 (best-effort).
 *
 * Legacy rules author regex + transforms directly. To show them in a typed
 * view (Phase 2B UI) or migrate them, we need to guess their typed model.
 *
 * This is heuristic and non-authoritative. The returned metadata is always
 * `Partial<TypedRuleSpec>` — fields we can't confidently infer are omitted.
 * Used for display and migration hints, never as the source of truth: if a
 * rule already has typed fields set (by import or derivation), those win.
 */

import type { MappingRule } from '../types/settings';
import type {
	Axis,
	FolderAnchor,
	FolderClassifier,
	TagPrefixMarker,
	TagVocabulary,
	TransferOp,
	TypedRuleSpec,
} from '../types/typed';

export type InferredFields = Pick<
	TypedRuleSpec,
	'folder' | 'tag' | 'transfer' | 'inverseTransfer' | 'folderEntry' | 'folderAnchor' | 'tagEntry'
>;

/**
 * Best-effort inference. Returns only fields we can guess with high
 * confidence; omits the rest. Pattern-shape heuristics:
 *
 *   - tagPattern is fully anchored (starts with `^`, ends with `$`) and the
 *     body has no `/` → `marker-only`
 *   - tagPattern is `^{marker}/` prefix only (no capture groups) → `identity`
 *   - entryPoint exists and pattern has 2+ capture groups → `truncation` (drop)
 *   - pattern is a bare prefix with no captures → `identity` (loose)
 *
 * Axis inference from tag prefix marker:
 *   - `/` → system
 *   - `--` → entity
 *   - `-` → capture
 *   - `_` → output
 *   - no prefix → work (default) or relation (if coordination looks flat)
 */
export function inferTypedModel(rule: MappingRule): Partial<InferredFields> {
	const out: Partial<InferredFields> = {};

	const folderInferred = inferEntryFromPattern(rule.folderPattern);
	const tagInferred = inferEntryFromPattern(rule.tagPattern);
	const folderEntry = rule.folderEntryPoint ?? folderInferred?.entry;
	const tagEntry = rule.tagEntryPoint ?? tagInferred?.entry;

	if (folderEntry) out.folderEntry = folderEntry;
	if (tagEntry) out.tagEntry = tagEntry;

	// Folder anchor: prefer explicit, fall back to pattern-shape inference.
	// Only surface when non-default ('root' is implicit) so callers don't get
	// noise on the common case.
	const folderAnchor: FolderAnchor | undefined = rule.folderAnchor ?? folderInferred?.anchor;
	if (folderAnchor && folderAnchor !== 'root') out.folderAnchor = folderAnchor;

	// Tag vocabulary + axis inference
	const prefixMarker = inferPrefixMarker(tagEntry);
	const axis = inferAxisFromMarker(prefixMarker);

	// Transfer op
	const transfer = inferTransferOp(rule);
	if (transfer) {
		out.transfer = transfer;
		out.inverseTransfer = transfer; // symmetric best-guess
	}

	// Tag vocabulary assembly
	if (axis) {
		const coordination = transfer?.op === 'marker-only' ? 'flat-keyword' : 'pre-coordinated';
		const tag: TagVocabulary = {
			axis,
			coordination,
			prefixMarker,
			authority: inferAuthority(rule),
		};
		out.tag = tag;
	}

	// Folder classifier assembly — we can infer axis from tag (tag and folder
	// must share axis for well-formed rules) and guess scheme from entry shape
	if (axis) {
		const folder: FolderClassifier = {
			axes: [axis],
			scheme: inferFolderScheme(folderEntry, transfer),
			naming: inferFolderNaming(folderEntry),
			subdivisionDepth:
				transfer?.op === 'truncation' ? transfer.depth : 'unbounded',
			siblingUniformity: 'parallel',
		};
		out.folder = folder;
	}

	return out;
}

// ─── Sub-inference helpers ────────────────────────────────────────────────

/**
 * Extract the entry literal AND infer the anchor mode from a folderPattern
 * regex. Phase G — bidirectional with `derive.ts:compileWithAnchor`.
 *
 * Recognized leading shapes (in order of specificity):
 *   `(?:^|/)X...`  → any-segment anchor, entry = X
 *   `^X...`        → root anchor, entry = X
 *
 * `under: { ... }` anchors CANNOT be inferred from regex shape alone — a
 * pattern like `^Output/Public(?:/|$)` is ambiguous (could be `under: 'Output'`
 * with entry `Public`, OR root with multi-segment entry `Output/Public`).
 * The caller must read `rule.folderAnchor` directly for `under`-anchored
 * rules; this function only round-trips the unambiguous root vs any-segment
 * distinction.
 *
 * Trailing-suffix peeling handles all three derivation-emitted shapes plus
 * legacy `^X/` and `^X$` forms:
 *   `(?:/|$)` — Phase E loose anchor for non-marker ops
 *   `(?:/.*)?$` — marker-only branch (entry OR anything below)
 *   bare `/`, `$` — legacy hand-authored shapes
 *
 * Returns undefined when the body still contains regex metacharacters that
 * the heuristic doesn't understand — caller falls back to empty entry, and
 * the guided modal's empty-entry warning explains why.
 *
 * Used for tag patterns too; tag callers ignore the `anchor` field (tags
 * don't have a filesystem-layer concept).
 */
function inferEntryFromPattern(
	pattern?: string,
): { entry: string; anchor: 'root' | 'any-segment' } | undefined {
	if (!pattern) return undefined;

	// Detect leading anchor — any-segment first (longer prefix).
	let s = pattern;
	let anchor: 'root' | 'any-segment';
	if (s.startsWith('(?:^|/)')) {
		anchor = 'any-segment';
		s = s.slice('(?:^|/)'.length);
	} else if (s.startsWith('^')) {
		anchor = 'root';
		s = s.slice(1);
	} else {
		return undefined; // unanchored — not a derived shape
	}

	// Peel known trailing suffixes (most specific first).
	s = s
		.replace(/\(\?:\/\|\$\)$/, '') // Phase E loose suffix `(?:/|$)`
		.replace(/\(\?:\/\.\*\)\?\$$/, '') // marker-only suffix `(?:/.*)?$`
		.replace(/\$$/, '') // legacy `$`
		.replace(/\/$/, ''); // legacy trailing `/`

	if (/[.*+?()[\]\\|]/.test(s)) return undefined;
	return { entry: s, anchor };
}

export function inferPrefixMarker(tagEntry?: string): TagPrefixMarker {
	if (!tagEntry) return null;
	if (tagEntry.startsWith('--')) return '--';
	if (tagEntry.startsWith('-')) return '-';
	if (tagEntry.startsWith('/')) return '/';
	if (tagEntry.startsWith('_')) return '_';
	return '';
}

export function inferAxisFromMarker(marker: TagPrefixMarker): Axis | undefined {
	switch (marker) {
		case '/':
			return 'system';
		case '--':
			return 'entity';
		case '-':
			return 'capture';
		case '_':
			return 'output';
		case '':
			return 'work'; // best-guess default for un-prefixed tags
		case null:
			return undefined;
	}
}

export function inferTransferOp(rule: MappingRule): TransferOp | undefined {
	const tagPat = rule.tagPattern;
	if (!tagPat) return undefined;

	// Fully anchored with no slash in body → marker-only
	if (/^\^[^/]*\$$/.test(tagPat)) {
		const marker = tagPat.replace(/^\^/, '').replace(/\$$/, '');
		return { op: 'marker-only', marker };
	}

	// Count capture groups (crude heuristic)
	const captureCount = (tagPat.match(/\([^?]/g) || []).length;

	// Pattern ending in `$` with N captures → truncation (drop)
	if (tagPat.endsWith('$') && captureCount >= 1) {
		return { op: 'truncation', depth: captureCount, tailHandling: 'drop' };
	}

	// Default: loose prefix match → identity
	return { op: 'identity' };
}

function inferAuthority(rule: MappingRule): TagVocabulary['authority'] {
	if (rule.direction === 'folder-to-tag') return 'folder-authoritative';
	if (rule.direction === 'tag-to-folder') return 'tag-authoritative';
	return 'mutual';
}

export function inferFolderScheme(
	folderEntry?: string,
	transfer?: TransferOp,
): FolderClassifier['scheme'] {
	if (!folderEntry) return 'hierarchical';
	if (transfer?.op === 'marker-only') return 'container-only';
	// Numeric-prefix entry (JD-style) → enumerative
	if (/^\d{2}\s*[-_]\s*/.test(folderEntry)) return 'enumerative';
	// Top-level workspace with known entity-like name → authority-root (crude)
	if (/^[A-Z][a-zA-Z0-9]+$/.test(folderEntry) && !folderEntry.includes('/')) {
		return 'authority-root';
	}
	return 'hierarchical';
}

export function inferFolderNaming(folderEntry?: string): FolderClassifier['naming'] {
	if (!folderEntry) return 'word';
	if (/^📁|^🗂️|^[\uD800-\uDFFF]/.test(folderEntry)) return 'emoji-prefixed';
	if (/^\d{2}\s*[-_]/.test(folderEntry)) return 'ordinal';
	if (/^[-_/]/.test(folderEntry)) return 'symbol-prefixed';
	return 'word';
}
