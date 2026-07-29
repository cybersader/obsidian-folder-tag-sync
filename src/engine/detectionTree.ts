/**
 * detectionTree — given a vault's folder list and a DetectionResult, build
 * a sparse tree of hit folders + their ancestors so the UI can show
 * *where* in the vault structure each detection signal fired.
 *
 * Design goals (from user feedback "the scan doesn't really give you an
 * idea of where it's detecting things; if you just show a list, that's
 * not super helpful — show a truncated version of the file tree"):
 *
 *  1. Show every folder that matched at least one signal, plus every
 *     ancestor folder back to root (so the hit's location is visible).
 *  2. Elide subtrees with no hits as "(N nested folders, no matches)" so
 *     the tree stays compact even on huge vaults.
 *  3. Annotate each hit folder with which signal(s) matched it, so the
 *     UI can colour-code by signal.
 *  4. Re-evaluate signals against ALL vault folders (not the 3-example
 *     cap that DetectionResult carries) — the cap is for the summary
 *     card; the tree wants completeness.
 *
 * Pure — no Obsidian, no I/O. Caller passes folder paths + the result.
 *
 * The matcher reuses the same emoji/JD-prefix normalization rules as
 * detectPacks.ts so a folder that detected as a hit there will detect
 * as a hit here too. Both files share the `matchesNormalized` helper
 * from `./folderNormalize`.
 */

import {
	detectionOccurrenceKey,
	isSurfacedDetection,
	type DetectionEvidenceRelation,
	type DetectionOccurrence,
	type DetectionOccurrenceEvidence,
	type DetectionOccurrenceStatus,
	type DetectionResult,
	type DetectionSignalResult,
} from './detectPacks';
import { matchesNormalized } from './folderNormalize';

// ─── Cross-pack hierarchy view types ──────────────────────────────────
//
// The pack-centric model ("here's pack X, here's pack Y") doesn't match
// how users actually think when they look at their vault. They see a
// folder tree and want to know: "what patterns fired here?" — they
// don't care which plugin pack contributed the signal. The UI surfaces
// signals as the primary unit; pack identity is metadata used at apply
// time to figure out which rule sets to load.

export interface AnnotatedSignal {
	/** Source pack — used at apply time to load the right rule set. */
	packId: string;
	packName: string;
	/** Stable signal-definition identity inside the pack. */
	signalId?: string;
	/** Position of this signal inside its pack's detection.anyOf list. */
	signalIndex: number;
	/** Globally unique index across all detected packs. Drives the colour
	 * scheme so every signal has a stable hue regardless of pack ordering. */
	globalIndex: number;
	label: string;
	regex: string;
	scope: 'name' | 'path' | 'leafName';
	role?: string;
	relation?: DetectionEvidenceRelation;
}

export interface AnnotatedHit {
	folderPath: string;
	signal: AnnotatedSignal;
	/** Occurrence identity is present for attached native evidence and legacy adapters. */
	occurrenceKey?: string;
	occurrenceAnchorPath?: string;
	occurrenceStatus?: DetectionOccurrenceStatus;
	/** Member evidence establishes/scores an occurrence; support only explains it. */
	relation?: DetectionEvidenceRelation;
}

export interface CrossPackHitMap {
	/** Legacy alias for actionableSignals. */
	allSignals: AnnotatedSignal[];
	/** Legacy alias for actionableHitsByPath. */
	hitsByPath: Map<string, AnnotatedHit[]>;
	/** Every signal definition with any raw evidence, including diagnostic-only evidence. */
	allEvidenceSignals: AnnotatedSignal[];
	/** Signal definitions represented by actionable occurrences only. */
	actionableSignals: AnnotatedSignal[];
	/** All raw evidence, including incomplete, suppressed, and unattached support evidence. */
	allEvidenceHitsByPath: Map<string, AnnotatedHit[]>;
	/** Evidence attached to actionable occurrences only. */
	actionableHitsByPath: Map<string, AnnotatedHit[]>;
}

export interface AnnotatedTreeNode {
	name: string;
	fullPath: string;
	children: Map<string, AnnotatedTreeNode>;
	hits: AnnotatedHit[];
	elidedChildCount: number;
}

export interface AnnotatedTree {
	root: AnnotatedTreeNode;
	totalHitFolders: number;
	totalVaultFolders: number;
}

export interface DetectionHit {
	/** Signal that matched this folder. */
	signalLabel: string;
	signalRegex: string;
	scope: 'name' | 'path' | 'leafName';
	/** Stable index across the pack's detection.anyOf definitions when native. */
	signalIndex: number;
	signalId?: string;
	role?: string;
	relation?: DetectionEvidenceRelation;
}

export interface DetectionTreeNode {
	/** Last path segment ("Projects"). For the synthetic root, empty string. */
	name: string;
	/** Slash-separated path back to the vault root ("Areas/Health"). */
	fullPath: string;
	/** Children kept in tree (only those with hits in their subtree). */
	children: Map<string, DetectionTreeNode>;
	/** Signals that matched THIS folder directly. Empty for ancestor-only nodes. */
	hits: DetectionHit[];
	/** Count of children that were elided because their subtree had no hits.
	 * Rendered as "(N other folders, no matches)" affordance. */
	elidedChildCount: number;
}

export interface DetectionTree {
	root: DetectionTreeNode;
	/** Folders that matched ≥1 signal. Used for the "10 hits across 4 folders" header. */
	totalHitFolders: number;
	/** Total number of folders walked (the vault folder count). */
	totalVaultFolders: number;
}

// ─── Normalization (shared) ─────────────────────────────────────────────
// stripEmojiOnly / stripJDPrefix / stripEmojiAndJD / matchesNormalized now
// live in `./folderNormalize` and are imported above — same source of truth
// detectPacks.ts uses, so a folder that detects as a hit there detects here.

function leafOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx === -1 ? path : path.slice(idx + 1);
}

function parentOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx === -1 ? '' : path.slice(0, idx);
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}

// ─── Tree construction ─────────────────────────────────────────────────

/**
 * Re-evaluate every signal in `result` against every vault folder, returning
 * a map from folder path to the list of signals that matched it. The summary
 * `DetectionResult.matchedSignals[].exampleMatches` is capped at 3, so we
 * can't reuse it directly — we need full match coverage for the tree.
 *
 * Exported so `extractInstances` (and any future consumer that wants the raw
 * hit map) can call it without re-implementing the normalization logic.
 */
export function collectAllHits(
	folderPaths: string[],
	signals: DetectionSignalResult[],
): Map<string, DetectionHit[]> {
	const hitsByPath = new Map<string, DetectionHit[]>();

	for (let i = 0; i < signals.length; i++) {
		const sig = signals[i];
		let regex: RegExp;
		try {
			regex = new RegExp(sig.folderRegex, 'i');
		} catch {
			continue; // invalid regex shouldn't reach here, but be defensive
		}
		for (const path of folderPaths) {
			const target = sig.scope === 'path' ? path : leafOf(path);
			if (!matchesNormalized(regex, target)) continue;
			const existing = hitsByPath.get(path);
			const hit: DetectionHit = {
				signalLabel: sig.label ?? sig.folderRegex,
				signalRegex: sig.folderRegex,
				scope: sig.scope,
				signalIndex: i,
			};
			if (existing) existing.push(hit);
			else hitsByPath.set(path, [hit]);
		}
	}

	return hitsByPath;
}

/**
 * Build a sparse detection tree: every hit folder gets a node, every
 * ancestor of a hit folder gets a node (so the path from root is visible),
 * and everything else is elided into ancestor-level `elidedChildCount`
 * counters.
 *
 * The tree is sparse on purpose. A 5000-folder vault with 12 hits should
 * render as ~30 nodes (12 hits + their ancestors), not 5000. Users who
 * want to see the dim full context can expand individual elision badges
 * in the UI.
 */
export function buildDetectionTree(
	folderPaths: string[],
	result: DetectionResult,
): DetectionTree {
	const hitsByPath = collectAllHits(folderPaths, result.matchedSignals);

	// Index every folder by path so we can look up children quickly.
	const childrenByParent = new Map<string, string[]>();
	const allPathsSet = new Set(folderPaths);
	for (const path of folderPaths) {
		const idx = path.lastIndexOf('/');
		const parent = idx === -1 ? '' : path.slice(0, idx);
		if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
		childrenByParent.get(parent)!.push(path);
	}

	// First pass: mark every path that should appear in the tree (hits +
	// ancestors of hits). We walk up from each hit, adding ancestors.
	const keep = new Set<string>();
	for (const hitPath of hitsByPath.keys()) {
		let cursor: string | null = hitPath;
		while (cursor !== null && cursor !== '') {
			keep.add(cursor);
			const idx = cursor.lastIndexOf('/');
			cursor = idx === -1 ? null : cursor.slice(0, idx);
		}
	}

	// Second pass: build the tree. For each kept folder, create a node and
	// attach it to its parent. For each kept folder, count its non-kept
	// children as `elidedChildCount`.
	const root: DetectionTreeNode = {
		name: '',
		fullPath: '',
		children: new Map(),
		hits: [],
		elidedChildCount: 0,
	};
	const nodesByPath = new Map<string, DetectionTreeNode>();
	nodesByPath.set('', root);

	// Order kept paths shortest-first so parents always exist by the time
	// children attach. This is important because we walk the tree in path
	// order, not topological — the prefix-length sort gives us parent-first.
	const orderedKeep = [...keep].sort((a, b) => a.length - b.length);
	for (const path of orderedKeep) {
		const idx = path.lastIndexOf('/');
		const parentPath = idx === -1 ? '' : path.slice(0, idx);
		const name = idx === -1 ? path : path.slice(idx + 1);
		const parent = nodesByPath.get(parentPath) ?? root;
		const node: DetectionTreeNode = {
			name,
			fullPath: path,
			children: new Map(),
			hits: hitsByPath.get(path) ?? [],
			elidedChildCount: 0,
		};
		parent.children.set(name, node);
		nodesByPath.set(path, node);
	}

	// Third pass: count elided children. For every kept node, look at its
	// real children in the vault and count how many got dropped. Attach to
	// the kept node so the renderer can show "(N other folders)" badges.
	for (const [path, node] of nodesByPath) {
		const realChildren = childrenByParent.get(path) ?? [];
		for (const childPath of realChildren) {
			if (!keep.has(childPath)) node.elidedChildCount++;
		}
		// `allPathsSet` retained to make the suppress-unused linter happy and
		// to document that the validation step uses it.
		void allPathsSet;
	}

	return {
		root,
		totalHitFolders: hitsByPath.size,
		totalVaultFolders: folderPaths.length,
	};
}

/**
 * Generate a deterministic HSL colour for a signal index. Golden-angle hue
 * rotation gives well-spaced colours for any number of signals (PARA's 4
 * signals will all be visually distinct, and so will SEACOW's 6+).
 */
export function colorForSignalIndex(index: number): string {
	const hue = (index * 137.508) % 360; // golden angle
	return `hsl(${hue.toFixed(0)}, 65%, 55%)`;
}

// ─── Anchored instance extraction ─────────────────────────────────────
//
// A user's vault can have the SAME organizational pattern applied at
// multiple levels — e.g. JD numbering at the root AND nested inside an
// entity-scoped subfolder (`📁 01 - Projects/Cybersader/01 - Active`).
// Without anchored-instance grouping the UI shows "JD detected" with a
// single tree of scattered hits, and the user can't tell whether that's
// "one big match" or "N independent applications of the same pattern."
//
// An instance is a cluster of hit folders that share a common parent.
// The parent is the instance's anchor. Multiple instances of the same
// pack reveal the recurrence: "JD at root, JD again under
// 01-Projects/Cybersader/" — exactly the case nested SEACOW + JD users
// hit.
//
// When one instance's anchor is a descendant of another's, the second
// is "nested" inside the first — the renderer uses this to draw a
// nested list, making the recurrence visually obvious without a wall
// of explanatory text.

export interface InstanceHit {
	folderPath: string;
	signals: DetectionHit[];
}

export interface DetectionInstance {
	/** Stable native occurrence identity; synthesized for legacy results. */
	occurrenceKey: string;
	/** Common parent of this instance's hit folders. Empty string for vault root. */
	anchorPath: string;
	/** Native occurrence status; legacy extraction preserves its historical actionable assumption. */
	status: DetectionOccurrenceStatus;
	/** Hit folders sitting directly under this anchor. */
	hits: InstanceHit[];
	/** Distinct signal indices represented in this instance. Used for stats. */
	signalIndices: number[];
}

export interface DetectionInstanceTreeNode {
	instance: DetectionInstance;
	/** Other instances whose anchor is a descendant of this instance's anchor. */
	children: DetectionInstanceTreeNode[];
}

/**
 * Group a pack's detection hits into anchored instances. Each instance is
 * one cluster of sibling hits — i.e. hits that share a parent folder. A
 * pack that fires at two depths (JD at root + JD nested inside a subfolder)
 * yields two instances; the UI renders both with their anchors so the user
 * sees "2 instances of JD: at root, at Projects/Cybersader/".
 *
 * Instances are returned sorted by anchor depth ascending (root first), then
 * lexicographically. The renderer walks the list and infers nesting from
 * anchor-prefix relationships.
 */
export function extractInstances(
	folderPaths: string[],
	result: DetectionResult,
): DetectionInstance[] {
	if (result.occurrences !== undefined) {
		return result.occurrences.map((occurrence) => detectionInstanceFromOccurrence(occurrence));
	}

	const hitsByPath = collectAllHits(folderPaths, result.matchedSignals);
	const instancesByAnchor = new Map<string, DetectionInstance>();

	for (const [path, signals] of hitsByPath) {
		const idx = path.lastIndexOf('/');
		const anchor = idx === -1 ? '' : path.slice(0, idx);
		if (!instancesByAnchor.has(anchor)) {
			instancesByAnchor.set(anchor, {
				occurrenceKey: detectionOccurrenceKey(result.packId, anchor),
				anchorPath: anchor,
				status: 'actionable',
				hits: [],
				signalIndices: [],
			});
		}
		const inst = instancesByAnchor.get(anchor)!;
		inst.hits.push({ folderPath: path, signals });
		for (const s of signals) {
			if (!inst.signalIndices.includes(s.signalIndex)) inst.signalIndices.push(s.signalIndex);
		}
	}

	// Sort hits within each instance by name for stable display
	for (const inst of instancesByAnchor.values()) {
		inst.hits.sort((a, b) => a.folderPath.localeCompare(b.folderPath));
	}

	return [...instancesByAnchor.values()].sort(compareDetectionInstances);
}

function detectionInstanceFromOccurrence(occurrence: DetectionOccurrence): DetectionInstance {
	const hitsByPath = new Map<string, DetectionHit[]>();
	for (const evidence of occurrence.evidence) {
		const hit: DetectionHit = {
			signalLabel: evidence.label ?? evidence.folderRegex,
			signalRegex: evidence.folderRegex,
			scope: evidence.scope,
			signalIndex: evidence.signalIndex,
			signalId: evidence.signalId,
			role: evidence.role,
			relation: evidence.relation,
		};
		const existing = hitsByPath.get(evidence.folderPath);
		if (existing) existing.push(hit);
		else hitsByPath.set(evidence.folderPath, [hit]);
	}

	return {
		occurrenceKey: occurrence.key,
		anchorPath: occurrence.anchorPath,
		status: occurrence.status,
		hits: [...hitsByPath.entries()]
			.map(([folderPath, signals]) => ({ folderPath, signals }))
			.sort((a, b) => compareCodePoints(a.folderPath, b.folderPath)),
		signalIndices: [...new Set(occurrence.evidence.map((evidence) => evidence.signalIndex))]
			.sort((a, b) => a - b),
	};
}

function compareDetectionInstances(a: DetectionInstance, b: DetectionInstance): number {
	const da = a.anchorPath ? a.anchorPath.split('/').length : 0;
	const db = b.anchorPath ? b.anchorPath.split('/').length : 0;
	if (da !== db) return da - db;
	return compareCodePoints(a.anchorPath, b.anchorPath);
}

/**
 * Convert a flat instance list into a nested tree structure where each
 * instance's children are other instances whose anchor lives under its
 * anchor. The root of the returned forest is the list of "outermost"
 * instances — those with no parent instance. The UI renders this forest
 * as an indented list so the recurrence ("JD at root, with another JD
 * nested inside") shows up structurally, not via text.
 *
 * Anchoring rule: instance B is nested inside instance A iff A's
 * anchorPath is a proper prefix of B's anchorPath (with a `/` separator,
 * or A's anchor is empty meaning vault root). Each B picks its closest
 * ancestor instance as parent.
 */
export function buildInstanceTree(instances: DetectionInstance[]): DetectionInstanceTreeNode[] {
	// Build nodes preserving input order (already root-first).
	const nodes: DetectionInstanceTreeNode[] = instances.map((i) => ({
		instance: i,
		children: [],
	}));
	const roots: DetectionInstanceTreeNode[] = [];
	for (let i = 0; i < nodes.length; i++) {
		const me = nodes[i];
		// Find the closest (deepest-anchor) other instance whose anchor is a
		// proper prefix of mine. That's my parent in the instance tree.
		let parent: DetectionInstanceTreeNode | null = null;
		let parentDepth = -1;
		for (let j = 0; j < nodes.length; j++) {
			if (i === j) continue;
			const candidate = nodes[j];
			if (!isAnchorPrefix(candidate.instance.anchorPath, me.instance.anchorPath)) continue;
			const cd = candidate.instance.anchorPath ? candidate.instance.anchorPath.split('/').length : 0;
			if (cd > parentDepth) {
				parent = candidate;
				parentDepth = cd;
			}
		}
		if (parent) parent.children.push(me);
		else roots.push(me);
	}
	return roots;
}

/**
 * True if `prefix` is a proper anchor-prefix of `target`. Root anchor (empty
 * string) is a prefix of every non-empty anchor. Otherwise prefix must end
 * exactly at a path-segment boundary (so `Project` is not a prefix of
 * `Projects/Web` — we want strict segment alignment).
 */
function isAnchorPrefix(prefix: string, target: string): boolean {
	if (prefix === target) return false;
	if (prefix === '') return target !== '';
	return target.startsWith(prefix + '/');
}

// ─── Cross-pack hit aggregation ───────────────────────────────────────
//
// Take every detected pack's signals and merge them into one map keyed
// by folder path. Each folder's annotation list shows every (pack,
// signal) that fired for it — this is what the hierarchy-first view
// renders as folder-row chips, with packs invisible to the user.

/**
 * Collect occurrence-native evidence from every detection result.
 *
 * `allEvidenceHitsByPath` is diagnostic and deliberately retains incomplete,
 * suppressed, and unattached support evidence. `actionableHitsByPath` is the
 * action boundary consumed by Scope/Map: it contains only evidence attached to
 * actionable occurrences. `hitsByPath` and `allSignals` remain legacy aliases
 * for the actionable-only view.
 *
 * Hand-built results without occurrence data keep the previous re-evaluation
 * behavior through a synthesized occurrence adapter.
 */
export function collectCrossPackHits(
	folderPaths: string[],
	results: DetectionResult[],
	packNamesById: Map<string, string>,
): CrossPackHitMap {
	const allEvidenceHitsByPath = new Map<string, AnnotatedHit[]>();
	const actionableHitsByPath = new Map<string, AnnotatedHit[]>();
	const signalsByIdentity = new Map<string, AnnotatedSignal>();
	const actionableSignalIdentities = new Set<string>();
	let globalIndex = 0;

	const ensureSignal = (
		result: DetectionResult,
		evidence: DetectionOccurrenceEvidence,
		packName: string,
	): AnnotatedSignal => {
		const identity = annotatedSignalIdentity(result.packId, evidence.signalId);
		let signal = signalsByIdentity.get(identity);
		if (!signal) {
			signal = {
				packId: result.packId,
				packName,
				signalId: evidence.signalId,
				signalIndex: evidence.signalIndex,
				globalIndex: globalIndex++,
				label: evidence.label ?? evidence.folderRegex,
				regex: evidence.folderRegex,
				scope: evidence.scope,
				role: evidence.role,
				relation: evidence.relation,
			};
			signalsByIdentity.set(identity, signal);
		}
		return signal;
	};

	for (const result of results) {
		if (result.occurrences !== undefined) {
			const occurrenceByEvidence = indexOccurrenceEvidence(result.occurrences);
			const nativeEvidence = result.rawEvidence
				?? uniqueOccurrenceEvidence(result.occurrences);
			const fallbackPackName = result.occurrences[0]?.packName
				?? packNamesById.get(result.packId)
				?? result.packId;

			for (const evidence of nativeEvidence) {
				const occurrence = occurrenceByEvidence.get(nativeEvidenceIdentity(evidence));
				const signal = ensureSignal(result, evidence, fallbackPackName);
				appendAnnotatedHit(allEvidenceHitsByPath, {
					folderPath: evidence.folderPath,
					signal,
					occurrenceKey: occurrence?.key,
					occurrenceAnchorPath: occurrence?.anchorPath,
					occurrenceStatus: occurrence?.status,
					relation: evidence.relation,
				});
			}

			for (const occurrence of result.occurrences) {
				if (occurrence.status !== 'actionable') continue;
				for (const evidence of occurrence.evidence) {
					const signal = ensureSignal(result, evidence, occurrence.packName);
					actionableSignalIdentities.add(
						annotatedSignalIdentity(result.packId, evidence.signalId),
					);
					appendAnnotatedHit(actionableHitsByPath, {
						folderPath: evidence.folderPath,
						signal,
						occurrenceKey: occurrence.key,
						occurrenceAnchorPath: occurrence.anchorPath,
						occurrenceStatus: occurrence.status,
						relation: evidence.relation,
					});
				}
			}
			continue;
		}

		collectLegacyCrossPackHits(
			folderPaths,
			result,
			packNamesById.get(result.packId) ?? result.packId,
			allEvidenceHitsByPath,
			actionableHitsByPath,
			signalsByIdentity,
			actionableSignalIdentities,
			() => globalIndex++,
		);
	}

	const allEvidenceSignals = [...signalsByIdentity.values()];
	const actionableSignals = allEvidenceSignals.filter((signal) =>
		actionableSignalIdentities.has(
			annotatedSignalIdentity(signal.packId, signal.signalId ?? `legacy:${signal.signalIndex}`),
		),
	);

	return {
		allSignals: actionableSignals,
		hitsByPath: actionableHitsByPath,
		allEvidenceSignals,
		actionableSignals,
		allEvidenceHitsByPath,
		actionableHitsByPath,
	};
}

function collectLegacyCrossPackHits(
	folderPaths: string[],
	result: DetectionResult,
	packName: string,
	allEvidenceHitsByPath: Map<string, AnnotatedHit[]>,
	actionableHitsByPath: Map<string, AnnotatedHit[]>,
	signalsByIdentity: Map<string, AnnotatedSignal>,
	actionableSignalIdentities: Set<string>,
	nextGlobalIndex: () => number,
): void {
	const actionable = isSurfacedDetection(result);
	const status: DetectionOccurrenceStatus = actionable
		? 'actionable'
		: result.suppressedByMissingParent
			? 'suppressed'
			: 'incomplete';
	const annotatedForPack: AnnotatedSignal[] = result.matchedSignals.map((signal, signalIndex) => {
		const signalId = `legacy:${signalIndex}`;
		const identity = annotatedSignalIdentity(result.packId, signalId);
		const annotated: AnnotatedSignal = {
			packId: result.packId,
			packName,
			signalId,
			signalIndex,
			globalIndex: nextGlobalIndex(),
			label: signal.label ?? signal.folderRegex,
			regex: signal.folderRegex,
			scope: signal.scope,
			role: signal.role ?? signalId,
			relation: signal.relation ?? 'member',
		};
		signalsByIdentity.set(identity, annotated);
		if (actionable) actionableSignalIdentities.add(identity);
		return annotated;
	});

	for (const [folderPath, hits] of collectAllHits(folderPaths, result.matchedSignals)) {
		const anchorPath = parentOf(folderPath);
		const occurrenceKey = detectionOccurrenceKey(result.packId, anchorPath);
		for (const hit of hits) {
			const signal = annotatedForPack[hit.signalIndex];
			const annotatedHit: AnnotatedHit = {
				folderPath,
				signal,
				occurrenceKey,
				occurrenceAnchorPath: anchorPath,
				occurrenceStatus: status,
				relation: signal.relation ?? 'member',
			};
			appendAnnotatedHit(allEvidenceHitsByPath, annotatedHit);
			if (actionable) appendAnnotatedHit(actionableHitsByPath, annotatedHit);
		}
	}
}

function indexOccurrenceEvidence(
	occurrences: DetectionOccurrence[],
): Map<string, DetectionOccurrence> {
	const indexed = new Map<string, DetectionOccurrence>();
	for (const occurrence of occurrences) {
		for (const evidence of occurrence.evidence) {
			indexed.set(nativeEvidenceIdentity(evidence), occurrence);
		}
	}
	return indexed;
}

function uniqueOccurrenceEvidence(
	occurrences: DetectionOccurrence[],
): DetectionOccurrenceEvidence[] {
	const evidenceByIdentity = new Map<string, DetectionOccurrenceEvidence>();
	for (const occurrence of occurrences) {
		for (const evidence of occurrence.evidence) {
			evidenceByIdentity.set(nativeEvidenceIdentity(evidence), evidence);
		}
	}
	return [...evidenceByIdentity.values()];
}

function annotatedSignalIdentity(packId: string, signalId: string): string {
	return `${packId.length}:${packId}:${signalId.length}:${signalId}`;
}

function nativeEvidenceIdentity(evidence: DetectionOccurrenceEvidence): string {
	return `${evidence.signalId.length}:${evidence.signalId}:${evidence.folderPath}`;
}

function appendAnnotatedHit(
	hitsByPath: Map<string, AnnotatedHit[]>,
	hit: AnnotatedHit,
): void {
	const existing = hitsByPath.get(hit.folderPath);
	if (existing) existing.push(hit);
	else hitsByPath.set(hit.folderPath, [hit]);
}

/**
 * Build a sparse vault tree from a cross-pack hit map. Same shape as
 * `buildDetectionTree` but each node carries `AnnotatedHit[]` so the
 * renderer can show per-folder pack/signal chips, not single-pack data.
 *
 * The walking algorithm is the same: keep hit folders + ancestors, count
 * elided children at each kept node.
 */
export function buildAnnotatedTree(
	folderPaths: string[],
	hitMap: CrossPackHitMap,
): AnnotatedTree {
	const childrenByParent = new Map<string, string[]>();
	for (const path of folderPaths) {
		const idx = path.lastIndexOf('/');
		const parent = idx === -1 ? '' : path.slice(0, idx);
		if (!childrenByParent.has(parent)) childrenByParent.set(parent, []);
		childrenByParent.get(parent)!.push(path);
	}

	const keep = new Set<string>();
	for (const hitPath of hitMap.hitsByPath.keys()) {
		let cursor: string | null = hitPath;
		while (cursor !== null && cursor !== '') {
			keep.add(cursor);
			const idx = cursor.lastIndexOf('/');
			cursor = idx === -1 ? null : cursor.slice(0, idx);
		}
	}

	const root: AnnotatedTreeNode = {
		name: '',
		fullPath: '',
		children: new Map(),
		hits: [],
		elidedChildCount: 0,
	};
	const nodesByPath = new Map<string, AnnotatedTreeNode>();
	nodesByPath.set('', root);

	const ordered = [...keep].sort((a, b) => a.length - b.length);
	for (const path of ordered) {
		const idx = path.lastIndexOf('/');
		const parentPath = idx === -1 ? '' : path.slice(0, idx);
		const name = idx === -1 ? path : path.slice(idx + 1);
		const parent = nodesByPath.get(parentPath) ?? root;
		const node: AnnotatedTreeNode = {
			name,
			fullPath: path,
			children: new Map(),
			hits: hitMap.hitsByPath.get(path) ?? [],
			elidedChildCount: 0,
		};
		parent.children.set(name, node);
		nodesByPath.set(path, node);
	}

	for (const [path, node] of nodesByPath) {
		const realChildren = childrenByParent.get(path) ?? [];
		for (const childPath of realChildren) {
			if (!keep.has(childPath)) node.elidedChildCount++;
		}
	}

	return {
		root,
		totalHitFolders: hitMap.hitsByPath.size,
		totalVaultFolders: folderPaths.length,
	};
}

/** All folders (full paths) under `node` in the annotated tree. */
export function collectAnnotatedTreeFolders(node: AnnotatedTreeNode): string[] {
	const out: string[] = [];
	if (node.fullPath !== '') out.push(node.fullPath);
	for (const child of node.children.values()) {
		out.push(...collectAnnotatedTreeFolders(child));
	}
	return out;
}
