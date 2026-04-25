/**
 * Pure helpers for the guided rule editor: form state, typed-spec
 * construction, validation, inconsistency detection.
 *
 * Extracted from GuidedRuleEditorModal.ts so that the form → spec
 * pipeline can be unit-tested without importing Obsidian's runtime
 * (the modal class pulls in `obsidian` which `bun test` can't load).
 *
 * Three concerns live here:
 *   1. FormState shape + defaults (defaultFormState, populateFromRule)
 *   2. Form → TypedRuleSpec compilation (buildTransferOp, buildSpec)
 *   3. Validation + inconsistency detection (entriesPopulated,
 *      detectWarnings, isFormValid)
 *
 * The modal owns rendering + event wiring; everything reasoning over
 * data lives here.
 */

import type { MappingRule, RuleOptions, RuleDirection } from '../types/settings';
import type {
	Axis,
	FolderScheme,
	FolderNaming,
	TagCoordination,
	TagPrefixMarker,
	TransferOp,
	TypedRuleSpec,
	TruncationTailHandling,
} from '../types/typed';
import { inferTypedModel } from './inferTyped';

// ─── Form state ──────────────────────────────────────────────────────────

export interface FormState {
	id: string;
	name: string;
	description: string;
	priority: number;
	direction: RuleDirection;
	enabled: boolean;

	axis: Axis;

	folderEntry: string;
	folderScheme: FolderScheme;
	folderNaming: FolderNaming;

	tagEntry: string;
	tagCoordination: TagCoordination;
	tagPrefixMarker: TagPrefixMarker;

	transferOp: TransferOp['op'];
	truncationDepth: number;
	truncationTailHandling: TruncationTailHandling;
	truncationSeparator: string;
	markerOnlyMarker: string;
	aggregationSeparator: string;
}

export const DEFAULT_OPTIONS: RuleOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

/**
 * Populate form state from an existing rule. If the rule has typed
 * (Layer 2) metadata fields, use them directly. Otherwise run
 * inferTypedModel() and use the best-effort result. Falls back to
 * field-by-field inspection if neither path produces a value.
 */
export function populateFromRule(rule: MappingRule): FormState {
	const inferred = inferTypedModel(rule);
	const folder = rule.folder ?? inferred.folder;
	const tag = rule.tag ?? inferred.tag;
	const transfer = rule.transfer ?? inferred.transfer ?? { op: 'identity' as const };

	const axis: Axis = (folder?.axes?.[0] ?? tag?.axis ?? 'work') as Axis;
	const folderEntry = rule.folderEntryPoint ?? inferred.folderEntry ?? '';
	const tagEntry = rule.tagEntryPoint ?? inferred.tagEntry ?? '';

	const state: FormState = {
		id: rule.id,
		name: rule.name,
		description: rule.description ?? '',
		priority: rule.priority,
		direction: rule.direction,
		enabled: rule.enabled,
		axis,
		folderEntry,
		folderScheme: folder?.scheme ?? 'hierarchical',
		folderNaming: folder?.naming ?? 'word',
		tagEntry,
		tagCoordination: tag?.coordination ?? 'pre-coordinated',
		tagPrefixMarker: tag?.prefixMarker ?? null,
		transferOp: transfer.op,
		truncationDepth: transfer.op === 'truncation' ? transfer.depth : 2,
		truncationTailHandling: transfer.op === 'truncation' ? transfer.tailHandling : 'drop',
		truncationSeparator: transfer.op === 'truncation' ? transfer.separator ?? '-' : '-',
		markerOnlyMarker: transfer.op === 'marker-only' ? transfer.marker : '-inbox',
		aggregationSeparator: transfer.op === 'aggregation' ? transfer.separator : '-',
	};
	return state;
}

export function defaultFormState(): FormState {
	return {
		id: `rule-${Date.now()}`,
		name: '',
		description: '',
		priority: 100,
		direction: 'bidirectional',
		enabled: true,
		axis: 'work',
		folderEntry: '',
		folderScheme: 'enumerative',
		folderNaming: 'word',
		tagEntry: '',
		tagCoordination: 'pre-coordinated',
		tagPrefixMarker: null,
		transferOp: 'identity',
		truncationDepth: 2,
		truncationTailHandling: 'drop',
		truncationSeparator: '-',
		markerOnlyMarker: '-inbox',
		aggregationSeparator: '-',
	};
}

// ─── Form → TypedRuleSpec → MappingRule (pure) ───────────────────────────

export function buildTransferOp(state: FormState): TransferOp {
	switch (state.transferOp) {
		case 'identity':
			return { op: 'identity' };
		case 'truncation':
			return {
				op: 'truncation',
				depth: state.truncationDepth,
				tailHandling: state.truncationTailHandling,
				separator: state.truncationSeparator || '-',
			};
		case 'marker-only':
			return { op: 'marker-only', marker: state.markerOnlyMarker };
		case 'promotion-to-root':
			return { op: 'promotion-to-root' };
		case 'flattening-to-leaf':
			return { op: 'flattening-to-leaf' };
		case 'aggregation':
			return { op: 'aggregation', separator: state.aggregationSeparator || '-' };
		case 'post-coordination':
			return { op: 'post-coordination' };
		case 'opaque':
			return { op: 'opaque' };
	}
}

export function buildSpec(state: FormState): TypedRuleSpec {
	const transfer = buildTransferOp(state);
	return {
		id: state.id,
		name: state.name || '(unnamed rule)',
		description: state.description || undefined,
		priority: state.priority,
		direction: state.direction,
		enabled: state.enabled,
		folder: {
			axes: [state.axis],
			scheme: state.folderScheme,
			naming: state.folderNaming,
			subdivisionDepth: 'unbounded',
			siblingUniformity: 'unique',
		},
		tag: {
			axis: state.axis,
			coordination: state.tagCoordination,
			prefixMarker: state.tagPrefixMarker,
			authority:
				state.direction === 'bidirectional'
					? 'mutual'
					: state.direction === 'folder-to-tag'
						? 'folder-authoritative'
						: 'tag-authoritative',
		},
		transfer,
		inverseTransfer: transfer,
		// Pass raw entry strings — no '(empty)' substitution. Empty entries
		// produce loose patterns the live preview can detect and gate on.
		folderEntry: state.folderEntry,
		tagEntry: state.tagEntry,
		options: { ...DEFAULT_OPTIONS },
	};
}

/**
 * Both folder and tag entries must be non-empty before live derivation
 * makes sense. Empty entries produce vacuous patterns (e.g. `^/`) that
 * pollute the preview output. The status strip + live preview should
 * gate on this and show a "fill in entry paths" hint instead.
 */
export function entriesPopulated(state: FormState): boolean {
	return state.folderEntry.trim() !== '' && state.tagEntry.trim() !== '';
}

// ─── Inconsistency detection ─────────────────────────────────────────────

export interface Warning {
	field: string;
	message: string;
	fix?: { label: string; apply: (state: FormState) => void };
}

export function detectWarnings(state: FormState): Warning[] {
	const out: Warning[] = [];

	if (state.transferOp === 'marker-only' && state.tagCoordination === 'pre-coordinated') {
		out.push({
			field: 'tagCoordination',
			message:
				"marker-only emits a single fixed term — pre-coordination is contradictory. Use flat-keyword.",
			fix: {
				label: 'Set to flat-keyword',
				apply: (s) => {
					s.tagCoordination = 'flat-keyword';
				},
			},
		});
	}

	if (state.transferOp === 'post-coordination' && state.tagCoordination !== 'post-coordinated') {
		out.push({
			field: 'tagCoordination',
			message:
				'post-coordination transfer should pair with post-coordinated tag vocabulary.',
			fix: {
				label: 'Set to post-coordinated',
				apply: (s) => {
					s.tagCoordination = 'post-coordinated';
				},
			},
		});
	}

	if (state.tagEntry && state.tagPrefixMarker && !state.tagEntry.startsWith(state.tagPrefixMarker)) {
		out.push({
			field: 'tagEntry',
			message: `Tag entry should include its prefix marker "${state.tagPrefixMarker}".`,
			fix: {
				label: `Prepend "${state.tagPrefixMarker}"`,
				apply: (s) => {
					s.tagEntry = `${s.tagPrefixMarker}${s.tagEntry.replace(/^[/_-]+/, '')}`;
				},
			},
		});
	}

	return out;
}

export function isFormValid(state: FormState): { valid: boolean; missing: string[] } {
	const missing: string[] = [];
	if (!state.name.trim()) missing.push('name');
	if (!state.folderEntry.trim()) missing.push('folder entry');
	if (!state.tagEntry.trim()) missing.push('tag entry');
	return { valid: missing.length === 0, missing };
}
