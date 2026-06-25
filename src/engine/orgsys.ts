/**
 * `.orgsys` — shareable organizational-system definition format (Phase 0).
 *
 * An `.orgsys` file is the *human-authorable source* for an organizational
 * system (PARA, Johnny Decimal, …). It defines the system as a small set of
 * SLOTS that the compiler (`compileSystemDef.ts`) lowers into the plugin's
 * existing rule-pack JSON ("bytecode"). Where `rule-packs/para.json` restates
 * "Projects" three times across four near-identical 25-line rule blocks, the
 * `.orgsys` source says it once as one parametric slot.
 *
 * ── Parser choice ──────────────────────────────────────────────────────────
 * This module ships a *minimal purpose-built* YAML-subset reader rather than
 * pulling in a YAML dependency. Rationale:
 *
 *   - `js-yaml` / `yaml` exist in `node_modules`, but ONLY as transitive dev
 *     dependencies of eslint + mocha. They are NOT runtime deps and NOT in the
 *     plugin bundle. Importing either into `src/` would drag a full YAML engine
 *     into `main.js` via esbuild — the exact bundle-weight the user flagged.
 *   - The `.orgsys` grammar is small and flat: block mappings, block sequences
 *     of mappings, flow sequences (`[a, b]`), quoted/plain scalars, and `#`
 *     comments. A focused ~150-line reader covers it with zero new bytes from
 *     a third-party lib.
 *
 * The reader is deliberately NOT a general YAML implementation — it supports
 * exactly the subset the `.orgsys` schema uses. Inputs outside that subset
 * (anchors/aliases, multi-line scalars, flow maps, tabs-as-indent) are out of
 * scope and may parse incorrectly; callers should stay within the documented
 * schema.
 */

import type { RuleDirection, CaseTransformType } from '../types/settings';

// ─── Phase-0 `.orgsys` schema ──────────────────────────────────────────────

/** Where in the vault tree the whole system anchors. Mirrors `FolderAnchor`. */
export type OrgsysAnchorMode = 'root' | 'any-segment' | { under: string };

export interface OrgsysAnchor {
	/** Default anchor mode for every slot in the system. */
	default: OrgsysAnchorMode;
	/** Reserved (Phase 0): whether the system may be relocated under a host. */
	relocatable?: boolean;
}

export interface OrgsysDefaults {
	/** Sync direction applied to every slot unless overridden. */
	direction?: RuleDirection;
	/** Case transform for the folder face (e.g. `Title Case`). */
	folderCase?: CaseTransformType;
	/** Case transform for the tag face (e.g. `kebab-case`). */
	tagCase?: CaseTransformType;
	/** Emoji handling on the folder face. */
	emoji?: 'keep' | 'strip';
}

export interface OrgsysSlot {
	/** Stable slot identifier. Doubles as the parametric token name (`{id}`). */
	id: string;
	/**
	 * The folder face. One of:
	 *   - a literal segment              `Projects`
	 *   - a parametric token             `{bucket}`   (with `values`)
	 *   - a Path-Lens pattern            `{n:\d{1,2}} - {name}`
	 */
	folder: string;
	/** The tag face (`#{bucket}`, `#{n}-{name}`). */
	tag: string;
	/** Transfer op. Phase 0: `identity` (default) or `marker`. */
	transfer?: string;
	/** Preserve the deeper tail (entry-or-anywhere-below). Default: true. */
	deepen?: boolean;
	/**
	 * If present, the slot is PARAMETRIC: it expands to ONE rule per value, the
	 * value substituted into the `{id}` token of the folder/tag faces. This is
	 * how PARA's four buckets come from one slot.
	 */
	values?: string[];
}

/**
 * A COMPOSITION mount (Phase 1). Nests another system (`snap`) inside this one
 * at a vault location (`at`). `at` is either a literal path (one anchor) or a
 * glob whose `*` segments (e.g. `Entity` then `*` then `Output`) are resolved
 * against the vault's folders — each existing folder that matches is an anchor.
 */
export interface OrgsysMount {
	/** System id of the snapped-in system — looked up in the compile registry. */
	snap: string;
	/** Literal path or star-glob naming where the snapped system is placed. */
	at: string;
	/** Rename parametric slot VALUES of the mounted system (`{Old: New}`). */
	rebind?: Record<string, string>;
	/** Drop slot ids or parametric values from the mounted system. */
	disable?: string[];
}

export interface SystemDef {
	/** System id (`para`, `jd`). */
	system: string;
	/** Display title. */
	title?: string;
	/** Semantic version. */
	version?: string;
	/** SEACOW axes the system covers. */
	axes?: string[];
	/**
	 * Base system id to inherit `axes` + `defaults` (+ anchor convention) from.
	 * Resolved against the compile registry; child fields override inherited.
	 */
	extends?: string;
	/** Where the system anchors in the vault tree. */
	anchor?: OrgsysAnchor;
	/** Defaults applied to every slot. */
	defaults?: OrgsysDefaults;
	/** The system's slots. */
	slots: OrgsysSlot[];
	/** Composed arrangement: systems nested inside this one (Phase 1). */
	mounts?: OrgsysMount[];
}

export class OrgsysParseError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'OrgsysParseError';
	}
}

// ─── Minimal YAML-subset reader ────────────────────────────────────────────

type YamlScalar = string | boolean | null;
type YamlValue = YamlScalar | YamlValue[] | { [k: string]: YamlValue };

interface Line {
	indent: number;
	content: string; // left-trimmed (no leading indent), comment-stripped
}

/**
 * Parse a `.orgsys` document into a validated `SystemDef`.
 *
 * Throws `OrgsysParseError` on structural problems (missing `system`, missing
 * or non-array `slots`, or a slot missing `id`/`folder`/`tag`).
 */
export function parseOrgsys(text: string): SystemDef {
	const root = parseYamlSubset(text);
	if (root === null || typeof root !== 'object' || Array.isArray(root)) {
		throw new OrgsysParseError('.orgsys root must be a mapping');
	}
	const obj = root as Record<string, YamlValue>;

	const system = obj.system;
	if (typeof system !== 'string' || system.trim() === '') {
		throw new OrgsysParseError("'.orgsys' requires a non-empty string 'system'");
	}
	const hasSlots = Array.isArray(obj.slots);
	const hasMounts = Array.isArray(obj.mounts);
	// A definition must carry at least slots (an ATOMIC system) OR mounts (a
	// composed arrangement). Pure-mount defs are valid Phase-1 compositions.
	if (!hasSlots && !hasMounts) {
		throw new OrgsysParseError("'.orgsys' requires a 'slots' sequence or a 'mounts' sequence");
	}

	const slots: OrgsysSlot[] = (hasSlots ? (obj.slots as YamlValue[]) : []).map((raw, i) => {
		if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
			throw new OrgsysParseError(`slot #${i} must be a mapping`);
		}
		const s = raw as Record<string, YamlValue>;
		if (typeof s.id !== 'string' || s.id.trim() === '') {
			throw new OrgsysParseError(`slot #${i} requires a string 'id'`);
		}
		if (typeof s.folder !== 'string' || s.folder.trim() === '') {
			throw new OrgsysParseError(`slot '${s.id}' requires a string 'folder' face`);
		}
		if (typeof s.tag !== 'string' || s.tag.trim() === '') {
			throw new OrgsysParseError(`slot '${s.id}' requires a string 'tag' face`);
		}
		const slot: OrgsysSlot = { id: s.id, folder: s.folder, tag: s.tag };
		if (typeof s.transfer === 'string') slot.transfer = s.transfer;
		if (typeof s.deepen === 'boolean') slot.deepen = s.deepen;
		if (Array.isArray(s.values)) {
			slot.values = s.values.map((v) => String(v));
		}
		return slot;
	});

	const def: SystemDef = { system, slots };
	if (typeof obj.title === 'string') def.title = obj.title;
	if (typeof obj.version === 'string') def.version = obj.version;
	if (typeof obj.extends === 'string' && obj.extends.trim() !== '') def.extends = obj.extends;
	if (Array.isArray(obj.axes)) def.axes = obj.axes.map((a) => String(a));
	if (obj.anchor && typeof obj.anchor === 'object' && !Array.isArray(obj.anchor)) {
		def.anchor = parseAnchor(obj.anchor as Record<string, YamlValue>);
	}
	if (obj.defaults && typeof obj.defaults === 'object' && !Array.isArray(obj.defaults)) {
		def.defaults = parseDefaults(obj.defaults as Record<string, YamlValue>);
	}
	if (Array.isArray(obj.mounts)) {
		def.mounts = obj.mounts.map((raw, i) => parseMount(raw, i));
	}
	return def;
}

/** Parse one `mounts[]` entry into a validated `OrgsysMount`. */
function parseMount(raw: YamlValue, i: number): OrgsysMount {
	if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
		throw new OrgsysParseError(`mount #${i} must be a mapping`);
	}
	const m = raw as Record<string, YamlValue>;
	if (typeof m.snap !== 'string' || m.snap.trim() === '') {
		throw new OrgsysParseError(`mount #${i} requires a string 'snap' (a system id)`);
	}
	if (typeof m.at !== 'string' || m.at.trim() === '') {
		throw new OrgsysParseError(`mount #${i} requires a string 'at' (a path or glob)`);
	}
	const mount: OrgsysMount = { snap: m.snap, at: m.at };
	if (m.rebind && typeof m.rebind === 'object' && !Array.isArray(m.rebind)) {
		const rebind: Record<string, string> = {};
		for (const [k, v] of Object.entries(m.rebind as Record<string, YamlValue>)) {
			rebind[k] = String(v);
		}
		mount.rebind = rebind;
	}
	if (Array.isArray(m.disable)) {
		mount.disable = m.disable.map((d) => String(d));
	}
	return mount;
}

function parseAnchor(obj: Record<string, YamlValue>): OrgsysAnchor {
	const d = obj.default;
	let mode: OrgsysAnchorMode = 'root';
	if (d === 'root' || d === 'any-segment') {
		mode = d;
	} else if (d && typeof d === 'object' && !Array.isArray(d) && typeof (d as Record<string, YamlValue>).under === 'string') {
		mode = { under: (d as Record<string, YamlValue>).under as string };
	}
	const anchor: OrgsysAnchor = { default: mode };
	if (typeof obj.relocatable === 'boolean') anchor.relocatable = obj.relocatable;
	return anchor;
}

function parseDefaults(obj: Record<string, YamlValue>): OrgsysDefaults {
	const out: OrgsysDefaults = {};
	if (typeof obj.direction === 'string') out.direction = obj.direction as RuleDirection;
	if (typeof obj.folderCase === 'string') out.folderCase = obj.folderCase as CaseTransformType;
	if (typeof obj.tagCase === 'string') out.tagCase = obj.tagCase as CaseTransformType;
	if (obj.emoji === 'keep' || obj.emoji === 'strip') out.emoji = obj.emoji;
	return out;
}

/**
 * Read the supported YAML subset into a plain JS value. Block mappings, block
 * sequences, flow sequences, quoted/plain scalars, and `#` comments only.
 */
export function parseYamlSubset(text: string): YamlValue {
	const lines = toLines(text);
	if (lines.length === 0) return null;
	const [value] = parseNode(lines, 0, lines[0].indent);
	return value;
}

/** Tokenize into non-blank, comment-stripped lines with indentation. */
function toLines(text: string): Line[] {
	const out: Line[] = [];
	for (const raw of text.split(/\r?\n/)) {
		const stripped = stripComment(raw);
		if (stripped.trim() === '') continue;
		const trimmedRight = stripped.replace(/\s+$/, '');
		const indent = trimmedRight.length - trimmedRight.replace(/^\s+/, '').length;
		out.push({ indent, content: trimmedRight.slice(indent) });
	}
	return out;
}

/**
 * Remove a trailing `# comment`. Quote-aware: a `#` inside a quoted scalar
 * (e.g. the tag face `"#{bucket}"`) is NOT a comment. Per YAML, `#` only
 * starts a comment at the start of the line or after whitespace.
 */
function stripComment(line: string): string {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inDouble) {
			if (ch === '\\') {
				i++; // skip escaped char
				continue;
			}
			if (ch === '"') inDouble = false;
			continue;
		}
		if (inSingle) {
			if (ch === "'") inSingle = false;
			continue;
		}
		if (ch === '"') inDouble = true;
		else if (ch === "'") inSingle = true;
		else if (ch === '#' && (i === 0 || /\s/.test(line[i - 1]))) {
			return line.slice(0, i);
		}
	}
	return line;
}

function parseNode(lines: Line[], idx: number, indent: number): [YamlValue, number] {
	const c = lines[idx].content;
	if (c === '-' || c.startsWith('- ')) {
		return parseSequence(lines, idx, indent);
	}
	return parseMapping(lines, idx, indent);
}

function parseMapping(lines: Line[], idx: number, indent: number): [YamlValue, number] {
	const map: { [k: string]: YamlValue } = {};
	let i = idx;
	while (i < lines.length && lines[i].indent === indent) {
		const content = lines[i].content;
		if (content === '-' || content.startsWith('- ')) break; // sequence belongs to a parent key
		const colon = findKeyColon(content);
		if (colon < 0) {
			throw new OrgsysParseError(`expected 'key: value' but got: ${content}`);
		}
		const key = content.slice(0, colon).trim();
		const rest = content.slice(colon + 1).trim();
		if (rest === '') {
			// Nested block at greater indent, or null.
			if (i + 1 < lines.length && lines[i + 1].indent > indent) {
				const [val, next] = parseNode(lines, i + 1, lines[i + 1].indent);
				map[key] = val;
				i = next;
			} else {
				map[key] = null;
				i++;
			}
		} else {
			map[key] = parseScalarOrFlow(rest);
			i++;
		}
	}
	return [map, i];
}

function parseSequence(lines: Line[], idx: number, indent: number): [YamlValue, number] {
	const arr: YamlValue[] = [];
	let i = idx;
	while (i < lines.length && lines[i].indent === indent) {
		const content = lines[i].content;
		if (content !== '-' && !content.startsWith('- ')) break;
		const rest = content === '-' ? '' : content.replace(/^-\s+/, '');
		const itemIndent = indent + 2;
		if (rest === '') {
			if (i + 1 < lines.length && lines[i + 1].indent > indent) {
				const [val, next] = parseNode(lines, i + 1, lines[i + 1].indent);
				arr.push(val);
				i = next;
			} else {
				arr.push(null);
				i++;
			}
		} else if (findKeyColon(rest) < 0) {
			// Bare scalar (or flow) list item: `- Archive`, `- [a, b]`. No
			// `key:` on the line, so it's a value, not the first key of an
			// inline mapping. Parse it directly and advance one line.
			arr.push(parseScalarOrFlow(rest));
			i++;
		} else {
			// Inline mapping item. Re-home this line at the item indent so the
			// mapping parse picks up the inline first key plus any following
			// sibling keys aligned under it.
			lines[i] = { indent: itemIndent, content: rest };
			const [val, next] = parseNode(lines, i, itemIndent);
			arr.push(val);
			i = next;
		}
	}
	return [arr, i];
}

/** First `:` that terminates a key (followed by space or end), not in quotes. */
function findKeyColon(line: string): number {
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < line.length; i++) {
		const ch = line[i];
		if (inDouble) {
			if (ch === '\\') {
				i++;
				continue;
			}
			if (ch === '"') inDouble = false;
			continue;
		}
		if (inSingle) {
			if (ch === "'") inSingle = false;
			continue;
		}
		if (ch === '"') inDouble = true;
		else if (ch === "'") inSingle = true;
		else if (ch === ':' && (i + 1 >= line.length || line[i + 1] === ' ')) {
			return i;
		}
	}
	return -1;
}

function parseScalarOrFlow(s: string): YamlValue {
	const t = s.trim();
	if (t.startsWith('[')) {
		const end = t.lastIndexOf(']');
		const inner = t.slice(1, end >= 0 ? end : undefined);
		if (inner.trim() === '') return [];
		return splitFlow(inner).map((part) => parseScalar(part));
	}
	return parseScalar(t);
}

function parseScalar(s: string): YamlScalar {
	const t = s.trim();
	if (t.length === 0) return '';
	if (t.startsWith('"') && t.endsWith('"') && t.length >= 2) {
		return unescapeDouble(t.slice(1, -1));
	}
	if (t.startsWith("'") && t.endsWith("'") && t.length >= 2) {
		return t.slice(1, -1).replace(/''/g, "'");
	}
	if (t === 'true') return true;
	if (t === 'false') return false;
	if (t === 'null' || t === '~') return null;
	return t;
}

/** Split a flow-sequence interior on top-level commas (quote-aware). */
function splitFlow(inner: string): string[] {
	const parts: string[] = [];
	let buf = '';
	let inSingle = false;
	let inDouble = false;
	for (let i = 0; i < inner.length; i++) {
		const ch = inner[i];
		if (inDouble) {
			buf += ch;
			if (ch === '\\') {
				if (i + 1 < inner.length) buf += inner[++i];
				continue;
			}
			if (ch === '"') inDouble = false;
			continue;
		}
		if (inSingle) {
			buf += ch;
			if (ch === "'") inSingle = false;
			continue;
		}
		if (ch === '"') {
			inDouble = true;
			buf += ch;
		} else if (ch === "'") {
			inSingle = true;
			buf += ch;
		} else if (ch === ',') {
			parts.push(buf);
			buf = '';
		} else {
			buf += ch;
		}
	}
	if (buf.trim() !== '') parts.push(buf);
	return parts;
}

/** Process YAML double-quoted backslash escapes (left-to-right, single pass). */
function unescapeDouble(s: string): string {
	let out = '';
	for (let i = 0; i < s.length; i++) {
		const ch = s[i];
		if (ch === '\\' && i + 1 < s.length) {
			const next = s[++i];
			switch (next) {
				case 'n':
					out += '\n';
					break;
				case 't':
					out += '\t';
					break;
				case 'r':
					out += '\r';
					break;
				case '"':
					out += '"';
					break;
				case '\\':
					out += '\\';
					break;
				case '/':
					out += '/';
					break;
				default:
					out += next;
			}
		} else {
			out += ch;
		}
	}
	return out;
}
