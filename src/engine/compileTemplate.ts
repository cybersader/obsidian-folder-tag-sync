/**
 * Path Lens template compiler.
 *
 * Compiles a Path Lens template string (e.g., `Projects/{topic}/{deeper...}`)
 * into a CompiledTemplate carrying the regex + slot list + filter metadata.
 * Pure function; no engine integration. Engine integration lives in
 * `derive.ts` (template → MappingRule), `applyTransfer.ts` (slot extraction),
 * and `rulePackLoader.ts` (validation at load time).
 *
 * Operators:
 * - `{name}` — single-segment slot (matches `[^/]+`)
 * - `{name...}` — glob slot (matches `.+`, can span path separators)
 * - `{name:regex}` — Tier B inline regex constraint (validated to not break path-shape semantics)
 * - `{name:regex...}` — glob slot with inline regex constraint
 * - `{name | filter1 | filter2}` — pipe filters (Jinja-style, applied at runtime)
 * - Literal segments — anything not in `{}`
 *
 * Tier B regex safety: for SEGMENT slots, the user-provided regex is rejected
 * if it can match `/` (would let one slot eat multiple path segments — broken
 * path-shape semantics). For glob slots, `/` matching is allowed by definition.
 *
 * Other Tier B operators (`{name?}` optional segment, optional literal prefix
 * `📁?`) still deferred.
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

	/**
	 * User-supplied inline regex constraint (Tier B — `{name:regex}` syntax).
	 * Replaces the default capture body (`[^/]+` for segment, `.+` for glob).
	 * Pre-validated by the compiler: for segment slots, must NOT match `/`
	 * (otherwise rejected with TemplateParseError to prevent breaking
	 * path-shape semantics).
	 */
	inlineRegex?: string;

	/** Position in the template string (for error messages) */
	templatePosition: number;

	/**
	 * True when this slot is a trailing glob whose preceding `/` is also
	 * optional — i.e., `Projects/{deeper...}` matches BOTH bare `Projects`
	 * AND `Projects/X/Y/Z`. The compiler sets this for the LAST slot in a
	 * template when it's a glob AND immediately preceded by `/`. Lets a
	 * single template express the typed-model "entry-or-anywhere-below" shape
	 * that older typed rules emitted via `^Projects(?:/|$)`.
	 *
	 * Affects:
	 *   - The compiled regex emits `(?:/<glob>)?` instead of `/<glob>`
	 *   - `extractSlots` returns slot value `undefined` for bare-prefix matches
	 *   - `instantiateTemplate` allows the slot value to be undefined; when
	 *     so, it omits both the slot and the preceding `/`
	 */
	trailingOptionalGlob?: boolean;
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
			// Balanced-brace search: regex quantifiers like `\d{1,2}` contain
			// inner `}`, so a naive `indexOf('}')` breaks. Track nesting depth
			// from `{` (this slot opener) to find the MATCHING `}`.
			let depth = 1;
			let slotEnd = -1;
			for (let j = i + 1; j < template.length; j++) {
				if (template[j] === '{') depth++;
				else if (template[j] === '}') {
					depth--;
					if (depth === 0) { slotEnd = j; break; }
				}
			}
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

			// Detect the trailing-optional-glob case: this slot is the LAST
			// thing in the template AND it's a glob AND the most recently-
			// flushed literal ends with `/`. If so, make BOTH the leading `/`
			// AND the slot capture optional in the compiled regex, so a single
			// template like `Projects/{deeper...}` matches the bare `Projects`
			// folder too — restoring the typed-model entry-or-anywhere shape.
			//
			// Note: `/` is NOT in escapeRegex's character class (JS regex
			// doesn't require it escaped), so the literal `/` in the
			// preceding regex part appears as a plain `/`, not `\/`.
			const isLastToken = slotEnd === template.length - 1;
			const lastPart = regexParts[regexParts.length - 1] ?? '';
			const lastPartEndsWithSlash = lastPart.endsWith('/');
			const trailingOptionalGlob =
				isLastToken && slot.kind === 'glob' && lastPartEndsWithSlash;

			// Capture body: user-supplied regex if present (Tier B), else the
			// default segment (`[^/]+`) or glob (`.+`) pattern.
			const defaultBody = slot.kind === 'glob' ? '.+' : '[^/]+';
			const captureBody = slot.inlineRegex ?? defaultBody;

			if (trailingOptionalGlob) {
				slot.trailingOptionalGlob = true;
				// Strip the trailing `/` from the preceding literal.
				regexParts[regexParts.length - 1] = lastPart.slice(0, -1);
				// Emit optional non-capturing group containing the leading `/`
				// and the named capture.
				regexParts.push(`(?:/(?<${slot.captureGroupName}>${captureBody}))?`);
			} else {
				regexParts.push(`(?<${slot.captureGroupName}>${captureBody})`);
			}

			slots.push(slot);

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

	// Split on `|` for filters. The first part is name (+ optional `...` glob
	// suffix + optional `:regex` inline-regex constraint).
	const parts = trimmed.split('|').map((p) => p.trim());
	let nameKindRegex = parts[0];
	const filters = parts.slice(1).filter((f) => f.length > 0);

	// Tier B — extract `:regex` if present. The regex extends to the END of
	// the first part (we already split on `|` so anything after `:` is part
	// of the regex). Slot syntax: `{name:regex}` or `{name:regex...}`.
	let inlineRegex: string | undefined;
	const colonIdx = nameKindRegex.indexOf(':');
	if (colonIdx > 0) {
		const afterColon = nameKindRegex.slice(colonIdx + 1).trim();
		nameKindRegex = nameKindRegex.slice(0, colonIdx).trim();
		// `...` glob suffix can appear AFTER the regex: `{name:\d+...}`. Detect
		// + strip it from the regex side.
		if (afterColon.endsWith('...')) {
			inlineRegex = afterColon.slice(0, -3).trim();
			nameKindRegex = nameKindRegex + '...';
		} else {
			inlineRegex = afterColon;
		}
		if (inlineRegex.length === 0) {
			throw new TemplateParseError(
				'inline regex must not be empty (use `{name}` for default segment match, or `{name...}` for glob)',
				template,
				position,
			);
		}
	}

	// Detect glob suffix `...`
	let kind: 'segment' | 'glob' = 'segment';
	if (nameKindRegex.endsWith('...')) {
		kind = 'glob';
		nameKindRegex = nameKindRegex.slice(0, -3);
	}

	const name = nameKindRegex.trim();
	if (!/^[a-zA-Z_][a-zA-Z0-9_-]*$/.test(name)) {
		throw new TemplateParseError(
			`invalid slot name "${name}" (must match /^[a-zA-Z_][a-zA-Z0-9_-]*$/)`,
			template,
			position,
		);
	}

	// Tier B safety validation — for SEGMENT slots, the user regex must not
	// be able to match `/`. Otherwise one slot could eat multiple path
	// segments and break the rest of the template's anchoring.
	if (inlineRegex !== undefined) {
		validateInlineRegex(inlineRegex, kind, name, template, position);
	}

	return {
		name,
		captureGroupName: name, // overwritten in compileTemplate when added to slots[]
		kind,
		filters,
		inlineRegex,
		templatePosition: position,
	};
}

/**
 * Tier B safety validator — ensures user-supplied regex doesn't break path-
 * shape semantics. For segment slots, the regex must NOT match `/`. For glob
 * slots, all characters are allowed (matching `/` is the whole point).
 *
 * Why this matters: a segment-slot regex like `.+` or `\W` matches `/`, so
 * the slot would eat across path boundaries — breaking the surrounding
 * template's literal segments. The validator catches this at compile time
 * with a clear error message instead of silent runtime mismatching.
 */
function validateInlineRegex(
	pattern: string,
	kind: 'segment' | 'glob',
	slotName: string,
	template: string,
	position: number,
): void {
	let userRe: RegExp;
	try {
		userRe = new RegExp(pattern);
	} catch (e) {
		throw new TemplateParseError(
			`inline regex for slot "${slotName}" is invalid: ${(e as Error).message}`,
			template,
			position,
		);
	}
	if (kind === 'segment' && userRe.test('/')) {
		throw new TemplateParseError(
			`inline regex for slot "${slotName}" can match '/' — segment slots must not cross path boundaries. Use a glob slot ({${slotName}...}) for multi-segment matching, or constrain the regex (e.g. \\d+, [a-z]+, [A-Z]{2,3}).`,
			template,
			position,
		);
	}
}

function escapeRegex(literal: string): string {
	return literal.replace(/[\\^$.*+?()[\]{}|]/g, '\\$&');
}

/**
 * Find the index of the matching `}` for the opening `{` at `openIdx`.
 * Tracks brace depth to skip over inner `{}` from regex quantifiers like
 * `\d{1,2}`. Returns -1 if no matching close brace is found.
 */
function findMatchingCloseBrace(s: string, openIdx: number): number {
	let depth = 1;
	for (let j = openIdx + 1; j < s.length; j++) {
		if (s[j] === '{') depth++;
		else if (s[j] === '}') {
			depth--;
			if (depth === 0) return j;
		}
	}
	return -1;
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
		const literalBefore = template.slice(lastIndex, slotStartInTemplate);

		// Find the matching closing `}` via balanced-brace counting (Tier B
		// inline regex like `\d{1,2}` contains literal `}` that we must not
		// confuse with the slot terminator).
		const slotEnd = findMatchingCloseBrace(template, slotStartInTemplate);
		if (slotEnd === -1) {
			throw new TemplateParseError(
				`unclosed slot in template`,
				template,
				slotStartInTemplate,
			);
		}

		// Append the slot's value
		const value = slotValues[slot.name];
		if (value === undefined) {
			// Trailing-optional-glob: when the slot value is undefined, drop
			// both the slot AND the preceding `/` literal. This lets a
			// template like `Projects/{deeper...}` instantiate to `Projects`
			// (bare entry) when no deeper path is provided.
			if (slot.trailingOptionalGlob && literalBefore.endsWith('/')) {
				result += literalBefore.slice(0, -1);
				lastIndex = slotEnd + 1;
				continue;
			}
			throw new TemplateParseError(
				`missing value for slot "${slot.name}"`,
				template,
				slot.templatePosition,
			);
		}
		result += literalBefore;
		result += value;

		// Advance past the slot's `}` in the template
		lastIndex = slotEnd + 1;
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
