import { parseFrontmatterTags } from './frontmatterTags';
import { parseWitness } from './frontmatterWitness';

/** The live writer's parser. Extraction only: normalization and fence semantics stay unchanged. */
export function splitForwardFrontmatter(content: string): { frontmatter: string; body: string } {
	let normalized = content.charCodeAt(0) === 0xfeff ? content.slice(1) : content;
	normalized = normalized.replace(/\r\n?/g, '\n');
	const match = normalized.match(/^---\n([\s\S]*?)\n---(?:\n([\s\S]*))?$/);
	return match ? { frontmatter: match[1], body: match[2] ?? '' } : { frontmatter: '', body: normalized };
}

export function normalizeCacheFrontmatterTags(value: unknown): string[] {
	if (value == null) return [];
	return (Array.isArray(value) ? value : [value])
		.map((tag) => String(tag).trim()).filter(Boolean)
		.map((tag) => tag.startsWith('#') ? tag : `#${tag}`);
}

/** Caller discards content immediately; this value contains no body or unrelated cached properties. */
export function readForwardTagInputs(content: string, cacheValue: unknown): {
	frontmatter: string; cacheTags: string[]; warnings: string[];
} {
	const { frontmatter } = splitForwardFrontmatter(content);
	const normalized = content.replace(/^﻿/, '').replace(/\r\n?/g, '\n');
	const warnings = !frontmatter && normalized.startsWith('---\n')
		? ['Frontmatter fences are unsupported or malformed; the writer may prepend a new block.'] : [];
	return { frontmatter, cacheTags: normalizeCacheFrontmatterTags(cacheValue), warnings };
}

export interface ForwardTagDelta {
	currentTags: string[];
	cacheTags: string[];
	newTagsToAdd: string[];
	tagsToRemove: string[];
	updatedTags: string[];
	/** Actual disk-parsed tag-set delta, not merely the writer's reported operations. */
	added: string[];
	removed: string[];
	unchanged: string[];
	shouldWrite: boolean;
	witnessWritten: boolean;
	warnings: string[];
}

/** Exact extraction of syncFile's decision. Does not validate emitted syntax or repair legacy behavior. */
export function decideForwardTagDelta(
	frontmatter: string,
	cacheTags: readonly string[],
	emitted: readonly string[],
	options: { removeOrphanedTags?: boolean; frontmatterMemory?: boolean },
): ForwardTagDelta {
	const currentTags = parseFrontmatterTags(frontmatter);
	const existingForDecision = new Set([...currentTags, ...cacheTags]);
	// Live sync returns before reading/cleaning up when output is empty.
	const newTagsToAdd = emitted.length ? emitted.filter((tag) => !existingForDecision.has(tag)) : [];
	let tagsToRemove: string[] = [];
	if (emitted.length && options.removeOrphanedTags) {
		const witness = parseWitness(frontmatter);
		if (witness) {
			const emittedNow = new Set(emitted.map((tag) => tag.replace(/^#/, '')));
			tagsToRemove = witness.tags.filter((tag) => !emittedNow.has(tag))
				.map((tag) => `#${tag}`).filter((tag) => currentTags.includes(tag));
		}
	}
	const shouldWrite = newTagsToAdd.length > 0 || tagsToRemove.length > 0;
	const remove = new Set(tagsToRemove);
	const updatedTags = shouldWrite
		? [...currentTags.filter((tag) => !remove.has(tag)), ...newTagsToAdd] : [...currentTags];
	const warnings: string[] = [];
	if (cacheTags.some((tag) => !currentTags.includes(tag)) || currentTags.some((tag) => !cacheTags.includes(tag))) {
		warnings.push('Disk and metadata-cache tags differ. Additions use their union; a write reconstructs tags from disk parsing only. Preservation of every existing tag is not guaranteed.');
	}
	if (/^(?:["']tags?["']\s*:|tags?\s*:\s*[&*{!|>]|-\s+)/mi.test(frontmatter)
		|| (frontmatter.match(/^tags?\s*:/gmi)?.length ?? 0) > 1
		|| currentTags.some((tag) => /[\s\[\]{}]/.test(tag))) {
		warnings.push('Unsupported or ambiguous tag syntax. These are the legacy writer’s parsed tags, not a guarantee that all YAML tags are preserved.');
	}
	return {
		currentTags, cacheTags: [...cacheTags], newTagsToAdd, tagsToRemove, updatedTags,
		added: updatedTags.filter((tag) => !currentTags.includes(tag)),
		removed: currentTags.filter((tag) => !updatedTags.includes(tag)),
		unchanged: currentTags.filter((tag) => updatedTags.includes(tag)),
		shouldWrite, witnessWritten: shouldWrite && !!options.frontmatterMemory, warnings,
	};
}
