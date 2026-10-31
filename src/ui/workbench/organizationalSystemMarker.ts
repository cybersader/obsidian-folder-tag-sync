export const ORGANIZATIONAL_SYSTEM_MARKER_COLOR_TOKENS = Object.freeze([
	'var(--color-blue)',
	'var(--color-cyan)',
	'var(--color-purple)',
	'var(--color-pink)',
	'var(--color-orange)',
	'var(--color-yellow)',
] as const);

export type OrganizationalSystemMarkerColorToken =
	(typeof ORGANIZATIONAL_SYSTEM_MARKER_COLOR_TOKENS)[number];

export interface OrganizationalSystemMarkerPresentation {
	/** Exact identity remains primary; the colour is only a supporting cue. */
	occurrenceKey: string;
	colorToken: OrganizationalSystemMarkerColorToken;
}

/**
 * Describe a stable visual marker for one exact organizational-system occurrence.
 *
 * The full collision-safe occurrence key is hashed rather than its pack prefix, so
 * repeated deployments of one pack do not inherit one pack-wide marker. The
 * restrained palette is deliberately secondary to the surrounding text and exact
 * occurrence identity. This helper is pure and independent of render order.
 */
export function describeOrganizationalSystemMarker(
	occurrenceKey: string,
): OrganizationalSystemMarkerPresentation {
	const paletteIndex = hashOccurrenceKey(occurrenceKey)
		% ORGANIZATIONAL_SYSTEM_MARKER_COLOR_TOKENS.length;
	return {
		occurrenceKey,
		colorToken: ORGANIZATIONAL_SYSTEM_MARKER_COLOR_TOKENS[paletteIndex],
	};
}

/** 32-bit FNV-1a over every UTF-16 code unit in the exact occurrence key. */
function hashOccurrenceKey(occurrenceKey: string): number {
	let hash = 0x811c9dc5;
	for (let index = 0; index < occurrenceKey.length; index++) {
		hash ^= occurrenceKey.charCodeAt(index);
		hash = Math.imul(hash, 0x01000193);
	}
	return hash >>> 0;
}
