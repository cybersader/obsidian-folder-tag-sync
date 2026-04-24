/**
 * Plugin settings and rule definitions
 */

import type {
	FolderClassifier,
	TagVocabulary,
	TransferOp,
	Cardinality,
} from './typed';

export interface DynamicTagsFoldersSettings {
	rules: MappingRule[];
	options: PluginOptions;
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
	priority: number; // Lower number = higher priority

	// Direction
	direction: RuleDirection;

	// Folder side (Layer 1 — raw regex / glob + transform pipeline)
	folderPattern?: string; // Regex or glob pattern
	folderEntryPoint?: string; // Base folder path
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
