/**
 * detectPacks — given a vault's folder list and a manifest of available
 * starter packs, return ranked detection results saying which packs the
 * vault appears to already use.
 *
 * Pure. No Obsidian, no I/O. Caller passes in folder paths (relative to
 * vault root) and the parsed manifest entries.
 *
 * Library-science framing: each pack's `detection.anyOf` is a list of
 * signals that say "if you see one of these patterns, this pack probably
 * applies." A signal can match against a folder's name (`scope: 'name'`),
 * full path (`'path'`), or leaf-only name (`'leafName'` — useful for
 * detecting Johnny Decimal-style numbered folders at any depth).
 *
 * `scopedUnder` lets a pack require a parent pack to also match. PARA
 * scoped under SEACOW means "PARA folders inside Work/" — they only fire
 * when SEACOW outer is also detected.
 *
 * Composition: multiple packs can match a vault simultaneously when they
 * target different axes/entry-points. The result is a ranked list, not
 * single best.
 *
 * Exclusivity: callers (UI) consult `pack.exclusiveWith` to flag conflicts
 * AFTER detection — the engine itself doesn't filter exclusives, it just
 * reports what fires.
 */

export interface DetectionSignalResult {
	/** The signal definition that matched. */
	folderRegex: string;
	scope: 'name' | 'path' | 'leafName';
	label?: string;
	/** Vault folders that matched this signal (capped to first 3 for display). */
	exampleMatches: string[];
}

export interface DetectionResult {
	packId: string;
	/** Match strength: signalsHit / minSignals. ≥ 1.0 means the pack should surface. */
	score: number;
	signalsHit: number;
	minSignals: number;
	matchedSignals: DetectionSignalResult[];
	/** When pack is scopedUnder another, the parent's id. */
	scopedUnder?: string;
	/** When scopedUnder set but parent didn't match — pack is suppressed. */
	suppressedByMissingParent?: boolean;
}

// Manifest entry shape — minimal subset of what the manifest builder emits.
// Defined locally rather than importing from manifest.json's TS shape so the
// engine stays decoupled from the build artifact layout.
export interface ManifestPackEntry {
	id: string;
	name: string;
	axes?: string[];
	// JSON `null` is the absence-of-detection signal in the bundled manifest;
	// allow it so the imported JSON's static type checks.
	detection?: {
		anyOf: Array<{
			folderRegex: string;
			scope?: 'name' | 'path' | 'leafName';
			label?: string;
		}>;
		minSignals?: number;
		scopedUnder?: string | null;
	} | null;
}

const MAX_EXAMPLES = 3;

/**
 * Score every pack in `manifest` against the vault's `folderPaths`.
 * Returns results in descending score order. Packs that don't fire (zero
 * matched signals) are omitted.
 *
 * Folder paths should be relative-to-vault, slash-separated, no leading
 * slash. Both folders themselves and their full paths get scoped against
 * each signal — the signal's `scope` field decides which view to use.
 */
export function detectPacks(
	folderPaths: string[],
	manifest: ManifestPackEntry[],
): DetectionResult[] {
	// Pre-compute leaf names alongside paths for `leafName` scoped signals.
	const folders = folderPaths.map((p) => ({
		path: p,
		leaf: leafOf(p),
	}));

	const results: DetectionResult[] = [];

	// First pass: score every pack against signals (without applying scoping).
	const rawScores = new Map<string, DetectionResult>();
	for (const pack of manifest) {
		const det = pack.detection;
		if (!det || !det.anyOf?.length) continue;

		const minSignals = det.minSignals ?? 1;
		const matchedSignals: DetectionSignalResult[] = [];

		for (const signal of det.anyOf) {
			let regex: RegExp;
			try {
				regex = new RegExp(signal.folderRegex, 'i');
			} catch {
				continue; // invalid regex — silently skip; the loader should have caught this
			}
			const scope = signal.scope ?? 'name';
			const examples: string[] = [];
			for (const f of folders) {
				const target = scope === 'path' ? f.path : scope === 'leafName' ? f.leaf : f.leaf;
				// Note: 'name' and 'leafName' both check the leaf — the field exists
				// for clarity in pack authoring; treat them as aliases at runtime.
				if (regex.test(target)) {
					examples.push(f.path);
					if (examples.length >= MAX_EXAMPLES) break;
				}
			}
			if (examples.length > 0) {
				matchedSignals.push({
					folderRegex: signal.folderRegex,
					scope,
					label: signal.label,
					exampleMatches: examples,
				});
			}
		}

		if (matchedSignals.length === 0) continue;

		const score = matchedSignals.length / minSignals;
		rawScores.set(pack.id, {
			packId: pack.id,
			score,
			signalsHit: matchedSignals.length,
			minSignals,
			matchedSignals,
			scopedUnder: det.scopedUnder ?? undefined,
		});
	}

	// Second pass: apply scopedUnder. A pack scoped under a parent only
	// surfaces if the parent also detected. We DON'T drop the result silently
	// — we mark `suppressedByMissingParent: true` so the UI can show "PARA
	// detected but expects to be inside SEACOW; SEACOW not detected"
	// rather than just hiding it.
	for (const result of rawScores.values()) {
		if (result.scopedUnder) {
			const parent = rawScores.get(result.scopedUnder);
			if (!parent || parent.score < 1.0) {
				result.suppressedByMissingParent = true;
			}
		}
		results.push(result);
	}

	// Sort: surfacing packs first (score ≥ 1, not suppressed), then
	// suppressed/below-threshold by score descending.
	results.sort((a, b) => {
		const aSurfacing = a.score >= 1 && !a.suppressedByMissingParent ? 1 : 0;
		const bSurfacing = b.score >= 1 && !b.suppressedByMissingParent ? 1 : 0;
		if (aSurfacing !== bSurfacing) return bSurfacing - aSurfacing;
		return b.score - a.score;
	});

	return results;
}

function leafOf(path: string): string {
	const idx = path.lastIndexOf('/');
	return idx === -1 ? path : path.slice(idx + 1);
}

/**
 * After detection, identify pairs of detected packs that conflict per
 * `exclusiveWith`. UI surfaces these as warnings.
 */
export interface ExclusivityConflict {
	packA: string;
	packB: string;
}

export function findExclusivityConflicts(
	results: DetectionResult[],
	manifest: ManifestPackEntry[],
): ExclusivityConflict[] {
	const surfacing = new Set(
		results
			.filter((r) => r.score >= 1 && !r.suppressedByMissingParent)
			.map((r) => r.packId),
	);
	const conflicts: ExclusivityConflict[] = [];
	const seen = new Set<string>();

	const exMap = new Map<string, string[]>();
	for (const pack of manifest) {
		const ex = (pack as ManifestPackEntry & { exclusiveWith?: string[] }).exclusiveWith;
		if (ex && ex.length) exMap.set(pack.id, ex);
	}

	for (const a of surfacing) {
		const exclusions = exMap.get(a) ?? [];
		for (const b of exclusions) {
			if (!surfacing.has(b)) continue;
			const key = [a, b].sort().join('|');
			if (seen.has(key)) continue;
			seen.add(key);
			conflicts.push({ packA: a, packB: b });
		}
	}

	return conflicts;
}
