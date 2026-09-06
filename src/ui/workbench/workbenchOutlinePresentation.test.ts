/**
 * Round-3 coverage for the annotated-outline presentation contract.
 *
 * Every assertion here is the wording, geometry, or hue rule the prototype
 * promises the user: the anchor row reads "Studio · PARA", a system's hue is
 * keyed to its pack id for the session, an occurrence is Complete / Partial /
 * Too few with one verb each, step 3 reads as a delta against the folder name,
 * and the conflict line stands on its own.
 */

import { describe, expect, test } from 'bun:test';
import { previewRule } from '../../engine/rulePreview';
import type { MappingRule } from '../../types/settings';
import type { CandidateDirectionalStatus } from './candidateDirectionStatus';
import {
	OUTLINE_HUES,
	OUTLINE_STEPS,
	OutlineHueRegistry,
	buildOutlineGroups,
	chooseOutlineGroupSystem,
	collectOutlineDeclinedKeys,
	computeOutlineBracketSpan,
	computeOutlineFoldModel,
	computeOutlineGroupBracketSpan,
	computeOutlineTagRoot,
	describeOutlineAnchorTitle,
	describeOutlineChoiceEvidence,
	describeOutlineChoiceLabel,
	describeOutlineCompleteness,
	describeOutlineDeltaCell,
	describeOutlineDirectionAnnotation,
	describeOutlineElision,
	describeOutlineEvidenceRow,
	describeOutlineFoldWord,
	describeOutlineFullTagLine,
	describeOutlineGhostRows,
	describeOutlineGroupInclusion,
	describeOutlineGroupState,
	describeOutlineHint,
	describeOutlineInstruction,
	describeOutlineManageControl,
	describeOutlineManagementSummary,
	describeOutlineMissingTypesLink,
	describeOutlineNoTag,
	describeOutlinePreviewToggle,
	describeOutlineResultSummary,
	describeOutlineTagRoot,
	describeOutlineWinReason,
	matchOutlineProposals,
	predictOutlineGroupChoice,
	describeOutlineMissingOutput,
	detectOutlineGroupCollision,
	findOutlineIncludingAncestor,
	folderDisplayName,
	folderNameSlug,
	isDegenerateTag,
	joinNames,
	outlineAnnotationColumnForStep,
	outlineDepth,
	outlineStepLabel,
	outlineStepShortLabel,
	resolveOutlineGroupChoice,
	sortOutlinePaths,
	titleCaseRole,
	toggleOutlineSelectedPath,
	type OutlineCandidateLike,
	type OutlineGroup,
	type OutlineHintInput,
	type OutlineInstructionInput,
	type OutlineOccurrenceLike,
} from './workbenchOutlinePresentation';

// ─── Fixtures (invented names only) ────────────────────────────────────────

function occurrence(
	overrides: Partial<OutlineOccurrenceLike> & Pick<OutlineOccurrenceLike, 'key' | 'anchorPath'>,
): OutlineOccurrenceLike {
	return {
		packId: 'para',
		packName: 'PARA',
		status: 'actionable',
		evidenceCount: 4,
		minEvidence: 2,
		countBy: 'roles',
		memberPaths: [],
		supportPaths: [],
		missingRoles: [],
		...overrides,
	};
}

function candidate(
	overrides: Partial<OutlineCandidateLike> & Pick<OutlineCandidateLike, 'key' | 'occurrenceKey'>,
): OutlineCandidateLike {
	return {
		ruleId: `rule-${overrides.key}`,
		conflict: {},
		...overrides,
	};
}

const instructionBase: OutlineInstructionInput = {
	systemCount: 5,
	managedCount: 2,
	proposedRuleCount: 6,
	conflictFolderCount: 0,
	showFullTags: false,
};

const hintBase: OutlineHintInput = {
	openPackNames: [],
	openEvidenceCount: 0,
	openNeededCount: 0,
	managedCount: 0,
	proposedRuleCount: 0,
	pendingChoiceAnchorName: null,
	conflictFolderCount: 0,
	exactRuleCount: 0,
};

function direction(
	folderToTag: CandidateDirectionalStatus['folderToTag']['status'],
	tagToFolder: CandidateDirectionalStatus['tagToFolder']['status'],
): CandidateDirectionalStatus {
	return {
		folderToTag: { status: folderToTag, label: labelFor(folderToTag), detail: '' },
		tagToFolder: { status: tagToFolder, label: labelFor(tagToFolder), detail: '' },
	};
}

function labelFor(status: string): string {
	return `${status.charAt(0).toUpperCase()}${status.slice(1)}`;
}

// ─── Steps, instruction, summary ───────────────────────────────────────────

describe('guided steps', () => {
	test('there are exactly three steps and each owns one annotation column', () => {
		expect([...OUTLINE_STEPS]).toEqual([1, 2, 3]);
		expect(outlineAnnotationColumnForStep(1)).toBe('completeness');
		expect(outlineAnnotationColumnForStep(2)).toBe('management');
		expect(outlineAnnotationColumnForStep(3)).toBe('result');
	});

	test('step labels keep the number and one verb, with a short form for narrow widths', () => {
		expect(outlineStepLabel(1)).toBe('1 Find systems');
		expect(outlineStepLabel(2)).toBe('2 Choose what to manage');
		expect(outlineStepLabel(3)).toBe('3 Check the tags');
		expect(outlineStepShortLabel(1)).toBe('1 Find');
		expect(outlineStepShortLabel(2)).toBe('2 Choose');
		expect(outlineStepShortLabel(3)).toBe('3 Check');
	});

	test('the instruction states the step and never repeats the hint', () => {
		expect(describeOutlineInstruction(1, instructionBase))
			.toBe('We found 5 organizational systems in your vault.');
		expect(describeOutlineInstruction(1, { ...instructionBase, systemCount: 1 }))
			.toBe('We found 1 organizational system in your vault.');
		expect(describeOutlineInstruction(2, instructionBase))
			.toBe('Checked systems get draft rules. '
				+ 'Managing a folder includes every ready system beneath it.');
	});

	test('step 3 leads with the delta reading, and with chips only when they are shown', () => {
		expect(describeOutlineInstruction(3, instructionBase))
			.toBe('Check the proposed tags. A ✓ means the last segment matches the normalized folder name.');
		expect(describeOutlineInstruction(3, { ...instructionBase, showFullTags: true }))
			.toBe('Proposed tags, shown in full. Compare rules where outputs differ.');
		expect(describeOutlineInstruction(3, {
			...instructionBase,
			showFullTags: true,
			conflictFolderCount: 1,
		})).toBe('Proposed tags, shown in full. Compare rules where outputs differ.');
		// The delta reading says the same thing whether or not a conflict exists;
		// the conflict is counted by the hint, not the lead.
		expect(describeOutlineInstruction(3, { ...instructionBase, conflictFolderCount: 3 }))
			.toBe('Check the proposed tags. A ✓ means the last segment matches the normalized folder name.');
	});

	test('the management summary counts systems and rules', () => {
		expect(describeOutlineManagementSummary(1, 1))
			.toBe('1 system managed · 1 rule will be proposed');
		expect(describeOutlineManagementSummary(3, 7))
			.toBe('3 systems managed · 7 rules will be proposed');
	});
});

// ─── Hint line ─────────────────────────────────────────────────────────────

describe('hint line per state', () => {
	test('step 1 teaches the fold, then reports what the folders prove', () => {
		expect(describeOutlineHint(1, hintBase))
			.toBe("Show a system's folders to see what identifies it.");
		expect(describeOutlineHint(1, {
			...hintBase,
			openPackNames: ['PARA'],
			openEvidenceCount: 4,
		})).toBe('These 4 folders identify PARA here. Next: choose what to manage.');
		expect(describeOutlineHint(1, {
			...hintBase,
			openPackNames: ['PARA'],
			openEvidenceCount: 1,
		})).toBe('These 1 folder identifies PARA here. Next: choose what to manage.');
	});

	test('step 1 names both co-anchored systems and what an incomplete one lacks', () => {
		expect(describeOutlineHint(1, {
			...hintBase,
			openPackNames: ['Johnny Decimal', 'PARA'],
			openEvidenceCount: 6,
		})).toBe('These 6 folders identify Johnny Decimal and PARA here. '
			+ 'Next: choose what to manage.');
		expect(describeOutlineHint(1, {
			...hintBase,
			openPackNames: ['Johnny Decimal'],
			openEvidenceCount: 1,
			openNeededCount: 1,
		})).toBe('Johnny Decimal needs 1 more folder type here. '
			+ 'Ask "which?" to see the types it did not find.');
		expect(describeOutlineHint(1, {
			...hintBase,
			openPackNames: ['Johnny Decimal'],
			openEvidenceCount: 1,
			openNeededCount: 2,
		})).toContain('needs 2 more folder types here');
	});

	test('step 2 counts the plan and points at a live co-anchored choice', () => {
		expect(describeOutlineHint(2, hintBase)).toBe('Check a system to manage it.');
		// A collision is only knowable once the anchor is managed, so an unmanaged
		// pending choice never overrides the teaching sentence.
		expect(describeOutlineHint(2, { ...hintBase, pendingChoiceAnchorName: 'Main' }))
			.toBe('Check a system to manage it.');
		expect(describeOutlineHint(2, {
			...hintBase,
			managedCount: 1,
			proposedRuleCount: 4,
			pendingChoiceAnchorName: 'Main',
		})).toBe('1 system · 4 rules. Main matches competing systems; '
			+ 'review the selected interpretation there.');
		expect(describeOutlineHint(2, { ...hintBase, managedCount: 2, proposedRuleCount: 3 }))
			.toBe('2 systems · 3 rules. Next: check the tags they produce.');
	});

	test('step 3 counts conflicts up front and says "both directions exact" once', () => {
		expect(describeOutlineHint(3, hintBase))
			.toBe('Nothing is managed yet. Go back to step 2 and check a system.');
		expect(describeOutlineHint(3, {
			...hintBase,
			managedCount: 2,
			proposedRuleCount: 4,
			exactRuleCount: 4,
		})).toBe('4 of 4 rules are exact in both directions. '
			+ 'Preview only; no active rules or notes change.');
		expect(describeOutlineHint(3, {
			...hintBase,
			managedCount: 2,
			proposedRuleCount: 5,
			exactRuleCount: 2,
		})).toBe('2 of 5 rules are exact in both directions. '
			+ 'Preview only; no active rules or notes change.');
	});

	test('step 3 sends the eye to the red line, singular and plural', () => {
		const one = describeOutlineHint(3, {
			...hintBase,
			managedCount: 2,
			proposedRuleCount: 4,
			exactRuleCount: 4,
			conflictFolderCount: 1,
		});
		expect(one).toBe('1 folder has different rule outputs. 4 of 4 rules are exact in both directions. '
			+ 'Preview only; no active rules or notes change.');
		expect(describeOutlineHint(3, {
			...hintBase,
			managedCount: 2,
			proposedRuleCount: 4,
			exactRuleCount: 4,
			conflictFolderCount: 3,
		})).toBe('3 folders have different rule outputs. 4 of 4 rules are exact in both directions. '
			+ 'Preview only; no active rules or notes change.');
	});
});

// ─── Anchor row title ──────────────────────────────────────────────────────

describe('anchor row title', () => {
	test('one system reads as folder name, middle dot, system name', () => {
		expect(describeOutlineAnchorTitle('Studio', ['PARA'])).toBe('Studio · PARA');
	});

	test('co-anchored systems merge into one anchor row', () => {
		expect(describeOutlineAnchorTitle('Main', ['Johnny Decimal', 'PARA']))
			.toBe('Main · Johnny Decimal + PARA');
		expect(describeOutlineAnchorTitle('Main', ['Johnny Decimal', 'PARA', 'SEACOW outer shell']))
			.toBe('Main · Johnny Decimal + PARA + SEACOW outer shell');
	});

	test('a folder with no system recognized at it is just the folder', () => {
		expect(describeOutlineAnchorTitle('Negative control', [])).toBe('Negative control');
	});
});

// ─── Hue registry ──────────────────────────────────────────────────────────

describe('system hues', () => {
	test('the palette is six Obsidian hues and excludes the semantic ones', () => {
		// Orange and red stay reserved for "too few" and conflict.
		expect([...OUTLINE_HUES]).toEqual(['blue', 'green', 'purple', 'pink', 'cyan', 'yellow']);
		expect(OUTLINE_HUES).not.toContain('orange' as never);
		expect(OUTLINE_HUES).not.toContain('red' as never);
	});

	test('a pack has no hue until it is assigned one', () => {
		const registry = new OutlineHueRegistry();
		expect(registry.hueFor('para')).toBeNull();
		expect(registry.size()).toBe(0);
		registry.assign(['para']);
		expect(registry.hueFor('para')).not.toBeNull();
		expect(registry.size()).toBe(1);
	});

	test('the same pack id gets the same hue across calls and registries', () => {
		const first = new OutlineHueRegistry();
		const second = new OutlineHueRegistry();
		first.assign(['para']);
		second.assign(['para']);
		expect(first.hueFor('para')).toBe(second.hueFor('para'));
		// Repeated assignment is a no-op, so the hue survives every rerender.
		const hue = first.hueFor('para');
		first.assign(['para']);
		first.assign(['para', 'johnny-decimal']);
		expect(first.hueFor('para')).toBe(hue);
	});

	test('neighbour avoidance decides only the first assignment', () => {
		// `para` and `johnny-decimal` hash to the same preferred hue, so the
		// second one moves to the next free hue rather than sharing.
		const together = new OutlineHueRegistry();
		together.assign(['para', 'johnny-decimal']);
		expect(together.hueFor('para')).not.toBe(together.hueFor('johnny-decimal'));

		// Reversing the order gives the FIRST-named pack the preferred hue: the
		// avoidance applies to whoever arrives second, never retroactively.
		const reversed = new OutlineHueRegistry();
		reversed.assign(['johnny-decimal', 'para']);
		expect(reversed.hueFor('johnny-decimal')).toBe(together.hueFor('para'));
		expect(reversed.hueFor('para')).toBe(together.hueFor('johnny-decimal'));
	});

	test('a later system never repaints an already coloured one', () => {
		const registry = new OutlineHueRegistry();
		registry.assign(['para']);
		const paraHue = registry.hueFor('para');
		registry.assign(['johnny-decimal']);
		registry.assign(['seacow']);
		registry.assign(['fourth-pack']);
		expect(registry.hueFor('para')).toBe(paraHue);
		expect(registry.size()).toBe(4);
	});

	test('six systems each get their own hue', () => {
		const registry = new OutlineHueRegistry();
		const six = ['pack-a', 'pack-b', 'pack-c', 'pack-d', 'pack-e', 'pack-f'];
		registry.assign(six);
		const hues = six.map((packId) => registry.hueFor(packId));
		expect(new Set(hues).size).toBe(6);
		for (const hue of hues) expect(OUTLINE_HUES).toContain(hue!);
	});

	test('a seventh system reuses the least-recently-assigned hue', () => {
		const registry = new OutlineHueRegistry();
		const six = ['pack-a', 'pack-b', 'pack-c', 'pack-d', 'pack-e', 'pack-f'];
		registry.assign(six);
		registry.assign(['pack-g']);
		// Every hue is taken, so the oldest assignment is handed out again —
		// reuse only ever happens once all six are gone.
		expect(registry.hueFor('pack-g')).toBe(registry.hueFor('pack-a'));
		expect(registry.size()).toBe(7);
	});

	test('co-anchored packs never share a hue', () => {
		// While a hue is free, avoidance is automatic: a free hue is by definition
		// held by nobody, so two systems on one anchor cannot collide.
		const fresh = new OutlineHueRegistry();
		fresh.assign(['para', 'johnny-decimal'], [['para', 'johnny-decimal']]);
		expect(fresh.hueFor('para')).not.toBe(fresh.hueFor('johnny-decimal'));

		// Three systems on one anchor still come out three different colours.
		const trio = new OutlineHueRegistry();
		trio.assign(['x1', 'x2', 'x3'], [['x1', 'x2', 'x3']]);
		expect(new Set(['x1', 'x2', 'x3'].map((packId) => trio.hueFor(packId))).size).toBe(3);

		// With the palette exhausted, reuse is forced — but never onto the hue a
		// co-anchored system holds. The oldest hue is skipped for the next one.
		const full = new OutlineHueRegistry();
		const six = ['pack-a', 'pack-b', 'pack-c', 'pack-d', 'pack-e', 'pack-f'];
		full.assign(six);
		full.assign(['pack-g'], [['pack-a', 'pack-g']]);
		expect(full.hueFor('pack-g')).not.toBe(full.hueFor('pack-a'));
		expect(full.hueFor('pack-g')).toBe(full.hueFor('pack-b'));
		expect(OUTLINE_HUES).toContain(full.hueFor('pack-g')!);
	});

	test('a co-anchored group declared later never repaints what it joins', () => {
		const registry = new OutlineHueRegistry();
		registry.assign(['para']);
		const paraHue = registry.hueFor('para');
		registry.assign(['johnny-decimal'], [['para', 'johnny-decimal']]);
		expect(registry.hueFor('para')).toBe(paraHue);
		expect(registry.hueFor('johnny-decimal')).not.toBe(paraHue);
	});
});

// ─── Completeness wording ──────────────────────────────────────────────────

describe('occurrence completeness', () => {
	test('every folder type found reads Complete with no verb after it', () => {
		const complete = describeOutlineCompleteness(occurrence({
			key: 'para@Studio',
			anchorPath: 'UX Lab/Studio',
			evidenceCount: 4,
			missingRoles: [],
		}));
		expect(complete.state).toBe('complete');
		expect(complete.text).toBe('Complete · 4 of 4');
		expect(complete.neededCount).toBe(0);
		expect(complete.missingCount).toBe(0);
	});

	test('enough to manage but not every type reads Partial · can manage', () => {
		const partial = describeOutlineCompleteness(occurrence({
			key: 'para@Home',
			anchorPath: 'UX Lab/Home',
			evidenceCount: 2,
			missingRoles: ['resources', 'archive'],
		}));
		expect(partial.state).toBe('partial');
		expect(partial.text).toBe('Partial · 2 of 4 — can manage');
		expect(partial.neededCount).toBe(0);
		expect(partial.missingCount).toBe(2);
	});

	test('a member-counting pack reports matching folders, not types', () => {
		expect(describeOutlineCompleteness(occurrence({
			key: 'seacow@Workshop',
			anchorPath: 'UX Lab/SEACOW workshop',
			countBy: 'members',
			evidenceCount: 4,
		})).text).toBe('Complete · 4 matching folders');
		expect(describeOutlineCompleteness(occurrence({
			key: 'seacow@Workshop',
			anchorPath: 'UX Lab/SEACOW workshop',
			countBy: 'members',
			evidenceCount: 1,
		})).text).toBe('Complete · 1 matching folder');
	});

	test('too few names the folder type that would complete it', () => {
		const tooFew = describeOutlineCompleteness(occurrence({
			key: 'para@Club',
			anchorPath: 'UX Lab/Club',
			status: 'incomplete',
			evidenceCount: 1,
			minEvidence: 2,
			missingRoles: ['projects'],
		}));
		expect(tooFew.state).toBe('too-few');
		expect(tooFew.text).toBe('Too few · 1 of 2 — add Projects');
		expect(tooFew.neededCount).toBe(1);
		expect(tooFew.missingCount).toBe(1);
	});

	test('too few joins a short list of missing types, and abbreviates a long one', () => {
		expect(describeOutlineCompleteness(occurrence({
			key: 'para@Club',
			anchorPath: 'UX Lab/Club',
			status: 'incomplete',
			evidenceCount: 1,
			minEvidence: 2,
			missingRoles: ['projects', 'resources', 'archive'],
		})).text).toBe('Too few · 1 of 4 — add Projects, Resources or Archive');
		expect(describeOutlineCompleteness(occurrence({
			key: 'jd@Partial',
			anchorPath: 'UX Lab/Partial enterprise',
			status: 'incomplete',
			evidenceCount: 2,
			minEvidence: 4,
			missingRoles: ['tasks-planning', 'areas-initiatives', 'docs-intel-sops', 'archive-admin'],
		})).text).toBe('Too few · 2 of 6 — add 2 of 4 types');
	});

	test('a member-counting pack below threshold counts folders, not names', () => {
		expect(describeOutlineCompleteness(occurrence({
			key: 'seacow@Thin',
			anchorPath: 'UX Lab/Thin',
			status: 'incomplete',
			countBy: 'members',
			evidenceCount: 1,
			minEvidence: 3,
		})).text).toBe('Too few · 1 of 3 — add 2 more');
	});
});

// ─── Fold word ─────────────────────────────────────────────────────────────

describe('fold word on the sub-row beneath the anchor', () => {
	test('an open anchor offers to hide, in a word', () => {
		expect(describeOutlineFoldWord({ unfolded: true, matchedCount: 4 })).toBe('Hide');
	});

	test('a folded anchor says how many matched folders it hides', () => {
		expect(describeOutlineFoldWord({ unfolded: false, matchedCount: 4 }))
			.toBe('Show 4 matched folders');
		expect(describeOutlineFoldWord({ unfolded: false, matchedCount: 1 }))
			.toBe('Show 1 matched folder');
	});

	test('the fold word only ever promises MATCHED folders', () => {
		// Fix 3: the missing-type ghost rows are a separate, opt-in reveal, so the
		// fold word can no longer be about them at all.
		for (const matchedCount of [1, 2, 9]) {
			expect(describeOutlineFoldWord({ unfolded: false, matchedCount }))
				.toContain('matched folder');
		}
	});
});

describe('the missing-types link is its own opt-in reveal', () => {
	test('it asks which types are missing, and offers to hide them again', () => {
		expect(describeOutlineMissingTypesLink(3, false)).toBe('3 missing types — which?');
		expect(describeOutlineMissingTypesLink(1, false)).toBe('1 missing type — which?');
		expect(describeOutlineMissingTypesLink(3, true)).toBe('Hide missing types');
	});
});

describe('a co-anchored group state is counts, never two statuses', () => {
	test('it reads as systems and how many of them can be managed', () => {
		expect(describeOutlineGroupState(2, 1)).toBe('2 systems · 1 can manage');
		expect(describeOutlineGroupState(3, 2)).toBe('3 systems · 2 can manage');
		expect(describeOutlineGroupState(2, 0)).toBe('2 systems · 0 can manage');
	});

	test('it never concatenates the per-system state text', () => {
		const tooFew = describeOutlineCompleteness(occurrence({
			key: 'jd@Overlap',
			anchorPath: 'UX Lab/Overlap',
			status: 'incomplete',
			evidenceCount: 2,
			minEvidence: 9,
			missingRoles: ['archive', 'ideation'],
		}));
		const state = describeOutlineGroupState(2, 1);
		expect(state).not.toContain(tooFew.text);
		expect(state).not.toContain('Too few');
		expect(state).not.toContain('Complete');
		expect(state.split('\n')).toHaveLength(1);
	});
});

// ─── Fold model and ordering ───────────────────────────────────────────────

describe('fold model', () => {
	const treePaths = [
		'UX Lab',
		'UX Lab/Repeated PARA',
		'UX Lab/Repeated PARA/Studio',
		'UX Lab/Repeated PARA/Studio/Areas',
		'UX Lab/Repeated PARA/Studio/Projects',
		'UX Lab/Negative control',
		'UX Lab/Negative control/Invented scratch',
	];
	const studio = occurrence({
		key: 'para@Studio',
		anchorPath: 'UX Lab/Repeated PARA/Studio',
		memberPaths: ['UX Lab/Repeated PARA/Studio/Areas', 'UX Lab/Repeated PARA/Studio/Projects'],
	});

	test('folded shows only the path down to each anchor', () => {
		const model = computeOutlineFoldModel({
			treePaths,
			occurrences: [studio],
			unfoldedKeys: new Set(),
			showAllFolders: false,
		});
		expect(model.visiblePaths).toEqual([
			'UX Lab',
			'UX Lab/Repeated PARA',
			'UX Lab/Repeated PARA/Studio',
		]);
		expect(model.visible.has('UX Lab/Repeated PARA/Studio/Areas')).toBe(false);
	});

	test('unfolding one occurrence reveals exactly its own evidence rows', () => {
		const model = computeOutlineFoldModel({
			treePaths,
			occurrences: [studio],
			unfoldedKeys: new Set(['para@Studio']),
			showAllFolders: false,
		});
		expect(model.visible.has('UX Lab/Repeated PARA/Studio/Areas')).toBe(true);
		expect(model.visible.has('UX Lab/Repeated PARA/Studio/Projects')).toBe(true);
		expect(model.visible.has('UX Lab/Negative control')).toBe(false);
	});

	test('show-all reveals every folder and elides nothing', () => {
		const model = computeOutlineFoldModel({
			treePaths,
			occurrences: [studio],
			unfoldedKeys: new Set(),
			showAllFolders: true,
		});
		expect(model.visiblePaths.length).toBe(treePaths.length);
		expect(model.elidedCountByParent.size).toBe(0);
	});

	test('unmatched children under a visible parent are counted, then worded', () => {
		const model = computeOutlineFoldModel({
			treePaths,
			occurrences: [studio],
			unfoldedKeys: new Set(),
			showAllFolders: false,
		});
		expect(model.elidedCountByParent.get('UX Lab')).toBe(1);
		expect(describeOutlineElision(1)).toBe('1 unmatched folder');
		expect(describeOutlineElision(4)).toBe('4 unmatched folders');
	});

	test('paths sort depth-first so a folder is followed by its own subtree', () => {
		expect(sortOutlinePaths([
			'A/b/c',
			'A',
			'B',
			'A/b',
			'A/a',
		])).toEqual(['A', 'A/a', 'A/b', 'A/b/c', 'B']);
	});
});

// ─── Bracket geometry ──────────────────────────────────────────────────────

describe('bracket span', () => {
	const rows = [
		'UX Lab/Studio',
		'UX Lab/Studio/Areas',
		'UX Lab/Studio/Projects',
		'UX Lab/Other',
	];

	test('the bar ends at the occurrence\'s own deepest visible evidence row', () => {
		const span = computeOutlineBracketSpan(occurrence({
			key: 'para@Studio',
			anchorPath: 'UX Lab/Studio',
			memberPaths: ['UX Lab/Studio/Areas', 'UX Lab/Studio/Projects'],
		}), rows);
		expect(span.lastRowPath).toBe('UX Lab/Studio/Projects');
		expect(span.lastRowIndex).toBe(2);
		expect(span.coveredPaths).toEqual(['UX Lab/Studio/Areas', 'UX Lab/Studio/Projects']);
		expect(span.collapsed).toBe(false);
		expect(span.dashed).toBe(false);
	});

	test('no visible evidence collapses the bar instead of drawing a stub', () => {
		const span = computeOutlineBracketSpan(occurrence({
			key: 'para@Studio',
			anchorPath: 'UX Lab/Studio',
			memberPaths: ['UX Lab/Studio/Hidden'],
			status: 'incomplete',
		}), rows);
		expect(span.collapsed).toBe(true);
		expect(span.lastRowIndex).toBe(-1);
		expect(span.dashed).toBe(true);
	});

	test('a co-anchored group draws ONE lane reaching the deeper system', () => {
		const group: OutlineGroup = {
			anchorPath: 'UX Lab/Studio',
			occurrences: [
				occurrence({
					key: 'para@Studio',
					anchorPath: 'UX Lab/Studio',
					memberPaths: ['UX Lab/Studio/Areas'],
				}),
				occurrence({
					key: 'jd@Studio',
					anchorPath: 'UX Lab/Studio',
					packId: 'johnny-decimal',
					packName: 'Johnny Decimal',
					memberPaths: ['UX Lab/Studio/Projects'],
				}),
			],
			collides: false,
			predictedWinnerKey: null,
		};
		const span = computeOutlineGroupBracketSpan(group, rows);
		expect(span.lastRowPath).toBe('UX Lab/Studio/Projects');
		expect(span.coveredPaths).toEqual(['UX Lab/Studio/Areas', 'UX Lab/Studio/Projects']);
		// One ready system keeps the lane solid even beside an incomplete one.
		expect(span.dashed).toBe(false);
	});
});

describe('evidence row annotation', () => {
	const studio = occurrence({
		key: 'para@Studio',
		anchorPath: 'UX Lab/Studio',
		memberPaths: ['UX Lab/Studio/Areas', 'UX Lab/Studio/Invented shelf'],
		supportPaths: ['UX Lab/Studio/Entity'],
	});

	test('a role named like its folder adds nothing and is not printed', () => {
		expect(describeOutlineEvidenceRow(
			studio,
			'UX Lab/Studio/Areas',
			new Map([['UX Lab/Studio/Areas', 'Areas']]),
		)).toBeNull();
	});

	test('a role that differs from the folder name is worth a line', () => {
		expect(describeOutlineEvidenceRow(
			studio,
			'UX Lab/Studio/Invented shelf',
			new Map([['UX Lab/Studio/Invented shelf', 'Resources']]),
		)).toEqual({ kind: 'role', text: 'Resources' });
	});

	test('support evidence says "supports", and a stranger row says nothing', () => {
		expect(describeOutlineEvidenceRow(studio, 'UX Lab/Studio/Entity', new Map()))
			.toEqual({ kind: 'support', text: 'supports' });
		expect(describeOutlineEvidenceRow(studio, 'UX Lab/Other', new Map())).toBeNull();
	});
});

// ─── Groups and collisions ─────────────────────────────────────────────────

describe('co-anchored groups', () => {
	const para = occurrence({ key: 'para@Main', anchorPath: 'UX Lab/Main' });
	const jd = occurrence({
		key: 'jd@Main',
		anchorPath: 'UX Lab/Main',
		packId: 'johnny-decimal',
		packName: 'Johnny Decimal',
	});
	const elsewhere = occurrence({ key: 'para@Studio', anchorPath: 'UX Lab/Studio' });

	test('one group per anchor, in the incoming occurrence order', () => {
		const groups = buildOutlineGroups([para, jd, elsewhere]);
		expect(groups.map((group) => group.anchorPath)).toEqual(['UX Lab/Main', 'UX Lab/Studio']);
		expect(groups[0].occurrences.map((item) => item.key)).toEqual(['para@Main', 'jd@Main']);
		expect(groups[1].occurrences).toHaveLength(1);
	});

	test('a lone system at an anchor never collides', () => {
		expect(buildOutlineGroups([elsewhere])[0].collides).toBe(false);
		expect(detectOutlineGroupCollision(['para@Studio'], []).collides).toBe(false);
	});

	test('named candidate targets are direct evidence of a collision, with a winner', () => {
		const candidates = [
			candidate({
				key: 'c-para',
				occurrenceKey: 'para@Main',
				ruleId: 'rule-para',
				conflict: {
					candidateTargets: [{ candidateKey: 'c-jd', occurrenceKey: 'jd@Main' }],
					predictedWinnerId: 'rule-jd',
				},
			}),
			candidate({ key: 'c-jd', occurrenceKey: 'jd@Main', ruleId: 'rule-jd' }),
		];
		const collision = detectOutlineGroupCollision(['para@Main', 'jd@Main'], candidates);
		expect(collision.collides).toBe(true);
		expect(collision.predictedWinnerKey).toBe('jd@Main');
		expect(buildOutlineGroups([para, jd], candidates)[0].collides).toBe(true);
	});

	test('targets outside the group are not this anchor\'s collision', () => {
		const collision = detectOutlineGroupCollision(['para@Main', 'jd@Main'], [
			candidate({
				key: 'c-para',
				occurrenceKey: 'para@Main',
				conflict: {
					candidateTargets: [{ candidateKey: 'c-far', occurrenceKey: 'para@Studio' }],
				},
			}),
		]);
		expect(collision.collides).toBe(false);
		expect(collision.predictedWinnerKey).toBeNull();
	});

	test('without exact targets, two systems reporting overlap is the fallback signal', () => {
		expect(detectOutlineGroupCollision(['para@Main', 'jd@Main'], [
			candidate({
				key: 'c-para',
				occurrenceKey: 'para@Main',
				conflict: { overlappingFolderSample: ['UX Lab/Main/10 - Projects'] },
			}),
			candidate({
				key: 'c-jd',
				occurrenceKey: 'jd@Main',
				conflict: { overlappingFolderSample: ['UX Lab/Main/10 - Projects'] },
			}),
		]).collides).toBe(true);
		// Only one system reporting overlap is not two systems competing.
		expect(detectOutlineGroupCollision(['para@Main', 'jd@Main'], [
			candidate({
				key: 'c-para',
				occurrenceKey: 'para@Main',
				conflict: { overlappingFolderSample: ['UX Lab/Main/10 - Projects'] },
			}),
			candidate({ key: 'c-jd', occurrenceKey: 'jd@Main' }),
		]).collides).toBe(false);
	});

	test('an incomplete co-anchored system is not a competitor', () => {
		const groups = buildOutlineGroups([
			para,
			{ ...jd, status: 'incomplete' as const },
		], [
			candidate({
				key: 'c-para',
				occurrenceKey: 'para@Main',
				conflict: { overlappingFolderSample: ['UX Lab/Main/10 - Projects'] },
			}),
			candidate({
				key: 'c-jd',
				occurrenceKey: 'jd@Main',
				conflict: { overlappingFolderSample: ['UX Lab/Main/10 - Projects'] },
			}),
		]);
		expect(groups[0].collides).toBe(false);
		expect(groups[0].occurrences).toHaveLength(2);
	});

	test('a group that does not collide manages every system in it', () => {
		expect(describeOutlineGroupInclusion(2)).toBe('both systems will be managed');
		expect(describeOutlineGroupInclusion(3)).toBe('all 3 systems will be managed');
	});
});

describe('resolving a colliding group', () => {
	const group: OutlineGroup = {
		anchorPath: 'UX Lab/Main',
		occurrences: [
			occurrence({ key: 'para@Main', anchorPath: 'UX Lab/Main' }),
			occurrence({
				key: 'jd@Main',
				anchorPath: 'UX Lab/Main',
				packId: 'johnny-decimal',
				packName: 'Johnny Decimal',
			}),
		],
		collides: true,
		predictedWinnerKey: 'jd@Main',
	};

	test('the predicted winner is preselected so two rules never silently fight', () => {
		const choice = resolveOutlineGroupChoice(group, new Set());
		expect(choice.chosenKey).toBe('jd@Main');
		expect(choice.declinedKeys).toEqual(['para@Main']);
	});

	test('an explicit decline wins over the prediction', () => {
		const choice = resolveOutlineGroupChoice(group, new Set(['jd@Main']));
		expect(choice.chosenKey).toBe('para@Main');
		expect(choice.declinedKeys).toEqual(['jd@Main']);
	});

	test('a group that does not collide forces no choice at all', () => {
		const choice = resolveOutlineGroupChoice({ ...group, collides: false }, new Set());
		expect(choice.chosenKey).toBeNull();
		expect(choice.declinedKeys).toEqual([]);
	});

	test('choosing one system declines its co-anchored alternatives', () => {
		const next = chooseOutlineGroupSystem(group, new Set(['para@Main']), 'para@Main');
		expect([...next]).toEqual(['jd@Main']);
		expect([...collectOutlineDeclinedKeys([group], next)]).toEqual(['jd@Main']);
	});

	test('the effective declined set covers every group at once', () => {
		const other: OutlineGroup = {
			anchorPath: 'UX Lab/Overlap',
			occurrences: [
				occurrence({ key: 'jd@Overlap', anchorPath: 'UX Lab/Overlap' }),
				occurrence({ key: 'ent@Overlap', anchorPath: 'UX Lab/Overlap', packId: 'enterprise-jd' }),
			],
			collides: true,
			predictedWinnerKey: 'ent@Overlap',
		};
		expect([...collectOutlineDeclinedKeys([group, other], new Set())].sort())
			.toEqual(['jd@Overlap', 'para@Main']);
	});
});

describe('the predicted choice shows its evidence', () => {
	test('the radio says which reading is the prediction', () => {
		expect(describeOutlineChoiceLabel(true)).toBe('Predicted on sample');
		expect(describeOutlineChoiceLabel(false)).toBe('Alternative');
	});

	test('one muted line names the folder types found, and why it wins', () => {
		expect(describeOutlineChoiceEvidence({
			evidenceCount: 4,
			totalCount: 4,
			reason: null,
		})).toBe('found 4 of 4 folder types');
		expect(describeOutlineChoiceEvidence({
			evidenceCount: 4,
			totalCount: 6,
			reason: 'higher priority',
		})).toBe('found 4 of 6 folder types · higher priority');
	});

	test('a member-counting pack states matching folders instead of types', () => {
		expect(describeOutlineChoiceEvidence({
			evidenceCount: 3,
			totalCount: 0,
			reason: null,
		})).toBe('found 3 matching folders');
		expect(describeOutlineChoiceEvidence({
			evidenceCount: 1,
			totalCount: 0,
			reason: 'more specific match',
		})).toBe('found 1 matching folder · more specific match');
	});
});

describe('ghost rows for missing folder types', () => {
	test('each missing role becomes one row named like a folder', () => {
		expect(describeOutlineGhostRows(['projects', 'docs-intel-sops'])).toEqual([
			{ name: 'Projects', text: 'Not found' },
			{ name: 'Docs Intel Sops', text: 'Not found' },
		]);
		expect(describeOutlineGhostRows([])).toEqual([]);
	});

	test('a role reads like a folder name', () => {
		expect(titleCaseRole('projects-archive')).toBe('Projects Archive');
		expect(titleCaseRole('tasks_planning')).toBe('Tasks Planning');
		expect(titleCaseRole('areas')).toBe('Areas');
	});
});

// ─── Management and parent inclusion ───────────────────────────────────────

describe('manage control and parent inclusion', () => {
	test('an unchecked ready anchor offers "Manage here" beside its checkbox', () => {
		expect(describeOutlineManageControl({
			anchorPath: 'UX Lab/Studio',
			ready: true,
			selectedPaths: [],
			inPlan: false,
		})).toEqual({ kind: 'manage', checked: false, disabled: false, text: 'Manage here' });
	});

	test('a checked anchor keeps the same label, now checked', () => {
		expect(describeOutlineManageControl({
			anchorPath: 'UX Lab/Studio',
			ready: true,
			selectedPaths: ['UX Lab/Studio'],
			inPlan: true,
		})).toEqual({ kind: 'manage', checked: true, disabled: false, text: 'Manage here' });
	});

	test('parent inclusion is drawn: disabled, checked, and it names the ancestor', () => {
		const control = describeOutlineManageControl({
			anchorPath: 'UX Lab/SEACOW workshop/Output/Main',
			ready: true,
			selectedPaths: ['UX Lab/SEACOW workshop'],
			inPlan: true,
		});
		expect(control).toEqual({
			kind: 'included-by',
			checked: true,
			disabled: true,
			text: 'included by SEACOW workshop',
		});
	});

	test('an unready occurrence says so instead of offering a checkbox action', () => {
		expect(describeOutlineManageControl({
			anchorPath: 'UX Lab/Club',
			ready: false,
			selectedPaths: ['UX Lab'],
			inPlan: true,
		})).toEqual({
			kind: 'unavailable',
			checked: false,
			disabled: true,
			text: "Can't manage yet",
		});
	});

	test('the including ancestor is the nearest checked one, not any of them', () => {
		expect(findOutlineIncludingAncestor('UX Lab/A/B/C', ['UX Lab', 'UX Lab/A/B']))
			.toBe('UX Lab/A/B');
		expect(findOutlineIncludingAncestor('UX Lab/A', ['UX Lab/A'])).toBeNull();
		expect(findOutlineIncludingAncestor('UX Lab/A', ['UX Lab/Other'])).toBeNull();
		expect(findOutlineIncludingAncestor('UX Lab/A', [''])).toBe('');
	});

	test('toggling an anchor writes the shared checked-folder input, stably ordered', () => {
		const once = toggleOutlineSelectedPath(['UX Lab/Studio'], 'UX Lab/Home', true);
		expect(once).toEqual(['UX Lab/Home', 'UX Lab/Studio']);
		expect(toggleOutlineSelectedPath(once, 'UX Lab/Studio', false)).toEqual(['UX Lab/Home']);
		// Re-adding an existing path is not a duplicate.
		expect(toggleOutlineSelectedPath(once, 'UX Lab/Home', true)).toEqual(once);
	});
});

// ─── Step 3: delta reading ─────────────────────────────────────────────────

describe('folder name as a tag segment', () => {
	test('a slug lower-cases and joins on hyphens', () => {
		expect(folderNameSlug('Areas')).toBe('areas');
		expect(folderNameSlug('Invented client rebrand')).toBe('invented-client-rebrand');
		expect(folderNameSlug('  Spaced  out  ')).toBe('spaced-out');
	});

	test('a numbered folder name does NOT slug to its Johnny Decimal segment', () => {
		// This is exactly why "10 - Projects → 10-projects" reads as a delta.
		expect(folderNameSlug('10 - Projects')).toBe('10---projects');
	});
});

describe('degenerate tags', () => {
	test('nothing after the hash, or an empty segment, is no tag at all', () => {
		expect(isDegenerateTag('#')).toBe(true);
		expect(isDegenerateTag('#/')).toBe(true);
		expect(isDegenerateTag('#a//b')).toBe(true);
		expect(isDegenerateTag('')).toBe(true);
	});

	test('a bare axis marker is degenerate; a named marker segment is not', () => {
		expect(isDegenerateTag('#-')).toBe(true);
		expect(isDegenerateTag('#a/_')).toBe(true);
		expect(isDegenerateTag('#-clip/ux-lab')).toBe(false);
		expect(isDegenerateTag('#areas')).toBe(false);
		expect(isDegenerateTag('#seacow-workshop/capture')).toBe(false);
	});
});

describe('the delta cell', () => {
	test('a tag that is just the parent tag plus the folder name reads ✓', () => {
		expect(describeOutlineDeltaCell({
			folderName: 'Capture',
			tag: '#seacow-workshop/capture',
			parentTag: '#seacow-workshop',
		})).toEqual({ kind: 'same', segment: null, tag: '#seacow-workshop/capture' });
		expect(describeOutlineDeltaCell({
			folderName: 'Areas',
			tag: '#areas',
			parentTag: null,
		})).toEqual({ kind: 'same', segment: null, tag: '#areas' });
	});

	test('only the segment the rule changed is shown', () => {
		expect(describeOutlineDeltaCell({
			folderName: '10 - Projects',
			tag: '#seacow-workshop/output/main/10-projects',
			parentTag: '#seacow-workshop/output/main',
		})).toEqual({
			kind: 'delta',
			segment: '10-projects',
			tag: '#seacow-workshop/output/main/10-projects',
		});
		expect(describeOutlineDeltaCell({
			folderName: '0 - Tasks, Planning',
			tag: '#0-tasks-planning',
			parentTag: null,
		})).toEqual({ kind: 'delta', segment: '0-tasks-planning', tag: '#0-tasks-planning' });
	});

	test('a tag that does not sit under the parent tag is shown whole', () => {
		expect(describeOutlineDeltaCell({
			folderName: 'Projects',
			tag: '#studio/projects',
			parentTag: '#seacow-workshop',
		})).toEqual({ kind: 'full', segment: null, tag: '#studio/projects' });
	});

	test('a degenerate or absent tag is no tag, never a chip', () => {
		expect(describeOutlineDeltaCell({ folderName: 'System', tag: '#/', parentTag: '#a' }))
			.toEqual({ kind: 'none', segment: null, tag: null });
		expect(describeOutlineDeltaCell({ folderName: 'System', tag: null, parentTag: null }))
			.toEqual({ kind: 'none', segment: null, tag: null });
	});

	test('a degenerate parent tag is ignored rather than used as a root', () => {
		expect(describeOutlineDeltaCell({
			folderName: 'Areas',
			tag: '#areas',
			parentTag: '#/',
		}).kind).toBe('same');
	});

	test('the orange no-tag text names the systems that did not match', () => {
		expect(describeOutlineNoTag(['Johnny Decimal', 'PARA']))
			.toBe('no tag — nothing in Johnny Decimal or PARA matches this name');
		expect(describeOutlineNoTag(['PARA']))
			.toBe('no tag — nothing in PARA matches this name');
		expect(describeOutlineNoTag([]))
			.toBe('no tag — nothing in the chosen systems matches this name');
	});

	test('the expansion line states the full tag and the rule that produced it', () => {
		expect(describeOutlineFullTagLine('#seacow-workshop/capture', 'SEACOW outer shell', 'Capture'))
			.toBe('full tag #seacow-workshop/capture · from rule SEACOW outer shell → Capture');
	});

	test('the sub-folder fold word counts what is inside', () => {
		expect(describeOutlinePreviewToggle(1)).toBe('1 folder inside');
		expect(describeOutlinePreviewToggle(2)).toBe('2 folders inside');
	});
});

describe('the tag root stated once at the anchor', () => {
	test('an anchor tag inconsistent with child winners cannot claim a shared root', () => {
		expect(computeOutlineTagRoot('#-clip/lab/output/main', ['#10-projects', '#20-areas'])).toBeNull();
		expect(computeOutlineTagRoot('#-clip/lab', ['#-clip/lab/capture', '#10-projects'])).toBeNull();
		expect(computeOutlineTagRoot('#lab', ['#laboratory/projects'])).toBe('#laboratory');
		expect(computeOutlineTagRoot('#lab', [])).toBeNull();
		expect(computeOutlineTagRoot('#lab', ['#lab/good', '#lab//bad'])).toBeNull();
	});

	test('the anchor\'s own tag is the root when the rule emits one', () => {
		expect(computeOutlineTagRoot('#seacow-workshop', ['#seacow-workshop/capture']))
			.toBe('#seacow-workshop');
	});

	test('with no anchor tag, the shared whole-segment prefix is the root', () => {
		expect(computeOutlineTagRoot(null, [
			'#seacow-workshop/output/main/10-projects',
			'#seacow-workshop/output/main/20-areas',
		])).toBe('#seacow-workshop/output/main');
	});

	test('members that share nothing have no root', () => {
		expect(computeOutlineTagRoot(null, ['#areas', '#projects'])).toBeNull();
		expect(computeOutlineTagRoot(null, [])).toBeNull();
		expect(computeOutlineTagRoot('#/', ['#/'])).toBeNull();
	});

	test('a prefix that is itself a whole member tag is not a root', () => {
		expect(computeOutlineTagRoot(null, ['#areas', '#areas/upkeep'])).toBeNull();
	});

	test('the anchor states the root, or what the tags amount to', () => {
		expect(describeOutlineTagRoot({ root: '#seacow-workshop', tagCount: 4, allSame: false }))
			.toBe('tags start with #seacow-workshop');
		expect(describeOutlineTagRoot({ root: null, tagCount: 4, allSame: true }))
			.toBe('4 distinct tags · normalized name endings');
		expect(describeOutlineTagRoot({ root: null, tagCount: 1, allSame: false })).toBe('1 distinct tag');
		expect(describeOutlineTagRoot({ root: null, tagCount: 0, allSame: false })).toBe('no tags');
	});
});

// ─── Step 3: conflict line ─────────────────────────────────────────────────

describe('exact-folder proposed-rule comparison', () => {
	const rule = (id: string, group: string | undefined, priority = 1, pattern = '^Lab/.+$'): MappingRule => ({
		id, name: id, group, priority, enabled: false, direction: 'bidirectional', folderPattern: pattern,
	} as MappingRule);
	const like = (match: NonNullable<ReturnType<typeof matchOutlineProposals>['winner']>) => ({
		group: match.rule.group, priority: match.rule.priority, confidence: match.confidence,
	});

	test('reordered precedence changes the proposed winner and its grounded reason', () => {
		const rules = [rule('alpha', 'alpha'), rule('zeta', 'zeta')];
		for (const order of [['zeta', 'alpha'], ['alpha', 'zeta']]) {
			const outcome = matchOutlineProposals('Lab/Projects', rules, order);
			expect(outcome.winner?.rule.id).toBe(order[0]);
			const other = outcome.matches.find((match) => match !== outcome.winner)!;
			expect(describeOutlineWinReason(like(outcome.winner!), like(other), order))
				.toBe(`Configured group order: “${order[0]}” precedes “${order[1]}”.`);
		}
	});

	test('unlisted groups use alphabetical fallback, not an invented earlier configured group', () => {
		const { winner, matches } = matchOutlineProposals('Lab/Projects', [rule('z', 'zeta'), rule('a', 'alpha')], []);
		expect(winner?.rule.id).toBe('a');
		expect(describeOutlineWinReason(like(winner!), like(matches[0]), []))
			.toContain('alphabetical group order puts “alpha” before “zeta”');
		expect(describeOutlineWinReason(like(matches[0]), like(winner!), [])).toBeNull();
	});

	test('a configured group without installed rules still precedes an unlisted group', () => {
		const outcome = matchOutlineProposals('Lab/Projects', [rule('a', 'alpha'), rule('z', 'zeta')], ['zeta']);
		expect(outcome.winner?.rule.id).toBe('z');
		expect(describeOutlineWinReason(like(outcome.winner!), like(outcome.matches[0]), ['zeta']))
			.toContain('Configured group order');
	});

	test('confidence, then lower priority, then original input order are matcher-supported ties', () => {
		const broad = rule('broad', 'a', 0, '^Lab/.*');
		const exact = rule('exact', 'a', 99, 'Lab/Projects');
		let outcome = matchOutlineProposals('Lab/Projects', [broad, exact], []);
		expect(outcome.winner?.rule.id).toBe('exact');
		expect(describeOutlineWinReason(like(outcome.winner!), like(outcome.matches[0])))
			.toContain('higher match confidence');
		outcome = matchOutlineProposals('Lab/Projects', [rule('second', 'a', 4), rule('first', 'a', 1)], []);
		expect(outcome.winner?.rule.id).toBe('first');
		expect(describeOutlineWinReason(like(outcome.winner!), like(outcome.matches[0])))
			.toContain('lower priority number (1 vs 4)');
		outcome = matchOutlineProposals('Lab/Projects', [rule('first', undefined), rule('second', '__default__')], []);
		expect(outcome.winner?.rule.id).toBe('first');
		expect(describeOutlineWinReason(like(outcome.winner!), like(outcome.matches[1])))
			.toContain('first rule in proposal order');
	});

	test('each folder is evaluated independently, not with the first sample prediction', () => {
		const rules = [rule('specific', 'a', 1, 'Lab/Projects'), rule('fallback', 'a', 2)];
		expect(matchOutlineProposals('Lab/Projects', rules, []).winner?.rule.id).toBe('specific');
		expect(matchOutlineProposals('Lab/Areas', rules, []).winner?.rule.id).toBe('fallback');
		expect(matchOutlineProposals('Other', rules, []).winner).toBeNull();
	});

	test('an inverse-only proposal cannot supply the displayed forward winner', () => {
		const inverse = { ...rule('inverse', 'a'), direction: 'tag-to-folder' as const };
		expect(matchOutlineProposals('Lab/Projects', [inverse], []).winner).toBeNull();
	});

	test('mixed directions exclude inverse-only even with stronger group precedence and priority', () => {
		const inverse = { ...rule('inverse', 'first', 0), direction: 'tag-to-folder' as const,
			folderEntryPoint: 'Lab', tagEntryPoint: '#-clip' };
		const forward = { ...rule('forward', 'last', 99), direction: 'folder-to-tag' as const };
		const bidirectional = rule('bidirectional', 'middle', 50);
		const outcome = matchOutlineProposals('Lab/Projects', [inverse, forward, bidirectional], ['first', 'middle', 'last']);
		expect(outcome.matches.map((match) => match.rule.id)).toEqual(['forward', 'bidirectional']);
		expect(outcome.winner?.rule.id).toBe('bidirectional');
		// A raw transform example is still valid syntax; eligibility is a separate fact.
		const raw = previewRule(inverse, ['Lab/Projects']).samples[0].tags[0];
		expect(raw).toBe('#-clip/Projects');
		expect(isDegenerateTag(raw)).toBe(false);
	});

	test('a winner with unusable output is not discarded before ranking', () => {
		const invalid = { ...rule('invalid', 'a'), folderEntryPoint: 'Lab/Projects', tagEntryPoint: '#/' };
		expect(previewRule(invalid, ['Lab/Projects']).samples[0].tags).toEqual(['#/']);
		expect(matchOutlineProposals('Lab/Projects', [invalid, rule('valid', 'z')], []).winner?.rule.id)
			.toBe('invalid');
		expect(describeOutlineMissingOutput(['#/'])).toContain('unusable tag syntax');
		expect(describeOutlineMissingOutput([])).toBe('Matched rule produces no tag.');
		expect(describeOutlineMissingOutput(null)).toBe('No proposed folder-to-tag rule matches.');
	});

	test('co-anchored sampled choice and folder preview share precedence and direction inputs', () => {
		const a = { occurrenceKey: 'alpha-system', rule: rule('a', 'alpha'), sampleFolders: ['Lab/Projects'] };
		const z = { occurrenceKey: 'zeta-system', rule: rule('z', 'zeta'), sampleFolders: ['Lab/Projects'] };
		expect(predictOutlineGroupChoice([a, z], ['zeta', 'alpha']))
			.toEqual({ occurrenceKey: 'zeta-system', sampleFolder: 'Lab/Projects' });
		expect(predictOutlineGroupChoice([a, z], ['alpha', 'zeta'])?.occurrenceKey).toBe('alpha-system');
		const inverse = { ...a, rule: { ...a.rule, direction: 'tag-to-folder' as const } };
		expect(predictOutlineGroupChoice([inverse, z], ['alpha', 'zeta'])).toBeNull();
		expect(predictOutlineGroupChoice([{ ...a, sampleFolders: [] }, { ...z, sampleFolders: [] }], [])).toBeNull();
	});

	test('no predicted winner is an explicitly labelled display default', () => {
		const group: OutlineGroup = {
			anchorPath: 'Lab', collides: true, predictedWinnerKey: null,
			occurrences: [occurrence({ key: 'first', anchorPath: 'Lab' }), occurrence({ key: 'other', anchorPath: 'Lab' })],
		};
		expect(resolveOutlineGroupChoice(group, new Set()).chosenKey).toBe('first');
		expect(describeOutlineChoiceLabel(false, true)).toBe('Display default · no prediction');
		expect(describeOutlineChoiceLabel(false)).toBe('Alternative');
	});
});

describe('direction annotation and result summary', () => {
	test('two exact directions say nothing on the row; the hint said it once', () => {
		expect(describeOutlineDirectionAnnotation(direction('exact', 'exact'))).toBeNull();
	});

	test('only the direction that is not exact is named', () => {
		expect(describeOutlineDirectionAnnotation(direction('exact', 'lossy')))
			.toBe('Tag → folder: lossy');
		expect(describeOutlineDirectionAnnotation(direction('conditional', 'exact')))
			.toBe('Folder → tag: conditional');
		expect(describeOutlineDirectionAnnotation(direction('lossy', 'unavailable')))
			.toBe('Folder → tag: lossy · Tag → folder: unavailable');
	});

	test('the footer summarises the rules, and skipped folders only when there are some', () => {
		expect(describeOutlineResultSummary({ systemCount: 3, tagCount: 11, skippedCount: 0 }))
			.toBe('3 systems · 11 distinct tags');
		expect(describeOutlineResultSummary({ systemCount: 1, tagCount: 1, skippedCount: 1 }))
			.toBe('1 system · 1 distinct tag · 1 folder without a tag');
		expect(describeOutlineResultSummary({ systemCount: 2, tagCount: 5, skippedCount: 2 }))
			.toBe('2 systems · 5 distinct tags · 2 folders without a tag');
	});
});

// ─── Shared helpers ────────────────────────────────────────────────────────

describe('shared helpers', () => {
	test('a folder path reads as its own name, and the root has a name too', () => {
		expect(folderDisplayName('UX Lab/Repeated PARA/Studio')).toBe('Studio');
		expect(folderDisplayName('UX Lab')).toBe('UX Lab');
		expect(folderDisplayName('')).toBe('vault root');
	});

	test('depth counts path segments', () => {
		expect(outlineDepth('')).toBe(0);
		expect(outlineDepth('UX Lab')).toBe(1);
		expect(outlineDepth('UX Lab/Studio/Areas')).toBe(3);
	});

	test('names join as prose, with the requested conjunction', () => {
		expect(joinNames([], 'and')).toBe('');
		expect(joinNames(['PARA'], 'and')).toBe('PARA');
		expect(joinNames(['PARA', 'Johnny Decimal'], 'and')).toBe('PARA and Johnny Decimal');
		expect(joinNames(['A', 'B', 'C'], 'or')).toBe('A, B or C');
	});
});
