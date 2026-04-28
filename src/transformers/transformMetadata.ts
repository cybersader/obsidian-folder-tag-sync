/**
 * Per-transform bijectivity metadata table.
 *
 * Each filter (kebab-case, strip-emoji, etc.) has a reversibility profile
 * the engine reads at parse time to compute per-slot bijectivity status.
 * This is Layer 2 of the bijectivity-detection algorithm documented at
 * docs/concepts/bijectivity-detection.md.
 *
 * Conservative defaults: lossy unless we have evidence the transform
 * round-trips. Conditional means "reversible iff input matches the
 * documented domain"; the engine can call `isReversibleFor(input)` at
 * runtime for per-input precision.
 *
 * Adding a new filter: extend this table with the filter's name + profile.
 * The compiler in `src/engine/compileTemplate.ts` looks up filter names
 * here when computing per-slot reversibility.
 */

import { toKebabCase, toSnakeCase, toTitleCase } from './caseTransformers';

export type Reversibility = 'total' | 'lossy' | 'conditional';

export interface TransformBijectivityProfile {
	/** Reversibility classification for this filter */
	reversibility: Reversibility;

	/**
	 * Human-readable description of the input domain for which this transform
	 * is reversible. Surfaced in the rule editor's status indicator when the
	 * filter contributes a 'conditional' verdict.
	 */
	reversibilityDomain?: string;

	/**
	 * Optional predicate the engine can call at runtime to determine whether
	 * a specific input value is in the reversibility domain. When absent,
	 * the engine treats 'conditional' as "always conditional" — flag and warn.
	 */
	isReversibleFor?: (input: string) => boolean;

	/**
	 * The inverse transform, when expressible. For 'lossy' filters, no inverse
	 * exists (information is gone). For 'total' and 'conditional', the inverse
	 * is the best-effort reverse function — may not produce the original on
	 * all inputs, but is the engine's reconstruction.
	 */
	inverse?: (output: string) => string;
}

/**
 * The canonical metadata table. Indexed by the filter name as it appears in
 * a Path Lens template's pipe syntax (`{slug | kebab-case}` looks up
 * `'kebab-case'`).
 *
 * Order is informational; the engine reads these as a map.
 */
export const TRANSFORM_METADATA: Record<string, TransformBijectivityProfile> = {
	// === Identity / no-op ===

	'keep': {
		reversibility: 'total',
	},

	// === Case transforms — conditional ===

	'kebab-case': {
		reversibility: 'conditional',
		reversibilityDomain: 'input is lowercase word-characters with no internal hyphens',
		isReversibleFor: (input) =>
			/^[a-z][a-z0-9-]*$/.test(input) && !input.includes('--'),
		inverse: (output) => toTitleCase(output.replace(/-/g, ' ')),
	},

	'snake_case': {
		reversibility: 'conditional',
		reversibilityDomain: 'input is lowercase word-characters with no internal underscores',
		isReversibleFor: (input) =>
			/^[a-z][a-z0-9_]*$/.test(input) && !input.includes('__'),
		inverse: (output) => toTitleCase(output.replace(/_/g, ' ')),
	},

	'Title Case': {
		reversibility: 'conditional',
		reversibilityDomain: 'input has clean word boundaries; no acronyms or compound words',
		isReversibleFor: (input) => /^[A-Z][a-z]+(\s+[A-Z][a-z]+)*$/.test(input),
		inverse: (output) => toKebabCase(output),
	},

	'lower': {
		reversibility: 'conditional',
		reversibilityDomain: 'input is already lowercase (round-trip preserves casing)',
		isReversibleFor: (input) => input === input.toLowerCase(),
		inverse: (output) => toTitleCase(output),
	},

	'upper': {
		reversibility: 'conditional',
		reversibilityDomain: 'input is already uppercase (round-trip preserves casing)',
		isReversibleFor: (input) => input === input.toUpperCase(),
		inverse: (output) => toTitleCase(output),
	},

	'camelCase': {
		reversibility: 'conditional',
		reversibilityDomain: 'input has clean word boundaries; first letter lowercase, others uppercase',
		isReversibleFor: (input) => /^[a-z][a-zA-Z0-9]*$/.test(input),
		inverse: (output) => toKebabCase(output),
	},

	'PascalCase': {
		reversibility: 'conditional',
		reversibilityDomain: 'input has clean word boundaries; all word-initial letters uppercase',
		isReversibleFor: (input) => /^[A-Z][a-zA-Z0-9]*$/.test(input),
		inverse: (output) => toKebabCase(output),
	},

	// === Emoji handling ===

	'strip-emoji': {
		reversibility: 'lossy',
		reversibilityDomain: 'never reversible — emoji content is discarded',
	},

	'keep-emoji': {
		reversibility: 'total',
	},

	// === Number-prefix handling ===

	'strip-num-prefix': {
		reversibility: 'lossy',
		reversibilityDomain: 'never reversible — numeric prefix is discarded',
	},

	// === Tag-safety ===

	'strip-invalid-tag-chars': {
		reversibility: 'lossy',
		reversibilityDomain:
			'never reversible — invalid-for-tags chars (.,;:?!@\\) discarded. Use on tag side to keep emitted tags Obsidian-valid (e.g., {name | strip-invalid-tag-chars | kebab-case} on `Tasks, Planning` → `tasks-planning`).',
	},

	'keep-num-prefix': {
		reversibility: 'total',
	},

	'extract-num-prefix': {
		reversibility: 'conditional',
		reversibilityDomain: 'extracted prefix is preserved in a separate slot for re-attachment on inverse',
		// Note: full reversibility requires the extracted value to flow into another slot.
		// Without that, this is effectively lossy. The compiler should warn when the
		// extracted slot isn't referenced on the other side of the rule.
	},

	// === Glob aggregation ===

	"join('-')": {
		reversibility: 'lossy',
		reversibilityDomain:
			'inputs contain no `-` characters (provably impossible to guarantee in general)',
	},

	"join('_')": {
		reversibility: 'lossy',
		reversibilityDomain:
			'inputs contain no `_` characters (provably impossible to guarantee in general)',
	},

	"join('/')": {
		reversibility: 'total',
		// '/' is the path separator; joining with / is structurally identity for path-shaped data
	},

	// === Custom regex ===

	'regex-replace': {
		reversibility: 'lossy',
		reversibilityDomain:
			'no general inverse — depends on the user-provided pattern + replacement',
	},
};

/**
 * Look up a filter's reversibility profile. Returns undefined for unknown
 * filter names; callers should treat unknown filters as 'lossy' by default
 * (conservative).
 */
export function getFilterMetadata(filterName: string): TransformBijectivityProfile | undefined {
	return TRANSFORM_METADATA[filterName];
}

/**
 * Compose a chain of filter reversibilities. Returns the most-restrictive
 * verdict in the chain:
 *
 * - Any filter `lossy` → chain is `lossy`
 * - Any filter `conditional` (and no lossy) → chain is `conditional`
 * - All filters `total` → chain is `total`
 *
 * Unknown filters are treated as 'lossy' (conservative).
 */
export function composeFilterChain(filterNames: string[]): Reversibility {
	let result: Reversibility = 'total';
	for (const name of filterNames) {
		const meta = getFilterMetadata(name);
		if (!meta) return 'lossy'; // unknown filter — conservative
		if (meta.reversibility === 'lossy') return 'lossy'; // short-circuit on lossy
		if (meta.reversibility === 'conditional') {
			result = 'conditional';
		}
	}
	return result;
}

/**
 * Aggregate per-slot reversibilities into a rule-level verdict. Same logic
 * as composeFilterChain but operates on Reversibility values directly.
 */
export function aggregateSlotReversibilities(slotResults: Reversibility[]): Reversibility {
	let result: Reversibility = 'total';
	for (const r of slotResults) {
		if (r === 'lossy') return 'lossy';
		if (r === 'conditional') result = 'conditional';
	}
	return result;
}
