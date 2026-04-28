/**
 * Path Lens template compiler.
 *
 * Compiles a Path Lens template string (e.g., `Projects/{topic}/{deeper...}`)
 * into a CompiledTemplate carrying the regex + slot list + filter metadata.
 * Pure function; no engine integration. Engine integration lives in
 * `derive.ts` (template → MappingRule), `applyTransfer.ts` (slot extraction),
 * and `rulePackLoader.ts` (validation at load time).
 *
 * F2 commit 1a — Tier A operators only:
 * - `{name}` — single-segment slot
 * - `{name...}` — glob slot (one or more segments)
 * - `{name | filter1 | filter2}` — pipe filters (Jinja-style)
 * - Literal segments — anything not in `{}`
 *
 * Tier B operators (`{name?}`, `{name:regex}`, optional literal prefix `📁?`)
 * deferred to future commits.
 *
 * Reference: docs/concepts/bijectivity-detection.md (storage layer + algorithm)
 * Reference: docs/agent-context/zz-log/2026-04-27-path-lens-operators-and-bijectivity-detection.md (research)
 */

import {
	type Reversibility,
	type TransformBijectivityProfile,
	composeFilterChain,
	aggregateSlotReversibilities,
	getFilterMetadata,
} from '../transformers/transformMetadata';

// ============================================================================
// Types
// ============================================================================

/**
 * A Path Lens template string. Examples:
 *   `Projects/{topic}/{deeper...}`
 *   `Capture/Inbox/{discarded...}`
 *   `Entity/{owner}/Projects/{project | kebab-case}`
 */
export type PathTemplate = string;

/**
 * A slot definition extracted from a template.
 *
 * `name` is the slot identifier — the engine uses name equality across folder
 * and tag templates to determine round-trip bindings (see
 * docs/agent-context/zz-log/2026-04-27-abstraction-shape-comparison.md
 * "What slot names actually do" for details).
 */
export interface SlotDef {
	/** Slot name as it appears in the template (may contain hyphens) */
	name: string;

	/**
	 * Sanitized name used as the regex named-capture-group identifier. JS
	 * regex named groups disallow hyphens, so `topic-name` becomes
	 * `topic_name__h0`. Internal use only — `extractSlots` maps back to
	 * `name` before returning.
	 */
	captureGroupName: string;

	/** Single-segment vs glob (multi-segment) capture */
	kind: 'segment' | 'glob';

	/** Filter pipeline applied to this slot's value, in order */
	filters: string[];

	/** Position in the template string (for error messages) */
	templatePosition: number;
}

export interface CompiledTemplate {
	/** Compiled regex with named capture groups, anchored at both ends */
	regex: RegExp;

	/** Slot definitions in template order */
	slots: SlotDef[];

	/** Original template source (for round-trip + diagnostics) */
	source: PathTemplate;
}

/**
 * Per-rule bijectivity verdict — Layer 1 (slot overlap) + Layer 2 (per-transform).
 * Documented in docs/concepts/bijectivity-detection.md.
 */
export interface BijectivityVerdict {
	/** Overall reversibility classification */
	status: Reversibility;

	/** Per-slot reversibilities (slot name → verdict). Empty if Layer 1 fails. */
	perSlot: Record<string, Reversibility>;

	/** Slots only on folder side (matched-but-discarded — lossy forward) */
	folderOnlySlots: string[];

	/** Slots only on tag side (unsourced — config error) */
	tagOnlySlots: string[];

	/** Layer 1 (structural slot-overlap) result */
	layer1Pass: boolean;

	/** Layer 2 (per-transform reversibility) result */
	layer2Pass: boolean;

	/**
	 * Human-readable reason for non-`total` status. When `status === 'lossy'`
	 * or `'conditional'`, this explains which slot/filter contributed.
	 */
	reason?: string;
}

// ============================================================================
// Errors
// ============================================================================

export class TemplateParseError extends Error {
	constructor(
		message: string,
		public readonly template: string,
		public readonly position: number,
	) {
		super(`Template parse error at position ${position}: ${message}\n  Template: ${template}`);
		this.name = 'TemplateParseError';
	}
}

// ============================================================================
// Compiler
// ============================================================================

/**
 * Compile a Path Lens template into a CompiledTemplate.
 *
 * The result has a regex that matches paths the template would match, with
 * named capture groups for each slot. The `slots` array preserves template
 * order and includes per-slot filter metadata.
 *
 * Throws TemplateParseError on malformed input.
 */
export function compileTemplate(template: PathTemplate): CompiledTemplate {
	if (template == null) {
		throw new TemplateParseError('template is null or undefined', String(template), 0);
	}

	const slots: SlotDef[] = [];
	const seenNames = new Set<string>();

	// Walk the template character-by-character; build regex string + slot list.
	let regexParts: string[] = ['^'];
	let i = 0;
	let literalBuffer = '';

	const flushLiteral = () => {
		if (literalBuffer) {
			regexParts.push(escapeRegex(literalBuffer));
			literalBuffer = '';
		}
	};

	while (i < template.length) {
		const ch = template[i];

		if (ch === '{') {
			flushLiteral();
			const slotEnd = template.indexOf('}', i);
			if (slotEnd === -1) {
				throw new TemplateParseError(
					'unclosed slot — expected `}`',
					template,
					i,
				);
			}
			const slotBody = template.slice(i + 1, slotEnd);
			const slot = parseSlot(slotBody, i, template);

			if (seenNames.has(slot.name)) {
				throw new TemplateParseError(
					`duplicate slot name "${slot.name}" within template`,
					template,
					i,
				);
			}
			seenNames.add(slot.name);

			// JS regex named groups disallow hyphens. Sanitize for the regex
			// layer; preserve original name for the public slot API.
			slot.captureGroupName = sanitizeForRegex(slot.name, slots.length);
			slots.push(slot);

			// Append the slot's regex pattern with a named capture group
			const captureBody = slot.kind === 'glob' ? '.+' : '[^/]+';
			regexParts.push(`(?<${slot.captureGroupName}>${captureBody})`);

			i = slotEnd + 1;
		} else {
			literalBuffer += ch;
			i++;
		}
	}

	flushLiteral();
	regexParts.push('$');

	const regexStr = regexParts.join('');
	let regex: RegExp;
	try {
		regex = new RegExp(regexStr);
	} catch (e) {
		throw new TemplateParseError(
			`compiled regex is invalid: ${(e as Error).message}`,
			template,
			0,
		);
	}

	return { regex, slots, source: template };
}

/**
 * Parse a single slot body (the text between `{` and `}`).
 * Examples:
 *   "topic"            → segment slot, no filters
 *   "deeper..."        → glob slot, no filters
 *   "topic | kebab"    → segment slot, one filter
 *   "topic | f1 | f2"  → segment slot, two filters
 */
function parseSlot(body: string, position: number, template: string): SlotDef {
	const trimmed = body.trim();
	if (trimmed.length === 0) {
		throw new TemplateParseError('empty slot — expected name', template, position);
	}

	// Split on `|` for filters
	const parts = trimmed.split('|').map((p) => p.trim());
	let nameWithKind = parts[0];
	const filters = parts.slice(1).filter((f) => f.length > 0);

	// Detect glob suffix `...`
	let kind: 'segment' | 'glob' = 'segment';
	if (nameWithKind.endsWith('...')) {
		kind = 'glob';
		nameWithKind = nameWithKind.slice(0, -3);
	}

	const name = nameWithKind.trim();
	if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) {
		throw new TemplateParseError(
			`invalid slot name "${name}" (must match /^[a-zA-Z_][a-zA-Z0-9_-]*$/)`,
			template,
			position,
		);
	}

	return {
		name,
		captureGroupName: name, // overwritten in compileTemplate when added to slots[]
		kind,
		filters,
		templatePosition: position,
	};
}

function escapeRegex(literal: string): string {
	return literal.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * Sanitize a slot name for use as a JS regex named-capture-group identifier.
 * Replaces hyphens with `_` and appends an index suffix to guarantee uniqueness
 * (in case the sanitized form would collide with another slot's name).
 */
function sanitizeForRegex(name: string, index: number): string {
	const sanitized = name.replace(/-/g, '_');
	// Always append index suffix so we never collide with a literal user-chosen
	// slot name like `topic_name` and a hyphenated `topic-name` in the same template.
	return `${sanitized}__s${index}`;
}

// ============================================================================
// Slot extraction
// ============================================================================

/**
 * Apply a compiled template to a path; return slot values or null on no-match.
 *
 * Slot values are keyed by the original slot `name` (with hyphens preserved),
 * not the internal sanitized `captureGroupName`.
 */
export function extractSlots(compiled: CompiledTemplate, path: string): Record<string, string> | null {
	const match = compiled.regex.exec(path);
	if (!match) return null;
	// Slot-less templates have no .groups; return {} (matched, no slots) rather than null.
	const result: Record<string, string> = {};
	if (match.groups) {
		for (const slot of compiled.slots) {
			const value = match.groups[slot.captureGroupName];
			if (value !== undefined) result[slot.name] = value;
		}
	}
	return result;
}

/**
 * Instantiate a template with slot values to produce a path.
 *
 * Validates that every required slot has a value; throws TemplateParseError
 * if a slot is missing. Filter pipelines are NOT applied here — that's the
 * forward sync engine's job (it walks the slot's filters and applies the
 * runtime transformation pipeline).
 */
export function instantiateTemplate(
	compiled: CompiledTemplate,
	slotValues: Record<string, string>,
): string {
	let result = '';
	let lastIndex = 0;
	const template = compiled.source;

	for (const slot of compiled.slots) {
		// Append the literal between the previous slot end and this slot's start
		const slotStartInTemplate = template.indexOf('{', lastIndex);
		result += template.slice(lastIndex, slotStartInTemplate);

		// Append the slot's value
		const value = slotValues[slot.name];
		if (value === undefined) {
			throw new TemplateParseError(
				`missing value for slot "${slot.name}"`,
				template,
				slot.templatePosition,
			);
		}
		result += value;

		// Advance past the slot's `}` in the template
		lastIndex = template.indexOf('}', slotStartInTemplate) + 1;
	}

	// Append any trailing literal after the last slot
	result += template.slice(lastIndex);

	return result;
}

// ============================================================================
// Bijectivity detection — Layer 1 (structural) + Layer 2 (per-transform)
// ============================================================================

/**
 * Compute the bijectivity verdict for a folder template + tag template pair.
 *
 * Implements Layer 1 (structural slot-overlap) and Layer 2 (per-transform
 * reversibility) from the bijectivity-detection algorithm. Layers 3+ run
 * elsewhere (Layer 3 on rule save; Layer 5 at runtime in applyTransfer).
 *
 * Reference: docs/concepts/bijectivity-detection.md
 */
export function computeBijectivity(
	folderTemplate: PathTemplate | undefined,
	tagTemplate: PathTemplate | undefined,
): BijectivityVerdict {
	// Edge cases
	if (!folderTemplate || !tagTemplate) {
		return {
			status: 'lossy',
			perSlot: {},
			folderOnlySlots: [],
			tagOnlySlots: [],
			layer1Pass: false,
			layer2Pass: false,
			reason: 'missing folder or tag template — cannot compute bijection',
		};
	}

	let folderCompiled: CompiledTemplate;
	let tagCompiled: CompiledTemplate;
	try {
		folderCompiled = compileTemplate(folderTemplate);
		tagCompiled = compileTemplate(tagTemplate);
	} catch (e) {
		return {
			status: 'lossy',
			perSlot: {},
			folderOnlySlots: [],
			tagOnlySlots: [],
			layer1Pass: false,
			layer2Pass: false,
			reason: `template parse failed: ${(e as Error).message}`,
		};
	}

	// === Layer 1 — Structural slot-overlap ===

	const folderSlotMap = new Map(folderCompiled.slots.map((s) => [s.name, s]));
	const tagSlotMap = new Map(tagCompiled.slots.map((s) => [s.name, s]));

	const folderOnlySlots = [...folderSlotMap.keys()].filter((n) => !tagSlotMap.has(n));
	const tagOnlySlots = [...tagSlotMap.keys()].filter((n) => !folderSlotMap.has(n));

	const layer1Pass = folderOnlySlots.length === 0 && tagOnlySlots.length === 0;

	if (!layer1Pass) {
		const reasons: string[] = [];
		if (folderOnlySlots.length > 0) {
			reasons.push(
				`slots only on folder side (matched but discarded — lossy forward): ${folderOnlySlots.join(', ')}`,
			);
		}
		if (tagOnlySlots.length > 0) {
			reasons.push(
				`slots only on tag side (unsourced — likely config error): ${tagOnlySlots.join(', ')}`,
			);
		}
		// Layer 1 fails — Layer 2 still runs to give the user the per-slot picture for shared slots.
		const sharedSlots = [...folderSlotMap.keys()].filter((n) => tagSlotMap.has(n));
		const perSlot: Record<string, Reversibility> = {};
		for (const slotName of sharedSlots) {
			const folderFilters = folderSlotMap.get(slotName)!.filters;
			const tagFilters = tagSlotMap.get(slotName)!.filters;
			const combined = composeFilterChain([...folderFilters, ...tagFilters]);
			perSlot[slotName] = combined;
		}
		return {
			status: 'lossy', // Layer 1 fail → rule isn't bijective regardless of Layer 2
			perSlot,
			folderOnlySlots,
			tagOnlySlots,
			layer1Pass: false,
			layer2Pass: false,
			reason: reasons.join('; '),
		};
	}

	// === Layer 2 — Per-transform reversibility ===

	const perSlot: Record<string, Reversibility> = {};
	const conditionalReasons: string[] = [];
	const lossyReasons: string[] = [];

	for (const folderSlot of folderCompiled.slots) {
		const tagSlot = tagSlotMap.get(folderSlot.name)!;
		// Filters from folder side first (forward direction), then tag side (inverse)
		// for the round-trip pipeline. The full pipeline reverses if every filter is reversible.
		const allFilters = [...folderSlot.filters, ...tagSlot.filters];
		const slotReversibility = composeFilterChain(allFilters);
		perSlot[folderSlot.name] = slotReversibility;

		if (slotReversibility === 'lossy') {
			const lossyFilter = findLossyFilter(allFilters);
			lossyReasons.push(
				`slot {${folderSlot.name}} has filter "${lossyFilter}" which is not reversible`,
			);
		} else if (slotReversibility === 'conditional') {
			const conditionalFilter = findConditionalFilter(allFilters);
			const meta = getFilterMetadata(conditionalFilter);
			conditionalReasons.push(
				`slot {${folderSlot.name}} via "${conditionalFilter}" — ${meta?.reversibilityDomain ?? 'conditional reversibility'}`,
			);
		}
	}

	const overallStatus = aggregateSlotReversibilities(Object.values(perSlot));

	let reason: string | undefined;
	if (overallStatus === 'lossy') {
		reason = lossyReasons.join('; ');
	} else if (overallStatus === 'conditional') {
		reason = conditionalReasons.join('; ');
	}

	return {
		status: overallStatus,
		perSlot,
		folderOnlySlots: [],
		tagOnlySlots: [],
		layer1Pass: true,
		layer2Pass: overallStatus !== 'lossy',
		reason,
	};
}

function findLossyFilter(filters: string[]): string {
	for (const f of filters) {
		const meta = getFilterMetadata(f);
		if (!meta || meta.reversibility === 'lossy') return f;
	}
	return filters[0] ?? '<unknown>';
}

function findConditionalFilter(filters: string[]): string {
	for (const f of filters) {
		const meta = getFilterMetadata(f);
		if (meta?.reversibility === 'conditional') return f;
	}
	return filters[0] ?? '<unknown>';
}
