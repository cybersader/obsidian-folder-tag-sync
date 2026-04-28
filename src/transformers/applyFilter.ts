/**
 * Per-slot filter runtime for Path Lens templates.
 *
 * The compiler in `src/engine/compileTemplate.ts` parses `{slot | filter | filter}`
 * syntax into filter-name lists. This module turns those filter-name lists
 * into actual string transformations at runtime, dispatching to the existing
 * transformers (case, emoji, number-prefix) under the hood.
 *
 * Forward direction (folder → tag) applies filters in order. Inverse direction
 * (tag → folder) walks the chain in reverse and uses each filter's metadata
 * `inverse` function. When a filter is `lossy`, no inverse exists — the
 * inverse path returns the input unchanged and the engine flags the rule as
 * non-bijective at this slot.
 *
 * Scope: only filters listed in `transformMetadata.TRANSFORM_METADATA`.
 * Unknown filters log a warning and pass through as identity.
 */

import { applyCaseTransform } from './caseTransformers';
import { stripEmoji, stripInvalidTagChars } from './emojiTransformers';
import { extractNumberPrefix, stripNumberPrefix } from './numberTransformers';
import { TRANSFORM_METADATA } from './transformMetadata';

/**
 * Apply a single filter forward (folder → tag direction).
 *
 * Unknown filters log and pass through as identity, matching the conservative
 * default in `getFilterMetadata` (which treats unknowns as `lossy`).
 */
export function applyFilter(value: string, filterName: string): string {
	switch (filterName) {
		case 'keep':
		case 'keep-emoji':
		case 'keep-num-prefix':
			return value;

		case 'kebab-case':
		case 'snake_case':
		case 'Title Case':
		case 'camelCase':
		case 'PascalCase':
			return applyCaseTransform(value, filterName);

		case 'lower':
			return value.toLowerCase();
		case 'upper':
			return value.toUpperCase();

		case 'strip-emoji':
			return stripEmoji(value);

		case 'strip-invalid-tag-chars':
			return stripInvalidTagChars(value);

		case 'strip-num-prefix':
			return stripNumberPrefix(value);

		case 'extract-num-prefix': {
			const result = extractNumberPrefix(value);
			return result.number ?? '';
		}

		case "join('-')":
		case "join('_')":
		case "join('/')": {
			// Glob slots capture `/`-separated segments. Join filter swaps the
			// separator. Identity for `join('/')`.
			const sep = filterName.match(/^join\('(.+)'\)$/)?.[1] ?? '/';
			return value.split('/').join(sep);
		}

		case 'regex-replace':
			// Bare `regex-replace` has no pattern/replacement args — pass through.
			// Future: support `{slot | regex-replace('pat','rep')}` syntax.
			return value;

		default:
			// eslint-disable-next-line no-console
			console.warn(`Unknown Path Lens filter: "${filterName}" — passing through unchanged`);
			return value;
	}
}

/**
 * Apply a chain of filters in order. The output of each filter feeds the next.
 */
export function applyFilterChain(value: string, filterNames: string[]): string {
	let result = value;
	for (const name of filterNames) {
		result = applyFilter(result, name);
	}
	return result;
}

/**
 * Apply a single filter's inverse (tag → folder direction).
 *
 * Reads the `inverse` function from `TRANSFORM_METADATA`. For `lossy` filters
 * (no inverse), returns the input unchanged — the caller should already know
 * the rule isn't bijective at this slot via `computeBijectivity`. For
 * `conditional` filters, the inverse is the metadata's best-effort guess
 * (won't recover the original on inputs outside the reversibility domain).
 *
 * Unknown filters: identity pass-through (matches forward behavior).
 */
export function applyFilterInverse(value: string, filterName: string): string {
	const meta = TRANSFORM_METADATA[filterName];
	if (!meta) {
		// eslint-disable-next-line no-console
		console.warn(`Unknown Path Lens filter (inverse): "${filterName}"`);
		return value;
	}
	if (meta.reversibility === 'lossy' || !meta.inverse) {
		// No inverse exists. Return identity; caller should treat this as
		// non-bijective at the slot.
		return value;
	}
	return meta.inverse(value);
}

/**
 * Apply a chain of filters in reverse order using each filter's inverse.
 * `[A, B, C]` forward → `[C^-1, B^-1, A^-1]` reverse.
 */
export function applyFilterChainInverse(value: string, filterNames: string[]): string {
	let result = value;
	for (let i = filterNames.length - 1; i >= 0; i--) {
		result = applyFilterInverse(result, filterNames[i]);
	}
	return result;
}
