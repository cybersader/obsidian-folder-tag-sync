/**
 * Template-driven rule runtime.
 *
 * When a `MappingRule` has both `folderTemplate` and `tagTemplate` set, the
 * sync engine uses this module instead of the typed-model `applyTransfer.ts`
 * runtime. Templates produce sync via:
 *
 *   forward (folder → tag):
 *     1. compile folderTemplate → regex + slot list
 *     2. extract slot values from the folder path
 *     3. apply each slot's folder-side filters (forward)
 *     4. apply each slot's tag-side filters (forward)
 *     5. instantiate tagTemplate with the transformed slot values
 *
 *   inverse (tag → folder):
 *     1. compile tagTemplate → regex + slot list
 *     2. extract slot values from the tag
 *     3. apply each slot's tag-side filters (inverse)
 *     4. apply each slot's folder-side filters (inverse)
 *     5. instantiate folderTemplate with the transformed slot values
 *
 * Bijectivity is per-rule and per-slot (see `computeBijectivity`); this
 * runtime is honest about it via the `lossy` field on its result types.
 *
 * F3 plug-in seam (frontmatter as bijection memory) ─────────────────────
 *
 * The canonical bijectivity verdict here is *per-rule*: kebab-case is
 * "conditional" because some inputs (`Web-Auth`) round-trip cleanly and
 * some (`Web--Auth` with double-dash) don't. We currently flag the entire
 * rule as `lossy: true` for any conditional filter — the conservative call.
 *
 * F3 (frontmatter witness) wants *per-instance* precision: if file
 * `oauth.md` was forward-synced from `Projects/Web Auth` and we recorded
 * the original slot values in frontmatter, the inverse direction can use
 * the stored value INSTEAD of recovering through `applyFilterChainInverse`.
 * That gives bijective recovery on lossy rules for files that have been
 * synced through them at least once.
 *
 * The plug-in seam is between steps 2 and 3 in each direction — slot
 * values arrive from `extractSlots`, then we call `applyFilterChain*` on
 * them. F3 will inject between these: read frontmatter, override extracted
 * slot values where stored values exist, then proceed.
 *
 * Concretely, the future signature will be roughly:
 *
 *   applyTemplateRuleInverse(
 *     tag: string,
 *     rule: MappingRule,
 *     ctx?: { storedSlots?: Record<string, string> }  // ← F3 injection
 *   ): InverseResult
 *
 * Today's API does NOT take a context param — keeping the runtime pure
 * until F3's research settles namespace/schema/migration design (see
 * `concepts/bijectivity-detection.md` and `about/roadmap.md` Increment 3).
 * The seam is documented here so future work knows where to plug in
 * without restructuring the runtime.
 */

import type { MappingRule } from '../types/settings';
import type { ForwardResult, InverseResult } from './applyTransfer';
import {
	type CompiledTemplate,
	compileTemplate,
	computeBijectivity,
	extractSlots,
	instantiateTemplate,
	TemplateParseError,
} from './compileTemplate';
import { applyFilterChain, applyFilterChainInverse } from '../transformers/applyFilter';

/**
 * Folder → tag(s) via templates.
 *
 * Returns `{ tags: [], lossy: false }` when:
 *   - the rule is not template-shaped (caller should dispatch elsewhere)
 *   - the folder path doesn't match the folder template
 *   - template instantiation fails (e.g., a slot value is empty)
 */
export function applyTemplateRuleForward(folderPath: string, rule: MappingRule): ForwardResult {
	if (!rule.folderTemplate || !rule.tagTemplate) {
		return { tags: [], lossy: false };
	}

	let folderCompiled: CompiledTemplate;
	let tagCompiled: CompiledTemplate;
	try {
		folderCompiled = compileTemplate(rule.folderTemplate);
		tagCompiled = compileTemplate(rule.tagTemplate);
	} catch (e) {
		// Should be caught at load-time, but guard at runtime too.
		return { tags: [], lossy: false };
	}

	const slots = extractSlots(folderCompiled, folderPath);
	if (slots === null) {
		return { tags: [], lossy: false };
	}

	const tagSlotMap = new Map(tagCompiled.slots.map((s) => [s.name, s]));
	const transformedSlots: Record<string, string> = {};

	for (const folderSlot of folderCompiled.slots) {
		const value = slots[folderSlot.name];
		if (value === undefined) continue;

		// Apply folder-side filters first, then tag-side filters
		// (the slot value flows through both filter chains).
		const afterFolder = applyFilterChain(value, folderSlot.filters);
		const tagSlot = tagSlotMap.get(folderSlot.name);
		const afterTag = tagSlot ? applyFilterChain(afterFolder, tagSlot.filters) : afterFolder;

		transformedSlots[folderSlot.name] = afterTag;
	}

	// Tag template may reference slots that don't appear on the folder side.
	// `computeBijectivity` flags these as `tagOnlySlots` (config error). At
	// runtime, we can't satisfy them — bail with no emission.
	for (const tagSlot of tagCompiled.slots) {
		if (transformedSlots[tagSlot.name] === undefined) {
			return { tags: [], lossy: true };
		}
	}

	let tag: string;
	try {
		tag = instantiateTemplate(tagCompiled, transformedSlots);
	} catch (e) {
		if (e instanceof TemplateParseError) {
			return { tags: [], lossy: false };
		}
		throw e;
	}

	const verdict = computeBijectivity(rule.folderTemplate, rule.tagTemplate);
	const tagWithHash = tag.startsWith('#') ? tag : `#${tag}`;
	return { tags: [tagWithHash], lossy: verdict.status !== 'total' };
}

/**
 * Tag → folder via templates.
 *
 * Returns `{ folder: null, lossy: ... }` when:
 *   - the rule is not template-shaped
 *   - the tag doesn't match the tag template
 *   - template instantiation fails
 */
export function applyTemplateRuleInverse(tag: string, rule: MappingRule): InverseResult {
	if (!rule.folderTemplate || !rule.tagTemplate) {
		return { folder: null, lossy: false };
	}

	let folderCompiled: CompiledTemplate;
	let tagCompiled: CompiledTemplate;
	try {
		folderCompiled = compileTemplate(rule.folderTemplate);
		tagCompiled = compileTemplate(rule.tagTemplate);
	} catch (e) {
		return { folder: null, lossy: false };
	}

	// Tags coming in may or may not have a leading `#` — the template's
	// literal prefix dictates which. Try the raw tag first; if it doesn't
	// match, try toggling the `#` (strip if present, prepend if absent)
	// to be tolerant of either convention.
	let slots = extractSlots(tagCompiled, tag);
	if (slots === null) {
		const toggled = tag.startsWith('#') ? tag.slice(1) : `#${tag}`;
		slots = extractSlots(tagCompiled, toggled);
	}
	if (slots === null) {
		return { folder: null, lossy: false };
	}

	const folderSlotMap = new Map(folderCompiled.slots.map((s) => [s.name, s]));
	const transformedSlots: Record<string, string> = {};

	for (const tagSlot of tagCompiled.slots) {
		const value = slots[tagSlot.name];
		if (value === undefined) continue;

		// Inverse direction: walk tag-side filters in reverse, then folder-side
		// filters in reverse. For lossy filters, inverse is identity; the
		// reconstructed value won't equal the original (the slot is non-bijective).
		const afterTag = applyFilterChainInverse(value, tagSlot.filters);
		const folderSlot = folderSlotMap.get(tagSlot.name);
		const afterFolder = folderSlot
			? applyFilterChainInverse(afterTag, folderSlot.filters)
			: afterTag;

		transformedSlots[tagSlot.name] = afterFolder;
	}

	// Folder template may have slots not in the tag template (folder-only
	// slots — discarded in forward direction). The inverse can't recover
	// them; bail.
	for (const folderSlot of folderCompiled.slots) {
		if (transformedSlots[folderSlot.name] === undefined) {
			return { folder: null, lossy: true };
		}
	}

	let folder: string;
	try {
		folder = instantiateTemplate(folderCompiled, transformedSlots);
	} catch (e) {
		if (e instanceof TemplateParseError) {
			return { folder: null, lossy: false };
		}
		throw e;
	}

	const verdict = computeBijectivity(rule.folderTemplate, rule.tagTemplate);
	return { folder, lossy: verdict.status !== 'total' };
}

/**
 * Predicate: does this rule use template-shaped semantics?
 * Engine dispatch hinges on this — if true, route to template runtime;
 * otherwise fall through to the typed-model / raw-regex runtime.
 */
export function isTemplateRule(rule: MappingRule): boolean {
	return Boolean(rule.folderTemplate && rule.tagTemplate);
}
