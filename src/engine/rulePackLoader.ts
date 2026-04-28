/**
 * Rule-pack loader.
 *
 * Parses a rule-pack JSON (shape documented in `rule-packs/README.md`),
 * validates its structure, and returns MappingRule[] ready to merge into
 * the main plugin's settings.
 *
 * The loader is typed-model-aware: if a rule carries a `typedSpec` field
 * (Layer 2), the loader runs `deriveRule` to produce the full Layer 1
 * regex + transforms. If a rule instead carries legacy Layer 1 fields
 * (tagPattern, folderPattern, etc.), those are used as-is — this keeps
 * existing hand-authored packs like `seacow-cyberbase.json` working
 * without modification.
 *
 * Pure — no Obsidian imports, no filesystem access. The UI layer hands us
 * the JSON string; we return rules or a structured error.
 */

import type { MappingRule } from '../types/settings';
import type { Axis, TypedRuleSpec } from '../types/typed';
import { deriveRule } from './derive';
import { inferTypedModel } from './inferTyped';
import { compileTemplate, computeBijectivity, TemplateParseError } from './compileTemplate';

// ─── Phase 2C extensions ─────────────────────────────────────────────────
//
// All new fields are OPTIONAL — existing community packs without these
// metadata fields keep loading. The fields enable: catalog grouping by
// SEACOW axis, vault-shape detection, composition (compatibleWith /
// exclusiveWith), and bootstrap (establish.createFolders).

/** A single signal pattern matched against vault folder names. */
export interface DetectionSignal {
	/** Regex matched (case-insensitive) against folder name, full path, or both. */
	folderRegex: string;
	/** Where to apply the regex. Default: name. */
	scope?: 'name' | 'path' | 'leafName';
	/** Optional human description for the detect modal. */
	label?: string;
}

/** Vault-shape detection rules for a pack. */
export interface PackDetection {
	/** Match if at least `minSignals` of these patterns hit. */
	anyOf: DetectionSignal[];
	/** Threshold to surface in detect results. Default: 1. */
	minSignals?: number;
	/** If set, this pack only fires when `scopedUnder` (a parent pack id) also matches. */
	scopedUnder?: string;
}

/** What to create when bootstrapping a new vault from this pack. */
export interface PackEstablish {
	/** Folder paths to create (with trailing slash). */
	createFolders: string[];
	/** One-line natural-language description for the wizard. */
	summary?: string;
}

export interface RulePack {
	name: string;
	description: string;
	version: string;
	author: string;
	rules: MappingRule[];
	notes?: string[];

	// Phase 2C metadata (all optional)

	/** Stable identifier — used by manifest, compatibleWith, scopedUnder. Defaults to file basename if absent. */
	id?: string;
	/** Which SEACOW axes this pack covers. */
	axes?: Axis[];
	/** Pack ids this pack composes cleanly with. */
	compatibleWith?: string[];
	/** Pack ids this pack should not be installed alongside. */
	exclusiveWith?: string[];
	/** Vault-shape detection signals. */
	detection?: PackDetection;
	/** Bootstrap (Establish-mode) instructions. */
	establish?: PackEstablish;
}

export interface LoadResult {
	ok: true;
	pack: RulePack;
}

export interface LoadError {
	ok: false;
	errors: string[];
}

/** Shape of a rule as it may appear in a rule-pack JSON — either legacy or typed. */
type RawRule = Partial<MappingRule> & {
	/** Optional Layer 2 typed specification. If present, derivation runs. */
	typedSpec?: TypedRuleSpec;
};

/**
 * Parse + validate + derive. Returns {ok: false, errors} for any pack-level
 * or per-rule structural problem. Legacy rules with only Layer 1 fields pass
 * through (augmented with inferred Layer 2 metadata). Rules with `typedSpec`
 * are derived.
 */
export function loadRulePackFromJSON(json: string): LoadResult | LoadError {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		return { ok: false, errors: [`JSON parse error: ${(err as Error).message}`] };
	}

	if (!raw || typeof raw !== 'object') {
		return { ok: false, errors: ['Rule pack must be a JSON object'] };
	}
	const obj = raw as Record<string, unknown>;

	const errors: string[] = [];
	const requireString = (k: string): string | undefined => {
		const v = obj[k];
		if (typeof v !== 'string' || v.trim() === '') {
			errors.push(`Missing or invalid '${k}' (must be non-empty string)`);
			return undefined;
		}
		return v;
	};

	const name = requireString('name');
	const description = requireString('description');
	const version = requireString('version');
	const author = requireString('author');

	if (!Array.isArray(obj.rules)) {
		errors.push("'rules' must be an array");
	}

	if (errors.length) return { ok: false, errors };

	// Validate + normalize each rule
	const rules: MappingRule[] = [];
	const seenIds = new Set<string>();

	// Pack-level group: read top-level `group` if present; else derive from pack `id`.
	// Per-rule `group` (if explicitly set on a rule) overrides this default.
	// F1 Step 3 — provides cross-pack precedence partitioning.
	const packGroup = typeof obj.group === 'string' && (obj.group as string).trim().length > 0
		? (obj.group as string).trim()
		: typeof obj.id === 'string' && (obj.id as string).trim().length > 0
			? (obj.id as string).trim()
			: undefined;

	for (const [i, rawRule] of (obj.rules as RawRule[]).entries()) {
		const ruleErrors = validateAndNormalizeRule(rawRule, i);
		if (!ruleErrors.ok) {
			errors.push(...ruleErrors.errors);
		} else {
			const r = ruleErrors.rule;
			if (seenIds.has(r.id)) {
				errors.push(`Rule #${i}: duplicate id '${r.id}'`);
			} else {
				seenIds.add(r.id);
				// F1 Step 3 — default group from pack-level group or pack id.
				// Only set when the rule didn't declare its own group.
				if (!r.group && packGroup) {
					r.group = packGroup;
				}
				rules.push(r);
			}
		}
	}

	// Validate optional Phase 2C metadata. Each block is independently
	// validated; absence is fine. Bad values become hard errors.
	const phase2cMeta = validatePhase2CMeta(obj, errors);

	if (errors.length) return { ok: false, errors };

	return {
		ok: true,
		pack: {
			name: name!,
			description: description!,
			version: version!,
			author: author!,
			rules,
			notes: Array.isArray(obj.notes) ? (obj.notes as string[]) : undefined,
			...phase2cMeta,
		},
	};
}

/**
 * Pull and validate the optional Phase 2C metadata blocks. Returns the
 * validated subset of fields suitable for spreading into the RulePack.
 * Pushes errors onto the shared `errors` array on validation failure.
 */
function validatePhase2CMeta(
	obj: Record<string, unknown>,
	errors: string[],
): Partial<RulePack> {
	const out: Partial<RulePack> = {};

	if (typeof obj.id === 'string' && obj.id.trim()) out.id = obj.id;

	if (Array.isArray(obj.axes)) {
		const axes = obj.axes.filter((a): a is Axis =>
			typeof a === 'string' &&
			['system', 'entity', 'capture', 'output', 'work', 'relation'].includes(a),
		);
		out.axes = axes;
	}

	if (Array.isArray(obj.compatibleWith)) {
		out.compatibleWith = obj.compatibleWith.filter((s): s is string => typeof s === 'string');
	}
	if (Array.isArray(obj.exclusiveWith)) {
		out.exclusiveWith = obj.exclusiveWith.filter((s): s is string => typeof s === 'string');
	}

	if (obj.detection !== undefined) {
		const det = obj.detection as Record<string, unknown>;
		if (!Array.isArray(det.anyOf)) {
			errors.push("'detection.anyOf' must be an array of signals");
		} else {
			const signals: DetectionSignal[] = [];
			for (const [i, s] of (det.anyOf as Record<string, unknown>[]).entries()) {
				if (typeof s.folderRegex !== 'string' || !s.folderRegex) {
					errors.push(`detection.anyOf[${i}].folderRegex must be a non-empty string`);
					continue;
				}
				try {
					new RegExp(s.folderRegex, 'i');
				} catch (err) {
					errors.push(`detection.anyOf[${i}].folderRegex invalid: ${(err as Error).message}`);
					continue;
				}
				signals.push({
					folderRegex: s.folderRegex,
					scope: s.scope === 'path' || s.scope === 'leafName' ? s.scope : 'name',
					label: typeof s.label === 'string' ? s.label : undefined,
				});
			}
			out.detection = {
				anyOf: signals,
				minSignals: typeof det.minSignals === 'number' ? det.minSignals : 1,
				scopedUnder: typeof det.scopedUnder === 'string' ? det.scopedUnder : undefined,
			};
		}
	}

	if (obj.establish !== undefined) {
		const est = obj.establish as Record<string, unknown>;
		if (!Array.isArray(est.createFolders)) {
			errors.push("'establish.createFolders' must be an array of paths");
		} else {
			out.establish = {
				createFolders: est.createFolders.filter((p): p is string => typeof p === 'string'),
				summary: typeof est.summary === 'string' ? est.summary : undefined,
			};
		}
	}

	return out;
}

/**
 * Validate the optional `folderAnchor` field shape. Returns an error string
 * (for accumulation in the surrounding errors list) if malformed, or null if
 * absent / well-formed. Phase G — pack JSONs can declare anchor explicitly,
 * but the value must conform to `FolderAnchor` (string literal or
 * `{ under: non-empty-string }`).
 */
function validateFolderAnchor(value: unknown, prefix: string): string | null {
	if (value === undefined) return null;
	if (value === 'root' || value === 'any-segment') return null;
	if (
		value !== null &&
		typeof value === 'object' &&
		typeof (value as { under?: unknown }).under === 'string' &&
		(value as { under: string }).under.trim() !== ''
	) {
		const under = (value as { under: string }).under;
		if (under.startsWith('/') || under.endsWith('/')) {
			return `${prefix} folderAnchor.under must not start or end with '/' (got '${under}')`;
		}
		return null;
	}
	return `${prefix} folderAnchor must be 'root', 'any-segment', or { under: '<path>' }`;
}

/**
 * F2 — validate a Path Lens template-shaped rule. Both templates compile
 * via `compileTemplate`; on success, auto-derive `folderPattern` +
 * `tagPattern` from the compiled regex sources so the existing
 * `findMatchingRules` runtime gates work unchanged. The runtime layer
 * (`applyTransfer.applyRuleForward` / `applyRuleInverse`) then dispatches
 * to the template-driven pipeline via `isTemplateRule`.
 *
 * Mutual exclusivity with `typedSpec` is enforced one level up.
 */
function validateTemplateRule(
	raw: RawRule,
	idx: number,
	prefix: string,
): { ok: true; rule: MappingRule } | { ok: false; errors: string[] } {
	const errors: string[] = [];

	// Required base fields (same as Path B)
	if (!raw.id) errors.push(`${prefix} missing 'id'`);
	if (!raw.name) errors.push(`${prefix} missing 'name'`);
	if (typeof raw.priority !== 'number') errors.push(`${prefix} missing or invalid 'priority'`);
	if (!raw.direction) errors.push(`${prefix} missing 'direction'`);
	if (!raw.options) errors.push(`${prefix} missing 'options'`);

	// Direction-specific template requirements.
	const needsFolder = raw.direction === 'folder-to-tag' || raw.direction === 'bidirectional';
	const needsTag = raw.direction === 'tag-to-folder' || raw.direction === 'bidirectional';

	if (needsFolder && !raw.folderTemplate) {
		errors.push(`${prefix} folder-to-tag/bidirectional template rule requires 'folderTemplate'`);
	}
	if (needsTag && !raw.tagTemplate) {
		errors.push(`${prefix} tag-to-folder/bidirectional template rule requires 'tagTemplate'`);
	}

	if (errors.length) return { ok: false, errors };

	// Compile both templates; surface parse errors loudly.
	let folderPattern: string | undefined;
	let tagPattern: string | undefined;

	if (raw.folderTemplate) {
		try {
			const compiled = compileTemplate(raw.folderTemplate);
			folderPattern = compiled.regex.source;
		} catch (e) {
			if (e instanceof TemplateParseError) {
				errors.push(`${prefix} invalid folderTemplate: ${e.message}`);
			} else {
				errors.push(`${prefix} folderTemplate compile failed: ${(e as Error).message}`);
			}
		}
	}

	if (raw.tagTemplate) {
		try {
			const compiled = compileTemplate(raw.tagTemplate);
			tagPattern = compiled.regex.source;
		} catch (e) {
			if (e instanceof TemplateParseError) {
				errors.push(`${prefix} invalid tagTemplate: ${e.message}`);
			} else {
				errors.push(`${prefix} tagTemplate compile failed: ${(e as Error).message}`);
			}
		}
	}

	if (errors.length) return { ok: false, errors };

	// Compute the bijectivity verdict at load time. We don't reject lossy
	// rules — lossy is a valid intentional shape (marker-only, aggregate,
	// etc.). We just ensure the verdict is computable and stash it on
	// `bijective` so the UI can surface the chip without recomputing.
	let bijective: boolean | undefined;
	if (raw.folderTemplate && raw.tagTemplate) {
		const verdict = computeBijectivity(raw.folderTemplate, raw.tagTemplate);
		bijective = verdict.status === 'total';
	}

	const rule: MappingRule = {
		id: raw.id!,
		name: raw.name!,
		description: raw.description,
		enabled: raw.enabled !== undefined ? raw.enabled : true,
		priority: raw.priority!,
		direction: raw.direction!,
		// Auto-derived from compiled templates — gates `findMatchingRules`
		folderPattern,
		tagPattern,
		// Preserve template source for the runtime
		folderTemplate: raw.folderTemplate,
		tagTemplate: raw.tagTemplate,
		// Pass through other optional fields if present
		folderEntryPoint: raw.folderEntryPoint,
		tagEntryPoint: raw.tagEntryPoint,
		folderTransforms: raw.folderTransforms,
		tagTransforms: raw.tagTransforms,
		folderAnchor: raw.folderAnchor,
		group: raw.group,
		options: raw.options!,
		// Layer 2 verdict
		bijective,
	};

	return { ok: true, rule };
}

function validateAndNormalizeRule(
	raw: RawRule,
	idx: number,
): { ok: true; rule: MappingRule } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const prefix = `Rule #${idx}${raw.id ? ` (${raw.id})` : ''}:`;

	// Mutual exclusivity check — a rule should declare ONE shape.
	const hasTemplate = Boolean(raw.folderTemplate || raw.tagTemplate);
	const hasTypedSpec = Boolean(raw.typedSpec);
	if (hasTemplate && hasTypedSpec) {
		errors.push(
			`${prefix} rule has both 'folderTemplate'/'tagTemplate' (Path Lens shape) and 'typedSpec' (typed-model shape). Choose one.`,
		);
		return { ok: false, errors };
	}

	// Path C: Path Lens template-shaped rule (F2). Compile both templates,
	// auto-derive folderPattern + tagPattern from the compiled regex sources,
	// preserve template fields for the runtime to use.
	if (hasTemplate) {
		return validateTemplateRule(raw, idx, prefix);
	}

	// Path A: typedSpec present → derive (anchor flows through deriveFolderPattern)
	if (raw.typedSpec) {
		// Validate anchor on the typedSpec before derivation
		const anchorErr = validateFolderAnchor(
			(raw.typedSpec as { folderAnchor?: unknown }).folderAnchor,
			prefix,
		);
		if (anchorErr) {
			errors.push(anchorErr);
			return { ok: false, errors };
		}
		try {
			const derived = deriveRule(raw.typedSpec);
			return { ok: true, rule: derived };
		} catch (err) {
			errors.push(`${prefix} derivation failed: ${(err as Error).message}`);
			return { ok: false, errors };
		}
	}

	// Path B: legacy Layer 1 rule → validate basic fields, augment with inferred metadata
	if (!raw.id) errors.push(`${prefix} missing 'id'`);
	if (!raw.name) errors.push(`${prefix} missing 'name'`);
	if (typeof raw.priority !== 'number') errors.push(`${prefix} missing or invalid 'priority'`);
	if (!raw.direction) errors.push(`${prefix} missing 'direction'`);
	if (!raw.options) errors.push(`${prefix} missing 'options'`);

	// Direction-specific pattern requirements
	if (raw.direction === 'folder-to-tag' || raw.direction === 'bidirectional') {
		if (!raw.folderPattern) {
			errors.push(`${prefix} folder-to-tag/bidirectional requires 'folderPattern'`);
		}
	}
	if (raw.direction === 'tag-to-folder' || raw.direction === 'bidirectional') {
		if (!raw.tagPattern) {
			errors.push(`${prefix} tag-to-folder/bidirectional requires 'tagPattern'`);
		}
	}

	// Regex compile check
	if (raw.folderPattern) {
		try {
			new RegExp(raw.folderPattern);
		} catch (err) {
			errors.push(`${prefix} invalid folderPattern: ${(err as Error).message}`);
		}
	}

	// Layer 1 rules can carry an explicit folderAnchor. The pattern is the
	// source of truth at runtime (sync engine consumes it as-is), so the
	// anchor here is metadata for the UI / typed-model round-trip.
	const anchorErr = validateFolderAnchor(raw.folderAnchor, prefix);
	if (anchorErr) errors.push(anchorErr);
	if (raw.tagPattern) {
		try {
			new RegExp(raw.tagPattern);
		} catch (err) {
			errors.push(`${prefix} invalid tagPattern: ${(err as Error).message}`);
		}
	}

	if (errors.length) return { ok: false, errors };

	// Cast is safe — we verified required fields above
	const rule = raw as MappingRule;

	// Layer 2 enrichment from the legacy rule (best-effort, additive)
	if (!rule.transfer || !rule.folder || !rule.tag) {
		const inferred = inferTypedModel(rule);
		rule.folder = rule.folder ?? inferred.folder;
		rule.tag = rule.tag ?? inferred.tag;
		rule.transfer = rule.transfer ?? inferred.transfer;
		rule.inverseTransfer = rule.inverseTransfer ?? inferred.inverseTransfer;
	}

	// enabled defaults to true if omitted
	if (rule.enabled === undefined) rule.enabled = true;

	return { ok: true, rule };
}
