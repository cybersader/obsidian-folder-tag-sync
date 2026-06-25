/**
 * `compileSystemDef` — lowers a `.orgsys` `SystemDef` (Phase-0 source) into the
 * plugin's existing rule-pack shape (`RulePack`, the "bytecode").
 *
 * This is the data-layer foundation of the Taxonomy Workbench: an `.orgsys`
 * file describes a *system* as a handful of slots; the compiler expands those
 * slots into the same `MappingRule[]` that hand-written packs like
 * `rule-packs/para.json` carry today. The current rule-pack JSON is the compile
 * target — proven equivalent by the golden test in `compileSystemDef.test.ts`.
 *
 * Lowering backends (reused, not reinvented):
 *   - literal / parametric-value folder faces → `deriveRule` (typed spec → rule)
 *   - Path-Lens pattern folder faces          → `compileTemplate` (template rule)
 *
 * NOT wired into the live rule-loading pipeline in this phase — pure engine.
 */

import type { MappingRule, RuleOptions, RuleDirection, CaseTransformType } from '../types/settings';
import type { Axis, FolderAnchor, FolderClassifier, TagVocabulary, TransferOp, TypedRuleSpec } from '../types/typed';
import type { RulePack, DetectionSignal, PackDetection, PackEstablish } from './rulePackLoader';
import type { OrgsysAnchorMode, OrgsysMount, OrgsysSlot, SystemDef } from './orgsys';
import { deriveRule, escapeRegex } from './derive';
import { compileTemplate } from './compileTemplate';
import { scopeRule } from './scopeRules';
import { findBestMatch } from './ruleMatcher';
import { applyRuleForward } from './applyTransfer';
import { applyCaseTransform } from '../transformers/caseTransformers';

/**
 * Optional vault + registry context.
 *
 * Phase 0 (atomic systems) ignores it. Phase 1 (composition) uses it:
 *   - `registry` resolves `mounts[].snap` and `extends` to their `SystemDef`.
 *   - `vaultFolders` resolves glob `at:` mount anchors LAZILY — an `Entity`/`*`/
 *     `Output` glob expands only to folders that actually exist, never an eager
 *     cross-product. Absent `vaultFolders` ⇒ globs resolve to zero anchors.
 */
export interface CompileContext {
	/** Known folder paths in the vault (future: anchor relocation / detection). */
	folders?: string[];
	/** System registry — resolves composition `snap` ids and `extends` bases. */
	registry?: Map<string, SystemDef>;
	/** Existing vault folder paths — the universe glob `at:` anchors resolve against. */
	vaultFolders?: string[];
}

/** Standard sync options stamped on every emitted rule. Behaviorally neutral
 * for forward emission (only patterns + transfer + transforms + entry points
 * decide tags); matches the intent of the shipped packs' option blocks. */
const STANDARD_OPTIONS: RuleOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
	keepDestinationTag: true,
	keepRelationTags: true,
	moveAttachments: true,
};

/** Resolved per-slot defaults after merging system-level `defaults`. */
interface ResolvedDefaults {
	direction: RuleDirection;
	folderCase: CaseTransformType;
	tagCase: CaseTransformType;
	emoji: 'keep' | 'strip';
	anchor: OrgsysAnchorMode;
	group: string;
	axis: Axis;
}

/**
 * Compile a `.orgsys` system definition into a `RulePack`.
 *
 * Per slot: if `values` is present, expand to one rule per value (substituting
 * the value into the `{id}` token of the folder/tag faces); literal faces lower
 * through `deriveRule`, Path-Lens pattern faces through `compileTemplate`. The
 * pack's `detection.anyOf` and `establish.createFolders` are DERIVED from the
 * folder faces + values (the author never restates them). Every emitted rule is
 * stamped `group: "<system>@<anchor>"`.
 */
export function compileSystemDef(rawDef: SystemDef, ctx?: CompileContext): RulePack {
	// Phase 1: inherit axes + defaults (+ anchor convention) from a base system.
	const def = resolveExtends(rawDef, ctx?.registry);

	const anchor: OrgsysAnchorMode = def.anchor?.default ?? 'root';
	const axis = (def.axes && def.axes.length ? def.axes[0] : 'work') as Axis;
	const defaults: ResolvedDefaults = {
		direction: def.defaults?.direction ?? 'bidirectional',
		folderCase: def.defaults?.folderCase ?? 'Title Case',
		tagCase: def.defaults?.tagCase ?? 'kebab-case',
		emoji: def.defaults?.emoji ?? 'keep',
		anchor,
		group: `${def.system}@${anchorToString(anchor)}`,
		axis,
	};

	const rules: MappingRule[] = [];
	const signals: DetectionSignal[] = [];
	const createFolders: string[] = [];

	let priority = 10;
	for (const slot of def.slots) {
		const values = slot.values && slot.values.length ? slot.values : [undefined];
		for (const value of values) {
			const compiled = compileSlot(def, slot, value, defaults, priority);
			rules.push(compiled.rule);
			if (compiled.signal) signals.push(compiled.signal);
			if (compiled.createFolder) createFolders.push(compiled.createFolder);
			priority += 10;
		}
	}

	// ─── Phase 1: COMPOSITION — nest mounted systems at resolved anchors ───────
	// Snapshot the base (host) rules BEFORE mounts so each mount's tag-namespace
	// derivation sees only the host, never a prior mount's emitted rules.
	const baseRules = [...rules];
	for (const mount of def.mounts ?? []) {
		rules.push(...compileMount(def, mount, baseRules, ctx));
	}

	const detection: PackDetection | undefined = signals.length
		? { anyOf: signals, minSignals: Math.min(2, signals.length) }
		: undefined;

	const establish: PackEstablish | undefined = createFolders.length
		? {
				createFolders,
				summary: `Top-level ${def.title ?? def.system} folders: ${createFolders
					.map((f) => f.replace(/\/$/, ''))
					.join(', ')}.`,
		  }
		: undefined;

	return {
		name: def.title ?? def.system,
		description: `${def.title ?? def.system} organizational system (compiled from .orgsys).`,
		version: def.version ?? '1.0.0',
		author: 'Folder Tag Sync',
		id: def.system,
		axes: def.axes ? (def.axes.filter(isAxis) as Axis[]) : undefined,
		rules,
		detection,
		establish,
	};
}

// ─── Phase 1: composition (mounts / extends / at-glob) ─────────────────────

/**
 * Resolve `extends`: inherit `axes`, `defaults`, and the anchor convention from
 * a base system in the registry. Child fields win; defaults merge field-wise.
 * No-op when there's no `extends` or the base isn't in the registry.
 */
function resolveExtends(def: SystemDef, registry: Map<string, SystemDef> | undefined): SystemDef {
	if (!def.extends || !registry) return def;
	const base = registry.get(def.extends);
	if (!base) return def;
	return {
		...def,
		axes: def.axes ?? base.axes,
		anchor: def.anchor ?? base.anchor,
		defaults: { ...base.defaults, ...def.defaults },
	};
}

/**
 * Compile one mount: look up the snapped system in the registry, apply
 * `rebind`/`disable`, compile it, then place a scoped copy of its rules at every
 * resolved anchor. Returns the union of all anchor placements (possibly empty
 * when the glob matches no existing folder — lazy resolution).
 */
function compileMount(
	host: SystemDef,
	mount: OrgsysMount,
	baseRules: MappingRule[],
	ctx: CompileContext | undefined,
): MappingRule[] {
	const snapDef = ctx?.registry?.get(mount.snap);
	if (!snapDef) return []; // unknown system id — skip (lazy / forgiving)

	const adjusted = applyRebindDisable(snapDef, mount.rebind, mount.disable);
	const snapPack = compileSystemDef(adjusted, ctx);

	const anchors = resolveMountAnchors(mount.at, ctx?.vaultFolders);
	const out: MappingRule[] = [];
	for (const anchor of anchors) {
		const depth = anchor === '' ? 0 : anchor.split('/').length;
		const tagScope = computeTagScope(mount.at, anchor, baseRules);
		const group = `${host.system}@${anchor}`;
		for (const r of snapPack.rules) {
			const scoped = scopeRule(r, anchor, { tagScope });
			scoped.group = group;
			// Deeper anchors are more specific and should win at runtime; the
			// specificity matcher already favors them, this sets the priority
			// tiebreak so deeper anchors out-rank shallower ones on a tie too.
			scoped.priority = Math.max(1, (r.priority ?? 10) - depth);
			out.push(scoped);
		}
	}
	return out;
}

/**
 * Apply a mount's `rebind` (rename parametric slot VALUES) and `disable` (drop
 * slot ids or parametric values) to a snapped system's def, BEFORE compilation.
 * Returns the def unchanged when neither is present.
 */
function applyRebindDisable(
	def: SystemDef,
	rebind: Record<string, string> | undefined,
	disable: string[] | undefined,
): SystemDef {
	const hasRebind = rebind && Object.keys(rebind).length > 0;
	const hasDisable = disable && disable.length > 0;
	if (!hasRebind && !hasDisable) return def;

	const disableSet = new Set(disable ?? []);
	const slots = def.slots
		.filter((s) => !disableSet.has(s.id)) // disable a whole slot by id
		.map((s) => {
			if (!s.values) return s;
			const values = s.values
				.filter((v) => !disableSet.has(v)) // disable a parametric value
				.map((v) => (rebind && rebind[v] !== undefined ? rebind[v] : v)); // rebind a value
			return { ...s, values };
		});
	return { ...def, slots };
}

/**
 * Resolve a mount `at:` into concrete anchors.
 *
 *   - A LITERAL path (no `*` segment) resolves to exactly one anchor — itself.
 *   - A GLOB (one or more `*` segments) resolves against `vaultFolders`: each
 *     `*` matches exactly one path segment, and every existing folder path that
 *     matches becomes an anchor. With no `vaultFolders`, a glob resolves to zero
 *     anchors (lazy — the caller may pass sample paths instead).
 */
export function resolveMountAnchors(at: string, vaultFolders?: string[]): string[] {
	const segs = at.split('/');
	const hasGlob = segs.some((s) => s === '*');
	if (!hasGlob) return [at];
	if (!vaultFolders || vaultFolders.length === 0) return [];
	const body = segs.map((s) => (s === '*' ? '[^/]+' : escapeRegex(s))).join('/');
	const re = new RegExp(`^${body}$`);
	return vaultFolders.filter((f) => re.test(f)).sort();
}

/**
 * Derive the tag namespace a mounted system inherits at an anchor. The host
 * system's emitted tag for the `*`-bound portion of the glob IS the namespace:
 * an `Entity`/`*`/`Output` glob matched at `Entity/Cybersader/Output` binds the
 * host to `Entity/Cybersader` → host emits `#--cybersader` → namespace
 * `--cybersader`. The literal segments AFTER the last `*` (`Output`) are
 * structural — they place the mount but contribute no tag segment, exactly like
 * the hand-written nested SEACOW rule. Literal mounts (no `*`) inherit no
 * namespace (folder-only scope).
 */
function computeTagScope(at: string, anchor: string, baseRules: MappingRule[]): string {
	const atSegs = at.split('/');
	let lastStar = -1;
	for (let i = 0; i < atSegs.length; i++) if (atSegs[i] === '*') lastStar = i;
	if (lastStar < 0) return '';

	const hostPath = anchor.split('/').slice(0, lastStar + 1).join('/');
	if (!hostPath) return '';

	const match = findBestMatch(hostPath, baseRules, {
		input: hostPath,
		matchType: 'folder',
		direction: 'folder-to-tag',
	});
	if (!match) return '';

	const fwd = applyRuleForward(hostPath, match.rule);
	if (fwd.tags.length === 0) return '';
	const tag = fwd.tags[0];
	return tag.startsWith('#') ? tag.slice(1) : tag;
}

/**
 * Group-precedence order for a COMPOSED pack: deeper anchors first. The matcher
 * partitions matches by `group` and resolves the highest-precedence group
 * outright, so listing deeper-anchor groups first makes nested mounts out-rank
 * the shallower host system at runtime. Pass the result as `findBestMatch`'s
 * `groupPrecedence` argument (or the vault's `groupPrecedence` setting).
 */
export function composedGroupPrecedence(pack: RulePack): string[] {
	const groups = new Set<string>();
	for (const r of pack.rules) if (r.group) groups.add(r.group);
	return [...groups].sort((a, b) => anchorDepthOfGroup(b) - anchorDepthOfGroup(a) || a.localeCompare(b));
}

/** Path depth of a `system@anchor` group's anchor (root/any-segment/under = 0). */
function anchorDepthOfGroup(group: string): number {
	const at = group.indexOf('@');
	const anchor = at >= 0 ? group.slice(at + 1) : group;
	if (anchor === '' || anchor === 'root' || anchor === 'any-segment' || anchor.startsWith('under:')) {
		return 0;
	}
	return anchor.split('/').length;
}

interface CompiledSlot {
	rule: MappingRule;
	/** Derived detection signal for this folder face (when derivable). */
	signal?: DetectionSignal;
	/** Derived establish folder path (literal faces only). */
	createFolder?: string;
}

/**
 * Compile one slot (optionally bound to one parametric `value`) into a rule.
 *
 * Classification after substituting `value` into `{<slot.id>}`:
 *   - face has no remaining `{...}` token → LITERAL → `deriveRule`
 *   - face still has a `{...}` token      → PATTERN → `compileTemplate`
 */
function compileSlot(
	def: SystemDef,
	slot: OrgsysSlot,
	value: string | undefined,
	d: ResolvedDefaults,
	priority: number,
): CompiledSlot {
	const folderFace = substituteToken(slot.folder, slot.id, value);
	const tagFace = substituteToken(slot.tag, slot.id, value);
	const deepen = slot.deepen !== false; // default true
	const label = value ?? slot.id;
	const idBase = `${def.system}-${slugify(label)}`;
	const name = `${def.title ?? def.system}: ${label}`;

	if (hasToken(folderFace)) {
		return compilePatternSlot(slot, folderFace, tagFace, deepen, d, priority, idBase, name);
	}
	return compileLiteralSlot(slot, folderFace, tagFace, deepen, d, priority, idBase, name);
}

/** Literal (or fully-substituted parametric) folder face → typed-spec lowering. */
function compileLiteralSlot(
	slot: OrgsysSlot,
	folderFace: string,
	tagFace: string,
	deepen: boolean,
	d: ResolvedDefaults,
	priority: number,
	idBase: string,
	name: string,
): CompiledSlot {
	const folderEntry = applyCaseTransform(folderFace, d.folderCase);
	const transferKind = slot.transfer ?? 'identity';

	let transfer: TransferOp;
	let tagEntry: string;
	if (transferKind === 'marker') {
		// Controlled-vocabulary marker — verbatim, not re-cased.
		const marker = stripHash(tagFace);
		transfer = { op: 'marker-only', marker };
		tagEntry = marker;
	} else {
		// identity. `deepen: false` caps depth so only the bare entry folder
		// matches (deeper paths are excluded) while still emitting the entry tag.
		transfer = deepen ? { op: 'identity' } : { op: 'truncation', depth: 0, tailHandling: 'drop' };
		tagEntry = applyCaseTransform(stripHash(tagFace), d.tagCase);
	}

	const folder: FolderClassifier = {
		axes: [d.axis],
		scheme: 'enumerative',
		naming: d.emoji === 'strip' ? 'emoji-prefixed' : 'word',
		subdivisionDepth: 'unbounded',
		siblingUniformity: 'parallel',
	};
	const tag: TagVocabulary = {
		axis: d.axis,
		coordination: transferKind === 'marker' ? 'flat-keyword' : 'pre-coordinated',
		prefixMarker: '',
		authority: 'mutual',
	};

	const tagOverride: Partial<{ caseTransform: CaseTransformType }> = {};
	if (transferKind !== 'marker') tagOverride.caseTransform = d.tagCase;

	const spec: TypedRuleSpec = {
		id: idBase,
		name,
		description: `${folderEntry}/ ↔ #${tagEntry}${transferKind === 'marker' ? '' : '/*'} — ${transferKind} transfer, ${d.direction}`,
		priority,
		direction: d.direction,
		folder,
		tag,
		transfer,
		inverseTransfer: transfer,
		folderEntry,
		folderAnchor: d.anchor === 'root' ? undefined : (d.anchor as FolderAnchor),
		tagEntry,
		transformOverrides: {
			folderTransforms: { caseTransform: d.folderCase, emojiHandling: d.emoji },
			tagTransforms: tagOverride,
		},
		options: STANDARD_OPTIONS,
		enabled: true,
	};

	const rule = deriveRule(spec);
	rule.group = d.group;

	return {
		rule,
		signal: { folderRegex: `^${escapeRegex(folderEntry)}$`, scope: 'name', label: `${folderEntry}/ root` },
		createFolder: `${folderEntry}/`,
	};
}

/** Path-Lens pattern folder face → template-rule lowering. */
function compilePatternSlot(
	slot: OrgsysSlot,
	folderFace: string,
	tagFace: string,
	deepen: boolean,
	d: ResolvedDefaults,
	priority: number,
	idBase: string,
	name: string,
): CompiledSlot {
	// Folder template: the face, plus the deeper tail when `deepen`. The
	// trailing `/{deeper...}` glob is optional in the compiled regex, so the
	// rule matches BOTH the bare numbered area and anything beneath it.
	const folderTemplate = deepen ? `${folderFace}/{deeper...}` : folderFace;
	// Tag template: every slot gets the tag-case filter (lowercasing a numeric
	// slot like `{n}` is a no-op, so a blanket apply is safe), plus the deeper
	// tail (also tag-cased — mirrors a whole-path kebab on the legacy rule).
	const tagCore = addFilterToSlots(tagFace, d.tagCase);
	const tagTemplate = deepen ? `${tagCore}/{deeper... | ${d.tagCase}}` : tagCore;

	const folderCompiled = compileTemplate(folderTemplate);
	const tagCompiled = compileTemplate(tagTemplate);

	const rule: MappingRule = {
		id: idBase,
		name,
		description: `${folderFace} ↔ ${tagFace} — Path-Lens pattern, ${d.direction}`,
		enabled: true,
		priority,
		direction: d.direction,
		// Gate `findMatchingRules` via the compiled regex sources (mirrors the
		// rule-pack loader's template path).
		folderPattern: folderCompiled.regex.source,
		tagPattern: tagCompiled.regex.source,
		folderTemplate,
		tagTemplate,
		folderAnchor: d.anchor === 'root' ? undefined : (d.anchor as FolderAnchor),
		group: d.group,
		options: STANDARD_OPTIONS,
	};

	return { rule, signal: faceToDetectionSignal(folderFace) };
}

// ─── Face helpers ──────────────────────────────────────────────────────────

/** Does the face contain a `{...}` slot token? */
function hasToken(face: string): boolean {
	return /\{[^}]*\}/.test(face) || face.includes('{');
}

/** Substitute `{id}` occurrences in a face with `value` (no-op when no value). */
function substituteToken(face: string, id: string, value: string | undefined): string {
	if (value === undefined) return face;
	return face.split(`{${id}}`).join(value);
}

/** Strip a single leading `#` from a tag face. */
function stripHash(tag: string): string {
	return tag.startsWith('#') ? tag.slice(1) : tag;
}

/**
 * Append ` | <filter>` to every top-level `{...}` token in a template that
 * doesn't already declare filters. Balanced-brace aware so inline regex like
 * `\d{1,2}` isn't mistaken for a slot boundary.
 */
function addFilterToSlots(template: string, filter: string): string {
	let out = '';
	let i = 0;
	while (i < template.length) {
		const ch = template[i];
		if (ch === '{') {
			let depth = 1;
			let j = i + 1;
			for (; j < template.length; j++) {
				if (template[j] === '{') depth++;
				else if (template[j] === '}') {
					depth--;
					if (depth === 0) break;
				}
			}
			const body = template.slice(i + 1, j);
			const newBody = body.includes('|') ? body : `${body} | ${filter}`;
			out += `{${newBody}}`;
			i = j + 1;
		} else {
			out += ch;
			i++;
		}
	}
	return out;
}

/**
 * Build a detection signal from a Path-Lens folder face. Compiles the face,
 * converts named captures to non-capturing groups, and drops the trailing
 * anchor so it matches as a prefix of a folder name.
 */
function faceToDetectionSignal(face: string): DetectionSignal {
	let regex = compileTemplate(face).regex.source; // `^...$`
	regex = regex.replace(/\(\?<[A-Za-z0-9_]+>/g, '(?:'); // named → non-capturing
	regex = regex.replace(/\$$/, ''); // prefix match
	return { folderRegex: regex, scope: 'name', label: `Matches ${face}` };
}

// ─── Small utilities ───────────────────────────────────────────────────────

function anchorToString(anchor: OrgsysAnchorMode): string {
	if (anchor === 'root' || anchor === 'any-segment') return anchor;
	return `under:${anchor.under}`;
}

function slugify(s: string): string {
	return applyCaseTransform(s, 'kebab-case').replace(/[^a-z0-9-]/g, '') || 'slot';
}

const AXES = ['system', 'entity', 'capture', 'output', 'work', 'relation'];
function isAxis(a: string): a is Axis {
	return AXES.includes(a);
}
