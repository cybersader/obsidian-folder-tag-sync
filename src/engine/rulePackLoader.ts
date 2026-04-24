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
import type { TypedRuleSpec } from '../types/typed';
import { deriveRule } from './derive';
import { inferTypedModel } from './inferTyped';

export interface RulePack {
	name: string;
	description: string;
	version: string;
	author: string;
	rules: MappingRule[];
	notes?: string[];
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
				rules.push(r);
			}
		}
	}

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
		},
	};
}

function validateAndNormalizeRule(
	raw: RawRule,
	idx: number,
): { ok: true; rule: MappingRule } | { ok: false; errors: string[] } {
	const errors: string[] = [];
	const prefix = `Rule #${idx}${raw.id ? ` (${raw.id})` : ''}:`;

	// Path A: typedSpec present → derive
	if (raw.typedSpec) {
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
