/**
 * WorkbenchOutlinePanel — the hidden "annotated outline" Workbench prototype.
 *
 * ONE folder outline. Every organizational-system occurrence annotates its
 * anchor folder's own row ("Studio · PARA"); nothing is added to the tree that
 * is not a folder. A bracket bar in the gutter spans the occurrence's real
 * member rows. Three guided steps change only what the annotation and status
 * columns of those same rows say:
 *
 *   1 Find systems            → Complete / Partial / Too few, fold word
 *   2 Choose what to manage   → checkbox + "Manage here", "included by …"
 *   3 Check the tags          → delta reading (✓ / → segment), conflict line
 *
 * Same inputs, same engine: checked folders are `state.scope.selectedPaths`
 * and the plan is `buildScopePackPlan`, exactly as the Scope surface. Nothing
 * here writes rules, folders, notes, or tags.
 *
 * Exact occurrence exclusions live in normalized Workbench state and drive the
 * canonical review/save plan. Display-only tag expansion remains panel-local.
 */

import type { DetectionOccurrence } from '../../engine/detectPacks';
import {
	buildAnnotatedTree,
	collectAnnotatedTreeFolders,
	type CrossPackHitMap,
} from '../../engine/detectionTree';
import { type RuleMatch } from '../../engine/ruleMatcher';
import type { RuleInstallPlan } from '../../engine/ruleInstallPlan';
import { previewRule } from '../../engine/rulePreview';
import type { CandidateRow } from '../../engine/scanAndSnapPlan';
import type { MappingRule } from '../../types/settings';
import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type { WorkbenchOutlineState, WorkbenchScopeState } from '../../workbench/workbenchState';
import { getCandidateDirectionalStatus } from './candidateDirectionStatus';
import {
	buildOutlineReviewPlan,
	type OutlineFolderComparison,
	type OutlineReviewPlan,
	type OutlineRuleOutcome,
} from './outlineReviewPlan';
import {
	OUTLINE_STEPS,
	OutlineHueRegistry,
	buildOutlineGroups,
	chooseOutlineGroupSystem,
	collectOutlineDeclinedKeys,
	computeOutlineFoldModel,
	computeOutlineTagRoot,
	describeOutlineChoiceEvidence,
	describeOutlineChoiceLabel,
	describeOutlineCompleteness,
	describeOutlineDeltaCell,
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
	describeOutlineMissingOutput,
	describeOutlineDirectionAnnotation,
	matchOutlineProposals,
	predictOutlineGroupChoice,
	findOutlineIncludingAncestor,
	describeOutlinePreviewToggle,
	describeOutlineResultSummary,
	describeOutlineTagRoot,
	describeOutlineWinReason,
	folderDisplayName,
	isDegenerateTag,
	outlineStepLabel,
	outlineStepShortLabel,
	resolveOutlineGroupChoice,
	titleCaseRole,
	toggleOutlineSelectedPath,
	type OutlineCandidateLike,
	type OutlineCompleteness,
	type OutlineDeltaCell,
	type OutlineGroup,
	type OutlineHue,
	type OutlineStep,
} from './workbenchOutlinePresentation';

/** Below this container width the annotation stacks under the name. */
const OUTLINE_NARROW_WIDTH = 480;
/** Indent per outline level, in px. Mirrors `--dtf-outline-indent`. */
const OUTLINE_INDENT = 16;

/**
 * Hues live for the plugin session, keyed by pack id: the same system keeps
 * its colour across steps, rerenders, and every panel instance in every frame.
 */
const outlineHueRegistry = new OutlineHueRegistry();

export interface WorkbenchOutlinePanelOptions {
	snapshot: WorkbenchSessionSnapshot;
	scope: WorkbenchScopeState;
	/** The one shared checked-folder input, identical to the Scope surface. */
	onSelectedPathsChange(selectedPaths: string[]): void;
	/** Persist exact occurrence exclusions; review confirmation remains panel-local. */
	onOutlineStateChange(state: WorkbenchOutlineState): void | Promise<void>;
	/** Existing guarded, forced-disabled Workbench installation seam. */
	onInstall(selectedRules: readonly MappingRule[]): Promise<RuleInstallPlan>;
	onReviewRule(ruleId: string): void | Promise<void>;
	isSnapshotStale(): boolean;
}

/** A definite refusal before the guarded persistence seam mutates settings. */
export class OutlineStaleReviewError extends Error {
	readonly code = 'outline-stale-review';

	constructor(message: string) {
		super(message);
		this.name = 'OutlineStaleReviewError';
	}
}

type OutlineRowKind =
	| 'folder' | 'choice' | 'ghost' | 'preview' | 'toggle' | 'elision' | 'line';

type OutlineRowParts = {
	row: HTMLElement;
	control: HTMLElement;
	name: HTMLElement;
	annotation: HTMLElement;
	status: HTMLElement;
};

interface OutlineRowRecord {
	el: HTMLElement;
	path: string;
	kind: OutlineRowKind;
	depth: number;
}

interface OutlineBracketRequest {
	anchorPath: string;
	anchorEl: HTMLElement;
	lastRowEl: HTMLElement | null;
	depth: number;
	dashed: boolean;
	hue: OutlineHue | null;
}

type OutlineGroupOf = OutlineGroup<DetectionOccurrence>;

/** One rule's claim on one folder at step 3. */
interface OutlineClaim {
	occurrence: DetectionOccurrence;
	candidate: CandidateRow;
	tag: string | null;
	tags: string[];
	outputError?: string;
}

/** What one folder ends up with at step 3, after competing claims resolve. */
interface OutlineFolderResult {
	winner: OutlineClaim;
	alternatives: OutlineClaim[];
	predicted: boolean;
	matches: RuleMatch[];
}

interface OutlineStepThreeModel {
	resultByFolder: Map<string, OutlineFolderResult>;
	comparisonByFolder: Map<string, OutlineFolderComparison>;
	reviewPlan: OutlineReviewPlan;
	/** The tag every member tag under the anchor starts with, per anchor. */
	rootByAnchor: Map<string, string | null>;
	conflictFolderCount: number;
	tagCount: number;
	outputFolderCount: number;
	skippedCount: number;
	exactRuleCount: number;
	newRulePreviewCount: number;
}

interface OutlineReviewPlanCache {
	snapshot: WorkbenchSessionSnapshot;
	sourceRevision: number;
	selectedPathsKey: string;
	excludedOccurrenceKeysKey: string;
	plan: OutlineReviewPlan;
}

interface OutlineInstallReceipt {
	result: RuleInstallPlan;
	snapshot: WorkbenchSessionSnapshot;
	sourceRevision: number;
	selectionKey: string;
}

export class WorkbenchOutlinePanel {
	private snapshot: WorkbenchSessionSnapshot;
	private scope: WorkbenchScopeState;
	private readonly onSelectedPathsChange: (selectedPaths: string[]) => void;
	private readonly onOutlineStateChange: (state: WorkbenchOutlineState) => void | Promise<void>;
	private readonly onInstall: (selectedRules: readonly MappingRule[]) => Promise<RuleInstallPlan>;
	private readonly onReviewRule: (ruleId: string) => void | Promise<void>;
	private readonly isSnapshotStale: () => boolean;

	private step: OutlineStep = 1;
	/** Step 1: the anchor whose matched folders are shown. */
	private openAnchor: string | null = null;
	private showAllFolders = false;
	/** Exact user choices excluded from review, preview, confirmation, and save. */
	private excludedOccurrenceKeys = new Set<string>();
	private reviewPlanCache: OutlineReviewPlanCache | null = null;
	private confirmationOpen = false;
	private installing = false;
	private feedback: { kind: 'info' | 'error'; message: string } | null = null;
	private installReceipt: OutlineInstallReceipt | null = null;
	/**
	 * Step 3 column mode. Off = the delta reading (✓ / → segment); on = full
	 * tag chips. Panel-local for the prototype; a later Settings candidate.
	 */
	private showFullTags = false;
	/**
	 * Occurrence keys whose missing-type ghost rows the user asked to see.
	 *
	 * PANEL-LOCAL state, deliberately: a plain unfold shows an occurrence's
	 * matched members only, and the "Not found" rows appear only after the user
	 * activates "N missing types — which?" on that occurrence. Nothing about this
	 * reaches `WorkbenchState` or the engine; adopting the outline would decide
	 * whether it is worth persisting at all.
	 */
	private missingTypesOpen = new Set<string>();
	/** Step 3: folders whose one-line "full tag …" expansion is open. */
	private expandedTagRows = new Set<string>();
	private expandedComparisons = new Set<string>();
	private predictionSamples = new Map<string, string>();
	private reviewContext: {
		folder: string;
		occurrenceKey: string;
		openAnchor: string | null;
		scrolls: Array<{ el: HTMLElement; top: number }>;
	} | null = null;
	private expandedPreviewMembers = new Set<string>();
	/** Members the user folded even though a conflict sits inside them. */
	private collapsedPreviewMembers = new Set<string>();

	private rowsEl: HTMLElement | null = null;
	private bracketLayerEl: HTMLElement | null = null;
	private rowRecords: OutlineRowRecord[] = [];
	private bracketRequests: OutlineBracketRequest[] = [];
	private lastCoveredRowByAnchor = new Map<string, HTMLElement>();
	/** The deepest sub-row printed under an anchor, so a bracket starts below it. */
	private lastSubRowByAnchor = new Map<string, HTMLElement>();
	private widthObserver: ResizeObserver | null = null;
	private controlId = 0;

	constructor(
		private readonly container: HTMLElement,
		options: WorkbenchOutlinePanelOptions,
	) {
		this.snapshot = options.snapshot;
		this.scope = cloneScope(options.scope);
		this.onSelectedPathsChange = options.onSelectedPathsChange;
		this.onOutlineStateChange = options.onOutlineStateChange;
		this.onInstall = options.onInstall;
		this.onReviewRule = options.onReviewRule;
		this.isSnapshotStale = options.isSnapshotStale;
		this.excludedOccurrenceKeys = new Set(options.snapshot.state.outline.excludedOccurrenceKeys);
		this.render();
		this.observeWidth();
	}

	update(snapshot: WorkbenchSessionSnapshot, scope: WorkbenchScopeState): void {
		if (snapshot !== this.snapshot) this.reviewPlanCache = null;
		if (this.installReceipt
			&& (snapshot !== this.installReceipt.snapshot
				|| snapshot.sourceRevision !== this.installReceipt.sourceRevision)) {
			this.installReceipt = null;
		}
		this.snapshot = snapshot;
		this.scope = cloneScope(scope);
		this.excludedOccurrenceKeys = new Set(snapshot.state.outline.excludedOccurrenceKeys);
		this.confirmationOpen = false;
		this.feedback = null;
		this.render();
	}

	destroy(): void {
		this.widthObserver?.disconnect();
		this.widthObserver = null;
		this.rowsEl = null;
		this.bracketLayerEl = null;
		this.rowRecords = [];
		this.bracketRequests = [];
		this.container.empty();
	}

	// ─── Data ──────────────────────────────────────────────────────────────

	/** Actionable + incomplete occurrences. Suppressed occurrences are ignored. */
	private visibleOccurrences(): DetectionOccurrence[] {
		return this.snapshot.occurrences
			.filter((occurrence) => occurrence.status !== 'suppressed')
			.slice()
			.sort((a, b) => {
				const byAnchor = compareCodePoints(a.anchorPath, b.anchorPath);
				return byAnchor !== 0 ? byAnchor : compareCodePoints(a.packName, b.packName);
			});
	}

	private allCandidates(): readonly CandidateRow[] {
		return this.snapshot.candidatePlan?.candidates ?? [];
	}

	private candidatesFor(occurrenceKey: string): CandidateRow[] {
		return this.allCandidates()
			.filter((candidate) => candidate.occurrenceKey === occurrenceKey);
	}

	/** The collision check only needs identity plus the conflict block. */
	private candidateLikes(): OutlineCandidateLike[] {
		return this.allCandidates().map((candidate) => ({
			key: candidate.key,
			ruleId: candidate.rule.id,
			occurrenceKey: candidate.occurrenceKey,
			conflict: {
				candidateTargets: candidate.conflict.candidateTargets,
				overlappingFolderSample: candidate.conflict.overlappingFolderSample,
				predictedWinnerId: candidate.conflict.predictedWinnerId,
			},
		}));
	}

	/** Do not infer this from installed layers: an ordered group may have no installed rules. */
	private groupPrecedence(): string[] {
		return [...(this.snapshot.groupPrecedence ?? [])];
	}

	private reviewPlan(excludedOccurrenceKeys: ReadonlySet<string>): OutlineReviewPlan {
		const selectedPathsKey = normalizedStringKey(this.scope.selectedPaths);
		const excludedOccurrenceKeysKey = normalizedStringKey(this.excludedOccurrenceKeys);
		const cached = this.reviewPlanCache;
		if (cached
			&& cached.snapshot === this.snapshot
			&& cached.sourceRevision === this.snapshot.sourceRevision
			&& cached.selectedPathsKey === selectedPathsKey
			&& cached.excludedOccurrenceKeysKey === excludedOccurrenceKeysKey) {
			return cached.plan;
		}
		const plan = buildOutlineReviewPlan({
			selectedPaths: this.scope.selectedPaths,
			hitMap: this.snapshot.hitMap,
			excludedOccurrenceKeys: [...excludedOccurrenceKeys],
			candidates: this.allCandidates(),
			installedRules: this.snapshot.installedRules,
			folderPaths: this.snapshot.folderPaths,
			groupPrecedence: this.snapshot.groupPrecedence,
		});
		this.reviewPlanCache = {
			snapshot: this.snapshot,
			sourceRevision: this.snapshot.sourceRevision,
			selectedPathsKey,
			excludedOccurrenceKeysKey,
			plan,
		};
		return plan;
	}

	private selectionKey(): string {
		return `${normalizedStringKey(this.scope.selectedPaths)}|${normalizedStringKey(this.excludedOccurrenceKeys)}`;
	}

	/**
	 * Every evidence hit — not just actionable — so an incomplete occurrence
	 * still has real folder rows to bracket.
	 */
	private evidenceHitMap(): CrossPackHitMap {
		return {
			...this.snapshot.hitMap,
			hitsByPath: this.snapshot.allEvidenceHitsByPath as CrossPackHitMap['hitsByPath'],
		};
	}

	private hueFor(packId: string): OutlineHue | null {
		return outlineHueRegistry.hueFor(packId);
	}

	// ─── Render ────────────────────────────────────────────────────────────

	private render(): void {
		const root = this.container;
		const active = root.ownerDocument.activeElement as HTMLElement | null;
		const focusKey = active && root.contains(active) ? active.dataset.dtfOutlineFocus : undefined;
		const scrolls = this.captureScrolls();
		root.empty();
		root.addClass('dtf-outline');
		root.dataset.dtfWorkbenchOutline = '1';
		root.dataset.dtfOutlineStep = String(this.step);
		this.controlId = 0;

		const occurrences = this.visibleOccurrences();
		const allGroups = buildOutlineGroups(occurrences, this.candidateLikes());
		this.predictionSamples.clear();
		for (const group of allGroups) {
			if (!group.collides) continue;
			const keys = new Set(group.occurrences.map((occurrence) => occurrence.key));
			const prediction = predictOutlineGroupChoice(this.allCandidates()
				.filter((candidate) => keys.has(candidate.occurrenceKey))
				.map((candidate) => ({
					occurrenceKey: candidate.occurrenceKey,
					rule: candidate.rule,
					sampleFolders: [
						...candidate.conflict.overlappingFolderSample,
						...(candidate.conflict.candidateTargets ?? []).flatMap((target) => target.sampleFolders),
					],
				})), this.groupPrecedence());
			group.predictedWinnerKey = prediction?.occurrenceKey ?? null;
			if (prediction) this.predictionSamples.set(group.anchorPath, prediction.sampleFolder);
		}
		const effectiveExcluded = collectOutlineDeclinedKeys(allGroups, this.excludedOccurrenceKeys);
		for (const key of this.excludedOccurrenceKeys) effectiveExcluded.add(key);
		const reviewPlan = this.reviewPlan(effectiveExcluded);
		const deployedKeys = new Set(
			reviewPlan.scopePlan.deployments.map((deployment) => deployment.occurrenceKey),
		);
		const managedKeys = new Set(
			reviewPlan.deployments.map((deployment) => deployment.occurrenceKey),
		);
		const proposedRuleCount = reviewPlan.newRuleCount;

		// Hue appears only once a system is checked; it is then keyed to the
		// pack id for the rest of the session. Co-anchored packs are declared so
		// two systems on one anchor row can never come out the same colour.
		if (this.step !== 1) {
			outlineHueRegistry.assign(
				occurrences
					.filter((occurrence) => managedKeys.has(occurrence.key))
					.map((occurrence) => occurrence.packId),
				allGroups
					.filter((group) => group.occurrences.length > 1)
					.map((group) => group.occurrences.map((occurrence) => occurrence.packId)),
			);
		}

		const step3 = this.step === 3;
		const groups: OutlineGroupOf[] = step3
			? allGroups
				.map((group) => ({
					...group,
					occurrences: group.occurrences
						.filter((occurrence) => managedKeys.has(occurrence.key)),
				}))
				.filter((group) => group.occurrences.length > 0)
			: allGroups;
		const bracketed = groups.flatMap((group) => group.occurrences);
		const groupsByAnchor = new Map<string, OutlineGroupOf>();
		for (const group of groups) groupsByAnchor.set(group.anchorPath, group);

		this.renderSteps(root, occurrences.length);
		const lead = root.createDiv({ cls: 'dtf-outline-lead' });
		const instructionEl = lead.createDiv({ cls: 'dtf-outline-instruction' });
		instructionEl.dataset.dtfOutlineInstruction = '1';
		const hintEl = lead.createDiv({ cls: 'dtf-outline-hint' });
		hintEl.dataset.dtfOutlineHint = '1';
		hintEl.setAttr('aria-live', 'polite');
		if (occurrences.length === 0 || (this.scope.selectedPaths.length > 0 && reviewPlan.reviewedRuleCount === 0)) {
			const custom = lead.createDiv({ cls: 'dtf-outline-custom-route' });
			custom.createSpan({ text: 'No built-in system proposal is available here. That is not a judgment about the quality of this organization.' });
			custom.createDiv({ text: 'Use Add rule in settings to create a custom mapping. This action does not create or enable a rule.' });
			const settings = custom.createEl('button', { text: 'Open rule settings' });
			settings.addEventListener('click', () => void this.onReviewRule(''));
		}

		const rows = root.createDiv({ cls: 'dtf-outline-rows' });
		rows.dataset.dtfOutlineRows = '1';
		rows.setAttr('role', 'tree');
		rows.setAttr('aria-label', 'Annotated folder outline');
		this.rowsEl = rows;
		this.bracketLayerEl = rows.createDiv({ cls: 'dtf-outline-bracket-layer' });
		this.bracketLayerEl.setAttr('aria-hidden', 'true');
		this.rowRecords = [];
		this.bracketRequests = [];
		this.lastCoveredRowByAnchor = new Map();
		this.lastSubRowByAnchor = new Map();

		// Step 1 unfolds the anchor the user opened; step 2 also unfolds every
		// managed system so its bracket spans the folders it will actually cover.
		const openKeys = this.openAnchor === null
			? []
			: bracketed
				.filter((occurrence) => occurrence.anchorPath === this.openAnchor)
				.map((occurrence) => occurrence.key);
		const unfoldedKeys = step3 || this.showAllFolders
			? new Set(bracketed.map((occurrence) => occurrence.key))
			: new Set([...openKeys, ...(this.step === 2 ? managedKeys : [])]);

		const tree = buildAnnotatedTree([...this.snapshot.folderPaths], this.evidenceHitMap());
		const treePaths = collectAnnotatedTreeFolders(tree.root);
		const fold = computeOutlineFoldModel({
			treePaths,
			occurrences: bracketed,
			unfoldedKeys,
			showAllFolders: this.showAllFolders && !step3,
		});
		const childrenByParent = groupChildren(treePaths);

		const model = step3 ? this.buildStepThreeModel(bracketed, reviewPlan) : null;

		// Root-anchored systems annotate a "vault root" row that heads the outline.
		const rootGroup = groupsByAnchor.get('');
		if (rootGroup) {
			this.renderFolderRow('', -1, rootGroup, bracketed, unfoldedKeys, deployedKeys, managedKeys, model);
		}

		const openParents: string[] = [];
		const leave = (parent: string): void => {
			this.renderGhostRows(parent, groupsByAnchor.get(parent) ?? null);
			if (!step3) {
				this.renderElisionRow(parent, fold, childrenByParent, groupsByAnchor.get(parent) ?? null);
			}
		};
		for (const path of fold.visiblePaths) {
			while (openParents.length > 0 && !isUnder(path, openParents[openParents.length - 1])) {
				leave(openParents.pop()!);
			}
			const depth = renderDepth(path);
			this.renderFolderRow(
				path,
				depth,
				groupsByAnchor.get(path) ?? null,
				bracketed,
				unfoldedKeys,
				deployedKeys,
				managedKeys,
				model,
			);
			if (model) this.renderPreviewRows(path, depth, fold.visible, bracketed, model);
			openParents.push(path);
		}
		while (openParents.length > 0) leave(openParents.pop()!);
		if (rootGroup) leave('');
		else if (!step3) this.renderElisionRow('', fold, childrenByParent, null);

		this.finalizeBrackets(groups);

		const conflictFolderCount = model?.conflictFolderCount ?? 0;
		instructionEl.setText(describeOutlineInstruction(this.step, {
			systemCount: occurrences.length,
			managedCount: managedKeys.size,
			proposedRuleCount,
			conflictFolderCount,
			showFullTags: this.showFullTags,
		}));
		this.renderHint(hintEl, bracketed, allGroups, deployedKeys, {
			managedCount: managedKeys.size,
			proposedRuleCount,
			conflictFolderCount,
			exactRuleCount: model?.exactRuleCount ?? 0,
		});
		this.renderFooter(root, managedKeys, proposedRuleCount, model, reviewPlan);
		this.applyRovingTabindex();
		this.applyWidthClass();
		requestAnimationFrame(() => {
			this.positionBrackets();
			this.restoreScrolls(scrolls);
			if (focusKey) this.focusByKey(focusKey);
		});
	}

	private renderSteps(root: HTMLElement, systemCount: number): void {
		const strip = root.createDiv({ cls: 'dtf-outline-steps' });
		strip.dataset.dtfOutlineSteps = '1';
		const tabs = strip.createDiv({ cls: 'dtf-outline-step-tabs' });
		tabs.setAttr('role', 'tablist');
		tabs.setAttr('aria-label', 'Guided steps');

		for (const step of OUTLINE_STEPS) {
			const button = tabs.createEl('button', { cls: 'dtf-outline-step' });
			button.createSpan({ cls: 'dtf-outline-step-full', text: outlineStepLabel(step) });
			button.createSpan({ cls: 'dtf-outline-step-short', text: outlineStepShortLabel(step) });
			button.setAttr('aria-label', outlineStepLabel(step));
			button.dataset.dtfOutlineStepButton = String(step);
			button.dataset.dtfOutlineFocus = `step-${step}`;
			button.setAttr('role', 'tab');
			button.setAttr('aria-selected', String(this.step === step));
			button.tabIndex = this.step === step ? 0 : -1;
			if (this.step === step) button.addClass('is-active');
			if (step < this.step) {
				button.addClass('is-done');
				button.createSpan({ cls: 'dtf-outline-step-done', text: 'Done' });
			}
			button.addEventListener('click', () => this.setStep(step));
			button.addEventListener('keydown', (event) => {
				if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
				event.preventDefault();
				const delta = event.key === 'ArrowRight' ? 1 : -1;
				const next = OUTLINE_STEPS[
					(OUTLINE_STEPS.indexOf(step) + delta + OUTLINE_STEPS.length)
					% OUTLINE_STEPS.length
				];
				this.setStep(next);
				this.container
					.querySelector<HTMLElement>(`[data-dtf-outline-step-button="${next}"]`)
					?.focus();
			});
		}

		const actions = strip.createDiv({ cls: 'dtf-outline-step-actions' });
		if (systemCount === 0) {
			actions.createSpan({ cls: 'dtf-outline-muted', text: 'No systems found' });
		}

		const back = actions.createEl('button', { cls: 'dtf-outline-nav', text: 'Back' });
		back.dataset.dtfOutlineBack = '1';
		back.disabled = this.step === 1;
		back.addEventListener('click', () => this.setStep((this.step - 1) as OutlineStep));

		const next = actions.createEl('button', { cls: 'mod-cta dtf-outline-nav', text: 'Next' });
		next.dataset.dtfOutlineNext = '1';
		next.disabled = this.step === 3;
		next.addEventListener('click', () => this.setStep((this.step + 1) as OutlineStep));
	}

	private setStep(step: OutlineStep): void {
		if (step < 1 || step > 3 || step === this.step) return;
		if (step === 3 && this.reviewContext) {
			this.returnToPreview();
			return;
		}
		this.step = step;
		this.confirmationOpen = false;
		this.feedback = null;
		this.render();
		requestAnimationFrame(() => this.focusByKey(`step-${step}`));
	}

	private renderHint(
		hintEl: HTMLElement,
		occurrences: readonly DetectionOccurrence[],
		groups: readonly OutlineGroupOf[],
		deployedKeys: ReadonlySet<string>,
		counts: {
			managedCount: number;
			proposedRuleCount: number;
			conflictFolderCount: number;
			exactRuleCount: number;
		},
	): void {
		const open = this.openAnchor === null
			? []
			: occurrences.filter((occurrence) => occurrence.anchorPath === this.openAnchor);
		const openEvidence = new Set<string>();
		let openNeeded = 0;
		for (const occurrence of open) {
			for (const path of occurrence.memberPaths) openEvidence.add(path);
			for (const path of occurrence.supportPaths) openEvidence.add(path);
			openNeeded = Math.max(openNeeded, describeOutlineCompleteness(occurrence).neededCount);
		}

		let pendingChoiceAnchorName: string | null = null;
		if (this.step === 2) {
			const pending = groups.find((group) =>
				group.collides
				&& group.occurrences.some((occurrence) => deployedKeys.has(occurrence.key)));
			if (pending) pendingChoiceAnchorName = folderDisplayName(pending.anchorPath);
		}

		hintEl.setText(describeOutlineHint(this.step, {
			openPackNames: open.map((occurrence) => occurrence.packName),
			openEvidenceCount: openEvidence.size,
			openNeededCount: openNeeded,
			managedCount: counts.managedCount,
			proposedRuleCount: counts.proposedRuleCount,
			pendingChoiceAnchorName,
			conflictFolderCount: counts.conflictFolderCount,
			exactRuleCount: counts.exactRuleCount,
		}));
	}

	private renderFooter(
		root: HTMLElement,
		managedKeys: ReadonlySet<string>,
		proposedRuleCount: number,
		model: OutlineStepThreeModel | null,
		reviewPlan: OutlineReviewPlan,
	): void {
		const footer = root.createDiv({ cls: 'dtf-outline-footer' });
		footer.dataset.dtfOutlineFooter = '1';

		if (this.step === 2) {
			const summary = footer.createDiv({ cls: 'dtf-outline-summary' });
			summary.dataset.dtfOutlineSummary = '1';
			summary.setText(describeOutlineManagementSummary(managedKeys.size, proposedRuleCount));
		}

		if (this.step === 3 && model) {
			const summary = footer.createDiv({ cls: 'dtf-outline-summary' });
			summary.dataset.dtfOutlineSummary = '1';
			summary.setText(`Preview: ${describeOutlineResultSummary({
				systemCount: managedKeys.size,
				tagCount: model.tagCount,
				skippedCount: model.skippedCount,
			})} across ${model.outputFolderCount} folders · ${model.newRulePreviewCount} new rule ${model.newRulePreviewCount === 1 ? 'preview' : 'previews'}`);
			if (model.skippedCount > 0) {
				summary.createDiv({ text: `${model.skippedCount} matched ${model.skippedCount === 1 ? 'folder has' : 'folders have'} no usable forward tag.` });
			}
		}

		const controls = footer.createDiv({ cls: 'dtf-outline-footer-controls' });
		if (this.step !== 3) {
			const id = this.nextControlId('show-all');
			const label = controls.createEl('label', { cls: 'dtf-outline-check' });
			label.htmlFor = id;
			const checkbox = label.createEl('input', { type: 'checkbox' });
			checkbox.id = id;
			checkbox.checked = this.showAllFolders;
			checkbox.dataset.dtfOutlineShowAll = '1';
			checkbox.addEventListener('change', () => {
				this.showAllFolders = checkbox.checked;
				this.render();
			});
			label.createSpan({ text: 'Show all folders' });
			return;
		}

		const id = this.nextControlId('full-tags');
		const label = controls.createEl('label', { cls: 'dtf-outline-check' });
		label.htmlFor = id;
		const checkbox = label.createEl('input', { type: 'checkbox' });
		checkbox.id = id;
		checkbox.checked = this.showFullTags;
		checkbox.dataset.dtfOutlineFullTags = '1';
		checkbox.dataset.dtfOutlineFocus = 'full-tags';
		checkbox.addEventListener('change', () => {
			this.showFullTags = checkbox.checked;
			this.render();
		});
		label.createSpan({ text: 'Show full tags' });

		this.renderReviewStatus(controls, reviewPlan);
		if (this.confirmationOpen) {
			this.renderSaveConfirmation(controls, reviewPlan);
			return;
		}

		const stale = this.isSnapshotStale();
		const save = controls.createEl('button', { cls: 'mod-cta dtf-outline-save' });
		save.dataset.dtfOutlineSave = '1';
		save.setText(reviewPlan.newRuleCount === 0
			? 'No new rules to save'
			: `Save ${reviewPlan.newRuleCount} disabled ${reviewPlan.newRuleCount === 1 ? 'rule' : 'rules'}`);
		save.disabled = !reviewPlan.canSave || this.installing || stale;
		save.setAttr('aria-disabled', String(save.disabled));
		save.addEventListener('click', () => {
			if (this.isSnapshotStale()) {
				this.feedback = { kind: 'error', message: 'The reviewed inputs changed. Refresh and review the updated rules before saving.' };
				this.render();
				return;
			}
			this.confirmationOpen = true;
			this.feedback = null;
			this.render();
		});
		const note = controls.createSpan({ cls: 'dtf-outline-muted dtf-outline-save-note' });
		note.setText('New rules are saved disabled. No folders, notes, tags, or active rule states change.');
	}

	private renderReviewStatus(parent: HTMLElement, plan: OutlineReviewPlan): void {
		const status = parent.createDiv({ cls: 'dtf-outline-review-status' });
		status.dataset.dtfOutlineReviewStatus = '1';
		status.setText(`${plan.reviewedSystemCount} ${plan.reviewedSystemCount === 1 ? 'system' : 'systems'} · ${plan.reviewedRuleCount} reviewed ${plan.reviewedRuleCount === 1 ? 'rule' : 'rules'} · ${plan.newRuleCount} new`);
		if (plan.savedRuleCount > 0) {
			const savedEntries = plan.reviewedRules.filter((entry) => entry.installStatus === 'saved');
			const activeCount = savedEntries.filter((entry) => entry.installedRule?.enabled).length;
			const disabledCount = savedEntries.length - activeCount;
			status.createDiv({ text: `${plan.savedRuleCount} already saved ${plan.savedRuleCount === 1 ? 'rule is' : 'rules are'} unchanged and will not be duplicated · ${activeCount} active · ${disabledCount} disabled.` });
		}
		if (plan.changedRuleCount > 0) {
			const changed = status.createDiv({ cls: 'dtf-outline-warning' });
			changed.createSpan({ text: `${plan.changedRuleCount} existing same-ID ${plan.changedRuleCount === 1 ? 'rule has' : 'rules have'} changed. Saving will not overwrite ${plan.changedRuleCount === 1 ? 'it' : 'them'}.` });
			for (const entry of plan.reviewedRules.filter((item) => item.installStatus === 'changed')) {
				const review = changed.createEl('button', { text: `Review ${entry.installedRule?.name ?? entry.rule.name} in settings` });
				review.addEventListener('click', () => void this.onReviewRule(entry.rule.id));
			}
		}
		if (plan.invalidDraftOutputs.length > 0) {
			const warning = status.createDiv({ cls: 'dtf-outline-error' });
			warning.createEl('strong', { text: 'Save blocked: a chosen draft generates invalid tag syntax.' });
			for (const invalid of plan.invalidDraftOutputs) {
				const item = warning.createDiv();
				item.createSpan({ text: `${invalid.ruleName} at ${invalid.folderPath || 'vault root'}: ${invalid.error}` });
				const owner = plan.reviewedRules.find((entry) => entry.rule.id === invalid.ruleId);
				if (owner) {
					const remove = item.createEl('button', { text: `Deselect ${owner.candidate.sourcePackName}` });
					remove.addEventListener('click', () => this.setOccurrenceIncluded(owner.candidate.occurrenceKey, false));
				}
			}
		}
		if (this.isSnapshotStale()) {
			status.createDiv({ cls: 'dtf-outline-warning', text: 'The vault or rule settings changed. Saving is paused until the refreshed proposal is reviewed.' });
		}
		if (this.feedback) {
			const feedback = status.createDiv({
				cls: this.feedback.kind === 'error' ? 'dtf-outline-error' : 'dtf-outline-muted',
				text: this.feedback.message,
			});
			feedback.dataset.dtfOutlineFeedback = this.feedback.kind;
		}
		if (this.installReceipt && this.installReceipt.selectionKey === this.selectionKey()) {
			const result = this.installReceipt.result;
			const line = status.createDiv({ cls: 'dtf-outline-success' });
			line.setText(`${result.addedRuleIds.length} disabled ${result.addedRuleIds.length === 1 ? 'rule' : 'rules'} saved · ${result.skippedExistingIds.length} existing skipped · ${result.skippedDuplicateCount} duplicate selections skipped.`);
			if (result.addedRuleIds[0]) {
				const review = line.createEl('button', { text: 'Review saved rule in settings' });
				review.addEventListener('click', () => void this.onReviewRule(result.addedRuleIds[0]));
			}
		}
	}

	private renderSaveConfirmation(parent: HTMLElement, plan: OutlineReviewPlan): void {
		const confirmation = parent.createDiv({ cls: 'dtf-outline-confirmation' });
		confirmation.dataset.dtfOutlineConfirmation = '1';
		confirmation.createEl('strong', { text: `Save ${plan.newRuleCount} disabled ${plan.newRuleCount === 1 ? 'rule' : 'rules'}?` });
		confirmation.createDiv({ text: `${plan.reviewedSystemCount} selected ${plan.reviewedSystemCount === 1 ? 'system' : 'systems'} produce ${plan.reviewedRuleCount} reviewed ${plan.reviewedRuleCount === 1 ? 'rule' : 'rules'}; ${plan.savedRuleCount} are already saved and ${plan.changedRuleCount} have changed existing same-ID definitions.` });
		confirmation.createDiv({ text: 'Only the new rules shown here will be added, always disabled. No file or folder content changes.' });
		const actions = confirmation.createDiv({ cls: 'dtf-outline-confirmation-actions' });
		const cancel = actions.createEl('button', { text: 'Cancel' });
		cancel.disabled = this.installing;
		cancel.addEventListener('click', () => {
			this.confirmationOpen = false;
			this.feedback = null;
			this.render();
		});
		const confirm = actions.createEl('button', {
			cls: 'mod-cta',
			text: this.installing
				? 'Saving disabled rules…'
				: `Save ${plan.newRuleCount} disabled ${plan.newRuleCount === 1 ? 'rule' : 'rules'}`,
		});
		confirm.disabled = this.installing || !plan.canSave || this.isSnapshotStale();
		confirm.addEventListener('click', () => void this.installReviewedRules(plan));
	}

	private async installReviewedRules(plan: OutlineReviewPlan): Promise<void> {
		if (this.installing || !plan.canSave) return;
		if (this.isSnapshotStale()) {
			this.confirmationOpen = false;
			this.feedback = { kind: 'error', message: 'Saving was not attempted because the reviewed inputs changed. Refresh and review the updated proposal.' };
			this.render();
			return;
		}
		const selectionKey = this.selectionKey();
		let persistenceAttempted = false;
		this.installing = true;
		this.feedback = { kind: 'info', message: 'Saving reviewed disabled rules…' };
		this.render();
		try {
			if (this.isSnapshotStale()) {
				throw new OutlineStaleReviewError('The reviewed inputs changed immediately before saving.');
			}
			persistenceAttempted = true;
			const result = await this.onInstall(plan.rulesForSave);
			if (!result || !Array.isArray(result.addedRuleIds)
				|| !Array.isArray(result.skippedExistingIds)
				|| !Array.isArray(result.skippedDuplicateIds)) {
				throw new Error('The install callback returned an invalid result.');
			}
			this.installReceipt = this.selectionKey() === selectionKey
				? {
					result,
					snapshot: this.snapshot,
					sourceRevision: this.snapshot.sourceRevision,
					selectionKey,
				}
				: null;
			this.confirmationOpen = false;
			this.feedback = null;
		} catch (error) {
			this.confirmationOpen = false;
			this.installReceipt = null;
			this.feedback = error instanceof OutlineStaleReviewError
				? {
					kind: 'error',
					message: `Saving was not attempted because the reviewed inputs changed. ${errorMessage(error)} Refresh and review the updated proposal.`,
				}
				: {
					kind: 'error',
					message: persistenceAttempted
						? `Saving disabled rules failed after persistence was attempted: ${errorMessage(error)} The review remains available; refresh before retrying because persistence may have partially completed.`
						: `Saving disabled rules failed before persistence was attempted: ${errorMessage(error)}`,
				};
		} finally {
			this.installing = false;
			this.render();
		}
	}

	private setOccurrenceIncluded(occurrenceKey: string, included: boolean): void {
		if (included) this.excludedOccurrenceKeys.delete(occurrenceKey);
		else this.excludedOccurrenceKeys.add(occurrenceKey);
		this.installReceipt = null;
		this.confirmationOpen = false;
		this.feedback = null;
		void this.onOutlineStateChange({
			excludedOccurrenceKeys: [...this.excludedOccurrenceKeys].sort(compareCodePoints),
		});
		this.render();
	}

	// ─── Rows ──────────────────────────────────────────────────────────────

	/**
	 * One row = three tracks: the control slot, the name cell (at least half the
	 * row), and one right-aligned trailing cell. The annotation and the status
	 * both live in that trailing cell, so a ✓, a delta chip and an anchor state
	 * all end at the SAME edge instead of floating mid-row.
	 */
	private createRow(kind: OutlineRowKind, path: string, depth: number): OutlineRowParts {
		const rows = this.rowsEl!;
		const row = rows.createDiv({ cls: `dtf-outline-row is-${kind}` });
		row.dataset.dtfOutlineRow = kind;
		if (kind === 'folder' || kind === 'preview') row.dataset.dtfOutlineFocus = `folder-${path}`;
		row.dataset.dtfOutlineDepth = String(depth);
		row.style.setProperty('--dtf-outline-gutter', `calc(${Math.max(0, depth + 2)} * var(--dtf-outline-indent))`);
		row.createDiv({ cls: 'dtf-outline-gutter' });
		const control = row.createDiv({ cls: 'dtf-outline-control' });
		const name = row.createDiv({ cls: 'dtf-outline-name' });
		const trailing = row.createDiv({ cls: 'dtf-outline-trailing' });
		const annotation = trailing.createDiv({ cls: 'dtf-outline-annotation' });
		const status = trailing.createDiv({ cls: 'dtf-outline-status' });
		this.rowRecords.push({ el: row, path, kind, depth });
		return { row, control, name, annotation, status };
	}

	/** A row that carries one sentence across the name and trailing columns. */
	private createLineRow(path: string, depth: number, cls: string): HTMLElement {
		const rows = this.rowsEl!;
		const row = rows.createDiv({ cls: `dtf-outline-row is-line ${cls}` });
		row.dataset.dtfOutlineRow = 'line';
		row.dataset.dtfOutlineDepth = String(depth);
		row.style.setProperty('--dtf-outline-gutter', `calc(${Math.max(0, depth + 2)} * var(--dtf-outline-indent))`);
		row.createDiv({ cls: 'dtf-outline-gutter' });
		row.createDiv({ cls: 'dtf-outline-control' });
		const line = row.createDiv({ cls: 'dtf-outline-line' });
		this.rowRecords.push({ el: row, path, kind: 'line', depth });
		return line;
	}


	/**
	 * A muted sub-row directly beneath an anchor, indented one level and running
	 * full width from the name column to the edge. This is where the fold word,
	 * the "which?" link and the step-3 tag root live, so the anchor row itself
	 * keeps to its three tracks and never grows past two lines.
	 */
	private createSubRow(anchorPath: string, depth: number, cls: string): HTMLElement {
		const line = this.createLineRow(anchorPath, depth + 1, `is-sub ${cls}`);
		line.parentElement!.dataset.dtfOutlineSubRow = anchorPath;
		this.lastSubRowByAnchor.set(anchorPath, line.parentElement as HTMLElement);
		return line;
	}

	/**
	 * One folder = one row. When systems are anchored here the row also names
	 * them ("Studio · PARA") and carries the step's control and annotation.
	 */
	private renderFolderRow(
		path: string,
		depth: number,
		group: OutlineGroupOf | null,
		bracketed: readonly DetectionOccurrence[],
		unfoldedKeys: ReadonlySet<string>,
		deployedKeys: ReadonlySet<string>,
		managedKeys: ReadonlySet<string>,
		model: OutlineStepThreeModel | null,
	): void {
		const parts = this.createRow('folder', path, depth);
		const { row, name } = parts;
		row.setAttr('role', 'treeitem');
		row.setAttr('aria-level', String(depth + 2));
		row.dataset.dtfOutlinePath = path;
		// The folder name may need an ellipsis — it is the ONLY thing here that
		// may be cut, and it always carries its full text as a tooltip.
		const folderName = name.createSpan({
			cls: 'dtf-outline-folder-name',
			text: folderDisplayName(path),
		});
		folderName.setAttr('title', folderDisplayName(path));

		// Which unfolded occurrences count this folder as evidence (and where
		// their bracket must reach).
		const evidenceOf = bracketed.filter((occurrence) =>
			occurrence.anchorPath !== path
			&& unfoldedKeys.has(occurrence.key)
			&& (occurrence.memberPaths.includes(path) || occurrence.supportPaths.includes(path)));
		for (const occurrence of evidenceOf) {
			this.lastCoveredRowByAnchor.set(occurrence.anchorPath, row);
		}
		if (evidenceOf.length > 0) row.addClass('is-evidence');

		if (group === null) {
			this.renderEvidenceAnnotation(parts, path, evidenceOf, managedKeys);
			if (model) this.renderResultCell(parts, path, depth, model);
			return;
		}

		this.renderAnchorRow(parts, path, depth, group, unfoldedKeys, deployedKeys, managedKeys, model);
	}

	/** Role text on an evidence row, only where it adds something. */
	private renderEvidenceAnnotation(
		parts: OutlineRowParts,
		path: string,
		evidenceOf: readonly DetectionOccurrence[],
		managedKeys: ReadonlySet<string>,
	): void {
		if (this.step === 3 || evidenceOf.length === 0) return;
		const texts: string[] = [];
		for (const occurrence of evidenceOf) {
			const annotation = describeOutlineEvidenceRow(occurrence, path, roleByPath(occurrence));
			if (annotation && !texts.includes(annotation.text)) texts.push(annotation.text);
		}
		if (texts.length === 0) return;
		const span = parts.annotation.createSpan({ cls: 'dtf-outline-role', text: texts.join(' · ') });
		span.dataset.dtfOutlineRole = '1';
		const hued = evidenceOf.find((occurrence) =>
			managedKeys.has(occurrence.key) && this.hueFor(occurrence.packId) !== null);
		if (this.step === 2 && hued) span.addClass(`is-hue-${this.hueFor(hued.packId)}`);
	}

	private renderAnchorRow(
		parts: OutlineRowParts,
		path: string,
		depth: number,
		group: OutlineGroupOf,
		unfoldedKeys: ReadonlySet<string>,
		deployedKeys: ReadonlySet<string>,
		managedKeys: ReadonlySet<string>,
		model: OutlineStepThreeModel | null,
	): void {
		const { row, control, name, annotation, status } = parts;
		row.addClass('is-anchor');
		row.dataset.dtfOutlineAnchor = path;
		row.dataset.dtfOutlineAnchorKeys = group.occurrences.map((occurrence) => occurrence.key).join(' ');
		const managed = group.occurrences.filter((occurrence) => managedKeys.has(occurrence.key));
		const ready = group.occurrences.filter((occurrence) => occurrence.status === 'actionable');
		const anyReady = ready.length > 0;
		row.dataset.dtfOutlineManaged = String(managed.length > 0);
		row.dataset.dtfOutlineStatus = anyReady ? 'ready' : 'incomplete';
		const open = this.openAnchor === path;
		row.dataset.dtfOutlineSelected = String(open && this.step !== 3);
		if (open && this.step !== 3) row.addClass('is-open');

		// "Studio · PARA" / "Main · Johnny Decimal + PARA".
		name.createSpan({ cls: 'dtf-outline-name-sep', text: ' · ' });
		group.occurrences.forEach((occurrence, index) => {
			if (index > 0) name.createSpan({ cls: 'dtf-outline-name-sep', text: ' + ' });
			const system = name.createSpan({ cls: 'dtf-outline-system-name', text: occurrence.packName });
			system.dataset.dtfOutlineSystem = occurrence.key;
			system.dataset.dtfOutlineOccurrenceTarget = occurrence.key;
			system.tabIndex = -1;
			system.dataset.dtfOutlinePack = occurrence.packId;
			const hue = this.step === 1 || !managedKeys.has(occurrence.key)
				? null
				: this.hueFor(occurrence.packId);
			if (hue) {
				system.addClass(`is-hue-${hue}`);
				system.dataset.dtfOutlineHue = hue;
			}
		});
		const firstHue = managed
			.map((occurrence) => this.step === 1 ? null : this.hueFor(occurrence.packId))
			.find((hue) => hue !== null) ?? null;
		if (firstHue) {
			row.addClass(`is-hue-${firstHue}`);
			row.dataset.dtfOutlineHue = firstHue;
		}
		if (managed.length > 0 && this.step !== 1) row.addClass('is-managed');
		if (!anyReady) row.addClass('is-too-few');

		const completeness = group.occurrences.map((occurrence) => describeOutlineCompleteness(occurrence));
		const matchedCount = new Set(group.occurrences.flatMap((occurrence) =>
			[...occurrence.memberPaths, ...occurrence.supportPaths])).size;
		const unfolded = group.occurrences.some((occurrence) => unfoldedKeys.has(occurrence.key));

		if (this.step === 1) {
			this.renderCompleteness(status, group, completeness);
			row.addEventListener('click', (event) => {
				if (isFormControl(event.target) || (event.target as HTMLElement).closest('button')) return;
				this.toggleOpenAnchor(path);
			});
			row.addEventListener('keydown', (event) => {
				if (event.target !== row || (event.key !== 'Enter' && event.key !== ' ')) return;
				event.preventDefault();
				this.toggleOpenAnchor(path);
			});
			this.renderFoldSubRow(path, depth, group, unfolded, matchedCount);
			return;
		}

		if (this.step === 2) {
			this.renderManageControl(parts, path, group, anyReady, deployedKeys);
			const included = row.dataset.dtfOutlineManage === 'included-by';
			const unavailable = row.dataset.dtfOutlineManage === 'unavailable';
			// Co-anchored systems that all get managed say so instead of offering
			// a fold word — but never at the cost of "included by …", which is
			// the only thing that explains why this anchor is managed at all.
			const wholeGroupManaged = managed.length > 1 && !group.collides;
			// One state per row: an anchor that cannot be managed yet says exactly
			// that, and its missing types are named on the fold sub-row instead.
			if (!unavailable) this.renderCompleteness(status, group, completeness);
			if (!included && !wholeGroupManaged && !this.showAllFolders) {
				this.renderFoldSubRow(path, depth, group, unfolded, matchedCount);
			} else {
				this.renderMissingTypesSubRow(path, depth, group);
			}
			// "included by …" is the anchor's own annotation (contract 3); the
			// whole-group promise gets a sub-row so the anchor row keeps to its
			// three tracks and never grows a third line.
			if (wholeGroupManaged) {
				const line = this.createSubRow(path, depth, 'is-group-inclusion');
				line.dataset.dtfOutlineGroupInclusion = path;
				line.setText(describeOutlineGroupInclusion(managed.length));
			}
			if (ready.some((occurrence) => deployedKeys.has(occurrence.key))) {
				this.renderChoiceRows(path, depth, group, deployedKeys, completeness);
			}
			this.renderReviewContext(path, depth, group);
			return;
		}

		// Step 3: the anchor states the tag root once; the marker carries the hue.
		const marker = control.createSpan({ cls: 'dtf-outline-marker' });
		marker.dataset.dtfOutlineMarker = '1';
		if (firstHue) marker.addClass('is-coloured');
		if (model) {
			const rootTag = model.rootByAnchor.get(path) ?? null;
			const anchorResult = model.resultByFolder.get(path);
			const anchorTags = anchorResult?.winner.tags ?? [];
			if (rootTag !== null) {
				const rootEl = this.createSubRow(path, depth, 'is-tag-root');
				rootEl.dataset.dtfOutlineRoot = rootTag;
				rootEl.appendText('tags start with ');
				this.renderTagChip(rootEl, rootTag, firstHue, managed[0]?.key ?? '');
			} else if (anchorTags.length > 0 && anchorTags.every((tag) => !isDegenerateTag(tag))) {
				const own = this.createSubRow(path, depth, 'is-tag-root');
				own.dataset.dtfOutlineOwnTag = path;
				own.appendText(anchorTags.length === 1 ? 'this folder’s tag ' : 'this folder’s tags ');
				for (const tag of anchorTags) this.renderTagChip(own, tag, this.hueFor(anchorResult!.winner.occurrence.packId), anchorResult!.winner.occurrence.key);
			} else {
				const tags = [...model.resultByFolder.entries()]
					.filter(([folder]) => isUnder(folder, path))
					.flatMap(([, result]) => result.winner.tags).filter((tag) => !isDegenerateTag(tag));
				const rootEl = status.createSpan({ cls: 'dtf-outline-root' });
				rootEl.dataset.dtfOutlineRoot = '';
				rootEl.setText(describeOutlineTagRoot({ root: null, tagCount: new Set(tags).size, allSame: false }));
			}
			for (const occurrence of managed) {
				const coverage = model.reviewPlan.occurrenceCoverage.find((entry) =>
					entry.occurrenceKey === occurrence.key);
				if (!coverage) continue;
				const line = this.createSubRow(path, depth, 'is-coverage');
				const details = line.createEl('details', { cls: 'dtf-outline-coverage' });
				details.dataset.dtfOutlineCoverage = occurrence.key;
				details.createEl('summary', {
					text: `${occurrence.packName} rules start at ${coverage.anchorPath || 'vault root'} · match ${coverage.matchingFolders.length} current ${coverage.matchingFolders.length === 1 ? 'folder' : 'folders'}`,
				});
				let populated = false;
				details.addEventListener('toggle', () => {
					if (details.open && !populated) {
						populated = true;
						details.createDiv({ cls: 'dtf-outline-muted', text: 'Complete coverage of current folders, not a sample. Selecting a detected folder does not limit future runtime matches to that one folder.' });
						for (const folder of coverage.matchingFolders) details.createDiv({ text: folder || 'vault root' });
					}
					this.positionBrackets();
				});
			}
			this.renderDirectionReview(path, depth, managed);
			this.renderResultCell(parts, path, depth, model, true);
		}
	}

	private toggleOpenAnchor(path: string): void {
		this.openAnchor = this.openAnchor === path ? null : path;
		this.render();
	}

	/**
	 * The fold sub-row: a muted line directly beneath the anchor, indented one
	 * level, carrying the fold word and — when a system here is short of folder
	 * types — the "N missing types — which?" link. Neither ever sits in the
	 * anchor row, where they had to compete with the name and the state.
	 */
	private renderFoldSubRow(
		anchorPath: string,
		depth: number,
		group: OutlineGroupOf,
		unfolded: boolean,
		matchedCount: number,
	): void {
		const missingCount = this.missingTypeCount(group);
		if (matchedCount === 0 && missingCount === 0) return;
		const line = this.createSubRow(anchorPath, depth, 'is-fold');
		if (matchedCount > 0) {
			const button = line.createEl('button', { cls: 'dtf-outline-fold' });
			button.dataset.dtfOutlineFold = anchorPath;
			button.setAttr('aria-expanded', String(unfolded));
			button.setText(describeOutlineFoldWord({ unfolded, matchedCount }));
			button.addEventListener('click', (event) => {
				event.stopPropagation();
				this.toggleOpenAnchor(anchorPath);
			});
		}
		if (missingCount > 0) {
			if (matchedCount > 0) line.createSpan({ cls: 'dtf-outline-name-sep', text: ' · ' });
			this.renderMissingTypesLink(line, group, missingCount);
		}
	}

	/** The "which?" link alone, for an anchor whose fold word is suppressed. */
	private renderMissingTypesSubRow(
		anchorPath: string,
		depth: number,
		group: OutlineGroupOf,
	): void {
		const missingCount = this.missingTypeCount(group);
		if (missingCount === 0) return;
		const line = this.createSubRow(anchorPath, depth, 'is-fold');
		this.renderMissingTypesLink(line, group, missingCount);
	}

	private renderMissingTypesLink(
		line: HTMLElement,
		group: OutlineGroupOf,
		missingCount: number,
	): void {
		const keys = group.occurrences
			.filter((occurrence) => occurrence.missingRoles.length > 0)
			.map((occurrence) => occurrence.key);
		const open = keys.every((key) => this.missingTypesOpen.has(key));
		const link = line.createEl('button', { cls: 'dtf-outline-fold' });
		link.dataset.dtfOutlineMissingTypes = group.anchorPath;
		link.setAttr('aria-expanded', String(open));
		link.setText(describeOutlineMissingTypesLink(missingCount, open));
		link.addEventListener('click', (event) => {
			event.stopPropagation();
			for (const key of keys) {
				if (open) this.missingTypesOpen.delete(key);
				else this.missingTypesOpen.add(key);
			}
			this.render();
		});
	}

	/** Folder types the systems at one anchor expected and did not find. */
	private missingTypeCount(group: OutlineGroupOf): number {
		return new Set(group.occurrences.flatMap((occurrence) => occurrence.missingRoles)).size;
	}

	private renderCompleteness(
		status: HTMLElement,
		group: OutlineGroupOf,
		completeness: readonly OutlineCompleteness[],
	): void {
		const readiest = completeness.find((item) => item.state !== 'too-few') ?? completeness[0];
		const span = status.createSpan({ cls: 'dtf-outline-completeness' });
		span.dataset.dtfOutlineCompleteness = readiest.state;
		span.addClass(`is-${readiest.state}`);
		// Co-anchored systems that DISAGREE get counts, one line — never two
		// system statuses spliced into one string. Each system's own state is
		// said on its radio sub-row instead.
		const disagree = group.occurrences.length > 1
			&& new Set(completeness.map((item) => item.state)).size > 1;
		if (disagree) {
			span.dataset.dtfOutlineGroupState = '1';
			span.setText(describeOutlineGroupState(
				group.occurrences.length,
				completeness.filter((item) => item.state !== 'too-few').length,
			));
			if (completeness.some((item) => item.state === 'too-few')) span.addClass('has-too-few');
			return;
		}
		span.setText(readiest.text);
	}

	/** Step 2: the checkbox in the control slot, its label right after the name. */
	private renderManageControl(
		parts: OutlineRowParts,
		anchorPath: string,
		group: OutlineGroupOf,
		ready: boolean,
		deployedKeys: ReadonlySet<string>,
	): void {
		const { row, control, name, annotation, status } = parts;
		const inPlan = group.occurrences.some((occurrence) => deployedKeys.has(occurrence.key));
		const manage = describeOutlineManageControl({
			anchorPath,
			ready,
			selectedPaths: this.scope.selectedPaths,
			inPlan,
		});
		row.dataset.dtfOutlineManage = manage.kind;

		const id = this.nextControlId('manage');
		const checkbox = control.createEl('input', { type: 'checkbox' });
		checkbox.id = id;
		checkbox.checked = manage.checked;
		checkbox.disabled = manage.disabled;
		checkbox.dataset.dtfOutlineManageCheckbox = anchorPath;
		checkbox.dataset.dtfOutlineFocus = `manage-${anchorPath}`;
		checkbox.setAttr('aria-label', `Manage ${folderDisplayName(anchorPath)}`);
		if (manage.kind === 'manage') {
			const label = name.createEl('label', { cls: 'dtf-outline-manage', text: manage.text });
			label.htmlFor = id;
			label.dataset.dtfOutlineManageLabel = anchorPath;
			if (manage.checked) label.addClass('is-checked');
			checkbox.addEventListener('change', () => {
				this.scope.selectedPaths = toggleOutlineSelectedPath(
					this.scope.selectedPaths,
					anchorPath,
					checkbox.checked,
				);
				this.installReceipt = null;
				this.onSelectedPathsChange([...this.scope.selectedPaths]);
				this.render();
			});
			return;
		}
		// "Can't manage yet" IS this row's state, so it sits at the right edge
		// and never wraps in the middle of the row; "included by …" stays an
		// annotation because the row still reports its own completeness.
		const host = manage.kind === 'unavailable' ? status : annotation;
		const note = host.createSpan({ cls: 'dtf-outline-manage-note', text: manage.text });
		note.dataset.dtfOutlineManageNote = manage.kind;
		if (manage.kind === 'included-by') row.addClass('is-included');
	}

	/**
	 * Step 2, one inclusion checkbox per deployed occurrence. Colliding systems
	 * begin with the predicted one selected, but every occurrence can be removed.
	 */
	private renderChoiceRows(
		anchorPath: string,
		depth: number,
		group: OutlineGroupOf,
		deployedKeys: ReadonlySet<string>,
		completeness: readonly OutlineCompleteness[],
	): void {
		const choice = resolveOutlineGroupChoice(group, this.excludedOccurrenceKeys);
		const effectiveExcluded = new Set(this.excludedOccurrenceKeys);
		for (const key of choice.declinedKeys) effectiveExcluded.add(key);
		const ready = group.occurrences.filter((occurrence) =>
			occurrence.status === 'actionable' && deployedKeys.has(occurrence.key));
		for (const occurrence of ready) {
			const parts = this.createRow('choice', anchorPath, depth + 1);
			const { row, control, name, annotation, status } = parts;
			row.dataset.dtfOutlineChoiceRow = occurrence.key;
			// Contract 4: a group's per-system state lives HERE, never spliced
			// into the anchor's own one-line state.
			const own = completeness[group.occurrences.indexOf(occurrence)];
			if (own) {
				const state = status.createSpan({ cls: 'dtf-outline-completeness' });
				state.dataset.dtfOutlineCompleteness = own.state;
				state.addClass(`is-${own.state}`);
				state.setText(own.text);
			}
			const predicted = occurrence.key === group.predictedWinnerKey;
			const displayDefault = group.collides
				&& group.predictedWinnerKey === null && occurrence.key === ready[0].key;
			const included = !effectiveExcluded.has(occurrence.key);
			const id = this.nextControlId('occurrence');
			const checkbox = control.createEl('input', { type: 'checkbox' });
			checkbox.id = id;
			checkbox.checked = included;
			checkbox.dataset.dtfOutlineChoice = occurrence.key;
			checkbox.dataset.dtfOutlineFocus = `choice-${occurrence.key}`;
			checkbox.dataset.dtfOutlineChoiceAnchor = anchorPath;
			checkbox.setAttr('aria-label', `${included ? 'Exclude' : 'Include'} ${occurrence.packName} draft rules at ${anchorPath || 'vault root'}`);
			checkbox.addEventListener('change', () => {
				if (group.collides) {
					this.excludedOccurrenceKeys = checkbox.checked
						? chooseOutlineGroupSystem(group, this.excludedOccurrenceKeys, occurrence.key)
						: new Set([...this.excludedOccurrenceKeys, occurrence.key]);
					this.installReceipt = null;
					void this.onOutlineStateChange({
						excludedOccurrenceKeys: [...this.excludedOccurrenceKeys].sort(compareCodePoints),
					});
					this.confirmationOpen = false;
					this.feedback = null;
					this.render();
					return;
				}
				this.setOccurrenceIncluded(occurrence.key, checkbox.checked);
			});
			const label = name.createEl('label', { cls: 'dtf-outline-choice' });
			label.htmlFor = id;
			const system = label.createSpan({ cls: 'dtf-outline-system-name', text: occurrence.packName });
			system.dataset.dtfOutlineSystem = occurrence.key;
			system.dataset.dtfOutlinePack = occurrence.packId;
			const hue = included ? this.hueFor(occurrence.packId) : null;
			if (hue) {
				system.addClass(`is-hue-${hue}`);
				system.dataset.dtfOutlineHue = hue;
			}
			label.createSpan({ cls: 'dtf-outline-name-sep', text: ' · ' });
			const word = label.createSpan({
				cls: 'dtf-outline-choice-label',
				text: group.collides
					? describeOutlineChoiceLabel(predicted, displayDefault)
					: included ? 'Included in review' : 'Excluded from review',
			});
			word.dataset.dtfOutlineChoiceLabel = predicted ? 'predicted' : displayDefault ? 'default' : 'alternative';

			if (predicted) {
				const rival = ready.find((other) => other.key !== occurrence.key) ?? null;
				const evidence = annotation.createSpan({ cls: 'dtf-outline-choice-evidence' });
				evidence.dataset.dtfOutlineChoiceEvidence = occurrence.key;
				evidence.setText(describeOutlineChoiceEvidence({
					evidenceCount: occurrence.evidenceCount,
					totalCount: occurrence.countBy === 'roles'
						? occurrence.evidenceCount + occurrence.missingRoles.length
						: 0,
					reason: rival ? this.predictionReason(occurrence, rival) : null,
				}));
			}
		}
	}

	/** Why the runtime would pick `winner`'s rule over `loser`'s on a shared folder. */
	private predictionReason(winner: DetectionOccurrence, loser: DetectionOccurrence): string | null {
		const winnerRules = this.candidatesFor(winner.key).map((candidate) => candidate.rule);
		const loserRules = this.candidatesFor(loser.key).map((candidate) => candidate.rule);
		const sample = this.predictionSamples.get(winner.anchorPath) ?? null;
		if (sample === null || winnerRules.length === 0 || loserRules.length === 0) return null;
		const rules = this.allCandidates().filter((candidate) => candidate.occurrenceKey === winner.key
			|| candidate.occurrenceKey === loser.key).map((candidate) => candidate.rule);
		const { matches, winner: actual } = matchOutlineProposals(sample, rules, this.groupPrecedence());
		if (!actual || !winnerRules.some((rule) => rule.id === actual.rule.id)) return null;
		const other = matches.find((match) => loserRules.some((rule) => rule.id === match.rule.id));
		return other ? describeOutlineWinReason(matchLike(actual), matchLike(other), this.groupPrecedence()) : null;
	}

	/**
	 * "N missing types — which?" unfolds into one row per missing folder type.
	 *
	 * Gated on `missingTypesOpen` alone (fix 3): a plain unfold reveals the
	 * occurrence's MATCHED members only, so the outline never fills with "Not
	 * found" rows the user did not ask for.
	 */
	private renderGhostRows(
		anchorPath: string,
		group: OutlineGroupOf | null,
	): void {
		if (group === null || this.step === 3) return;
		const depth = renderDepth(anchorPath) + 1;
		const shown = new Set<string>();
		for (const occurrence of group.occurrences) {
			if (!this.missingTypesOpen.has(occurrence.key)) continue;
			for (const ghost of describeOutlineGhostRows(occurrence.missingRoles)) {
				if (shown.has(ghost.name)) continue;
				shown.add(ghost.name);
				const parts = this.createRow('ghost', anchorPath, depth);
				parts.row.dataset.dtfOutlineGhost = anchorPath;
				parts.row.setAttr('aria-hidden', 'false');
				parts.name.createSpan({ cls: 'dtf-outline-folder-name', text: ghost.name });
				parts.annotation.createSpan({ cls: 'dtf-outline-ghost-text', text: ghost.text });
				this.lastCoveredRowByAnchor.set(anchorPath, parts.row);
			}
		}
	}

	/** Hidden tree children no system matched, under a visible parent. */
	private renderElisionRow(
		parent: string,
		fold: ReturnType<typeof computeOutlineFoldModel>,
		childrenByParent: ReadonlyMap<string, readonly string[]>,
		group: OutlineGroupOf | null,
	): void {
		const hidden = (childrenByParent.get(parent) ?? []).filter((child) => !fold.visible.has(child));
		if (hidden.length === 0) return;
		// Under an anchor the fold word already accounts for its matched
		// folders; only the unmatched remainder is worth a line.
		const evidence = new Set(group?.occurrences.flatMap((occurrence) =>
			[...occurrence.memberPaths, ...occurrence.supportPaths]) ?? []);
		const unmatched = hidden.filter((child) => !evidence.has(child)
			&& ![...evidence].some((path) => isUnder(path, child)));
		if (unmatched.length === 0) return;
		const parts = this.createRow('elision', parent, renderDepth(parent) + 1);
		parts.row.dataset.dtfOutlineElision = parent;
		parts.name.createSpan({ cls: 'dtf-outline-muted', text: describeOutlineElision(unmatched.length) });
	}

	// ─── Step 3 ────────────────────────────────────────────────────────────

	/**
	 * Every managed rule previewed over its anchor's subtree; competing claims
	 * on one folder resolved the way the runtime would (planner prediction
	 * first, else the matcher's own precedence), with the reason kept.
	 */
	private buildStepThreeModel(
		bracketed: readonly DetectionOccurrence[],
		reviewPlan: OutlineReviewPlan,
	): OutlineStepThreeModel {
		const claimsByFolder = new Map<string, OutlineClaim[]>();
		let newRulePreviewCount = 0;
		let exactRuleCount = 0;
		// Preserve candidate order for a full matcher tie. Never deduplicate or
		// promote usable outputs before ranking: a winning invalid output matters.
		const occurrences = new Map(bracketed.map((occurrence) => [occurrence.key, occurrence]));
		for (const reviewed of reviewPlan.reviewedRules) {
			if (reviewed.installStatus !== 'new') continue;
			const candidate = reviewed.candidate;
			const occurrence = occurrences.get(candidate.occurrenceKey);
			if (!occurrence) continue;
			newRulePreviewCount++;
			const status = getCandidateDirectionalStatus(candidate);
			if (status.folderToTag.status === 'exact' && status.tagToFolder.status === 'exact') exactRuleCount++;
			const scoped = this.snapshot.folderPaths.filter((folder) => folder === occurrence.anchorPath || isUnder(folder, occurrence.anchorPath));
			const preview = previewRule(candidate.rule, scoped, { maxSamples: scoped.length });
			const samples = new Map(preview.samples.map((sample) => [sample.folder, sample.tags]));
			for (const folder of scoped) {
				if (!matchOutlineProposals(folder, [candidate.rule], this.groupPrecedence()).winner) continue;
				const tags = samples.get(folder) ?? [];
				const claim: OutlineClaim = { occurrence, candidate, tags, tag: tags[0] ?? null,
					outputError: preview.invalidRegex?.error };
				const bucket = claimsByFolder.get(folder);
				if (bucket) bucket.push(claim);
				else claimsByFolder.set(folder, [claim]);
			}
		}
		const resultByFolder = new Map<string, OutlineFolderResult>();
		const tags = new Set<string>();
		let conflictFolderCount = 0;
		let outputFolderCount = 0;
		let skippedCount = 0;
		for (const [folder, claims] of claimsByFolder) {
			const result = this.resolveClaims(folder, claims);
			resultByFolder.set(folder, result);
			if (result.alternatives.length > 0) conflictFolderCount++;
			const usable = result.winner.tags.filter((tag) => !isDegenerateTag(tag));
			if (usable.length === 0) skippedCount++;
			else outputFolderCount++;
			for (const tag of usable) tags.add(tag);
		}
		const rootByAnchor = new Map<string, string | null>();
		for (const occurrence of bracketed) {
			if (rootByAnchor.has(occurrence.anchorPath)) continue;
			// The claim is about everything displayed beneath this folder, including
			// winners from nested systems and expandable descendant rows.
			const descendants = [...resultByFolder.entries()].filter(([folder]) => isUnder(folder, occurrence.anchorPath));
			const memberTags = descendants.flatMap(([, result]) => result.winner.tags.length > 0 ? result.winner.tags : ['']);
			const anchorTag = resultByFolder.get(occurrence.anchorPath)?.winner.tag ?? null;
			rootByAnchor.set(occurrence.anchorPath, computeOutlineTagRoot(anchorTag, memberTags));
		}
		return {
			resultByFolder,
			comparisonByFolder: new Map(
				reviewPlan.comparisons.map((comparison) => [comparison.folderPath, comparison]),
			),
			reviewPlan,
			rootByAnchor,
			conflictFolderCount,
			tagCount: tags.size,
			outputFolderCount,
			skippedCount,
			exactRuleCount,
			newRulePreviewCount,
		};
	}

	private resolveClaims(folder: string, claims: readonly OutlineClaim[]): OutlineFolderResult {
		const { matches, winner: match } = matchOutlineProposals(folder,
			claims.map((claim) => claim.candidate.rule), this.groupPrecedence());
		const winner = claims.find((claim) => claim.candidate.rule.id === match?.rule.id) ?? claims[0];
		const signature = (claim: OutlineClaim) => JSON.stringify([...claim.tags].sort());
		const alternatives = claims.filter((claim) => claim !== winner && signature(claim) !== signature(winner));
		return { winner, alternatives, predicted: match !== null, matches };
	}


	/** The delta reading of a folder's tag against its parent's tag. */
	private deltaFor(
		folder: string,
		result: OutlineFolderResult,
		model: OutlineStepThreeModel,
	): OutlineDeltaCell {
		const parent = parentOf(folder);
		const parentTag = model.resultByFolder.get(parent)?.winner.tag
			?? model.rootByAnchor.get(parent)
			?? null;
		const cell = describeOutlineDeltaCell({
			folderName: folderDisplayName(folder),
			tag: result.winner.tag,
			parentTag: parent === folder ? null : parentTag,
		});
		let cursor = parent;
		while (cursor !== '') {
			if (model.rootByAnchor.has(cursor)) {
				if (model.rootByAnchor.get(cursor) === null && model.resultByFolder.has(cursor)
					&& cell.kind !== 'none') return { kind: 'full', segment: null, tag: cell.tag };
				break;
			}
			cursor = parentOf(cursor);
		}
		return cell;
	}

	/** Step 3 annotation for one folder row: ✓, → segment, chip, or "no tag". */
	private renderResultCell(
		parts: OutlineRowParts,
		folder: string,
		depth: number,
		model: OutlineStepThreeModel,
		isAnchor = false,
	): void {
		const result = model.resultByFolder.get(folder);
		const comparison = model.comparisonByFolder.get(folder) ?? null;
		if (!result) {
			if (!isAnchor && parts.row.classList.contains('is-evidence')) {
				parts.annotation.createSpan({ cls: 'dtf-outline-muted', text: describeOutlineMissingOutput(null) });
			}
			if (comparison) this.renderBehaviorComparison(folder, depth, comparison);
			return;
		}
		const { row, annotation } = parts;
		const cell = this.deltaFor(folder, result, model);
		row.dataset.dtfOutlineDelta = cell.kind;
		row.dataset.dtfOutlineTagSystem = result.winner.occurrence.key;
		if (result.alternatives.length > 0) {
			row.dataset.dtfOutlineRowConflict = '1';
			row.addClass('has-conflict');
			this.renderComparison(folder, depth, result);
			if (comparison) this.renderBehaviorComparison(folder, depth, comparison);
			return;
		}
		if (isAnchor && cell.kind !== 'none') {
			if (comparison) this.renderBehaviorComparison(folder, depth, comparison);
			return;
		}
		const cellEl = annotation.createSpan({ cls: 'dtf-outline-result' });
		const winnerHue = this.hueFor(result.winner.occurrence.packId);
		if (cell.kind === 'none') {
			const warn = cellEl.createSpan({ cls: 'dtf-outline-no-tag', text: describeOutlineMissingOutput(result.winner.tags) });
			warn.dataset.dtfOutlineNoTag = '1';
			row.addClass('is-no-tag');
			this.renderOutputDetails(folder, depth, result.winner);
		} else if (this.showFullTags || cell.kind === 'full' || result.winner.tags.length > 1) {
			for (const tag of result.winner.tags) this.renderTagChip(cellEl, tag, winnerHue, result.winner.occurrence.key);
		} else {
			const expanded = this.expandedTagRows.has(folder);
			const button = cellEl.createEl('button', { cls: 'dtf-outline-tag-toggle' });
			button.dataset.dtfOutlineFocus = `tag-${folder}`;
			button.setAttr('aria-expanded', String(expanded));
			button.setAttr('aria-label', `${expanded ? 'Hide' : 'Show'} full tag for ${folderDisplayName(folder)}: ${cell.tag}`);
			if (cell.kind === 'same') {
				button.createSpan({ cls: 'dtf-outline-tick', text: '✓' });
				button.createSpan({ cls: 'dtf-outline-tag-toggle-label', text: 'Name ending' });
			} else {
				button.createSpan({ cls: 'dtf-outline-delta', text: `→ ${cell.segment}` });
			}
			button.addEventListener('click', () => this.toggleTagRow(folder));
			row.addClass('is-expandable');
			row.setAttr('aria-expanded', String(expanded));
			row.addEventListener('click', (event) => {
				if (!(event.target as HTMLElement).closest('button')) this.toggleTagRow(folder);
			});
			row.addEventListener('keydown', (event) => {
				if (event.target === row && (event.key === 'Enter' || event.key === ' ')) {
					event.preventDefault(); this.toggleTagRow(folder);
				}
			});
			if (expanded) {
				const line = this.createLineRow(folder, depth, 'is-full-tag');
				line.dataset.dtfOutlineFullTag = folder;
				line.setText(describeOutlineFullTagLine(cell.tag!, result.winner.occurrence.packName, folderDisplayName(folder)));
			}
		}
		if (comparison) this.renderBehaviorComparison(folder, depth, comparison);
	}

	private renderBehaviorComparison(
		folder: string,
		depth: number,
		comparison: OutlineFolderComparison,
	): void {
		const line = this.createLineRow(folder, depth, 'is-behavior-comparison');
		const details = line.createEl('details', { cls: 'dtf-outline-behavior-comparison' });
		details.dataset.dtfOutlineBehaviorComparison = folder;
		const current = describeRuleOutcome(comparison.current);
		const hypothetical = describeRuleOutcome(comparison.hypothetical);
		details.createEl('summary', {
			text: comparison.change === 'unchanged'
				? `Current behavior unchanged · ${hypothetical}`
				: `Behavior changes · ${current} → ${hypothetical}`,
		});
		const body = details.createDiv({ cls: 'dtf-outline-behavior-body' });
		this.renderBehaviorOutcome(body, 'Current behavior', comparison.current);
		this.renderBehaviorOutcome(body, 'If new drafts were enabled', comparison.hypothetical);
		body.createDiv({ cls: 'dtf-outline-muted', text: 'This comparison uses enabled installed forward-capable rules, exact new reviewed drafts, configured group order, and the production matcher. Saving does not enable the drafts.' });
		details.addEventListener('toggle', () => this.positionBrackets());
	}

	private renderBehaviorOutcome(parent: HTMLElement, label: string, result: OutlineRuleOutcome): void {
		const row = parent.createDiv({ cls: 'dtf-outline-behavior-outcome' });
		row.createEl('strong', { text: label });
		row.createDiv({ text: describeRuleOutcome(result) });
		if (result.ruleId) {
			row.createDiv({ text: `${result.origin === 'proposed' ? 'Proposed' : 'Installed'} rule: ${result.ruleName ?? result.ruleId}` });
			if (result.origin === 'installed') {
				const review = row.createEl('button', { text: 'Review rule in settings' });
				review.addEventListener('click', () => void this.onReviewRule(result.ruleId!));
			}
		}
		if (result.error) row.createDiv({ cls: 'dtf-outline-error', text: result.error });
	}

	/** Folder-attached comparison. Disclosure is native for keyboard and touch;
	 * full outputs wrap and are never dependent on a hover tooltip. */
	private renderComparison(folder: string, depth: number, result: OutlineFolderResult): void {
		const line = this.createLineRow(folder, depth, 'is-conflict');
		const card = line.createDiv({ cls: 'dtf-outline-comparison' });
		card.dataset.dtfOutlineConflictLine = folder;
		card.createDiv({ cls: 'dtf-outline-comparison-title', text: result.alternatives.length === 1
			? 'Two rules produce different tags' : `${result.alternatives.length + 1} rules produce different tags` });
		const outcome = card.createDiv({ cls: 'dtf-outline-proposed-output' });
		outcome.createSpan({ cls: 'dtf-outline-muted', text: result.predicted ? 'Proposed result' : 'Display default · no prediction' });
		this.renderClaimTags(outcome, result.winner);
		const details = card.createEl('details', { cls: 'dtf-outline-compare-details' });
		details.open = this.expandedComparisons.has(folder);
		const summary = details.createEl('summary', { text: 'Compare rules' });
		summary.dataset.dtfOutlineCompare = folder;
		summary.dataset.dtfOutlineFocus = `compare-${folder}`;
		const body = details.createDiv({ cls: 'dtf-outline-compare-body' });
		body.createDiv({ cls: 'dtf-outline-muted', text: 'The matcher picks one rule for this folder; it does not combine outputs.' });
		const options = body.createDiv({ cls: 'dtf-outline-compare-options' });
		for (const [index, claim] of [result.winner, ...result.alternatives].entries()) {
			const option = options.createDiv({ cls: 'dtf-outline-compare-option' });
			option.dataset.dtfOutlineClaim = claim.candidate.key;
			option.createDiv({ cls: 'dtf-outline-option-state', text: index === 0 ? 'Proposed result' : 'Other output' });
			const name = option.createDiv({ cls: 'dtf-outline-option-system', text: claim.occurrence.packName });
			const hue = this.hueFor(claim.occurrence.packId);
			if (hue) name.addClass(`is-hue-${hue}`);
			option.createDiv({ cls: 'dtf-outline-option-anchor', text: `Starts at ${folderDisplayName(claim.occurrence.anchorPath)}` });
			this.renderClaimTags(option, claim);
			const metadata = option.createEl('details', { cls: 'dtf-outline-rule-name' });
			metadata.createEl('summary', { text: 'Rule details' });
			metadata.createDiv({ text: `Rule: ${claim.candidate.rule.name}` });
			metadata.createDiv({ text: `System starts at: ${claim.occurrence.anchorPath || 'vault root'}` });
			const review = option.createEl('button', { cls: 'dtf-outline-review', text: 'Review system in step 2' });
			review.dataset.dtfOutlineReview = claim.occurrence.key;
			review.dataset.dtfOutlineFocus = `review-${folder}-${claim.occurrence.key}`;
			review.setAttr('aria-label', `Review ${claim.occurrence.packName} at ${claim.occurrence.anchorPath} in step 2`);
			review.addEventListener('click', () => this.reviewOccurrence(folder, claim.occurrence));
		}
		const decision = body.createDiv({ cls: 'dtf-outline-decision' });
		decision.createEl('strong', { text: 'Why this result' });
		const winnerMatch = result.matches.find((match) => match.rule.id === result.winner.candidate.rule.id);
		for (const alternative of result.alternatives) {
			const other = result.matches.find((match) => match.rule.id === alternative.candidate.rule.id);
			const reason = winnerMatch && other
				? describeOutlineWinReason(matchLike(winnerMatch), matchLike(other), this.groupPrecedence()) : null;
			decision.createDiv({ text: reason ?? 'A winner could not be verified from the available matcher inputs. This is a display default, not a runtime prediction.' });
		}
		if (result.alternatives.some((claim) => claim.occurrence.anchorPath !== result.winner.occurrence.anchorPath)) {
			body.createDiv({ cls: 'dtf-outline-review-guidance', text: 'A checked parent includes ready nested systems. Step 2 has no per-child exclusion; reviewing a system does not resolve that overlap.' });
		}
		body.createDiv({ cls: 'dtf-outline-muted', text: 'This draft-only comparison explains competing proposed systems. The folder’s Current behavior disclosure below includes installed rules and the exact post-save hypothetical.' });
		details.addEventListener('toggle', () => {
			if (!details.isConnected) return;
			if (details.open) this.expandedComparisons.add(folder);
			else this.expandedComparisons.delete(folder);
			this.positionBrackets();
		});
	}

	private renderClaimTags(host: HTMLElement, claim: OutlineClaim): void {
		if (claim.tags.length === 0) {
			host.createDiv({ cls: 'dtf-outline-no-tag', text: claim.outputError
				? `Preview error: ${claim.outputError}` : describeOutlineMissingOutput([]) });
		}
		for (const tag of claim.tags) {
			if (isDegenerateTag(tag)) {
				host.createDiv({ cls: 'dtf-outline-no-tag', text: 'Generation error · unusable output' });
				host.createEl('code', { cls: 'dtf-outline-raw-output', text: JSON.stringify(tag) });
			} else this.renderTagChip(host, tag, this.hueFor(claim.occurrence.packId), claim.occurrence.key);
		}
	}

	private renderOutputDetails(folder: string, depth: number, claim: OutlineClaim): void {
		const line = this.createLineRow(folder, depth, 'is-output-review');
		const details = line.createEl('details');
		details.createEl('summary', { text: 'Review output' });
		this.renderClaimTags(details, claim);
		details.createDiv({ text: `Rule: ${claim.candidate.rule.name}` });
	}

	/** Inexact directions remain reviewable even when a rule produces no sample. */
	private renderDirectionReview(anchor: string, depth: number, occurrences: readonly DetectionOccurrence[]): void {
		const candidates = occurrences.flatMap((occurrence) => this.candidatesFor(occurrence.key))
			.filter((candidate) => describeOutlineDirectionAnnotation(getCandidateDirectionalStatus(candidate)) !== null);
		if (candidates.length === 0) return;
		const line = this.createSubRow(anchor, depth, 'is-direction-review');
		const details = line.createEl('details');
		details.dataset.dtfOutlineDirections = anchor;
		details.createEl('summary', { text: `Review directions · ${candidates.length} ${candidates.length === 1 ? 'rule' : 'rules'} not exact both ways` });
		for (const candidate of candidates) {
			const item = details.createDiv({ cls: 'dtf-outline-direction-item' });
			item.createEl('strong', { text: candidate.rule.name });
			const status = getCandidateDirectionalStatus(candidate);
			for (const [label, direction] of [['Folder → tag', status.folderToTag], ['Tag → folder', status.tagToFolder]] as const) {
				item.createDiv({ text: `${label}: ${direction.label}. ${direction.detail}` });
			}
			if (candidate.rule.direction === 'tag-to-folder') {
				const occurrence = occurrences.find((source) => source.key === candidate.occurrenceKey)!;
				const raw = item.createEl('details', { cls: 'dtf-outline-raw-direction-preview' });
				raw.dataset.dtfOutlineRawDirectionOutput = candidate.key;
				raw.createEl('summary', { text: 'Raw transformation examples · not forward results' });
				raw.createDiv({ text: 'This rule runs only from tags to folders. These raw folder-to-tag transformations are not eligible to win the forward comparison.' });
				const examples = previewRule(candidate.rule, [occurrence.anchorPath, ...occurrence.memberPaths], { maxSamples: 2 });
				for (const sample of examples.samples) {
					raw.createDiv({ text: `Folder: ${sample.folder}` });
					for (const tag of sample.tags) {
						if (isDegenerateTag(tag)) raw.createEl('code', { cls: 'dtf-outline-raw-output', text: JSON.stringify(tag) });
						else this.renderTagChip(raw, tag, this.hueFor(occurrence.packId), occurrence.key);
					}
				}
				raw.addEventListener('toggle', () => this.positionBrackets());
			}
		}
		details.addEventListener('toggle', () => this.positionBrackets());
	}

	private reviewOccurrence(folder: string, occurrence: DetectionOccurrence): void {
		this.reviewContext = { folder, occurrenceKey: occurrence.key,
			openAnchor: this.openAnchor, scrolls: this.captureScrolls() };
		this.openAnchor = occurrence.anchorPath;
		this.step = 2;
		this.render();
		requestAnimationFrame(() => {
			const target = this.findData('dtfOutlineChoice', occurrence.key)
				?? this.findData('dtfOutlineOccurrenceTarget', occurrence.key);
			if (!target) return;
			target.closest('.dtf-outline-row')?.classList.add('is-review-target');
			target.focus({ preventScroll: true });
			target.scrollIntoView({ block: 'center', behavior: 'instant' });
		});
	}

	private renderReviewContext(anchor: string, depth: number, group: OutlineGroupOf): void {
		const context = this.reviewContext;
		const occurrence = group.occurrences.find((item) => item.key === context?.occurrenceKey);
		if (!context || !occurrence) return;
		const line = this.createSubRow(anchor, depth, 'is-review-context');
		const notice = line.createDiv({ cls: 'dtf-outline-review-context' });
		notice.dataset.dtfOutlineReviewTarget = occurrence.key;
		notice.createEl('strong', { text: `Reviewing ${occurrence.packName} for ${folderDisplayName(context.folder)}` });
		const ancestor = findOutlineIncludingAncestor(anchor, this.scope.selectedPaths);
		notice.createDiv({ text: ancestor !== null
			? `Included by ${folderDisplayName(ancestor)}. This nested system cannot be excluded while that parent is checked. Changing the parent selection changes the included branch.`
			: group.collides ? 'The radios above choose this folder’s interpretation for the preview only.'
				: 'The checkbox above includes or removes this branch from the preview.' });
		const back = notice.createEl('button', { text: 'Return to comparison' });
		back.dataset.dtfOutlineReturn = '1';
		back.dataset.dtfOutlineFocus = 'return-comparison';
		back.addEventListener('click', () => this.returnToPreview());
	}

	private returnToPreview(): void {
		const context = this.reviewContext;
		if (!context) return;
		this.openAnchor = context.openAnchor;
		this.reviewContext = null;
		this.step = 3;
		this.render();
		requestAnimationFrame(() => {
			this.restoreScrolls(context.scrolls);
			if (!this.focusByKey(`review-${context.folder}-${context.occurrenceKey}`)) {
				this.focusByKey(`compare-${context.folder}`);
			}
		});
	}

	private findData(key: string, value: string): HTMLElement | undefined {
		return Array.from(this.container.querySelectorAll<HTMLElement>('*')).find((el) => el.dataset[key] === value);
	}

	private focusByKey(key: string): boolean {
		const target = this.findData('dtfOutlineFocus', key);
		if (!target) return false;
		target.focus({ preventScroll: true });
		return true;
	}

	private captureScrolls(): Array<{ el: HTMLElement; top: number }> {
		const scrolls: Array<{ el: HTMLElement; top: number }> = [];
		let el: HTMLElement | null = this.container;
		while (el) {
			if (el.scrollHeight > el.clientHeight) scrolls.push({ el, top: el.scrollTop });
			el = el.parentElement;
		}
		return scrolls;
	}

	private restoreScrolls(scrolls: Array<{ el: HTMLElement; top: number }>): void {
		for (const { el, top } of scrolls) if (el.isConnected) el.scrollTop = top;
	}

	private renderTagChip(
		parent: HTMLElement,
		tag: string,
		hue: OutlineHue | null,
		occurrenceKey: string,
	): HTMLElement {
		const chip = parent.createSpan({ cls: 'dtf-outline-tag', text: tag });
		chip.dataset.dtfOutlineTagSystem = occurrenceKey;
		if (hue) {
			chip.addClass(`is-hue-${hue}`);
			chip.dataset.dtfOutlineHue = hue;
		}
		return chip;
	}

	private toggleTagRow(folder: string): void {
		if (this.expandedTagRows.has(folder)) this.expandedTagRows.delete(folder);
		else this.expandedTagRows.add(folder);
		this.render();
	}

	/**
	 * Step 3: folders below a visible member that a rule reaches but the fold
	 * model does not show, behind "N folders inside". A member with a conflict
	 * inside opens by itself so the red line is never hidden.
	 */
	private renderPreviewRows(
		member: string,
		depth: number,
		visible: ReadonlySet<string>,
		bracketed: readonly DetectionOccurrence[],
		model: OutlineStepThreeModel,
	): void {
		const hidden = [...model.resultByFolder.keys()]
			.filter((folder) => !visible.has(folder) && isUnder(folder, member)
				&& nearestVisibleAncestor(folder, visible) === member)
			.sort(compareCodePoints);
		if (hidden.length === 0) return;

		const hasConflict = hidden.some((folder) => model.resultByFolder.get(folder)?.alternatives.length !== 0);
		const expanded = this.expandedPreviewMembers.has(member)
			|| (hasConflict && !this.collapsedPreviewMembers.has(member));

		const toggle = this.createRow('toggle', member, depth + 1);
		toggle.row.dataset.dtfOutlinePreviewToggle = member;
		toggle.name.createSpan({ cls: 'dtf-outline-muted', text: describeOutlinePreviewToggle(hidden.length) });
		const button = toggle.name.createEl('button', { cls: 'dtf-outline-fold' });
		button.setText(expanded ? 'Hide' : 'Show');
		button.setAttr('aria-expanded', String(expanded));
		button.addEventListener('click', () => {
			if (expanded) {
				this.expandedPreviewMembers.delete(member);
				this.collapsedPreviewMembers.add(member);
			} else {
				this.expandedPreviewMembers.add(member);
				this.collapsedPreviewMembers.delete(member);
			}
			this.render();
		});
		if (!expanded) return;

		const owner = bracketed.find((occurrence) =>
			member === occurrence.anchorPath || isUnder(member, occurrence.anchorPath)) ?? null;
		for (const folder of hidden) {
			const parts = this.createRow('preview', folder, renderDepth(folder));
			parts.row.dataset.dtfOutlinePreviewFolder = folder;
			parts.row.setAttr('role', 'treeitem');
			parts.row.setAttr('aria-level', String(renderDepth(folder) + 2));
			parts.name.createSpan({ cls: 'dtf-outline-folder-name', text: folderDisplayName(folder) });
			this.renderResultCell(parts, folder, renderDepth(folder), model);
			if (owner) this.lastCoveredRowByAnchor.set(owner.anchorPath, parts.row);
		}
	}

	// ─── Brackets ──────────────────────────────────────────────────────────

	private finalizeBrackets(groups: readonly OutlineGroupOf[]): void {
		for (const group of groups) {
			const anchorEl = this.rowRecords.find((record) =>
				record.kind === 'folder' && record.el.dataset.dtfOutlineAnchor === group.anchorPath)?.el;
			if (!anchorEl) continue;
			const hue = anchorEl.dataset.dtfOutlineHue as OutlineHue | undefined;
			this.bracketRequests.push({
				anchorPath: group.anchorPath,
				// A sub-row (fold word, tag root) sits between the anchor and its
				// members, so the lane starts below whichever came last.
				anchorEl: this.lastSubRowByAnchor.get(group.anchorPath) ?? anchorEl,
				lastRowEl: this.lastCoveredRowByAnchor.get(group.anchorPath) ?? null,
				depth: renderDepth(group.anchorPath),
				dashed: group.occurrences.every((occurrence) => occurrence.status !== 'actionable'),
				hue: hue ?? null,
			});
		}
	}

	/** Bars are absolutely positioned from measured rows after layout. */
	private positionBrackets(): void {
		const layer = this.bracketLayerEl;
		if (!layer || !layer.isConnected) return;
		layer.empty();
		for (const request of this.bracketRequests) {
			if (request.lastRowEl === null) continue;
			const top = request.anchorEl.offsetTop + request.anchorEl.offsetHeight - 2;
			const bottom = request.lastRowEl.offsetTop + request.lastRowEl.offsetHeight - 4;
			if (bottom <= top) continue;
			const bar = layer.createDiv({ cls: 'dtf-outline-bracket' });
			bar.dataset.dtfOutlineBracket = request.anchorPath;
			bar.style.top = `${top}px`;
			bar.style.height = `${bottom - top}px`;
			const indent = Number.parseFloat(getComputedStyle(this.container).getPropertyValue('--dtf-outline-indent')) || OUTLINE_INDENT;
			bar.style.left = `${Math.max(0, request.depth + 3) * indent - indent / 2 - 1}px`;
			if (request.hue) bar.addClass('is-coloured', `is-hue-${request.hue}`);
			if (request.dashed) bar.addClass('is-dashed');
		}
	}

	// ─── Focus / layout ────────────────────────────────────────────────────

	private nextControlId(prefix: string): string {
		this.controlId++;
		return `dtf-outline-${prefix}-${this.controlId}`;
	}

	private applyRovingTabindex(): void {
		const focusable = this.rowRecords.filter((record) =>
			record.kind === 'folder' || record.kind === 'preview');
		for (const [index, record] of focusable.entries()) {
			record.el.tabIndex = index === 0 ? 0 : -1;
			record.el.addEventListener('focus', () => {
				for (const other of focusable) other.el.tabIndex = other === record ? 0 : -1;
			});
			record.el.addEventListener('keydown', (event) => {
				if (event.target !== record.el) return;
				if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
				event.preventDefault();
				const target = event.key === 'Home'
					? 0
					: event.key === 'End'
						? focusable.length - 1
						: Math.max(0, Math.min(
							focusable.length - 1,
							index + (event.key === 'ArrowDown' ? 1 : -1),
						));
				focusable[target]?.el.focus();
			});
		}
	}

	private observeWidth(): void {
		this.widthObserver = new ResizeObserver(() => {
			this.applyWidthClass();
			this.positionBrackets();
		});
		this.widthObserver.observe(this.container);
	}

	private applyWidthClass(): void {
		const narrow = this.container.clientWidth > 0
			&& this.container.clientWidth <= OUTLINE_NARROW_WIDTH;
		this.container.toggleClass('is-outline-narrow', narrow);
		this.container.dataset.dtfOutlineLayout = narrow ? 'stacked' : 'inline';
	}
}

// ─── Local helpers ─────────────────────────────────────────────────────────

function roleByPath(occurrence: DetectionOccurrence): Map<string, string> {
	const roles = new Map<string, string>();
	for (const evidence of occurrence.evidence) {
		if (evidence.relation !== 'member') continue;
		if (roles.has(evidence.folderPath)) continue;
		roles.set(evidence.folderPath, titleCaseRole(evidence.role));
	}
	return roles;
}

function matchLike(match: RuleMatch): { group?: string; confidence: number; priority: number } {
	const rule: MappingRule = match.rule;
	return { group: rule.group, confidence: match.confidence, priority: rule.priority };
}

function groupChildren(paths: readonly string[]): Map<string, string[]> {
	const byParent = new Map<string, string[]>();
	for (const path of paths) {
		const parent = parentOf(path);
		const bucket = byParent.get(parent);
		if (bucket) bucket.push(path);
		else byParent.set(parent, [path]);
	}
	return byParent;
}

function nearestVisibleAncestor(path: string, visible: ReadonlySet<string>): string | null {
	let cursor = parentOf(path);
	while (cursor !== '') {
		if (visible.has(cursor)) return cursor;
		cursor = parentOf(cursor);
	}
	return visible.has('') ? '' : null;
}

function parentOf(path: string): string {
	const index = path.lastIndexOf('/');
	return index === -1 ? '' : path.slice(0, index);
}

function isFormControl(target: EventTarget | null): boolean {
	return target instanceof HTMLInputElement || target instanceof HTMLLabelElement;
}

function isUnder(path: string, parent: string): boolean {
	if (parent === '') return path !== '';
	return path.startsWith(`${parent}/`);
}

function renderDepth(path: string): number {
	return path === '' ? -1 : path.split('/').length - 1;
}

function describeRuleOutcome(outcome: OutlineRuleOutcome): string {
	switch (outcome.state) {
		case 'no-match': return 'No forward rule matches';
		case 'empty': return `${outcome.ruleName ?? 'Matched rule'} produces no tag`;
		case 'invalid': return `${outcome.ruleName ?? 'Matched rule'} produces invalid output`;
		case 'valid': return outcome.tags.join(', ');
	}
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== '') return error.message;
	if (typeof error === 'string' && error.trim() !== '') return error;
	return 'Unknown error';
}

function cloneScope(scope: WorkbenchScopeState): WorkbenchScopeState {
	return {
		selectedPaths: [...scope.selectedPaths],
		signalFilter: scope.signalFilter ? { ...scope.signalFilter } : null,
	};
}

function normalizedStringKey(values: Iterable<string>): string {
	return JSON.stringify([...values].sort(compareCodePoints));
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
