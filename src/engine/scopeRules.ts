/**
 * scopeRules — rewrite a list of MappingRules so they apply only inside a
 * specific scope folder (the user-selected branch in the detection tree).
 *
 * The hierarchy-first detection view promises that "selecting a folder
 * makes the rules local to that folder." Without this rewrite, the rules
 * would fire wherever their original folder pattern matched in the vault,
 * defeating the user's selection. Auto-scoping makes the selection
 * semantic, not just visual.
 *
 * Rewrite shape:
 *   - folderPattern: prepend an anchored, regex-escaped scope path right
 *     after `^`. `^\d+ - ` scoped to `Projects/Cybersader/01 - Active`
 *     becomes `^Projects/Cybersader/01 - Active/\d+ - `.
 *   - folderTemplate: literally prepend the scope path with a slash.
 *     `{deeper...}` scoped to the same folder becomes
 *     `Projects/Cybersader/01 - Active/{deeper...}`.
 *   - folderEntryPoint: set to the scope path directly. Used by the
 *     guided UI to show the entry point cleanly.
 *   - id: suffixed with a slug of the scope path so multiple selections of
 *     the same pack at different scopes don't collide on insert.
 *   - name: appended " @ <scopePath>" so the user can tell which
 *     instance of a duplicated rule is which.
 *
 * Scope = '' (empty) is a no-op: the rule applies vault-wide as written.
 *
 * Pure — no Obsidian, no I/O. Tested.
 */

import type { MappingRule } from '../types/settings';

/**
 * Apply a scope to a single rule. Returns a NEW rule object — never
 * mutates the input. Re-scoping an already-scoped rule should pass the
 * un-scoped version: this function does not detect prior scoping.
 */
export function scopeRule(rule: MappingRule, scopePath: string): MappingRule {
	if (scopePath === '') return { ...rule }; // no-op clone preserves call-site immutability
	const slug = pathToSlug(scopePath);
	return {
		...rule,
		id: `${rule.id}__${slug}`,
		name: `${rule.name} @ ${scopePath}`,
		folderPattern: rule.folderPattern ? scopePattern(rule.folderPattern, scopePath) : rule.folderPattern,
		folderTemplate: rule.folderTemplate ? scopeTemplate(rule.folderTemplate, scopePath) : rule.folderTemplate,
		folderEntryPoint: scopePath,
	};
}

/**
 * Apply a scope to many rules at once. Convenience for the apply path.
 */
export function scopeRules(rules: MappingRule[], scopePath: string): MappingRule[] {
	return rules.map((r) => scopeRule(r, scopePath));
}

/**
 * Prepend a scope path to a regex pattern. Folder paths can contain regex
 * metacharacters (`.`, `(`, `)`, `+`, etc.) so the prefix must be escaped.
 *
 * Conventions of pack-shipped patterns:
 *   - All start with `^`. The escaped prefix slots in right after.
 *   - If a pattern lacks `^`, the prefix wraps: `(?:scope/)<original>`.
 *     This isn't strictly anchored, but matches the intent of "scoped
 *     to this folder" without breaking the original pattern's semantics.
 */
function scopePattern(pattern: string, scopePath: string): string {
	const escaped = escapeRegex(scopePath);
	if (pattern.startsWith('^')) {
		return `^${escaped}/${pattern.slice(1)}`;
	}
	return `(?:${escaped}/)${pattern}`;
}

/**
 * Prepend a scope path to a Path Lens template. Templates are literal
 * folder paths with `{name}` slot syntax — no escaping needed.
 */
function scopeTemplate(template: string, scopePath: string): string {
	return `${scopePath}/${template}`;
}

/**
 * Escape regex metacharacters in a string so it can be embedded literally
 * into a regex pattern.
 */
function escapeRegex(s: string): string {
	return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Convert a folder path to a slug suitable for use in a rule ID. Removes
 * slashes, spaces, and special characters; lowercases.
 */
function pathToSlug(path: string): string {
	return path
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Reduce a list of selected scope paths to a "minimal cover" — drops any
 * path that is a descendant of another path in the same list. This avoids
 * applying a pack's rules twice at overlapping scopes.
 *
 * Example: selecting both `Projects` and `Projects/Cybersader` would, by
 * default, install JD rules at both scopes — but `Projects/Cybersader` is
 * already covered by the broader `Projects` scope (the JD rule at
 * `Projects` matches numbered folders anywhere under it). Reducing to
 * just `Projects` avoids duplicate firing.
 *
 * If the user specifically wants different rules at the inner scope,
 * they should select ONLY the inner scope, not both.
 */
export function minimalScopeCover(scopePaths: string[]): string[] {
	const sorted = [...scopePaths].sort((a, b) => a.length - b.length);
	const cover: string[] = [];
	for (const path of sorted) {
		const isCovered = cover.some((c) => isAncestorOrEqual(c, path));
		if (!isCovered) cover.push(path);
	}
	return cover;
}

/** True iff `ancestor` equals or is a strict ancestor of `target` (segment-aligned). */
function isAncestorOrEqual(ancestor: string, target: string): boolean {
	if (ancestor === target) return true;
	if (ancestor === '') return true;
	return target.startsWith(ancestor + '/');
}
