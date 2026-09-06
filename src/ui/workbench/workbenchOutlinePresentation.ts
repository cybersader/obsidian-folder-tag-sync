/**
 * workbenchOutlinePresentation — the pure half of the hidden "annotated
 * outline" Workbench prototype.
 *
 * The prototype draws ONE folder outline. Every organizational-system
 * occurrence annotates its anchor folder's own row ("Studio · PARA"); nothing
 * is added to the tree that is not a folder. A bracket bar in the gutter spans
 * the occurrence's real member rows. Three guided steps change only what the
 * annotation and status columns say on those same rows.
 *
 * Everything in this module is deterministic and DOM-free so the wording, the
 * hue registry, the fold model, the bracket geometry, the delta-preview
 * reading, and the conflict sentence can be tested without Obsidian.
 */

import type { DetectionOccurrence } from '../../engine/detectPacks';
import { findMatchingRules, selectBestMatch, type RuleMatch } from '../../engine/ruleMatcher';
import type { MappingRule } from '../../types/settings';
import type { CandidateDirectionalStatus } from './candidateDirectionStatus';

export type OutlineStep = 1 | 2 | 3;

/** What the annotation column reports at each guided step. */
export type OutlineAnnotationColumn = 'completeness' | 'management' | 'result';

/** Minimal occurrence shape the outline needs. `DetectionOccurrence` satisfies it. */
export interface OutlineOccurrenceLike {
	key: string;
	packId: string;
	packName: string;
	anchorPath: string;
	status: DetectionOccurrence['status'];
	evidenceCount: number;
	minEvidence: number;
	countBy: DetectionOccurrence['countBy'];
	memberPaths: readonly string[];
	supportPaths: readonly string[];
	missingRoles: readonly string[];
}

// ─── Step → annotation column ──────────────────────────────────────────────

export const OUTLINE_STEPS: readonly OutlineStep[] = Object.freeze([1, 2, 3]);

export function outlineAnnotationColumnForStep(step: OutlineStep): OutlineAnnotationColumn {
	switch (step) {
		case 1: return 'completeness';
		case 2: return 'management';
		case 3: return 'result';
	}
}

export function outlineStepLabel(step: OutlineStep): string {
	switch (step) {
		case 1: return '1 Find systems';
		case 2: return '2 Choose what to manage';
		case 3: return '3 Check the tags';
	}
}

/** Narrow containers keep the step number and one verb. */
export function outlineStepShortLabel(step: OutlineStep): string {
	switch (step) {
		case 1: return '1 Find';
		case 2: return '2 Choose';
		case 3: return '3 Check';
	}
}

export interface OutlineInstructionInput {
	systemCount: number;
	managedCount: number;
	proposedRuleCount: number;
	conflictFolderCount: number;
	/** Step 3: the column shows full tag chips instead of the delta reading. */
	showFullTags: boolean;
}

export function describeOutlineInstruction(
	step: OutlineStep,
	input: OutlineInstructionInput,
): string {
	// The instruction states the step; the hint (describeOutlineHint) says what
	// to do next. The two never repeat each other.
	if (step === 1) {
		return `We found ${input.systemCount} organizational `
			+ `${plural(input.systemCount, 'system', 'systems')} in your vault.`;
	}
	if (step === 2) {
		return 'Checked systems get draft rules. '
			+ 'Managing a folder includes every ready system beneath it.';
	}
	return input.showFullTags
		? 'Proposed tags, shown in full. Compare rules where outputs differ.'
		: 'Check the proposed tags. A ✓ means the last segment matches the normalized folder name.';
}

export function describeOutlineManagementSummary(
	managedCount: number,
	proposedRuleCount: number,
): string {
	return `${managedCount} ${plural(managedCount, 'system', 'systems')} managed · `
		+ `${proposedRuleCount} ${plural(proposedRuleCount, 'rule', 'rules')} will be proposed`;
}

export interface OutlineHintInput {
	/** Step 1: pack names at the anchor whose folders are shown. */
	openPackNames: readonly string[];
	/** Step 1: how many folders identify the open anchor's systems. */
	openEvidenceCount: number;
	/** Step 1: how many folder types the open anchor's system still lacks to be ready. */
	openNeededCount: number;
	managedCount: number;
	proposedRuleCount: number;
	/**
	 * Step 2: the display name of a managed anchor whose two systems collide.
	 * Candidates exist only once the anchor is managed, so the collision — and
	 * the preselected choice — can only be pointed at after that.
	 */
	pendingChoiceAnchorName: string | null;
	/** Step 3: folders two proposed rules both claim. */
	conflictFolderCount: number;
	/** Step 3: how many proposed rules are exact in both directions. */
	exactRuleCount: number;
}

/**
 * One sentence that teaches the next move from the current state. It is the
 * only place the prototype says what happens next, so it always changes when
 * the state changes. "Both directions exact" is said here, once, never per row.
 */
export function describeOutlineHint(step: OutlineStep, input: OutlineHintInput): string {
	if (step === 1) {
		if (input.openPackNames.length === 0) {
			return 'Show a system\'s folders to see what identifies it.';
		}
		const names = joinNames(input.openPackNames, 'and');
		if (input.openNeededCount > 0) {
			return `${names} needs ${input.openNeededCount} more folder `
				+ `${plural(input.openNeededCount, 'type', 'types')} here. `
				+ 'Ask "which?" to see the types it did not find.';
		}
		return `These ${input.openEvidenceCount} `
			+ `${plural(input.openEvidenceCount, 'folder identifies', 'folders identify')} `
			+ `${names} here. Next: choose what to manage.`;
	}
	if (step === 2) {
		if (input.managedCount === 0) {
			return 'Check a system to manage it.';
		}
		const counts = `${input.managedCount} ${plural(input.managedCount, 'system', 'systems')} · `
			+ `${input.proposedRuleCount} ${plural(input.proposedRuleCount, 'rule', 'rules')}.`;
		if (input.pendingChoiceAnchorName !== null) {
			return `${counts} ${input.pendingChoiceAnchorName} matches competing systems; `
				+ 'review the selected interpretation there.';
		}
		return `${counts} Next: check the tags they produce.`;
	}
	if (input.managedCount === 0) {
		return 'Nothing is managed yet. Go back to step 2 and check a system.';
	}
	const exact = `${input.exactRuleCount} of ${input.proposedRuleCount} rules are exact in both directions.`;
	const conflicts = input.conflictFolderCount > 0
		? `${input.conflictFolderCount} ${plural(input.conflictFolderCount, 'folder has', 'folders have')} different rule outputs. `
		: '';
	return `${conflicts}${exact} Preview only; no active rules or notes change.`;
}

// ─── Anchor row ────────────────────────────────────────────────────────────

/**
 * The anchor row's reading: the folder name, then every system recognized
 * there — "Studio · PARA", "Main · Johnny Decimal + PARA". The folder stays in
 * ink; each system name carries its own hue once chosen.
 */
export function describeOutlineAnchorTitle(
	folderName: string,
	packNames: readonly string[],
): string {
	if (packNames.length === 0) return folderName;
	return `${folderName} · ${packNames.join(' + ')}`;
}

// ─── System hues ───────────────────────────────────────────────────────────

/**
 * Six well-separated Obsidian hues for systems the user has chosen. Orange and
 * red stay reserved for "too few" and conflict, so a coloured bracket can never
 * be mistaken for a warning.
 */
export const OUTLINE_HUES = Object.freeze([
	'blue', 'green', 'purple', 'pink', 'cyan', 'yellow',
] as const);

export type OutlineHue = (typeof OUTLINE_HUES)[number];

/**
 * Hue per pack id, assigned once and never reassigned. A pack prefers the hue
 * its own hash names; if a pack already coloured holds that hue, the next free
 * hue is taken so systems coloured together never share one while a free hue
 * exists. Once given, a hue survives every rerender, step, and frame.
 *
 * Two occurrences that share an anchor form a group, and a group's systems must
 * be told apart at a glance: they never share a hue. When every hue is already
 * taken the registry hands out the LEAST-RECENTLY-ASSIGNED hue that no system
 * in the same group holds, rather than duplicating a sibling's colour.
 */
export class OutlineHueRegistry {
	private readonly hues = new Map<string, OutlineHue>();
	/** Assignment order per hue, so an exhausted palette reuses the oldest. */
	private readonly assignedAt = new Map<OutlineHue, number>();
	private tick = 0;

	hueFor(packId: string): OutlineHue | null {
		return this.hues.get(packId) ?? null;
	}

	/**
	 * Assign hues to any pack ids not yet coloured, in the given order.
	 *
	 * @param coAnchoredPackIds groups of pack ids that share one anchor. No two
	 *   pack ids inside one group are ever given the same hue.
	 */
	assign(
		packIds: readonly string[],
		coAnchoredPackIds: readonly (readonly string[])[] = [],
	): void {
		for (const packId of packIds) {
			if (this.hues.has(packId)) continue;
			const taken = new Set(this.hues.values());
			const forbidden = this.huesOfCoAnchored(packId, coAnchoredPackIds);
			const preferred = hashKey(packId) % OUTLINE_HUES.length;
			const ordered: OutlineHue[] = [];
			for (let offset = 0; offset < OUTLINE_HUES.length; offset++) {
				ordered.push(OUTLINE_HUES[(preferred + offset) % OUTLINE_HUES.length]);
			}
			// A free hue is never held by a sibling, so it always satisfies the
			// group rule; only an exhausted palette has to fall back.
			const chosen = ordered.find((hue) => !taken.has(hue))
				?? this.leastRecentlyAssigned(ordered.filter((hue) => !forbidden.has(hue)))
				?? this.leastRecentlyAssigned(ordered)
				?? ordered[0];
			this.tick++;
			this.hues.set(packId, chosen);
			this.assignedAt.set(chosen, this.tick);
		}
	}

	size(): number {
		return this.hues.size;
	}

	private huesOfCoAnchored(
		packId: string,
		coAnchoredPackIds: readonly (readonly string[])[],
	): Set<OutlineHue> {
		const forbidden = new Set<OutlineHue>();
		for (const group of coAnchoredPackIds) {
			if (!group.includes(packId)) continue;
			for (const sibling of group) {
				if (sibling === packId) continue;
				const hue = this.hues.get(sibling);
				if (hue !== undefined) forbidden.add(hue);
			}
		}
		return forbidden;
	}

	private leastRecentlyAssigned(candidates: readonly OutlineHue[]): OutlineHue | null {
		let best: OutlineHue | null = null;
		let bestTick = Number.POSITIVE_INFINITY;
		for (const hue of candidates) {
			const at = this.assignedAt.get(hue) ?? -1;
			if (at < bestTick) {
				bestTick = at;
				best = hue;
			}
		}
		return best;
	}
}

/** 32-bit FNV-1a; the same hash the organizational-system marker uses. */
function hashKey(value: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < value.length; index++) {
		hash ^= value.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}

// ─── Occurrence state wording ──────────────────────────────────────────────

export type OutlineOccurrenceState = 'complete' | 'partial' | 'too-few';

export interface OutlineCompleteness {
	state: OutlineOccurrenceState;
	text: string;
	/** Too few only: how many more folders would make the occurrence ready. */
	neededCount: number;
	/** Folder types the pack expects that were not found here. */
	missingCount: number;
}

/**
 * Three states, one verb each. Complete found every folder type; Partial found
 * enough to manage; Too few names what would complete it. Only "Too few" is a
 * warning.
 */
export function describeOutlineCompleteness(
	occurrence: Pick<
		OutlineOccurrenceLike,
		'status' | 'evidenceCount' | 'minEvidence' | 'countBy' | 'missingRoles'
	>,
): OutlineCompleteness {
	const missing = occurrence.missingRoles.length;
	const found = occurrence.evidenceCount;

	if (occurrence.status === 'actionable') {
		if (occurrence.countBy === 'roles') {
			const total = found + missing;
			return missing === 0
				? { state: 'complete', text: `Complete · ${found} of ${total}`, neededCount: 0, missingCount: 0 }
				: {
					state: 'partial',
					text: `Partial · ${found} of ${total} — can manage`,
					neededCount: 0,
					missingCount: missing,
				};
		}
		return {
			state: 'complete',
			text: `Complete · ${found} matching ${plural(found, 'folder', 'folders')}`,
			neededCount: 0,
			missingCount: 0,
		};
	}

	const needed = Math.max(1, occurrence.minEvidence - found);
	if (occurrence.countBy === 'roles' && missing > 0) {
		const total = found + missing;
		return {
			state: 'too-few',
			text: `Too few · ${found} of ${total} — add ${describeMissingTypes(occurrence.missingRoles, needed)}`,
			neededCount: needed,
			missingCount: missing,
		};
	}
	return {
		state: 'too-few',
		text: `Too few · ${found} of ${occurrence.minEvidence} — add ${needed} more`,
		neededCount: needed,
		missingCount: missing,
	};
}

/** "Areas", "Areas or Resources", "Areas, Resources or Archive", "2 of 5 types". */
function describeMissingTypes(missingRoles: readonly string[], needed: number): string {
	const names = missingRoles.map(titleCaseRole);
	if (names.length > 3) return `${Math.min(needed, names.length)} of ${names.length} types`;
	return joinNames(names, needed >= names.length ? 'and' : 'or');
}

export interface OutlineFoldWordInput {
	unfolded: boolean;
	matchedCount: number;
}

/**
 * The fold toggle is a word, never a glyph, and it lives on its own muted
 * sub-row beneath the anchor — never in the anchor row itself, where it competed
 * with the folder name and the state for the same line. It says exactly what
 * unfolding reveals: the occurrence's matched folders.
 */
export function describeOutlineFoldWord(input: OutlineFoldWordInput): string {
	if (input.unfolded) return 'Hide';
	return `Show ${input.matchedCount} matched ${plural(input.matchedCount, 'folder', 'folders')}`;
}

/**
 * The separate link on the fold sub-row that reveals the missing-type ghost
 * rows. A plain unfold shows matched members only; the "Not found" rows appear
 * only after the user asks which types are missing.
 */
export function describeOutlineMissingTypesLink(missingCount: number, open: boolean): string {
	if (open) return 'Hide missing types';
	return `${missingCount} missing ${plural(missingCount, 'type', 'types')} — which?`;
}

/**
 * Co-anchored systems that disagree get COUNTS on the anchor row, one line —
 * never two concatenated system statuses. Each system's own state is said on
 * its radio sub-row instead.
 */
export function describeOutlineGroupState(systemCount: number, canManageCount: number): string {
	return `${systemCount} ${plural(systemCount, 'system', 'systems')} · `
		+ `${canManageCount} can manage`;
}

// ─── Fold / unfold model ───────────────────────────────────────────────────

export interface OutlineFoldInput {
	/** Every folder path present in the annotated tree. */
	treePaths: readonly string[];
	/** Occurrences whose brackets are drawn. */
	occurrences: readonly OutlineOccurrenceLike[];
	/** Occurrence keys whose evidence rows are revealed. */
	unfoldedKeys: ReadonlySet<string>;
	/** Reveal every folder in the tree, ignoring folding. */
	showAllFolders: boolean;
}

export interface OutlineFoldModel {
	/** Rendered folder paths, depth-first and alphabetical within a level. */
	visiblePaths: string[];
	/** Rendered paths, as a set, for quick membership checks. */
	visible: Set<string>;
	/** Per parent path (`''` = tree root) how many tree children stayed hidden. */
	elidedCountByParent: Map<string, number>;
}

/**
 * Start folded: only the ancestors needed to reach an anchor, plus the anchors
 * themselves. Unfolding an occurrence reveals exactly its own member/support
 * rows (and any intermediate folders between the anchor and that evidence).
 */
export function computeOutlineFoldModel(input: OutlineFoldInput): OutlineFoldModel {
	const treePaths = new Set(input.treePaths);
	const visible = new Set<string>();

	const reveal = (path: string): void => {
		let cursor = path;
		while (cursor !== '' && treePaths.has(cursor) && !visible.has(cursor)) {
			visible.add(cursor);
			cursor = parentOf(cursor);
		}
	};

	if (input.showAllFolders) {
		for (const path of treePaths) visible.add(path);
	} else {
		for (const occurrence of input.occurrences) {
			reveal(occurrence.anchorPath);
			if (!input.unfoldedKeys.has(occurrence.key)) continue;
			for (const path of occurrence.memberPaths) reveal(path);
			for (const path of occurrence.supportPaths) reveal(path);
		}
	}

	const childrenByParent = new Map<string, string[]>();
	for (const path of treePaths) {
		const parent = parentOf(path);
		const bucket = childrenByParent.get(parent);
		if (bucket) bucket.push(path);
		else childrenByParent.set(parent, [path]);
	}

	const elidedCountByParent = new Map<string, number>();
	for (const [parent, children] of childrenByParent) {
		if (parent !== '' && !visible.has(parent)) continue;
		const hidden = children.filter((child) => !visible.has(child)).length;
		if (hidden > 0) elidedCountByParent.set(parent, hidden);
	}

	return {
		visiblePaths: sortOutlinePaths([...visible]),
		visible,
		elidedCountByParent,
	};
}

/** Depth-first order: a folder is immediately followed by its own subtree. */
export function sortOutlinePaths(paths: readonly string[]): string[] {
	return [...paths].sort((a, b) => {
		const left = a.split('/');
		const right = b.split('/');
		const shared = Math.min(left.length, right.length);
		for (let index = 0; index < shared; index++) {
			if (left[index] === right[index]) continue;
			return left[index] < right[index] ? -1 : 1;
		}
		return left.length - right.length;
	});
}

/** Hidden tree children that no system matched, under a visible parent. */
export function describeOutlineElision(count: number): string {
	return `${count} unmatched ${plural(count, 'folder', 'folders')}`;
}

// ─── Bracket geometry ──────────────────────────────────────────────────────

export interface OutlineBracketSpan {
	occurrenceKey: string;
	anchorPath: string;
	/** Row index of the last member/support row covered, or -1 when folded away. */
	lastRowIndex: number;
	lastRowPath: string | null;
	/** Covered evidence rows, in render order. */
	coveredPaths: string[];
	/** No evidence row is visible, so no bar renders. */
	collapsed: boolean;
	/** Incomplete occurrences draw a dashed span. */
	dashed: boolean;
}

/**
 * Compute how far one occurrence's bracket reaches. The span starts under the
 * anchor row and ends at the deepest evidence row of that occurrence that is
 * actually rendered — never at an unrelated row that happens to follow.
 */
export function computeOutlineBracketSpan(
	occurrence: OutlineOccurrenceLike,
	visibleRowPaths: readonly string[],
): OutlineBracketSpan {
	const evidence = new Set<string>([
		...occurrence.memberPaths,
		...occurrence.supportPaths,
	]);
	const coveredPaths: string[] = [];
	let lastRowIndex = -1;
	let lastRowPath: string | null = null;

	for (const [index, path] of visibleRowPaths.entries()) {
		if (!evidence.has(path)) continue;
		coveredPaths.push(path);
		lastRowIndex = index;
		lastRowPath = path;
	}

	return {
		occurrenceKey: occurrence.key,
		anchorPath: occurrence.anchorPath,
		lastRowIndex,
		lastRowPath,
		coveredPaths,
		collapsed: lastRowIndex === -1,
		dashed: occurrence.status !== 'actionable',
	};
}

/**
 * A group's bracket is ONE lane. Co-anchored systems share their evidence rows,
 * so two parallel lines would draw the same span twice; the lane instead runs
 * to whichever system's evidence reaches deepest.
 */
export function computeOutlineGroupBracketSpan(
	group: OutlineGroup<OutlineOccurrenceLike>,
	visibleRowPaths: readonly string[],
): OutlineBracketSpan {
	const spans = group.occurrences
		.map((occurrence) => computeOutlineBracketSpan(occurrence, visibleRowPaths));
	const deepest = spans.reduce(
		(best, span) => (span.lastRowIndex > best.lastRowIndex ? span : best),
		spans[0],
	);
	const covered = new Set<string>();
	for (const span of spans) for (const path of span.coveredPaths) covered.add(path);
	return {
		occurrenceKey: group.occurrences[0].key,
		anchorPath: group.anchorPath,
		lastRowIndex: deepest.lastRowIndex,
		lastRowPath: deepest.lastRowPath,
		coveredPaths: visibleRowPaths.filter((path) => covered.has(path)),
		collapsed: deepest.lastRowIndex === -1,
		dashed: group.occurrences.every((occurrence) => occurrence.status !== 'actionable'),
	};
}

export interface OutlineEvidenceAnnotation {
	kind: 'role' | 'support';
	text: string;
}

/**
 * Role text shown on an evidence row of an OPEN occurrence only, and only when
 * it adds something: a role named exactly like its folder is noise.
 */
export function describeOutlineEvidenceRow(
	occurrence: OutlineOccurrenceLike,
	folderPath: string,
	roleByPath: ReadonlyMap<string, string>,
): OutlineEvidenceAnnotation | null {
	if (occurrence.supportPaths.includes(folderPath)) {
		return { kind: 'support', text: 'supports' };
	}
	if (!occurrence.memberPaths.includes(folderPath)) return null;
	const role = roleByPath.get(folderPath) ?? null;
	if (role === null) return null;
	if (role.toLowerCase() === folderDisplayName(folderPath).toLowerCase()) return null;
	return { kind: 'role', text: role };
}

// ─── Co-anchored groups ────────────────────────────────────────────────────

/** Minimal candidate shape the collision check needs. */
export interface OutlineCandidateLike {
	key: string;
	ruleId: string;
	occurrenceKey: string;
	conflict: {
		candidateTargets?: readonly { candidateKey: string; occurrenceKey: string }[];
		overlappingFolderSample?: readonly string[];
		predictedWinnerId?: string | null;
	};
}

export interface OutlineGroupCollision {
	/** Two co-anchored systems would both claim the same folders. */
	collides: boolean;
	/** Occurrence the runtime would pick, when the plan predicts one. */
	predictedWinnerKey: string | null;
}

/**
 * Do the systems at one anchor genuinely compete? A candidate from system A
 * naming a candidate from system B is direct evidence. When the planner did not
 * attach exact targets, two systems both reporting overlapping folders at the
 * same anchor is the fallback signal.
 */
export function detectOutlineGroupCollision(
	occurrenceKeys: readonly string[],
	candidates: readonly OutlineCandidateLike[],
): OutlineGroupCollision {
	const inGroup = new Set(occurrenceKeys);
	const groupCandidates = candidates
		.filter((candidate) => inGroup.has(candidate.occurrenceKey));
	const ownerByRuleId = new Map(
		groupCandidates.map((candidate) => [candidate.ruleId, candidate.occurrenceKey] as const),
	);

	let collides = false;
	let predictedWinnerKey: string | null = null;
	let sawTargets = false;

	for (const candidate of groupCandidates) {
		const targets = candidate.conflict.candidateTargets;
		if (targets === undefined) continue;
		sawTargets = true;
		for (const target of targets) {
			if (!inGroup.has(target.occurrenceKey)) continue;
			if (target.occurrenceKey === candidate.occurrenceKey) continue;
			collides = true;
			const winnerId = candidate.conflict.predictedWinnerId ?? null;
			const winnerKey = winnerId === null ? null : ownerByRuleId.get(winnerId) ?? null;
			if (predictedWinnerKey === null && winnerKey !== null) predictedWinnerKey = winnerKey;
		}
	}

	if (!collides && !sawTargets) {
		const overlapping = new Set(
			groupCandidates
				.filter((candidate) => (candidate.conflict.overlappingFolderSample ?? []).length > 0)
				.map((candidate) => candidate.occurrenceKey),
		);
		collides = overlapping.size > 1;
	}

	return { collides, predictedWinnerKey };
}

/**
 * Generic over the occurrence type so a caller that starts with full
 * `DetectionOccurrence`s (the panel needs `evidence` for role text) gets them
 * back unchanged; the pure helpers only ever read the `OutlineOccurrenceLike`
 * subset.
 */
export interface OutlineGroup<T extends OutlineOccurrenceLike = OutlineOccurrenceLike> {
	anchorPath: string;
	/** Every system recognized at this anchor, in stable render order. */
	occurrences: T[];
	collides: boolean;
	predictedWinnerKey: string | null;
}

/** One group per anchor, preserving the incoming occurrence order. */
export function buildOutlineGroups<T extends OutlineOccurrenceLike>(
	occurrences: readonly T[],
	candidates: readonly OutlineCandidateLike[] = [],
): OutlineGroup<T>[] {
	const byAnchor = new Map<string, T[]>();
	for (const occurrence of occurrences) {
		const bucket = byAnchor.get(occurrence.anchorPath);
		if (bucket) bucket.push(occurrence);
		else byAnchor.set(occurrence.anchorPath, [occurrence]);
	}

	const groups: OutlineGroup<T>[] = [];
	for (const [anchorPath, members] of byAnchor) {
		const ready = members.filter((member) => member.status === 'actionable');
		const collision = ready.length > 1
			? detectOutlineGroupCollision(ready.map((member) => member.key), candidates)
			: { collides: false, predictedWinnerKey: null };
		groups.push({
			anchorPath,
			occurrences: members,
			collides: collision.collides,
			predictedWinnerKey: collision.predictedWinnerKey,
		});
	}
	return groups;
}

export function describeOutlineGroupInclusion(count: number): string {
	return count === 2
		? 'both systems will be managed'
		: `all ${count} systems will be managed`;
}

/** The radio's visible word: the runtime's prediction, or the alternative. */
export function describeOutlineChoiceLabel(predicted: boolean, displayDefault = false): string {
	return predicted ? 'Predicted on sample' : displayDefault ? 'Display default · no prediction' : 'Alternative';
}

export interface OutlineChoiceEvidenceInput {
	/** Folder types this system found at the anchor. */
	evidenceCount: number;
	/** Folder types the pack expects; 0 when the pack counts members. */
	totalCount: number;
	/** Why the runtime picks this rule over the alternative, when known. */
	reason: string | null;
}

/** One muted line under "Predicted": the evidence the prediction rests on. */
export function describeOutlineChoiceEvidence(input: OutlineChoiceEvidenceInput): string {
	const found = input.totalCount > 0
		? `found ${input.evidenceCount} of ${input.totalCount} folder types`
		: `found ${input.evidenceCount} matching ${plural(input.evidenceCount, 'folder', 'folders')}`;
	return input.reason === null ? found : `${found} · ${input.reason}`;
}

export interface OutlineGhostRow {
	/** The missing folder type, as a folder would be named. */
	name: string;
	text: string;
}

/**
 * "3 missing types" unfolds into one ghost row per missing role, so the user
 * sees exactly which folder would complete the system.
 */
export function describeOutlineGhostRows(missingRoles: readonly string[]): OutlineGhostRow[] {
	return missingRoles.map((role) => ({ name: titleCaseRole(role), text: 'Not found' }));
}

/** `projects-archive` → `Projects Archive`: a role rendered like a folder name. */
export function titleCaseRole(role: string): string {
	return role
		.split(/[-_\s]+/)
		.filter((part) => part !== '')
		.map((part) => part.charAt(0).toUpperCase() + part.slice(1))
		.join(' ');
}

export interface OutlineGroupChoice {
	/** The system the group is being read as, when a choice is forced. */
	chosenKey: string | null;
	/** Co-anchored alternatives the user is not taking. */
	declinedKeys: string[];
}

/**
 * Resolve a colliding group to one interpretation. An explicit decline wins;
 * otherwise the predicted runtime winner is preselected so the prototype never
 * silently proposes two rules that fight over the same folders.
 */
export function resolveOutlineGroupChoice(
	group: OutlineGroup,
	declined: ReadonlySet<string>,
): OutlineGroupChoice {
	const ready = group.occurrences.filter((occurrence) => occurrence.status === 'actionable');
	if (!group.collides || ready.length < 2) return { chosenKey: null, declinedKeys: [] };

	const remaining = ready.filter((occurrence) => !declined.has(occurrence.key));
	const fallback = group.predictedWinnerKey !== null
		&& ready.some((occurrence) => occurrence.key === group.predictedWinnerKey)
		? group.predictedWinnerKey
		: ready[0].key;
	const chosenKey = remaining.length === 1 ? remaining[0].key : fallback;

	return {
		chosenKey,
		declinedKeys: ready
			.filter((occurrence) => occurrence.key !== chosenKey)
			.map((occurrence) => occurrence.key),
	};
}

/** Every occurrence key the current choices exclude from planning. */
export function collectOutlineDeclinedKeys(
	groups: readonly OutlineGroup[],
	declined: ReadonlySet<string>,
): Set<string> {
	const effective = new Set<string>();
	for (const group of groups) {
		for (const key of resolveOutlineGroupChoice(group, declined).declinedKeys) {
			effective.add(key);
		}
	}
	return effective;
}

/** Choosing one system in a group declines its co-anchored alternatives. */
export function chooseOutlineGroupSystem(
	group: OutlineGroup,
	declined: ReadonlySet<string>,
	chosenKey: string,
): Set<string> {
	const next = new Set(declined);
	for (const occurrence of group.occurrences) {
		if (occurrence.status !== 'actionable') continue;
		if (occurrence.key === chosenKey) next.delete(occurrence.key);
		else next.add(occurrence.key);
	}
	return next;
}

// ─── Management (step 2) ───────────────────────────────────────────────────

export type OutlineManageKind = 'manage' | 'included-by' | 'unavailable';

export interface OutlineManageControl {
	kind: OutlineManageKind;
	checked: boolean;
	disabled: boolean;
	/** The checkbox label ("Manage here") or, when no checkbox, the annotation. */
	text: string;
}

export interface OutlineManageInput {
	anchorPath: string;
	ready: boolean;
	/** Checked folders — the one and only deployment filter. */
	selectedPaths: readonly string[];
	/** True when this occurrence is in the current scope pack plan. */
	inPlan: boolean;
}

/** The nearest checked ancestor that would absorb this anchor, if any. */
export function findOutlineIncludingAncestor(
	anchorPath: string,
	selectedPaths: readonly string[],
): string | null {
	let best: string | null = null;
	for (const selected of selectedPaths) {
		if (selected === anchorPath) continue;
		const covers = selected === ''
			|| anchorPath === selected
			|| anchorPath.startsWith(`${selected}/`);
		if (!covers) continue;
		if (best === null || pathDepth(selected) > pathDepth(best)) best = selected;
	}
	return best;
}

/**
 * Parent inclusion is drawn: a descendant anchor managed by a checked ancestor
 * shows a disabled, checked control and says which folder includes it.
 */
export function describeOutlineManageControl(
	input: OutlineManageInput,
): OutlineManageControl {
	if (!input.ready) {
		return {
			kind: 'unavailable',
			checked: false,
			disabled: true,
			text: "Can't manage yet",
		};
	}
	if (input.selectedPaths.includes(input.anchorPath)) {
		return { kind: 'manage', checked: true, disabled: false, text: 'Manage here' };
	}
	const ancestor = findOutlineIncludingAncestor(input.anchorPath, input.selectedPaths);
	if (input.inPlan && ancestor !== null) {
		return {
			kind: 'included-by',
			checked: true,
			disabled: true,
			text: `included by ${folderDisplayName(ancestor)}`,
		};
	}
	return { kind: 'manage', checked: false, disabled: false, text: 'Manage here' };
}

/** Toggle one anchor in the shared checked-folder input. Order is stable. */
export function toggleOutlineSelectedPath(
	selectedPaths: readonly string[],
	anchorPath: string,
	next: boolean,
): string[] {
	const set = new Set(selectedPaths);
	if (next) set.add(anchorPath);
	else set.delete(anchorPath);
	return [...set].sort(compareCodePoints);
}

// ─── Results (step 3) ──────────────────────────────────────────────────────

/**
 * Say only what is not already true. Two exact directions is nothing (the hint
 * says it once); anything else names just the direction that is not exact.
 */
export function describeOutlineDirectionAnnotation(
	status: CandidateDirectionalStatus,
): string | null {
	const parts: string[] = [];
	if (status.folderToTag.status !== 'exact') {
		parts.push(`Folder → tag: ${status.folderToTag.label.toLowerCase()}`);
	}
	if (status.tagToFolder.status !== 'exact') {
		parts.push(`Tag → folder: ${status.tagToFolder.label.toLowerCase()}`);
	}
	return parts.length === 0 ? null : parts.join(' · ');
}

export function describeOutlinePreviewToggle(count: number): string {
	return `${count} ${plural(count, 'folder', 'folders')} inside`;
}

/**
 * A folder name as a tag segment would spell it when the rule did nothing but
 * lower-case it: "Areas" → "areas", "Invented client rebrand" →
 * "invented-client-rebrand". "10 - Projects" → "10---projects", which is why
 * a Johnny Decimal segment "10-projects" reads as a delta: the rule did work.
 */
export function folderNameSlug(name: string): string {
	return name.trim().toLowerCase().replace(/\s+/g, '-');
}

/**
 * A tag that no note could carry: nothing after the hash, an empty segment
 * (`#/`, `#a//b`), or a segment that is only an axis marker with no name
 * (`#-`, `#a/_`). A named marker segment such as `-clip` is a legitimate
 * SEACOW capture-axis tag and is not degenerate.
 */
export function isDegenerateTag(tag: string): boolean {
	const body = tag.startsWith('#') ? tag.slice(1) : tag;
	if (body === '') return true;
	return body.split('/').some((segment) => segment === '' || /^[-_]+$/.test(segment));
}

export type OutlineDeltaKind = 'same' | 'delta' | 'full' | 'none';

export interface OutlineDeltaCell {
	kind: OutlineDeltaKind;
	/** The segment the rule produced, when it differs from the folder name. */
	segment: string | null;
	/** The full tag, for the expansion line and the full-tags mode. */
	tag: string | null;
}

export interface OutlineDeltaInput {
	folderName: string;
	tag: string | null;
	/** The tag the same rule gives the parent folder, or the anchor's tag root. */
	parentTag: string | null;
}

/**
 * The delta reading: ✓ when the tag is just the parent's tag plus the folder
 * name; otherwise only the part the rule changed. A tag that does not sit
 * under the parent's tag at all is shown whole. A degenerate tag is no tag.
 */
export function describeOutlineDeltaCell(input: OutlineDeltaInput): OutlineDeltaCell {
	const tag = input.tag;
	if (tag === null || isDegenerateTag(tag)) return { kind: 'none', segment: null, tag: null };
	const parent = input.parentTag !== null && input.parentTag !== '' && !isDegenerateTag(input.parentTag)
		? input.parentTag
		: null;
	const expected = `${parent === null ? '#' : `${parent}/`}${folderNameSlug(input.folderName)}`;
	if (tag === expected) return { kind: 'same', segment: null, tag };
	if (parent !== null && tag.startsWith(`${parent}/`)) {
		return { kind: 'delta', segment: tag.slice(parent.length + 1), tag };
	}
	if (parent === null && tag.startsWith('#') && !tag.slice(1).includes('/')) {
		return { kind: 'delta', segment: tag.slice(1), tag };
	}
	return { kind: 'full', segment: null, tag };
}

/** The one-line expansion under a ✓ or delta row. */
export function describeOutlineFullTagLine(
	tag: string,
	packName: string,
	folderName: string,
): string {
	return `full tag ${tag} · from rule ${packName} → ${folderName}`;
}

/** The orange text that replaces a degenerate tag. */
export function describeOutlineNoTag(packNames: readonly string[]): string {
	const systems = packNames.length === 0 ? 'the chosen systems' : joinNames(packNames, 'or');
	return `no tag — nothing in ${systems} matches this name`;
}

/**
 * The anchor's own tag when its rule emits one; otherwise the longest tag
 * prefix (whole segments) every member tag shares. `null` when there is none.
 */
export function computeOutlineTagRoot(
	anchorTag: string | null,
	memberTags: readonly string[],
): string | null {
	if (memberTags.length === 0 || memberTags.some(isDegenerateTag)) return null;
	if (anchorTag !== null && !isDegenerateTag(anchorTag)
		&& memberTags.every((tag) => tag.startsWith(`${anchorTag}/`))) return anchorTag;
	const tags = memberTags.filter((tag) => !isDegenerateTag(tag));
	if (tags.length === 0) return null;
	let prefix = tags[0].split('/');
	for (const tag of tags.slice(1)) {
		const parts = tag.split('/');
		let shared = 0;
		while (shared < prefix.length && shared < parts.length && prefix[shared] === parts[shared]) {
			shared++;
		}
		prefix = prefix.slice(0, shared);
		if (prefix.length === 0) return null;
	}
	// A "prefix" that is a whole member tag is that member's tag, not a root.
	if (tags.some((tag) => tag.split('/').length <= prefix.length)) {
		prefix = prefix.slice(0, -1);
	}
	return prefix.length === 0 ? null : prefix.join('/');
}

export interface OutlineTagRootInput {
	root: string | null;
	tagCount: number;
	/** Every member tag reads ✓. */
	allSame: boolean;
}

/** Stated once at the anchor: what every tag below starts with. */
export function describeOutlineTagRoot(input: OutlineTagRootInput): string {
	if (input.root !== null) return `tags start with ${input.root}`;
	if (input.tagCount === 0) return 'no tags';
	const count = `${input.tagCount} distinct ${plural(input.tagCount, 'tag', 'tags')}`;
	return input.allSame ? `${count} · normalized name endings` : count;
}

export interface OutlineMatchLike {
	group?: string;
	confidence: number;
	priority: number;
}

/**
 * Why the runtime picks one rule over another, in the order the matcher
 * decides it: rule group, then match specificity, then priority. `null` when
 * the two are indistinguishable here, which the conflict line reports as
 * "predicted".
 */
export function describeOutlineWinReason(
	winner: OutlineMatchLike,
	loser: OutlineMatchLike,
	groupPrecedence: readonly string[] = [],
): string | null {
	const a = winner.group ?? '__default__';
	const b = loser.group ?? '__default__';
	const rank = (group: string): number => {
		const index = groupPrecedence.indexOf(group);
		return index < 0 ? groupPrecedence.length + 1 : index;
	};
	if (a !== b) {
		if (rank(a) < rank(b)) return `Configured group order: “${a}” precedes “${b}”.`;
		if (rank(a) === rank(b) && a.localeCompare(b) < 0) {
			return `Neither group is ordered in settings; alphabetical group order puts “${a}” before “${b}”.`;
		}
		return null;
	}
	if (winner.confidence > loser.confidence) {
		return `Same group; higher match confidence (${winner.confidence.toFixed(3)} vs ${loser.confidence.toFixed(3)}).`;
	}
	if (winner.confidence !== loser.confidence) return null;
	if (winner.priority < loser.priority) {
		return `Same group and confidence; lower priority number (${winner.priority} vs ${loser.priority}).`;
	}
	if (winner.priority !== loser.priority) return null;
	return 'Same group, confidence and priority; the matcher keeps the first rule in proposal order.';
}

/** Evaluate proposed rules on this exact folder, not the planner's first overlap
 * sample. Include disabled proposals explicitly; this is not active-rule output. */
export function matchOutlineProposals(
	folder: string,
	rules: readonly MappingRule[],
	groupPrecedence: readonly string[],
): { matches: RuleMatch[]; winner: RuleMatch | null } {
	const matches = findMatchingRules(folder, [...rules], {
		input: folder, matchType: 'folder', direction: 'folder-to-tag', includeDisabled: true,
	});
	return { matches, winner: selectBestMatch(matches, [...groupPrecedence]) };
}

/** Co-anchored choices use the same forward matcher as the tag comparison.
 * An overlap sample with only reverse rules is not a forward prediction. */
export function predictOutlineGroupChoice(
	candidates: readonly { occurrenceKey: string; rule: MappingRule; sampleFolders: readonly string[] }[],
	groupPrecedence: readonly string[],
): { occurrenceKey: string; sampleFolder: string } | null {
	const owners = new Map(candidates.map((candidate) => [candidate.rule.id, candidate.occurrenceKey]));
	const samples = new Set(candidates.flatMap((candidate) => [...candidate.sampleFolders]));
	for (const sampleFolder of samples) {
		const { matches, winner } = matchOutlineProposals(sampleFolder, candidates.map((candidate) => candidate.rule), groupPrecedence);
		if (new Set(matches.map((match) => owners.get(match.rule.id))).size < 2 || !winner) continue;
		return { occurrenceKey: owners.get(winner.rule.id)!, sampleFolder };
	}
	return null;
}

export function describeOutlineMissingOutput(tags: readonly string[] | null): string {
	if (tags === null) return 'No proposed folder-to-tag rule matches.';
	if (tags.length === 0) return 'Matched rule produces no tag.';
	return 'Generation error: matched rule produces unusable tag syntax.';
}

export interface OutlineResultSummaryInput {
	systemCount: number;
	tagCount: number;
	skippedCount: number;
}

/** Footer line at step 3: what the rules amount to. */
export function describeOutlineResultSummary(input: OutlineResultSummaryInput): string {
	const base = `${input.systemCount} ${plural(input.systemCount, 'system', 'systems')} · `
		+ `${input.tagCount} distinct ${plural(input.tagCount, 'tag', 'tags')}`;
	return input.skippedCount === 0
		? base
		: `${base} · ${input.skippedCount} ${plural(input.skippedCount, 'folder', 'folders')} without a tag`;
}

// ─── Shared helpers ────────────────────────────────────────────────────────

export function folderDisplayName(path: string): string {
	if (path === '') return 'vault root';
	const index = path.lastIndexOf('/');
	return index === -1 ? path : path.slice(index + 1);
}

export function outlineDepth(path: string): number {
	return path === '' ? 0 : path.split('/').length;
}

/** "A", "A and B", "A, B and C". */
export function joinNames(names: readonly string[], conjunction: 'and' | 'or'): string {
	if (names.length === 0) return '';
	if (names.length === 1) return names[0];
	return `${names.slice(0, -1).join(', ')} ${conjunction} ${names[names.length - 1]}`;
}

function parentOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}

function pathDepth(path: string): number {
	return path === '' ? 0 : path.split('/').length;
}

function plural(count: number, one: string, many: string): string {
	return count === 1 ? one : many;
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
