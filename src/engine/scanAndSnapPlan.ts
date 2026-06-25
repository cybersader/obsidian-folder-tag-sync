/**
 * scanAndSnapPlan — the PURE planner behind the "Scan & Snap" rule-authoring
 * builder (Phase 1a). Given the org-system packs a vault already appears to
 * use (from `detectPacks`) plus the vault's folder list, it produces a flat
 * list of *candidate rule rows* the user can review, triage, and (later)
 * commit — without writing any rule regex by hand.
 *
 * The mental model: detection tells us "this vault uses JD at root and PARA
 * under Work/." Each such (pack, anchored-instance) pairing wants that pack's
 * rules *scoped to that branch* (via `scopeRules`). One produced scoped rule =
 * one `CandidateRow`. The planner then annotates every candidate with what it
 * would actually do against the real vault:
 *
 *   - coverage    — how many folders it touches + a few folder→tag samples
 *                   (delegates to `previewRule`, never throws)
 *   - bijectivity — a per-rule lossy/conditional/total verdict (or 'unknown')
 *   - conflict    — whether it overlaps ANY other rule, and crucially whether
 *                   that other rule is one ALREADY INSTALLED (the dangerous
 *                   case the user must see), plus the predicted runtime winner
 *                   at a sample overlapping folder.
 *
 * Why "conflict over the union" matters: `computeConflicts` only inspects the
 * array you hand it. If we passed candidates alone we'd be blind to overlaps
 * against the user's existing installed rules — exactly the collisions that
 * break a working vault. So conflicts are computed over
 * `[...allCandidateRules, ...existingRules]`, and each conflicting rule is
 * tagged by source so we can distinguish candidate-vs-candidate (benign, you
 * haven't committed yet) from candidate-vs-EXISTING (dangerous).
 *
 * Why "predicted winner" matters: a raw overlap count over-reports. Two rules
 * matching the same folder is fine if the runtime deterministically resolves
 * which one wins (group → confidence → priority). We run `findBestMatch` over
 * the union at a sample overlapping folder and record the winning rule id, so
 * the UI can say "rule X wins here" instead of just flashing a red badge.
 *
 * Pure — no Obsidian, no I/O, no Date.now / Math.random. Fully deterministic.
 */

import type { MappingRule } from '../types/settings';
import type { DetectionResult } from './detectPacks';
import { extractInstances } from './detectionTree';
import { scopeRules } from './scopeRules';
import { previewRule } from './rulePreview';
import { computeConflicts } from './ruleCoverage';
import { findBestMatch } from './ruleMatcher';
import { deriveBijective } from './derive';
import { computeBijectivity } from './compileTemplate';

// ─── Public types ──────────────────────────────────────────────────────────

export type BijectivityVerdict = 'total' | 'conditional' | 'lossy' | 'unknown';

export interface CandidateCoverage {
	/** How many vault folders this candidate's pattern matches (from previewRule). */
	matchCount: number;
	/** A few illustrative folder→tag(s) emissions (capped, sorted). */
	sampleEmissions: Array<{ folder: string; tags: string[] }>;
}

export interface CandidateConflict {
	/** Does this candidate overlap ANY other rule (candidate OR existing) on ≥1 folder? */
	conflicts: boolean;
	/**
	 * Does this candidate overlap an ALREADY-INSTALLED rule? This is the
	 * dangerous case — committing the candidate would create a genuine
	 * collision against the user's working vault, not just against another
	 * (uncommitted) candidate.
	 */
	collidesWithExisting: boolean;
	/** Up to a few folders where this candidate overlaps some other rule. */
	overlappingFolderSample: string[];
	/**
	 * At a sample overlapping folder, which rule id actually wins per
	 * `findBestMatch` (group → confidence → priority) over the union of all
	 * candidate + existing rules. `null` when there is no overlap (or no
	 * winner could be resolved). Lets the UI say "rule X wins here" rather
	 * than just reporting a raw overlap.
	 */
	predictedWinnerId: string | null;
}

export interface CandidateRow {
	/** The scoped rule's id — also the row's stable identity. */
	id: string;
	/** The scoped rule itself — this is exactly what gets committed on accept. */
	rule: MappingRule;
	/** Pack this candidate descends from. */
	sourcePackId: string;
	/** Display name of the source pack (falls back to packId if not supplied). */
	sourcePackName: string;
	/** Anchor branch this candidate is scoped to. '' = vault root. */
	anchorPath: string;
	coverage: CandidateCoverage;
	bijectivity: BijectivityVerdict;
	conflict: CandidateConflict;
}

export interface ScanAndSnapSummary {
	/** Total candidate rows produced. */
	totalCandidates: number;
	/** Candidates whose pattern touches ≥1 vault folder. */
	touchingCandidates: number;
	/** Candidates that overlap ≥1 other rule (candidate or existing). */
	conflictingCandidates: number;
	/** Candidates that overlap an ALREADY-INSTALLED rule (the dangerous subset). */
	collidingWithExistingCandidates: number;
	/** Distinct source pack ids represented in the candidate set. */
	distinctSourcePacks: string[];
	/** Distinct source pack display names (parallel to distinctSourcePacks). */
	distinctSourceSystems: string[];
}

export interface ScanAndSnapPlan {
	candidates: CandidateRow[];
	summary: ScanAndSnapSummary;
}

export interface ScanAndSnapInput {
	/** Vault folder paths (relative, slash-separated, no leading slash). */
	folderPaths: string[];
	/** Detection results from `detectPacks()`. Suppressed packs are skipped. */
	detectionResults: DetectionResult[];
	/** Already-loaded pack rules keyed by pack id (caller parses the JSON). */
	packRulesById: Map<string, MappingRule[]>;
	/** Rules already installed in settings — the union-conflict baseline. */
	existingRules: MappingRule[];
	/** Pack id → display name. Optional; defaults to the id when missing. */
	packNamesById?: Map<string, string>;
	/** Group precedence for the runtime-winner prediction (settings field). */
	groupPrecedence?: string[];
}

// ─── Internal: tagging a rule by its provenance for union-conflict logic ────

type RuleSource = 'candidate' | 'existing';

interface SourcedRule {
	rule: MappingRule;
	source: RuleSource;
}

// ─── Main entry point ───────────────────────────────────────────────────────

/**
 * Build the Scan & Snap plan: candidate rule rows from detected packs, each
 * annotated with coverage, bijectivity, and union-aware conflict info.
 */
export function buildScanAndSnapPlan(input: ScanAndSnapInput): ScanAndSnapPlan {
	const {
		folderPaths,
		detectionResults,
		packRulesById,
		existingRules,
		packNamesById,
		groupPrecedence,
	} = input;

	// 1. Produce the scoped candidate rules — one CandidateRow scaffold per
	//    (non-suppressed pack, anchored instance, produced scoped rule).
	interface Scaffold {
		row: Omit<CandidateRow, 'coverage' | 'bijectivity' | 'conflict'>;
	}
	const scaffolds: Scaffold[] = [];

	for (const result of detectionResults) {
		if (result.suppressedByMissingParent) continue;
		const packRules = packRulesById.get(result.packId);
		if (!packRules || packRules.length === 0) continue;

		const packName = packNamesById?.get(result.packId) ?? result.packId;
		const instances = extractInstances(folderPaths, result);

		for (const instance of instances) {
			const scoped = scopeRules(packRules, instance.anchorPath);
			for (const rule of scoped) {
				scaffolds.push({
					row: {
						id: rule.id,
						rule,
						sourcePackId: result.packId,
						sourcePackName: packName,
						anchorPath: instance.anchorPath,
					},
				});
			}
		}
	}

	const candidateRules = scaffolds.map((s) => s.row.rule);

	// 2. Build the SOURCED union: candidate rules + existing rules, each tagged
	//    by provenance so conflict reporting can tell candidate-vs-candidate
	//    apart from candidate-vs-EXISTING. `computeConflicts` only sees what we
	//    pass it, so existing rules MUST be unioned in here.
	const sourcedById = new Map<string, RuleSource>();
	const unionRules: MappingRule[] = [];
	for (const r of candidateRules) {
		// First write wins — candidate rules keep their 'candidate' tag even if
		// (improbably) an existing rule shares the id.
		if (!sourcedById.has(r.id)) {
			sourcedById.set(r.id, 'candidate');
			unionRules.push(r);
		}
	}
	for (const r of existingRules) {
		if (!sourcedById.has(r.id)) {
			sourcedById.set(r.id, 'existing');
			unionRules.push(r);
		}
	}

	// 3. Compute conflicts over the UNION. computeConflicts returns, per folder,
	//    the ids of all enabled forward rules matching it (2+). Invert that into
	//    a per-rule map: ruleId → list of { folderPath, coMatchingRuleIds }.
	const conflictFolders = computeConflicts(unionRules, folderPaths);
	const overlapByRuleId = new Map<
		string,
		Array<{ folderPath: string; others: string[] }>
	>();
	for (const entry of conflictFolders) {
		for (const ruleId of entry.matchingRuleIds) {
			const others = entry.matchingRuleIds.filter((id) => id !== ruleId);
			const list = overlapByRuleId.get(ruleId);
			const record = { folderPath: entry.folderPath, others };
			if (list) list.push(record);
			else overlapByRuleId.set(ruleId, [record]);
		}
	}

	// 4. Finalize each candidate row.
	const candidates: CandidateRow[] = scaffolds.map(({ row }) => {
		const rule = row.rule;

		// Coverage — delegate to previewRule (never throws; invalidRegex/opaque
		// are surfaced via matchCount 0 + empty samples, which is the right
		// "no-op" representation for the planner).
		const preview = previewRule(rule, folderPaths);
		const coverage: CandidateCoverage = {
			matchCount: preview.matchCount,
			sampleEmissions: preview.samples.map((s) => ({ folder: s.folder, tags: s.tags })),
		};

		// Bijectivity — per-rule verdict, with graceful fallback to 'unknown'.
		const bijectivity = bijectivityVerdictFor(rule);

		// Conflict — union-aware. The overlap records for this rule's id tell us
		// every folder where it competes with another rule, and which rules.
		const overlaps = overlapByRuleId.get(rule.id) ?? [];
		const conflicts = overlaps.length > 0;

		let collidesWithExisting = false;
		const overlappingFolderSample: string[] = [];
		for (const o of overlaps) {
			if (overlappingFolderSample.length < CONFLICT_SAMPLE_CAP) {
				overlappingFolderSample.push(o.folderPath);
			}
			for (const otherId of o.others) {
				if (sourcedById.get(otherId) === 'existing') {
					collidesWithExisting = true;
				}
			}
		}

		// Predicted winner — at the first overlapping folder, run findBestMatch
		// over the union (forward direction) to name the rule the runtime would
		// actually pick. This collapses benign precedence-resolved overlaps.
		let predictedWinnerId: string | null = null;
		if (conflicts) {
			const sampleFolder = overlaps[0].folderPath;
			const best = findBestMatch(
				sampleFolder,
				unionRules,
				{ input: sampleFolder, matchType: 'folder' },
				groupPrecedence,
			);
			predictedWinnerId = best ? best.rule.id : null;
		}

		const conflict: CandidateConflict = {
			conflicts,
			collidesWithExisting,
			overlappingFolderSample,
			predictedWinnerId,
		};

		return {
			id: row.id,
			rule,
			sourcePackId: row.sourcePackId,
			sourcePackName: row.sourcePackName,
			anchorPath: row.anchorPath,
			coverage,
			bijectivity,
			conflict,
		};
	});

	return { candidates, summary: summarize(candidates) };
}

const CONFLICT_SAMPLE_CAP = 5;

// ─── Bijectivity verdict resolution ─────────────────────────────────────────

/**
 * Resolve a per-rule bijectivity verdict for a candidate. A candidate is a
 * plain MappingRule, which may carry any of three shapes of bijection info.
 * We try them in order of fidelity and fall back to 'unknown' rather than
 * throwing when nothing applies:
 *
 *   1. Path Lens templates (folderTemplate + tagTemplate) → computeBijectivity,
 *      which yields a 3-state Reversibility ('total' | 'conditional' | 'lossy')
 *      — the richest signal, so it wins when both templates are present.
 *   2. A typed `transfer` + `inverseTransfer` pair → deriveBijective (boolean),
 *      mapped to 'total' / 'lossy'.
 *   3. A precomputed `bijective: boolean` flag (set by deriveRule at pack-load)
 *      → 'total' / 'lossy'.
 *   4. Nothing usable → 'unknown'.
 *
 * Scoping (scopeRule) only prepends literal path text to folderTemplate and
 * leaves slot NAMES intact, so computeBijectivity's slot-overlap analysis is
 * unaffected by scoping.
 */
export function bijectivityVerdictFor(rule: MappingRule): BijectivityVerdict {
	// 1. Template-shaped rules — richest verdict.
	if (rule.folderTemplate && rule.tagTemplate) {
		try {
			return computeBijectivity(rule.folderTemplate, rule.tagTemplate).status;
		} catch {
			return 'unknown';
		}
	}

	// 2. Typed transfer pair.
	if (rule.transfer && rule.inverseTransfer) {
		try {
			return deriveBijective(rule.transfer, rule.inverseTransfer) ? 'total' : 'lossy';
		} catch {
			return 'unknown';
		}
	}

	// 3. Precomputed boolean flag.
	if (typeof rule.bijective === 'boolean') {
		return rule.bijective ? 'total' : 'lossy';
	}

	// 4. Nothing to go on.
	return 'unknown';
}

// ─── Summary ────────────────────────────────────────────────────────────────

function summarize(candidates: CandidateRow[]): ScanAndSnapSummary {
	let touching = 0;
	let conflicting = 0;
	let colliding = 0;
	const packIds: string[] = [];
	const packNames: string[] = [];
	const seenPackIds = new Set<string>();

	for (const c of candidates) {
		if (c.coverage.matchCount > 0) touching++;
		if (c.conflict.conflicts) conflicting++;
		if (c.conflict.collidesWithExisting) colliding++;
		if (!seenPackIds.has(c.sourcePackId)) {
			seenPackIds.add(c.sourcePackId);
			packIds.push(c.sourcePackId);
			packNames.push(c.sourcePackName);
		}
	}

	return {
		totalCandidates: candidates.length,
		touchingCandidates: touching,
		conflictingCandidates: conflicting,
		collidingWithExistingCandidates: colliding,
		distinctSourcePacks: packIds,
		distinctSourceSystems: packNames,
	};
}

// ─── Pure triage sort helpers (for the UI later) ────────────────────────────

/**
 * Order candidates "junk first": rows that touch no folders or emit nothing
 * surface at the top so the user can quickly cull dead rules. Among touching
 * rows, fewer matches sort earlier (lower-signal first). Ties break on id for
 * determinism. Returns a NEW array — does not mutate the input.
 */
export function sortCandidatesByNoise(candidates: CandidateRow[]): CandidateRow[] {
	return [...candidates].sort((a, b) => {
		const an = noiseScore(a);
		const bn = noiseScore(b);
		if (an !== bn) return an - bn; // lower score = noisier = earlier
		if (a.coverage.matchCount !== b.coverage.matchCount) {
			return a.coverage.matchCount - b.coverage.matchCount;
		}
		return a.id.localeCompare(b.id);
	});
}

/**
 * A small ordinal capturing "how junky" a candidate is. Lower = junkier (sorts
 * first). Zero-match rows are the junkiest; rows that match but emit no tags
 * are next; rows that emit tags are "real".
 */
function noiseScore(c: CandidateRow): number {
	if (c.coverage.matchCount === 0) return 0;
	const emitsAnything = c.coverage.sampleEmissions.some((e) => e.tags.length > 0);
	if (!emitsAnything) return 1;
	return 2;
}

/**
 * Cluster conflicting candidates together. Candidates that collide with an
 * EXISTING installed rule sort first (most urgent), then candidates that
 * conflict only with other candidates, then non-conflicting rows. Ties break
 * on id. Returns a NEW array — does not mutate the input.
 */
export function sortCandidatesByConflict(candidates: CandidateRow[]): CandidateRow[] {
	return [...candidates].sort((a, b) => {
		const ar = conflictRank(a);
		const br = conflictRank(b);
		if (ar !== br) return ar - br;
		return a.id.localeCompare(b.id);
	});
}

/**
 * Conflict urgency rank: 0 = collides with an installed rule (most urgent),
 * 1 = conflicts only with another candidate, 2 = no conflict. Lower sorts
 * first so conflicting rows cluster at the top.
 */
function conflictRank(c: CandidateRow): number {
	if (c.conflict.collidesWithExisting) return 0;
	if (c.conflict.conflicts) return 1;
	return 2;
}
