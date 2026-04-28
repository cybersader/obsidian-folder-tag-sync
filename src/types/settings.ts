/**
 * Plugin settings and rule definitions
 */

import type {
	FolderAnchor,
	FolderClassifier,
	TagVocabulary,
	TransferOp,
	Cardinality,
} from './typed';

export interface DynamicTagsFoldersSettings {
	rules: MappingRule[];
	options: PluginOptions;
	/**
	 * F1 Step 3 — Cross-pack precedence. Ordered list of group names from
	 * highest precedence (first) to lowest. When `findBestMatch` evaluates
	 * a tag/folder against multiple matching rules, it partitions the
	 * matches by `MappingRule.group` and picks the highest-precedence group
	 * that has at least one match. Within that group, specificity-aware
	 * sort (Step 1+2) takes over, with priority as the tiebreak override.
	 *
	 * Groups not in this list fall to lowest precedence (after all listed
	 * groups), preserving zero-config behavior for users who don't author
	 * a precedence order. Ungrouped rules (no `group` field) get the
	 * default group `'__default__'` and inherit lowest precedence.
	 *
	 * Optional. When absent, all groups are treated equally (alphabetical
	 * tiebreak by group name as a last resort).
	 */
	groupPrecedence?: string[];
}

export interface PluginOptions {
	// Execution triggers
	syncOnSave: boolean;
	syncOnFileClose: boolean;
	syncOnCreate: boolean;
	syncOnRename: boolean;

	// UI options
	showNotifications: boolean;
	previewChanges: boolean;
	debugMode: boolean;

	// Special handling
	handleFolderNotes: boolean;
	moveAttachments: boolean;
	defaultFolderForUntagged: string;
}

export interface MappingRule {
	// Identification
	id: string;
	name: string;
	description?: string;
	enabled: boolean;
	priority: number; // Lower number = higher priority (within-group tiebreak after F1 Step 2)

	/**
	 * F1 Step 3 — Cross-pack precedence cluster.
	 *
	 * Optional named group this rule belongs to. Rules with the same `group`
	 * compete with each other for matching; rules in different groups are
	 * partitioned by the vault's `groupPrecedence` setting. CSS `@layer`-style
	 * precedence: highest-precedence group with a match wins outright, then
	 * within that group, specificity (and priority as tiebreak) decides.
	 *
	 * Default group when absent: `'__default__'` (lowest precedence). Shipped
	 * rule packs declare their group at the pack level (or via per-rule field);
	 * the loader fills in the pack-derived default if the field is missing.
	 */
	group?: string;

	// Direction
	direction: RuleDirection;

	// Folder side (Layer 1 — raw regex / glob + transform pipeline)
	folderPattern?: string; // Regex or glob pattern
	folderEntryPoint?: string; // Base folder path
	/**
	 * Where this rule anchors in the vault tree. See `FolderAnchor` in
	 * `types/typed.ts`. Defaults to `'root'` when absent — preserves the
	 * pre-Phase-G behavior for legacy rules and unmodified packs.
	 */
	folderAnchor?: FolderAnchor;
	folderTransforms?: TransformConfig;

	// Tag side (Layer 1 — raw regex + transform pipeline)
	tagPattern?: string; // Regex pattern
	tagEntryPoint?: string; // Tag prefix (e.g., "#projects")
	tagTransforms?: TransformConfig;

	// Behavior options
	options: RuleOptions;

	// ─── Typed model (Layer 2) — all optional, additive ──────────────────
	// Set by deriveRule() or imported from a typed rule pack. Sync engines
	// ignore these and consume the Layer 1 fields only. Phase 2B will use
	// them to drive a guided rule-editor UI.
	folder?: FolderClassifier;
	tag?: TagVocabulary;
	transfer?: TransferOp;
	inverseTransfer?: TransferOp;
	cardinality?: Cardinality;
	bijective?: boolean;

	// ─── Path Lens templates (F2) — peer abstraction to typed model ──────
	/**
	 * Folder-side template using Path Lens syntax. When set together with
	 * `tagTemplate`, the rule is "template-shaped": the engine compiles
	 * both templates and uses slot-extraction + per-slot filter pipelines
	 * for sync, bypassing the typed-model `transfer` op runtime.
	 *
	 * Examples:
	 *   `Projects/{topic}`
	 *   `Projects/{topic}/{deeper...}`
	 *   `📁 {area}/{topic | kebab-case}`
	 *
	 * Mutually exclusive with `transfer` semantically — a rule should be
	 * authored as either a typed-model rule or a template-rule, not both.
	 * The loader normalizes whichever shape is present into Layer 1
	 * `folderPattern` for the matcher; runtime dispatch (template path vs
	 * typed-op path vs raw regex) is by field-presence in the engine.
	 */
	folderTemplate?: string;

	/**
	 * Tag-side template. Slot names that appear on both sides are bound
	 * to the same value at sync time; slots only on one side are flagged
	 * by `computeBijectivity` (folder-only → lossy forward; tag-only →
	 * config error).
	 */
	tagTemplate?: string;
}

export type RuleDirection = 'folder-to-tag' | 'tag-to-folder' | 'bidirectional';

export interface TransformConfig {
	// Case transformation
	caseTransform?: CaseTransformType;

	// Emoji handling
	emojiHandling?: 'keep' | 'strip';

	// Number prefix handling
	numberPrefixHandling?: 'keep' | 'strip' | 'extract';

	// Custom regex transformations
	customTransforms?: RegexTransform[];
}

export type CaseTransformType =
	| 'none'
	| 'snake_case'
	| 'kebab-case'
	| 'camelCase'
	| 'PascalCase'
	| 'Title Case'
	| 'lowercase'
	| 'UPPERCASE';

export interface RegexTransform {
	pattern: string;
	replacement: string;
	flags?: string;
}

export interface RuleOptions {
	// Sync behavior
	createFolders: boolean;
	addTags: boolean;
	removeOrphanedTags: boolean;
	syncOnFileCreate: boolean;
	syncOnFileMove: boolean;
	syncOnFileRename: boolean;

	// Conflict resolution
	onConflict?: 'prompt' | 'auto-resolve' | 'skip';
	tagSpecificity?: 'broader' | 'narrower';

	// Tag management
	removeSourceTag?: boolean;
	keepDestinationTag?: boolean;
	keepRelationTags?: boolean;

	// Special handling
	handleFolderNote?: boolean;
	moveAttachments?: boolean;
}

export const DEFAULT_SETTINGS: DynamicTagsFoldersSettings = {
	rules: [],
	options: {
		syncOnSave: false,
		syncOnFileClose: false,
		syncOnCreate: true,
		syncOnRename: true,
		showNotifications: true,
		previewChanges: false,
		debugMode: false,
		handleFolderNotes: false,
		moveAttachments: false,
		defaultFolderForUntagged: ''
	}
};
