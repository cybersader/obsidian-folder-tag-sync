import type { MappingRule } from '../types/settings';
import { findMatchingRules } from './ruleMatcher';
import { evaluateForwardFolder, type ForwardFolderOutcome } from './forwardFolderOutcome';

export interface PreviewFolder {
	folderPath: string;
	draftMatches: boolean;
	originalMatches: boolean;
	current: ForwardFolderOutcome;
	hypothetical: ForwardFolderOutcome;
}
export interface GuidedNotePreviewPlan {
	draft: MappingRule;
	currentRules: MappingRule[];
	hypotheticalRules: MappingRule[];
	precedence: string[];
	folders: PreviewFolder[];
	refusal: string | null;
	changedFields: { field: string; before: unknown; after: unknown }[];
}

/** Same-ID edit semantics belong to SettingsTab.upsertRule, not Workbench installation. */
export function buildGuidedNotePreviewPlan(
	draft: MappingRule, installed: readonly MappingRule[], precedence: readonly string[], folderPaths: readonly string[],
): GuidedNotePreviewPlan {
	const seen = new Set<string>();
	for (const r of installed) {
		if (seen.has(r.id)) throw new Error(`Duplicate installed rule ID: ${r.id}. Preview cannot resolve an ambiguous edit.`);
		seen.add(r.id);
	}
	const currentRules = structuredClone([...installed]);
	const hypotheticalRules = structuredClone(currentRules);
	const exactDraft = structuredClone(draft);
	const original = currentRules.find((r) => r.id === draft.id);
	const index = hypotheticalRules.findIndex((r) => r.id === draft.id);
	const hypotheticalDraft = { ...structuredClone(draft), enabled: true };
	if (index < 0) hypotheticalRules.push(hypotheticalDraft);
	else hypotheticalRules[index] = hypotheticalDraft;
	const changedFields: GuidedNotePreviewPlan['changedFields'] = [];
	if (original) {
		if (original.group !== draft.group) changedFields.push({ field: 'group', before: original.group ?? null, after: draft.group ?? null });
		for (const key of new Set([...Object.keys(original.options), ...Object.keys(draft.options)])) {
			const before = (original.options as unknown as Record<string, unknown>)[key] ?? null;
			const after = (draft.options as unknown as Record<string, unknown>)[key] ?? null;
			if (JSON.stringify(before) !== JSON.stringify(after)) changedFields.push({ field: `options.${key}`, before, after });
		}
	}
	const refusal = draft.direction === 'tag-to-folder'
		? 'This rule is reverse-only. Note movement preview is unsupported; no notes were read.' : null;
	const rawMatches = (path: string, r: MappingRule): boolean => findMatchingRules(path, [{ ...r, enabled: true }], {
		input: path, matchType: 'folder', direction: 'folder-to-tag',
	}).length > 0;
	const folders: PreviewFolder[] = [];
	if (!refusal) for (const folderPath of new Set(folderPaths)) {
		const draftMatches = rawMatches(folderPath, draft);
		const originalMatches = !!original && rawMatches(folderPath, original);
		if (!draftMatches && !originalMatches) continue;
		folders.push({ folderPath, draftMatches, originalMatches,
			current: evaluateForwardFolder(folderPath, currentRules, precedence),
			hypothetical: evaluateForwardFolder(folderPath, hypotheticalRules, precedence) });
	}
	return { draft: exactDraft, currentRules, hypotheticalRules, precedence: [...precedence], folders, refusal, changedFields };
}
