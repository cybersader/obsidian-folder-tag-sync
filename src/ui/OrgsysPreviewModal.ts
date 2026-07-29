/**
 * Taxonomy Workbench — live `.orgsys` preview modal.
 *
 * The user evaluates everything inside Obsidian, never by reading source. This
 * modal is the in-app surface for the new `.orgsys` system-definition format:
 * a roomy "edit a definition → see what it compiles to" workbench built on the
 * already-verified compiler.
 *
 * Flow on every edit (debounced) and on preset load:
 *   1. `parseOrgsys(text)`        — text → SystemDef (throws on malformed input)
 *   2. `compileSystemDef(def)`    — SystemDef → RulePack (`{ rules }`, the bytecode)
 *   3. render the compiled rules  — one readable line per rule
 *   4. run the rules against the user's REAL vault folders via `findBestMatch`
 *      + `applyRuleForward` to show `folder → #tag` sample emissions. If no
 *      vault folder matches, fall back to illustrative sample paths derived
 *      from the definition so the user always sees something working.
 *
 * COMPOSITION: when the definition carries `mounts` (or `extends`), step 2 runs
 * the composed-compile path — `compileSystemDef(def, { registry, vaultFolders })`
 * — so mounts resolve against a small inlined registry of base systems (`jd`,
 * `people`) and the user's real folders. When a mount's `at:` glob matches no
 * real folder, step 4 re-compiles against DERIVED sample anchors so the nested
 * expansion is always visible (labelled as sample paths).
 *
 * Pure consumer of the engine — it never mutates settings, folders, or files.
 * The compiler, matcher, and forward-emit runtime are all imported as-is.
 *
 * A separate preview-only modal beside the persistent Taxonomy Workbench. It
 * reuses the same structural patterns (folder collection, roomy sizing,
 * makeStat-style cards, and stable E2E data hooks) without entering the rule
 * installation path.
 */

import { App, Modal, TFolder } from 'obsidian';
import { parseOrgsys } from '../engine/orgsys';
import type { SystemDef } from '../engine/orgsys';
import { compileSystemDef, composedGroupPrecedence } from '../engine/compileSystemDef';
import type { RulePack } from '../engine/rulePackLoader';
import { findBestMatch, type RuleEvaluationContext } from '../engine/ruleMatcher';
import { applyRuleForward } from '../engine/applyTransfer';
import type { MappingRule } from '../types/settings';

/**
 * The PARA `.orgsys` example, inlined verbatim from `rule-packs/para.orgsys`.
 * Inlined (not read from disk) because the wdio install strips `rule-packs/`,
 * and a self-contained modal is simpler and always works.
 */
const PARA_ORGSYS = `# PARA — Tiago Forte's four canonical Work buckets.
# Source for the Taxonomy Workbench. Compiles (via compileSystemDef) to the
# same four rules as rule-packs/para.json — from ONE parametric slot.
system: para
title: PARA
version: 1.0.0
axes: [work]
anchor:
  default: root
  relocatable: false
defaults:
  direction: bidirectional
  folderCase: Title Case
  tagCase: kebab-case
  emoji: keep
slots:
  - id: bucket
    folder: "{bucket}"
    tag: "#{bucket}"
    transfer: identity
    deepen: true
    values: [Projects, Areas, Resources, Archive]
`;

/**
 * The Johnny Decimal `.orgsys` example, inlined verbatim from
 * `rule-packs/jd.orgsys`. The folder face carries a Path-Lens pattern with an
 * inline `\\d` regex; in this template literal the backslashes are doubled so
 * the resulting string holds the same `\\d` bytes the on-disk file does.
 */
const JD_ORGSYS = `# Johnny Decimal — numeric-prefixed areas (one or two digits).
# Compiles (via compileSystemDef) to the same identity-preserving rule as
# rule-packs/jd.json — from ONE Path-Lens pattern slot.
system: jd
title: Johnny Decimal
version: 1.1.0
axes: [work]
anchor:
  default: root
  relocatable: true
defaults:
  direction: bidirectional
  folderCase: Title Case
  tagCase: kebab-case
slots:
  - id: area
    folder: "{n:\\\\d{1,2}} - {name}"
    tag: "#{n}-{name}"
    transfer: identity
    deepen: true
`;

/**
 * A people / entity namespace system — one folder per owner, one tag namespace
 * each (`Entity/{owner}` ↔ `#--{owner}`). It is a registry BASE system: composed
 * definitions can mount other systems beneath it, snap it in, or `extends` it to
 * inherit its axes + defaults.
 */
const PEOPLE_ORGSYS = `# People / entity namespace — one folder per owner, one tag namespace each.
# A registry base system: other definitions mount systems under it or extend it.
system: people
title: People
version: 1.0.0
axes: [entity]
anchor:
  default: root
  relocatable: false
defaults:
  direction: bidirectional
  folderCase: Title Case
  tagCase: kebab-case
slots:
  - id: owner
    folder: "Entity/{owner}"
    tag: "#--{owner}"
    transfer: identity
    deepen: true
`;

/**
 * The COMPOSITION example — the one arrangement a single flat rule-pack can't
 * express. A people host (`Entity/{owner}` ↔ `#--{owner}`) with Johnny Decimal
 * MOUNTED under every per-entity Output folder. The mount's `at:` glob resolves
 * against the user's real folders; where the vault has none yet, the modal shows
 * the nested compilation on derived sample paths.
 */
const COMPOSED_ORGSYS = `# Composition — nest one system inside another (what a single flat rule-pack
# can't express). A people host (Entity/{owner} -> #--{owner}) with Johnny
# Decimal mounted under every per-entity Output folder.
#
# The mount's "at: Entity/*/Output" glob resolves against your REAL vault
# folders: every existing Entity/<owner>/Output becomes an anchor, and the JD
# system is placed there with the owner's tag namespace inherited automatically
# (e.g. Entity/Cybersader/Output/01 - Projects -> #--cybersader/01-projects).
#
# Where your vault has no matching Output folder yet, the sample emissions below
# show the same nesting on derived sample paths (clearly labelled).
system: seacow
title: SEACOW
axes: [entity]
defaults:
  direction: bidirectional
  folderCase: Title Case
  tagCase: kebab-case
slots:
  - id: owner
    folder: "Entity/{owner}"
    tag: "#--{owner}"
    transfer: identity
    deepen: true
mounts:
  - snap: jd
    at: Entity/*/Output
`;

/** Max sample-emission rows rendered before we collapse the rest into a note. */
const MAX_EMISSION_ROWS = 40;

/** One previewed folder → tag(s) emission. */
interface Emission {
	folder: string;
	tags: string[];
}

export class OrgsysPreviewModal extends Modal {
	private readonly groupPrecedence?: string[];

	private textarea!: HTMLTextAreaElement;
	private outputEl!: HTMLElement;
	private debounceHandle: ReturnType<typeof setTimeout> | null = null;

	constructor(app: App, groupPrecedence?: string[]) {
		super(app);
		this.groupPrecedence = groupPrecedence;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('dtf-orgsys-preview-modal');
		modalEl.style.width = 'min(1000px, 95vw)';
		modalEl.style.maxHeight = '90vh';

		contentEl.createEl('h2', { text: 'Taxonomy Workbench — preview a system definition' });

		const intro = contentEl.createDiv();
		intro.style.fontSize = '0.86em';
		intro.style.color = 'var(--text-muted)';
		intro.style.marginBottom = '0.6em';
		intro.setText(
			'Edit a system definition below and watch what it compiles to. Sample emissions run the compiled rules against your real vault folders.',
		);

		// ─── Preset buttons ───────────────────────────────────────────────
		const presetRow = contentEl.createDiv();
		presetRow.style.display = 'flex';
		presetRow.style.gap = '0.4em';
		presetRow.style.flexWrap = 'wrap';
		presetRow.style.marginBottom = '0.5em';

		const paraBtn = presetRow.createEl('button', { text: 'Load PARA example' });
		paraBtn.addEventListener('click', () => this.loadPreset(PARA_ORGSYS));
		const jdBtn = presetRow.createEl('button', { text: 'Load Johnny Decimal example' });
		jdBtn.addEventListener('click', () => this.loadPreset(JD_ORGSYS));
		const composedBtn = presetRow.createEl('button', { text: 'Load composed example' });
		composedBtn.addEventListener('click', () => this.loadPreset(COMPOSED_ORGSYS));

		// ─── Editor ───────────────────────────────────────────────────────
		this.textarea = contentEl.createEl('textarea');
		this.textarea.value = PARA_ORGSYS;
		this.textarea.rows = 14;
		this.textarea.spellcheck = false;
		this.textarea.style.width = '100%';
		this.textarea.style.fontFamily = 'var(--font-monospace)';
		this.textarea.style.fontSize = '0.84em';
		this.textarea.style.lineHeight = '1.45';
		this.textarea.style.resize = 'vertical';
		this.textarea.style.marginBottom = '0.7em';
		this.textarea.style.boxSizing = 'border-box';
		this.textarea.addEventListener('input', () => this.scheduleRecompile());

		// ─── Output ───────────────────────────────────────────────────────
		this.outputEl = contentEl.createDiv();
		this.outputEl.dataset.dtfOrgsysPreview = '1';
		this.outputEl.style.maxHeight = '46vh';
		this.outputEl.style.overflow = 'auto';
		this.outputEl.style.background = 'var(--background-secondary)';
		this.outputEl.style.padding = '0.6em 0.7em';
		this.outputEl.style.borderRadius = '6px';
		this.outputEl.style.fontSize = '0.88em';
		this.outputEl.style.marginBottom = '0.7em';

		// ─── Footer ───────────────────────────────────────────────────────
		const actions = contentEl.createDiv();
		actions.style.display = 'flex';
		actions.style.justifyContent = 'flex-end';
		actions.style.marginTop = '0.4em';
		const closeBtn = actions.createEl('button', { text: 'Close' });
		closeBtn.addClass('mod-cta');
		closeBtn.addEventListener('click', () => this.close());

		// First render — synchronous so the modal opens already populated.
		this.recompile();
	}

	/** Swap the editor's contents to a preset and recompile immediately. */
	private loadPreset(text: string): void {
		this.textarea.value = text;
		this.recompile();
	}

	/** Debounced recompile — coalesces rapid keystrokes into one render. */
	private scheduleRecompile(): void {
		if (this.debounceHandle !== null) clearTimeout(this.debounceHandle);
		this.debounceHandle = setTimeout(() => {
			this.debounceHandle = null;
			this.recompile();
		}, 300);
	}

	/**
	 * Parse → compile → render. Any parse/compile error is shown in a red
	 * panel without crashing the modal; the rest of the output is cleared so
	 * the user isn't misled by stale rules.
	 */
	private recompile(): void {
		this.outputEl.empty();

		let def: SystemDef;
		try {
			def = parseOrgsys(this.textarea.value);
		} catch (err) {
			this.renderError(`Parse error: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		// `extends` and `mounts` both resolve against the base-system registry;
		// mounts additionally resolve their `at:` globs against the real folders.
		const needsRegistry = Boolean(def.mounts?.length) || Boolean(def.extends);
		const registry = needsRegistry ? this.buildRegistry() : undefined;
		const vaultFolders = this.collectVaultFolders();

		let pack: RulePack;
		try {
			pack = needsRegistry
				? compileSystemDef(def, { registry, vaultFolders })
				: compileSystemDef(def);
		} catch (err) {
			this.renderError(`Compile error: ${err instanceof Error ? err.message : String(err)}`);
			return;
		}

		const hasMounts = Boolean(def.mounts?.length);
		const mountsResolved = pack.rules.some((r) => isMountGroup(r.group));

		// Composition with no real anchors: the `at:` glob matched no existing
		// folder, so the mount placed nothing. Re-compile against DERIVED sample
		// anchors so the user always sees the nested expansion (rules + emissions),
		// clearly labelled as sample paths.
		if (hasMounts && !mountsResolved && registry) {
			const sample = deriveComposedSamples(def, registry);
			if (sample.anchors.length > 0) {
				const samplePack = compileSystemDef(def, { registry, vaultFolders: sample.anchors });
				this.renderWarnings(samplePack.warnings);
				this.renderCompiledRules(samplePack.rules);
				this.renderComposedSamples(samplePack, sample.samplePaths);
				return;
			}
		}

		const precedence = hasMounts ? composedGroupPrecedence(pack) : this.groupPrecedence;
		this.renderWarnings(pack.warnings);
		this.renderCompiledRules(pack.rules);
		this.renderEmissions(def, pack.rules, precedence);
	}

	/**
	 * Surface non-fatal composition diagnostics (skipped mounts, cycles,
	 * duplicate anchors, empty namespaces) in a muted panel above the rules,
	 * so the user sees them in-app rather than only in compiled output.
	 */
	private renderWarnings(warnings: string[] | undefined): void {
		if (!warnings || warnings.length === 0) return;
		const panel = this.outputEl.createDiv();
		panel.dataset.dtfOrgsysWarnings = '1';
		panel.style.padding = '0.5em 0.7em';
		panel.style.marginBottom = '0.7em';
		panel.style.background = 'var(--background-modifier-error-hover, rgba(210, 150, 40, 0.10))';
		panel.style.borderLeft = '3px solid var(--text-warning, rgb(200, 150, 40))';
		panel.style.borderRadius = '4px';
		panel.style.fontSize = '0.82em';
		panel.style.color = 'var(--text-muted)';

		const header = panel.createDiv({ text: `Warnings (${warnings.length})` });
		header.style.fontWeight = '600';
		header.style.marginBottom = '0.25em';
		for (const w of warnings) {
			panel.createDiv({ text: `• ${w}` });
		}
	}

	/** Build the registry of base systems that `extends` / `mounts` resolve against. */
	private buildRegistry(): Map<string, SystemDef> {
		const registry = new Map<string, SystemDef>();
		for (const src of [JD_ORGSYS, PEOPLE_ORGSYS]) {
			const baseDef = parseOrgsys(src);
			registry.set(baseDef.system, baseDef);
		}
		return registry;
	}

	private renderError(message: string): void {
		const panel = this.outputEl.createDiv();
		panel.style.padding = '0.6em 0.8em';
		panel.style.background = 'rgba(200, 60, 60, 0.12)';
		panel.style.borderLeft = '3px solid var(--text-error, rgb(190, 50, 50))';
		panel.style.borderRadius = '4px';
		panel.style.color = 'var(--text-error, rgb(190, 50, 50))';
		panel.style.fontFamily = 'var(--font-monospace)';
		panel.style.fontSize = '0.84em';
		panel.style.whiteSpace = 'pre-wrap';
		panel.setText(message);
	}

	// ─── Compiled rules ────────────────────────────────────────────────────
	private renderCompiledRules(rules: MappingRule[]): void {
		const header = this.outputEl.createDiv({ text: `Compiled rules (${rules.length})` });
		header.style.fontWeight = '600';
		header.style.marginBottom = '0.35em';

		const list = this.outputEl.createDiv();
		list.dataset.dtfOrgsysRules = '1';
		list.style.fontFamily = 'var(--font-monospace)';
		list.style.fontSize = '0.82em';
		list.style.lineHeight = '1.6';
		list.style.marginBottom = '0.9em';

		if (rules.length === 0) {
			list.createDiv({ text: '(no rules — the definition has no slots)' }).style.color =
				'var(--text-muted)';
			return;
		}

		for (const rule of rules) {
			const row = list.createDiv();
			row.dataset.dtfOrgsysRule = '1';
			const folder = rule.folderPattern ?? '—';
			const tag = rule.tagPattern ?? '—';
			row.createSpan({ text: rule.id }).style.color = 'var(--text-accent, var(--interactive-accent))';
			row.createSpan({ text: ' · ' }).style.color = 'var(--text-faint)';
			row.createSpan({ text: folder });
			row.createSpan({ text: ' → ' }).style.color = 'var(--text-muted)';
			row.createSpan({ text: tag }).style.color = 'var(--text-success, rgb(40, 140, 70))';
			row.createSpan({ text: ` · ${rule.direction}` }).style.color = 'var(--text-faint)';
		}
	}

	// ─── Sample emissions ───────────────────────────────────────────────────
	private renderEmissions(def: SystemDef, rules: MappingRule[], precedence?: string[]): void {
		const header = this.outputEl.createDiv({ text: 'Sample emissions' });
		header.style.fontWeight = '600';
		header.style.marginBottom = '0.35em';

		if (rules.length === 0) {
			this.outputEl.createDiv({ text: '(nothing to emit)' }).style.color = 'var(--text-muted)';
			return;
		}

		const vaultFolders = this.collectVaultFolders();
		const vaultEmissions = this.emitFor(vaultFolders, rules, precedence);

		if (vaultEmissions.length > 0) {
			const note = this.outputEl.createDiv();
			note.style.fontSize = '0.8em';
			note.style.color = 'var(--text-muted)';
			note.style.marginBottom = '0.3em';
			note.setText(`${vaultEmissions.length} of your vault folders match these rules.`);
			this.renderEmissionList(vaultEmissions, false);
			return;
		}

		// Fallback — no real folder matches. Show illustrative sample paths so
		// the user always sees the rules working on something concrete.
		const samplePaths = deriveSamplePaths(def);
		const sampleEmissions = this.emitFor(samplePaths, rules, precedence);
		const label = this.outputEl.createDiv();
		label.style.fontSize = '0.8em';
		label.style.fontStyle = 'italic';
		label.style.color = 'var(--text-muted)';
		label.style.marginBottom = '0.3em';
		label.setText('(sample paths — your vault has no matching folders)');
		if (sampleEmissions.length === 0) {
			this.outputEl.createDiv({
				text: 'No emissions — the compiled rules did not match any sample path.',
			}).style.color = 'var(--text-muted)';
			return;
		}
		this.renderEmissionList(sampleEmissions, true);
	}

	/**
	 * Render sample emissions for a COMPOSED pack compiled against DERIVED sample
	 * anchors (the user's vault has no folder the mount's glob matches yet). The
	 * paths are labelled as samples, but the nested tags they emit are the real
	 * output of the mount expansion — so the user always sees composition working.
	 */
	private renderComposedSamples(samplePack: RulePack, samplePaths: string[]): void {
		const header = this.outputEl.createDiv({ text: 'Sample emissions' });
		header.style.fontWeight = '600';
		header.style.marginBottom = '0.35em';

		const label = this.outputEl.createDiv();
		label.style.fontSize = '0.8em';
		label.style.fontStyle = 'italic';
		label.style.color = 'var(--text-muted)';
		label.style.marginBottom = '0.3em';
		label.setText(
			'(sample paths — your vault has no matching folders yet; composition shown on derived folders)',
		);

		const emissions = this.emitFor(samplePaths, samplePack.rules, composedGroupPrecedence(samplePack));
		if (emissions.length === 0) {
			this.outputEl.createDiv({
				text: 'No emissions — the compiled rules did not match any sample path.',
			}).style.color = 'var(--text-muted)';
			return;
		}
		this.renderEmissionList(emissions, true);
	}

	/**
	 * Run the compiled rules against a list of folder paths, returning the
	 * folder → tag(s) emissions for every path that a rule matches. A path
	 * "matches" when `findBestMatch` selects a rule for it (forward direction);
	 * the emitted tags come from `applyRuleForward`.
	 */
	private emitFor(folders: string[], rules: MappingRule[], precedence?: string[]): Emission[] {
		const groups = precedence ?? this.groupPrecedence;
		const out: Emission[] = [];
		for (const folder of folders) {
			const context: RuleEvaluationContext = {
				input: folder,
				matchType: 'folder',
				direction: 'folder-to-tag',
			};
			const match = findBestMatch(folder, rules, context, groups);
			if (!match) continue;
			const { tags } = applyRuleForward(folder, match.rule);
			out.push({ folder, tags });
		}
		return out;
	}

	private renderEmissionList(emissions: Emission[], isSample: boolean): void {
		const list = this.outputEl.createDiv();
		list.style.fontFamily = 'var(--font-monospace)';
		list.style.fontSize = '0.82em';
		list.style.lineHeight = '1.55';

		const shown = emissions.slice(0, MAX_EMISSION_ROWS);
		for (const e of shown) {
			const row = list.createDiv();
			if (isSample) row.style.opacity = '0.92';
			row.createSpan({ text: e.folder });
			row.createSpan({ text: ' → ' }).style.color = 'var(--text-muted)';
			const tagsText = e.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(', ');
			const tags = row.createSpan({ text: tagsText || '(no tag)' });
			tags.style.color = e.tags.length > 0 ? 'var(--text-success, rgb(40, 140, 70))' : 'var(--text-faint)';
		}
		if (emissions.length > shown.length) {
			const more = list.createDiv({ text: `… ${emissions.length - shown.length} more` });
			more.style.color = 'var(--text-faint)';
		}
	}

	/** Walk the vault tree and return every folder path (excludes the root). */
	private collectVaultFolders(): string[] {
		const out: string[] = [];
		const walk = (folder: TFolder) => {
			for (const child of folder.children) {
				if (child instanceof TFolder) {
					out.push(child.path);
					walk(child);
				}
			}
		};
		walk(this.app.vault.getRoot());
		return out;
	}

	onClose(): void {
		if (this.debounceHandle !== null) {
			clearTimeout(this.debounceHandle);
			this.debounceHandle = null;
		}
		this.contentEl.empty();
	}
}

/**
 * Derive a handful of illustrative sample paths from a system definition, used
 * when the vault has no folders the compiled rules match. For each slot we
 * build a representative literal folder face (substituting parametric values,
 * filling Path-Lens tokens with sensible placeholders) plus one deeper child,
 * so the preview shows both the bare entry and a nested case.
 */
export function deriveSamplePaths(def: SystemDef): string[] {
	const paths: string[] = [];
	const seen = new Set<string>();
	const push = (p: string) => {
		if (p && !seen.has(p)) {
			seen.add(p);
			paths.push(p);
		}
	};
	for (const slot of def.slots) {
		const values = slot.values && slot.values.length ? slot.values : [undefined];
		for (const value of values) {
			const face = value !== undefined ? slot.folder.split(`{${slot.id}}`).join(value) : slot.folder;
			const example = exampleFromFace(face);
			push(example);
			push(`${example}/Example`);
			if (paths.length >= 12) return paths;
		}
	}
	return paths;
}

/** Placeholder owner used to render a concrete sample of a glob-mounted system. */
const SAMPLE_OWNER = 'SamplePerson';

/**
 * Derive concrete sample anchors + folder paths for a COMPOSED definition whose
 * mounts matched no real vault folder. Each `*` in a mount's `at:` glob is filled
 * with a placeholder owner, giving one sample anchor per mount (the glob
 * `Entity/<star>/Output` becomes `Entity/SamplePerson/Output`). The sample paths
 * exercise BOTH levels: the host portion the glob binds (`Entity/SamplePerson`,
 * which emits the host tag) and a deeper child drawn from the snapped system
 * (`Entity/SamplePerson/Output/01 - Name`, which emits the nested tag). Returns
 * the anchors to compile against and the paths to emit.
 */
export function deriveComposedSamples(
	def: SystemDef,
	registry: Map<string, SystemDef>,
): { anchors: string[]; samplePaths: string[] } {
	const anchors = new Set<string>();
	const samplePaths: string[] = [];
	const pushPath = (p: string) => {
		if (p && !samplePaths.includes(p)) samplePaths.push(p);
	};

	for (const mount of def.mounts ?? []) {
		const segs = mount.at.split('/');
		let lastStar = -1;
		for (let i = 0; i < segs.length; i++) if (segs[i] === '*') lastStar = i;
		const filled = segs.map((s) => (s === '*' ? SAMPLE_OWNER : s));
		const anchor = filled.join('/');
		anchors.add(anchor);

		// Host-level sample: the portion the glob's `*` binds emits the host tag.
		if (lastStar >= 0) pushPath(filled.slice(0, lastStar + 1).join('/'));

		// Nested sample: a deeper child from the snapped system, placed under the
		// anchor, emits the composed tag (host namespace + mounted body).
		const snapDef = registry.get(mount.snap);
		const deeper = snapDef ? firstSamplePath(snapDef) : undefined;
		pushPath(deeper ? `${anchor}/${deeper}` : anchor);
	}
	return { anchors: [...anchors], samplePaths };
}

/** First illustrative sample path for a system (used as a mount's deeper child). */
function firstSamplePath(def: SystemDef): string | undefined {
	const paths = deriveSamplePaths(def);
	return paths.length ? paths[0] : undefined;
}

/**
 * Is this group a mount placement, not the host root? Groups are `host@root`
 * (host) or `host@snap@anchor` (a mount) — the anchor follows the LAST `@`.
 */
function isMountGroup(group: string | undefined): boolean {
	if (!group) return false;
	const at = group.lastIndexOf('@');
	const anchor = at >= 0 ? group.slice(at + 1) : '';
	return anchor !== '' && anchor !== 'root' && anchor !== 'any-segment' && !anchor.startsWith('under:');
}

/**
 * Turn a folder face (possibly carrying `{token}` / `{token:regex}` Path-Lens
 * slots) into a representative literal. Balanced-brace aware so an inline regex
 * quantifier like `\d{1,2}` isn't mistaken for a slot boundary.
 */
function exampleFromFace(face: string): string {
	let out = '';
	let i = 0;
	while (i < face.length) {
		if (face[i] === '{') {
			let depth = 1;
			let j = i + 1;
			for (; j < face.length; j++) {
				if (face[j] === '{') depth++;
				else if (face[j] === '}') {
					depth--;
					if (depth === 0) break;
				}
			}
			out += exampleForToken(face.slice(i + 1, j));
			i = j + 1;
		} else {
			out += face[i];
			i++;
		}
	}
	return out;
}

/**
 * Pick a placeholder literal for one Path-Lens token body. Forms handled:
 * `name`, `name:regex`, `name...`, `name | filter`. A numeric inline regex
 * (`\d`) yields `01`; everything else title-cases the token name.
 */
function exampleForToken(body: string): string {
	const colonIdx = body.indexOf(':');
	const regexPart = colonIdx >= 0 ? body.slice(colonIdx + 1) : '';
	if (/\\d/.test(regexPart)) return '01';
	const name = (colonIdx >= 0 ? body.slice(0, colonIdx) : body)
		.split('|')[0]
		.replace(/\.\.\.$/, '')
		.trim();
	if (!name) return 'Example';
	return name.charAt(0).toUpperCase() + name.slice(1);
}
