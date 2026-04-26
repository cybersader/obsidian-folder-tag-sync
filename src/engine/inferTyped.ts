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
	FolderClassifier,
	TagPrefixMarker,
	TagVocabulary,
	TransferOp,
	TypedRuleSpec,
} from '../types/typed';

export type InferredFields = Pick<
	TypedRuleSpec,
	'folder' | 'tag' | 'transfer' | 'inverseTransfer' | 'folderEntry' | 'tagEntry'
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

	const folderEntry = rule.folderEntryPoint ?? inferEntryFromPattern(rule.folderPattern);
	const tagEntry = rule.tagEntryPoint ?? inferEntryFromPattern(rule.tagPattern);

	if (folderEntry) out.folderEntry = folderEntry;
	if (tagEntry) out.tagEntry = tagEntry;

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

function inferEntryFromPattern(pattern?: string): string | undefined {
	if (!pattern) return undefined;
	// Strip leading anchor first.
	let s = pattern.replace(/^\^/, '');
	// Strip the two benign loose-anchor suffixes that `derive.ts` emits:
	//   `^Entry(?:/|$)`     — Phase E loose anchor for non-marker ops
	//   `^Entry(?:/.*)?$`   — marker-only branch (entry OR anything below)
	// These are derivation markers, not regex content authored by the user,
	// so peel them off before the metacharacter rejection check below.
	// Without these strips, a freshly-derived rule that comes back through
	// `populateFromRule` would land in the metachar reject branch and
	// surface a blank folder/tag entry to the guided modal.
	s = s.replace(/\(\?:\/\|\$\)$/, '').replace(/\(\?:\/\.\*\)\?\$$/, '');
	// Then the legacy trailing anchors / separators.
	s = s.replace(/\$$/, '').replace(/\/$/, '');
	// Reject if it still contains regex metacharacters we didn't handle.
	if (/[.*+?()[\]\\|]/.test(s)) return undefined;
	return s;
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

function inferFolderScheme(
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

function inferFolderNaming(folderEntry?: string): FolderClassifier['naming'] {
	if (!folderEntry) return 'word';
	if (/^📁|^🗂️|^[\uD800-\uDFFF]/.test(folderEntry)) return 'emoji-prefixed';
	if (/^\d{2}\s*[-_]/.test(folderEntry)) return 'ordinal';
	if (/^[-_/]/.test(folderEntry)) return 'symbol-prefixed';
	return 'word';
}
