/**
 * axisConventions — the SEACOW axis → tag-prefix-marker table plus the
 * slug helper for turning a folder/segment name into a tag entry.
 *
 * Pure. No Obsidian, no I/O. Lifted out of the guided rule-editor UI so the
 * upcoming rule-authoring synthesizer can reuse the same axis→marker mapping
 * and slug convention without importing UI code.
 *
 * The marker convention follows docs/concepts/axes.md.
 */

import type { Axis, TagPrefixMarker } from '../types/typed';
import { stripEmojiOnly, stripJDPrefix } from './folderNormalize';

export interface AxisConvention {
	label: string;
	marker: TagPrefixMarker;
	description: string;
}

/** SEACOW prefix-marker convention per docs/concepts/axes.md */
export const AXIS_CONVENTIONS: Record<Axis, AxisConvention> = {
	system: { label: 'System', marker: '/', description: 'Platform, config, templates' },
	entity: { label: 'Entity', marker: '--', description: 'Workspace owner, authority' },
	capture: { label: 'Capture', marker: '-', description: 'Ingestion, inbox, clippings' },
	output: { label: 'Output', marker: '_', description: 'Publishable, external-facing' },
	work: { label: 'Work', marker: null, description: 'Active processing (PARA, JD)' },
	relation: { label: 'Relation', marker: null, description: 'Flat cross-link keywords' },
};

/**
 * Convert a folder/segment name into a clean tag-entry slug.
 *
 * Mirrors the existing slug conventions in the codebase rather than inventing
 * a new one:
 *   - `scopeRules.ts:pathToSlug` — lowercase, non-alphanumeric runs → `-`,
 *     trim leading/trailing `-`.
 *   - decorative emoji and Johnny-Decimal numeric prefixes are stripped first
 *     (same normalization detection uses), so `📁 01 - Project Notes` slugs
 *     to a meaningful `project-notes` rather than `01-project-notes`.
 *
 * The lowercase + `[^a-z0-9]+ → -` collapse inherently drops characters
 * Obsidian forbids in tags (`.:;,?!@\` and whitespace), so the result is
 * always a valid tag segment.
 *
 * Examples:
 *   "Project Notes"        → "project-notes"
 *   "📁 01 - Project Notes" → "project-notes"
 *   "already-clean"        → "already-clean"
 */
export function slugifyToTagEntry(name: string): string {
	const undecorated = stripJDPrefix(stripEmojiOnly(name));
	return undecorated
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}
