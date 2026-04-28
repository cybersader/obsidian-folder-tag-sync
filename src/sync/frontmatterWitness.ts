/**
 * F3 commit 1 — Frontmatter witness helpers (pure, no Obsidian dep).
 *
 * The witness is a `fts:` namespaced block written to a file's frontmatter
 * when forward sync runs against a rule with `frontmatterMemory: true`.
 * It records: origin folder path, rule id, the set of tags FTS wrote,
 * timestamp. This data unblocks safe orphan-cleanup (A6) and cross-area-
 * move detection (A5) — without it, the engine can't tell which tags it
 * owns vs which the user added manually.
 *
 * v1 schema is intentionally minimal — just enough to unblock A6 + A5.
 * Slot values + version field can be added later without breaking
 * compatibility (additive YAML, parser ignores unknown keys).
 *
 * Per docs/concepts/bijectivity-detection.md "F3 plug-in seam".
 */

export interface WitnessRecord {
	origin: string;
	ruleId: string;
	tags: string[];
	timestamp: string;
}

/**
 * Inject the `fts:` witness block into a frontmatter YAML string. If a
 * `fts:` block already exists, replace it; otherwise append. Returns the
 * updated frontmatter.
 */
export function injectWitness(frontmatter: string, witness: WitnessRecord): string {
	const yaml = [
		'fts:',
		`  origin: "${witness.origin.replace(/"/g, '\\"')}"`,
		`  ruleId: "${witness.ruleId}"`,
		`  timestamp: "${witness.timestamp}"`,
		`  tags:`,
		...witness.tags.map((t) => `    - "${t.replace(/"/g, '\\"')}"`),
	].join('\n');

	const ftsBlockRegex = /^fts:\s*\n(?:\s+.+\n?)*/m;
	if (ftsBlockRegex.test(frontmatter)) {
		return frontmatter.replace(ftsBlockRegex, yaml + '\n');
	}
	return `${frontmatter.trimEnd()}\n${yaml}`;
}

/**
 * Parse the `fts:` witness block from a frontmatter YAML string. Returns
 * null if no witness present or if parsing fails (graceful — sync continues
 * without orphan cleanup). Manual line-based parser since Obsidian's
 * frontmatter is fragile YAML and we don't want a heavy dep.
 */
export function parseWitness(frontmatter: string): WitnessRecord | null {
	const ftsBlockRegex = /^fts:\s*\n((?:\s+.+\n?)*)/m;
	const m = frontmatter.match(ftsBlockRegex);
	if (!m) return null;
	const body = m[1];
	const originMatch = body.match(/^\s+origin:\s*"((?:[^"\\]|\\.)*)"/m);
	const ruleIdMatch = body.match(/^\s+ruleId:\s*"((?:[^"\\]|\\.)*)"/m);
	if (!originMatch || !ruleIdMatch) return null;
	const timestampMatch = body.match(/^\s+timestamp:\s*"((?:[^"\\]|\\.)*)"/m);
	const tagsBlockMatch = body.match(/^\s+tags:\s*\n((?:\s+- .+\n?)*)/m);
	const tags: string[] = [];
	if (tagsBlockMatch) {
		const tagLineRegex = /^\s+-\s*"((?:[^"\\]|\\.)*)"/gm;
		let tm: RegExpExecArray | null;
		while ((tm = tagLineRegex.exec(tagsBlockMatch[1])) !== null) {
			tags.push(tm[1].replace(/\\"/g, '"'));
		}
	}
	return {
		origin: originMatch[1].replace(/\\"/g, '"'),
		ruleId: ruleIdMatch[1].replace(/\\"/g, '"'),
		timestamp: timestampMatch?.[1].replace(/\\"/g, '"') ?? '',
		tags,
	};
}
