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

export type DetectionEvidenceRelation = 'member' | 'support';
export type DetectionOccurrenceCountBy = 'roles' | 'folders';
export type DetectionScopedUnderMode = 'local' | 'pack-global';

/** A single signal pattern matched against vault folder names. */
export interface DetectionSignal {
	/** Regex matched (case-insensitive) against folder name, full path, or both. */
	folderRegex: string;
	/** Where to apply the regex. Defaults to `name`. */
	scope?: 'name' | 'path' | 'leafName';
	/** Optional human description for the detect modal. */
	label?: string;
	/** Stable semantic role shared by alternative regex definitions. */
	role?: string;
	/** Whether the signal seeds an occurrence or only attaches context. Defaults to `member`. */
	relation?: DetectionEvidenceRelation;
}

export interface DetectionOccurrencePolicy {
	/** Count distinct semantic roles or distinct matched member folders. */
	countBy: DetectionOccurrenceCountBy;
	/** Local evidence required for an actionable occurrence. */
	minEvidence: number;
}

/** Vault-shape detection rules for a pack. */
export interface PackDetection {
	/** Signal definitions evaluated against the vault. */
	anyOf: DetectionSignal[];
	/** Compatibility threshold for the pack-level signal summary. Defaults to 1. */
	minSignals?: number;
	/** Occurrence-local scoring policy. Defaults to role-counting at minSignals. */
	occurrence?: DetectionOccurrencePolicy;
	/** If set, this pack only fires when a parent pack also matches. */
	scopedUnder?: string;
	/** Parent resolution mode. Defaults to the safer occurrence-local mode. */
	scopedUnderMode?: DetectionScopedUnderMode;
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
	/**
	 * Non-fatal compile diagnostics (composition). Populated by
	 * `compileSystemDef` when a mount is skipped (unknown system, cycle,
	 * duplicate anchor) or degrades (glob mount that derives an empty tag
	 * namespace). Surfaced in the preview modal; never thrown.
	 */
	warnings?: string[];

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
 * Clone JSON-compatible input before normalization. Object-loaded packs may
 * come from the statically imported bundled catalog, so loader enrichment must
 * never mutate the catalog object or share nested references with it.
 */
function cloneRawValue(
	value: unknown,
	clones = new WeakMap<object, unknown>(),
	active = new WeakSet<object>(),
): unknown {
	if (value === null || typeof value !== 'object') return value;
	if (active.has(value)) {
		throw new Error('Rule pack object must not contain circular references');
	}
	const existing = clones.get(value);
	if (existing !== undefined) return existing;

	active.add(value);
	if (Array.isArray(value)) {
		const copy: unknown[] = [];
		clones.set(value, copy);
		for (const item of value) copy.push(cloneRawValue(item, clones, active));
		active.delete(value);
		return copy;
	}

	const copy: Record<string, unknown> = {};
	clones.set(value, copy);
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		copy[key] = cloneRawValue(child, clones, active);
	}
	active.delete(value);
	return copy;
}

/**
 * Validate + derive a parsed rule-pack object. Returns {ok: false, errors} for
 * any pack-level or per-rule structural problem. Legacy rules with only Layer
 * 1 fields pass through (augmented with inferred Layer 2 metadata). Rules with
 * `typedSpec` are derived.
 */
export function loadRulePackFromObject(raw: unknown): LoadResult | LoadError {
	if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
		return { ok: false, errors: ['Rule pack must be a JSON object'] };
	}

	let obj: Record<string, unknown>;
	try {
		obj = cloneRawValue(raw) as Record<string, unknown>;
	} catch (err) {
		return { ok: false, errors: [(err as Error).message] };
	}

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

	for (const [i, candidate] of (obj.rules as unknown[]).entries()) {
		if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) {
			errors.push(`Rule #${i}: must be an object`);
			continue;
		}
		const ruleErrors = validateAndNormalizeRule(candidate as RawRule, i);
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

/** Parse JSON, then delegate all validation and derivation to the object loader. */
export function loadRulePackFromJSON(json: string): LoadResult | LoadError {
	let raw: unknown;
	try {
		raw = JSON.parse(json);
	} catch (err) {
		return { ok: false, errors: [`JSON parse error: ${(err as Error).message}`] };
	}
	return loadRulePackFromObject(raw);
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
		if (!isRecord(obj.detection)) {
			errors.push("'detection' must be an object");
		} else {
			const det = obj.detection;
			const minSignals = readPositiveInteger(det.minSignals, 1, 'detection.minSignals', errors);
			const scopedUnder = readOptionalPackId(det.scopedUnder, 'detection.scopedUnder', errors);
			const scopedUnderMode = readEnum(
				det.scopedUnderMode,
				['local', 'pack-global'] as const,
				'local',
				'detection.scopedUnderMode',
				errors,
			);
			const occurrence = readOccurrencePolicy(det.occurrence, minSignals, errors);

			if (!Array.isArray(det.anyOf)) {
				errors.push("'detection.anyOf' must be an array of signals");
			} else {
				const signals: DetectionSignal[] = [];
				for (const [i, rawSignal] of det.anyOf.entries()) {
					const prefix = `detection.anyOf[${i}]`;
					if (!isRecord(rawSignal)) {
						errors.push(`${prefix} must be an object`);
						continue;
					}
					const folderRegex = rawSignal.folderRegex;
					if (typeof folderRegex !== 'string' || folderRegex.length === 0) {
						errors.push(`${prefix}.folderRegex must be a non-empty string`);
						continue;
					}
					try {
						new RegExp(folderRegex, 'i');
					} catch (err) {
						errors.push(`${prefix}.folderRegex invalid: ${(err as Error).message}`);
						continue;
					}

					const scope = readEnum(
						rawSignal.scope,
						['name', 'path', 'leafName'] as const,
						'name',
						`${prefix}.scope`,
						errors,
					);
					const relation = readEnum(
						rawSignal.relation,
						['member', 'support'] as const,
						'member',
						`${prefix}.relation`,
						errors,
					);
					const label = readOptionalString(rawSignal.label, `${prefix}.label`, errors);
					const role = readOptionalString(rawSignal.role, `${prefix}.role`, errors, true);
					signals.push({ folderRegex, scope, label, role, relation });
				}
				out.detection = {
					anyOf: signals,
					minSignals,
					occurrence,
					scopedUnder,
					scopedUnderMode,
				};
			}
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

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function readPositiveInteger(
	value: unknown,
	fallback: number,
	path: string,
	errors: string[],
): number {
	if (value === undefined) return fallback;
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		errors.push(`${path} must be a positive integer`);
		return fallback;
	}
	return value;
}

function readEnum<const T extends string>(
	value: unknown,
	allowed: readonly T[],
	fallback: T,
	path: string,
	errors: string[],
): T {
	if (value === undefined) return fallback;
	if (typeof value === 'string' && allowed.includes(value as T)) return value as T;
	errors.push(`${path} must be one of: ${allowed.join(', ')}`);
	return fallback;
}

function readOptionalString(
	value: unknown,
	path: string,
	errors: string[],
	requireNonEmpty = false,
): string | undefined {
	if (value === undefined) return undefined;
	if (typeof value !== 'string' || (requireNonEmpty && value.trim() === '')) {
		errors.push(`${path} must be ${requireNonEmpty ? 'a non-empty string' : 'a string'}`);
		return undefined;
	}
	return value;
}

function readOptionalPackId(
	value: unknown,
	path: string,
	errors: string[],
): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (typeof value !== 'string' || value.trim() === '') {
		errors.push(`${path} must be null or a non-empty string`);
		return undefined;
	}
	return value;
}

function readOccurrencePolicy(
	value: unknown,
	defaultMinEvidence: number,
	errors: string[],
): DetectionOccurrencePolicy {
	if (value === undefined) {
		return { countBy: 'roles', minEvidence: defaultMinEvidence };
	}
	if (!isRecord(value)) {
		errors.push('detection.occurrence must be an object');
		return { countBy: 'roles', minEvidence: defaultMinEvidence };
	}
	return {
		countBy: readEnum(
			value.countBy,
			['roles', 'folders'] as const,
			'roles',
			'detection.occurrence.countBy',
			errors,
		),
		minEvidence: readPositiveInteger(
			value.minEvidence,
			defaultMinEvidence,
			'detection.occurrence.minEvidence',
			errors,
		),
	};
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
