/**
 * Typed folder↔tag model — Layer 2 of the three-layer architecture.
 *
 *   Layer 3: user intent (natural language)
 *   Layer 2: typed description — FolderClassifier + TagVocabulary + TransferOp   ← this file
 *   Layer 1: raw regex + TransformConfig                                        (MappingRule legacy fields)
 *   Layer 0: Obsidian API calls                                                 (sync engines)
 *
 * The typed model is NOT one description of a rule. It's three things:
 *
 *   1. How the folder side is structured  — FolderClassifier
 *   2. How the tag side is structured     — TagVocabulary
 *   3. An explicit mapping between them   — TransferOp + inverseTransfer
 *
 * Two sides, independently typed, then mapped. Each half is its own statement
 * about a slice of the user's knowledgebase; the mapping is how they bridge.
 *
 * All vocabulary is drawn from the library-science prior art documented in
 * cybersader/crosswalker (knowledge-organization docs + SEACOW log). Nothing
 * invented here.
 *
 * Canonical source is the sibling fixtures plugin's src/fixtures/types.ts —
 * this file mirrors it (minus FixtureFile/FixtureFramework, plus TypedRuleSpec).
 */

import type {
	TransformConfig,
	RuleOptions,
	RuleDirection,
} from './settings';

// ─── The meta-dimension: SEACOW axes ──────────────────────────────────────

export type Axis =
	| 'system'   // S — platform, tool, config
	| 'entity'   // E — workspace owner, user, agent, authority
	| 'capture'  // A.C — ingestion, inbox, clippings
	| 'output'   // A.O — publishable, external-facing
	| 'work'     // A.W — active processing, derivation (PARA, JD live here)
	| 'relation'; // r — flat cross-link keywords

export const ALL_AXES: Axis[] = [
	'system',
	'entity',
	'capture',
	'output',
	'work',
	'relation',
];

// ─── Folder side ──────────────────────────────────────────────────────────

export type FolderScheme =
	| 'enumerative'      // numbered siblings (JD 10-, 20-); order-meaningful list
	| 'hierarchical'     // strict subject tree (deep Output taxonomies)
	| 'faceted'          // multiple independent sub-axes intermixed under one root
	| 'authority-root'   // per-authority workspace (Cybersader/, Username1/)
	| 'container-only';  // clusters without classifying (Attachments/, Drafts/)

export type FolderNaming =
	| 'word'             // Projects/
	| 'ordinal'          // 10 - Projects/
	| 'symbol-prefixed'  // --cybersader/, _public/
	| 'emoji-prefixed'   // 📁 Projects/
	| 'mixed';

export type FolderSubdivisionDepth = number | 'unbounded';

export type SiblingUniformity = 'parallel' | 'unique';

/**
 * How a folder classifies content. `axes` is usually one entry; when a folder
 * is nested inside another classifier (e.g. `Cybersader/10-Projects/` is
 * scoped by an Entity but itself classifies Work), we list both.
 */
export interface FolderClassifier {
	axes: Axis[];
	scheme: FolderScheme;
	naming: FolderNaming;
	subdivisionDepth: FolderSubdivisionDepth;
	siblingUniformity: SiblingUniformity;
}

// ─── Tag side ─────────────────────────────────────────────────────────────

export type TagCoordination =
	| 'pre-coordinated'   // #projects/q4-roadmap — concepts fused in the term
	| 'post-coordinated'  // #projects + #q4-roadmap — applied separately
	| 'flat-keyword';     // #urgent — single concept, no compounding

/**
 * Documented SEACOW tag-prefix conventions (from seacow-cyberbase.json +
 * UI_IMPROVEMENTS_SUMMARY.md ASCII-sort rationale):
 *
 *   '/' : System
 *   '--': Entity
 *   '-' : Capture
 *   '_' : Output
 *   ''  : Work (no prefix)
 *   null: Relation (or any un-prefixed convention)
 */
export type TagPrefixMarker = '/' | '--' | '-' | '_' | '' | null;

export type TagAuthority =
	| 'folder-authoritative' // tag derived from folder (folder→tag)
	| 'tag-authoritative'    // folder position derived from tag (tag→folder)
	| 'mutual';              // bidirectional; either side can edit

export interface TagVocabulary {
	axis: Axis;
	coordination: TagCoordination;
	prefixMarker: TagPrefixMarker;
	authority: TagAuthority;
}

// ─── Hierarchy transfer: primitives + mode flags for common compositions ──
//
// Primitives are deliberately small. Real-world mappings are usually two
// primitives *stacked* — e.g. "preserve two levels, then aggregate the rest".
// Rather than force users to author compositions, each primitive carries the
// options needed to express its common compound behaviors:
//
//   - `truncation.tailHandling` absorbs `truncation ∘ (drop | aggregation |
//     flattening-to-leaf)` on the deeper tail. One primitive, three modes.
//
// New primitives get added only when "a second primitive with a mode flag"
// cannot express the case cleanly.

export type TruncationTailHandling =
	| 'drop'       // deeper segments ignored on tag side (bijective iff depth preserves info)
	| 'aggregate'  // deeper segments joined with separator into a single (N+1)th tag segment (lossy to unpack)
	| 'flatten';   // deeper path collapses to the single leaf folder name (lossy)

/**
 * The eight library-science transfer primitives. See the docs site's
 * concepts/transfer-operations page for a worked example of each.
 */
export type TransferOp =
	/** Pre-coordination preserved at full depth. Folder `A/B/C` → tag `a/b/c`. Bijective when transforms are reversible. */
	| { op: 'identity' }

	/** Bounded specificity: tag carries only the first N folder segments. `tailHandling` chooses how deeper segments are represented. */
	| {
			op: 'truncation';
			depth: number;
			tailHandling: TruncationTailHandling;
			/** Required when tailHandling === 'aggregate'; default '-'. */
			separator?: string;
	  }

	/** Broader-term collection: first folder segment becomes the tag; deeper path is ignored. Many:1 when inverted. */
	| { op: 'promotion-to-root' }

	/** Specific-term indexing: last folder segment (leaf) becomes the tag; ancestry is dropped. Many:1. */
	| { op: 'flattening-to-leaf' }

	/** Axis split: N independent flat tags emitted, one per folder segment. Use when tag axis is post-coordinated. */
	| { op: 'post-coordination' }

	/** Compressed descriptor: entire path joined with separator into a single tag segment. `#a-b-c`. */
	| { op: 'aggregation'; separator: string }

	/** Flat controlled vocabulary: the folder emits one fixed tag regardless of sub-path. `Capture/Inbox/*` → `#-inbox`. */
	| { op: 'marker-only'; marker: string }

	/** Folder is clustering-only; no tag is emitted. For containers like `Attachments/`. */
	| { op: 'opaque' };

// ─── Rule-level typed description ─────────────────────────────────────────

export type Cardinality = '1:1' | '1:many' | 'many:1';

/**
 * The typed specification of a rule. `deriveRule(spec)` compiles this into
 * a full MappingRule with raw regex + TransformConfig populated for the
 * sync engines.
 *
 * `folderEntry` and `tagEntry` are the anchor strings (no trailing slash).
 * For a tag entry with a prefix marker like `-clip`, include the marker —
 * the vocab.prefixMarker field is metadata, not a transformation input.
 */
/**
 * Where in the vault tree a rule anchors. Phase G — makes the layer at
 * which an organizational system lives a first-class concept rather than
 * an implicit `^` (vault root) assumption.
 *
 * - `'root'` (default if absent): pattern anchors to vault root.
 *   Compiles to `^Entry(?:/|$)`. Matches `Entry`, `Entry/foo`.
 * - `'any-segment'`: pattern matches at any path-segment boundary.
 *   Compiles to `(?:^|/)Entry(?:/|$)`. Matches `Entry`, `parent/Entry`,
 *   `a/b/Entry`, etc. Useful for org systems that can appear anywhere
 *   (e.g., a numbered-folder convention applied at multiple depths).
 * - `{ under: 'Prefix' }`: pattern anchors to a parent prefix.
 *   Compiles to `^Prefix/Entry(?:/|$)`. Matches `Prefix/Entry`,
 *   `Prefix/Entry/foo`. Useful for nested deployments — JD under
 *   `Output/`, PARA under `Work/`, etc.
 *
 * Sync engines (`applyTransfer`, `ruleMatcher`, `previewRule`) consume
 * the compiled `folderPattern` regex and don't care which anchor mode
 * produced it; they're pattern-agnostic. The anchor field exists so the
 * derivation/inference round-trip and the guided modal can talk about
 * the layer concept directly.
 */
export type FolderAnchor =
	| 'root'
	| 'any-segment'
	| { under: string };

export interface TypedRuleSpec {
	id: string;
	name: string;
	description?: string;
	priority: number;
	direction: RuleDirection;

	folder: FolderClassifier;
	tag: TagVocabulary;

	transfer: TransferOp;
	inverseTransfer: TransferOp;

	folderEntry: string;
	/** See `FolderAnchor`. Defaults to `'root'` when absent. */
	folderAnchor?: FolderAnchor;
	tagEntry: string;

	/** Override anything derivation can't predict (custom regex, unusual case). */
	transformOverrides?: {
		folderTransforms?: Partial<TransformConfig>;
		tagTransforms?: Partial<TransformConfig>;
	};

	options: RuleOptions;
	enabled: boolean;
}

// ─── Re-export helpers for convenience ────────────────────────────────────

/** The typed metadata that rides along on a MappingRule once derivation has run. */
export interface TypedRuleMetadata {
	folder: FolderClassifier;
	tag: TagVocabulary;
	transfer: TransferOp;
	inverseTransfer: TransferOp;
	cardinality: Cardinality;
	bijective: boolean;
}
