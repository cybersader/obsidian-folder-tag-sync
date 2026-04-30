/**
 * Detect-mode modal — scans the vault, runs the pack detection engine,
 * displays ranked detected packs with Apply buttons.
 *
 * Each detected pack shows:
 *   - score badge (signals hit / min signals required)
 *   - matched signals as a bullet list (label + example folders)
 *   - "Apply" button → loads the pack JSON from rule-packs/, merges rules
 *     into settings (existing append logic from browseRulePacks)
 *
 * Suppressed packs (scopedUnder a parent that didn't match) render in a
 * subdued section at the bottom, with the parent's name shown — so the
 * user understands "PARA detected but expected inside SEACOW outer; SEACOW
 * outer not present" rather than the pack just silently disappearing.
 *
 * Exclusivity conflicts surface as a yellow banner above the list.
 */

import { App, Modal, Notice, TFolder } from 'obsidian';
import {
	detectPacks,
	findExclusivityConflicts,
	type DetectionResult,
	type ManifestPackEntry,
} from '../engine/detectPacks';
import {
	buildDetectionTree,
	buildInstanceTree,
	colorForSignalIndex,
	extractInstances,
	type DetectionInstanceTreeNode,
	type DetectionTreeNode,
} from '../engine/detectionTree';
import { loadRulePackFromJSON } from '../engine/rulePackLoader';
import type { MappingRule } from '../types/settings';
// Bundle the manifest at build time so the modal works even when the
// plugin's rule-packs/ folder isn't shipped alongside main.js (e.g. some
// wdio install paths copy only main.js + manifest.json + styles.css).
// Pack files themselves stay on-disk and load on-demand when the user
// applies a pack — that path goes through the vault adapter, which is
// fine because users installing via BRAT/community-plugins always get
// the full plugin directory.
import bundledManifest from '../../rule-packs/manifest.json';

interface ManifestFile {
	version: number;
	packs: Array<ManifestPackEntry & { file: string; description: string; ruleCount: number }>;
}

export class DetectVaultModal extends Modal {
	private readonly onApply: (rules: MappingRule[]) => void | Promise<void>;

	constructor(app: App, onApply: (rules: MappingRule[]) => void | Promise<void>) {
		super(app);
		this.onApply = onApply;
	}

	async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('dtf-detect-modal');
		modalEl.style.width = 'min(720px, 95vw)';

		contentEl.createEl('h2', { text: 'Detect organizational systems' });
		const intro = contentEl.createEl('p');
		intro.style.color = 'var(--text-muted)';
		intro.style.fontSize = '0.9em';
		intro.setText(
			'Scanning your vault for known organizational patterns. Each detected pack lists the signals that matched and offers to install its rules.',
		);

		const status = contentEl.createDiv();
		status.style.padding = '0.6em';
		status.style.fontStyle = 'italic';
		status.setText('Loading packs and scanning vault…');

		// Use bundled manifest. Falls back to filesystem read only if a future
		// version of the manifest schema needs runtime fetching.
		const manifest = bundledManifest as ManifestFile;

		const folderPaths = this.collectVaultFolders();
		const results = detectPacks(folderPaths, manifest.packs);
		const conflicts = findExclusivityConflicts(results, manifest.packs);

		status.remove();

		if (results.length === 0) {
			const empty = contentEl.createDiv();
			empty.style.padding = '1em';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--text-muted)';
			empty.createEl('p', {
				text: "No organizational patterns detected in this vault. You can browse the catalog or author a rule manually.",
			});
			return;
		}

		// Exclusivity warnings
		if (conflicts.length > 0) {
			const warn = contentEl.createDiv({ cls: 'dtf-detect-warn' });
			warn.style.padding = '0.6em 0.8em';
			warn.style.background = 'var(--background-modifier-error-hover)';
			warn.style.borderLeft = '3px solid var(--text-error)';
			warn.style.borderRadius = '4px';
			warn.style.marginBottom = '0.8em';
			warn.style.fontSize = '0.9em';
			const conflictText = conflicts
				.map((c) => `${this.packName(manifest, c.packA)} ↔ ${this.packName(manifest, c.packB)}`)
				.join(', ');
			warn.createSpan({ text: `⚠ Conflicts detected: ${conflictText}` }).style.fontWeight = '500';
			warn.createEl('div', {
				text: 'These packs target the same niche. Install only one of each conflicting pair.',
			});
		}

		// Render results — surfacing first, then suppressed
		const surfacing = results.filter((r) => r.score >= 1 && !r.suppressedByMissingParent);
		const suppressed = results.filter((r) => r.suppressedByMissingParent);
		const lowConfidence = results.filter(
			(r) => r.score < 1 && !r.suppressedByMissingParent,
		);

		if (surfacing.length > 0) {
			const heading = contentEl.createEl('h3', { text: 'Detected (high confidence)' });
			heading.style.marginTop = '0.5em';
			heading.style.fontSize = '0.95em';
			for (const result of surfacing) {
				this.renderResult(contentEl, result, manifest, false, folderPaths);
			}
		}

		if (lowConfidence.length > 0) {
			const heading = contentEl.createEl('h3', { text: 'Partial match' });
			heading.style.marginTop = '0.8em';
			heading.style.fontSize = '0.95em';
			heading.style.color = 'var(--text-muted)';
			for (const result of lowConfidence) {
				this.renderResult(contentEl, result, manifest, false, folderPaths);
			}
		}

		if (suppressed.length > 0) {
			const heading = contentEl.createEl('h3', { text: 'Suppressed (parent missing)' });
			heading.style.marginTop = '0.8em';
			heading.style.fontSize = '0.95em';
			heading.style.color = 'var(--text-muted)';
			for (const result of suppressed) {
				this.renderResult(contentEl, result, manifest, true, folderPaths);
			}
		}
	}

	private renderResult(
		parent: HTMLElement,
		result: DetectionResult,
		manifest: ManifestFile,
		suppressed: boolean,
		folderPaths: string[],
	): void {
		const pack = manifest.packs.find((p) => p.id === result.packId);
		if (!pack) return;

		const card = parent.createDiv({ cls: 'dtf-detect-result' });
		card.style.padding = '0.8em';
		card.style.background = 'var(--background-secondary)';
		card.style.borderRadius = '6px';
		card.style.marginBottom = '0.5em';
		card.style.opacity = suppressed ? '0.7' : '1';

		const headerRow = card.createDiv();
		headerRow.style.display = 'flex';
		headerRow.style.alignItems = 'baseline';
		headerRow.style.gap = '0.6em';
		headerRow.style.marginBottom = '0.3em';

		const name = headerRow.createEl('strong', { text: pack.name });
		name.style.flex = '1';

		const scoreBadge = headerRow.createSpan();
		scoreBadge.setText(`${result.signalsHit}/${result.minSignals} signals`);
		scoreBadge.style.padding = '0.15em 0.5em';
		scoreBadge.style.borderRadius = '10px';
		scoreBadge.style.fontSize = '0.78em';
		scoreBadge.style.background =
			result.score >= 1 ? 'var(--color-green)' : 'var(--color-base-50)';
		scoreBadge.style.color = 'var(--text-on-accent)';

		const desc = card.createDiv();
		desc.style.fontSize = '0.85em';
		desc.style.color = 'var(--text-muted)';
		desc.style.marginBottom = '0.4em';
		desc.setText(pack.description);

		// Suppressed → show why
		if (suppressed && result.scopedUnder) {
			const why = card.createDiv();
			why.style.fontSize = '0.85em';
			why.style.fontStyle = 'italic';
			why.style.marginBottom = '0.4em';
			why.setText(
				`Expects to be nested under "${this.packName(manifest, result.scopedUnder)}", which was not detected. Install with adjusted entry point if your structure differs.`,
			);
		}

		// Matched-signals legend — one chip per signal, colour-coded so the
		// vault tree below can show which signal lit up each folder. Click a
		// chip to highlight just that signal in the tree.
		let activeSignalFilter: number | null = null;
		const legend = card.createDiv();
		legend.style.display = 'flex';
		legend.style.flexWrap = 'wrap';
		legend.style.gap = '0.3em';
		legend.style.marginBottom = '0.4em';

		const signalChips: HTMLElement[] = [];
		for (let i = 0; i < result.matchedSignals.length; i++) {
			const sig = result.matchedSignals[i];
			const color = colorForSignalIndex(i);
			const chip = legend.createSpan();
			chip.style.display = 'inline-flex';
			chip.style.alignItems = 'center';
			chip.style.gap = '0.3em';
			chip.style.padding = '0.15em 0.55em';
			chip.style.background = 'var(--background-secondary-alt)';
			chip.style.border = '1px solid var(--background-modifier-border)';
			chip.style.borderRadius = '999px';
			chip.style.fontSize = '0.78em';
			chip.style.cursor = 'pointer';
			chip.style.userSelect = 'none';
			const swatch = chip.createSpan();
			swatch.style.display = 'inline-block';
			swatch.style.width = '8px';
			swatch.style.height = '8px';
			swatch.style.borderRadius = '50%';
			swatch.style.background = color;
			chip.createSpan({ text: sig.label ?? sig.folderRegex });
			signalChips.push(chip);
		}

		// Anchored-instance summary. A pack can detect at multiple "anchors"
		// in a vault — e.g. JD numbering at root AND JD nested inside an
		// entity-scoped subfolder. Without this summary, the user can't tell
		// whether "JD detected" means one big match or N independent
		// applications of the same pattern at different levels.
		const instances = extractInstances(folderPaths, result);
		const instanceTree = buildInstanceTree(instances);
		if (instances.length > 0) {
			const summary = card.createDiv();
			summary.style.fontSize = '0.85em';
			summary.style.padding = '0.45em 0.6em';
			summary.style.background = 'var(--background-primary-alt)';
			summary.style.borderRadius = '4px';
			summary.style.borderLeft = '3px solid var(--interactive-accent)';
			summary.style.marginBottom = '0.4em';

			const header = summary.createDiv();
			header.style.fontWeight = '500';
			header.style.marginBottom = instances.length > 1 ? '0.3em' : '0';
			if (instances.length === 1) {
				const inst = instances[0];
				const anchorLabel = inst.anchorPath || '(vault root)';
				header.setText(
					`Detected as 1 instance — anchored at ${anchorLabel} (${inst.hits.length} hit${inst.hits.length === 1 ? '' : 's'})`,
				);
			} else {
				header.setText(`Detected as ${instances.length} nested instance(s) of this pattern:`);
				const list = summary.createDiv();
				renderInstanceTree(list, instanceTree, 0);
			}
		}

		// "Show vault tree" expand-toggle — building the tree is fast (single
		// pass over folders) but rendering 5000 nodes is wasteful when the
		// user just wants to glance at scores. Hidden behind a click.
		const treeToggle = card.createDiv();
		treeToggle.style.display = 'flex';
		treeToggle.style.alignItems = 'center';
		treeToggle.style.gap = '0.4em';
		treeToggle.style.cursor = 'pointer';
		treeToggle.style.userSelect = 'none';
		treeToggle.style.fontSize = '0.85em';
		treeToggle.style.color = 'var(--text-muted)';
		treeToggle.style.marginTop = '0.3em';
		treeToggle.style.marginBottom = '0.3em';
		const toggleArrow = treeToggle.createSpan({ text: '▸' });
		toggleArrow.style.fontSize = '0.8em';
		const toggleLabel = treeToggle.createSpan({ text: 'Show where this detected (vault tree)' });

		const treeContainer = card.createDiv();
		treeContainer.style.display = 'none';
		treeContainer.style.background = 'var(--background-primary)';
		treeContainer.style.padding = '0.5em 0.6em';
		treeContainer.style.borderRadius = '4px';
		treeContainer.style.border = '1px solid var(--background-modifier-border)';
		treeContainer.style.marginBottom = '0.4em';
		treeContainer.style.maxHeight = '40vh';
		treeContainer.style.overflow = 'auto';

		let treeBuilt = false;
		const renderTree = () => {
			treeContainer.empty();
			const tree = buildDetectionTree(folderPaths, result);
			if (tree.totalHitFolders === 0) {
				const empty = treeContainer.createDiv();
				empty.style.color = 'var(--text-muted)';
				empty.style.fontStyle = 'italic';
				empty.style.padding = '0.4em';
				empty.setText('No folders matched any signal in this vault.');
				return;
			}
			// Header line with hit count + (if filtering) which signal
			const header = treeContainer.createDiv();
			header.style.fontSize = '0.82em';
			header.style.color = 'var(--text-muted)';
			header.style.marginBottom = '0.3em';
			const baseText =
				`${tree.totalHitFolders} folder(s) matched · ${tree.totalVaultFolders} folders scanned`;
			header.setText(activeSignalFilter !== null
				? `${baseText} · filtering: ${result.matchedSignals[activeSignalFilter].label ?? result.matchedSignals[activeSignalFilter].folderRegex}`
				: baseText);

			renderDetectionTreeNode(treeContainer, tree.root, 0, activeSignalFilter, true);
		};

		treeToggle.addEventListener('click', () => {
			const isOpen = treeContainer.style.display !== 'none';
			if (isOpen) {
				treeContainer.style.display = 'none';
				toggleArrow.setText('▸');
				return;
			}
			if (!treeBuilt) {
				renderTree();
				treeBuilt = true;
			}
			treeContainer.style.display = '';
			toggleArrow.setText('▾');
		});

		// Wire signal-chip clicks → toggle filter, re-render tree if open
		signalChips.forEach((chip, idx) => {
			chip.addEventListener('click', () => {
				activeSignalFilter = activeSignalFilter === idx ? null : idx;
				signalChips.forEach((c, i) => {
					c.style.outline =
						activeSignalFilter === i ? '2px solid var(--interactive-accent)' : '';
					c.style.opacity =
						activeSignalFilter !== null && i !== activeSignalFilter ? '0.4' : '1';
				});
				if (treeBuilt) renderTree();
			});
		});

		// Apply button (disabled for suppressed)
		const actions = card.createDiv();
		actions.style.display = 'flex';
		actions.style.justifyContent = 'flex-end';
		const applyBtn = actions.createEl('button', { text: 'Apply rules', cls: 'mod-cta' });
		if (suppressed) {
			applyBtn.disabled = true;
			applyBtn.style.opacity = '0.5';
			applyBtn.title = 'Parent pack is missing — install parent first or adjust entry point.';
		}
		applyBtn.addEventListener('click', () => this.applyPack(pack));
	}

	private async applyPack(packEntry: ManifestFile['packs'][number]): Promise<void> {
		const adapter = this.app.vault.adapter;
		const path = `${this.app.vault.configDir}/plugins/${this.pluginId()}/rule-packs/${packEntry.file}`;
		try {
			const json = await adapter.read(path);
			const result = loadRulePackFromJSON(json);
			if (!result.ok) {
				new Notice(`✗ Failed to load ${packEntry.name}: ${result.errors[0]}`);
				return;
			}
			await this.onApply(result.pack.rules);
			new Notice(`✓ Applied ${packEntry.name} — ${result.pack.rules.length} rule(s)`);
			this.close();
		} catch (err) {
			new Notice(`✗ Error reading ${packEntry.file}: ${(err as Error).message}`);
		}
	}

	private pluginId(): string {
		// The detect modal is constructed by the main plugin which knows its own
		// id. We grab from the same place browseRulePacks does. Hardcoded as a
		// fallback — matches manifest.json id.
		return 'folder-tag-sync';
	}

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

	private packName(manifest: ManifestFile, id: string): string {
		const found = manifest.packs.find((p) => p.id === id);
		return found?.name ?? id;
	}

	onClose(): void {
		this.contentEl.empty();
	}
}

// ─── Anchored-instance summary renderer ───────────────────────────────

/**
 * Render the nested-instance forest as a compact indented list. Each row
 * states one instance's anchor + hit count + a short preview of the first
 * few hit folder names. Nested instances appear indented with a tree-line
 * connector so the recurrence ("JD inside JD") shows up structurally.
 *
 * Why this matters: a vault with JD at root + JD inside `Projects/Bob/`
 * gets rendered as:
 *
 *   • At (vault root) — 5 hits: 01 - Projects, 02 - Areas, …
 *     └─ At 01 - Projects/Bob/ — 3 hits: 01 - Active, 02 - Archive, …
 *
 * The user immediately sees "this is the same pattern detected twice, in
 * a nested arrangement." No paragraph of explanation needed.
 */
function renderInstanceTree(
	parent: HTMLElement,
	nodes: DetectionInstanceTreeNode[],
	depth: number,
): void {
	for (const node of nodes) {
		const row = parent.createDiv();
		row.style.paddingLeft = `${depth * 1.0}em`;
		row.style.fontSize = '0.85em';
		row.style.lineHeight = '1.5';

		// Tree-line connector for nested instances
		const connector = depth > 0 ? '└─ ' : '• ';
		const conSpan = row.createSpan({ text: connector });
		conSpan.style.color = 'var(--text-muted)';

		const anchor = row.createSpan({
			text: 'At ',
		});
		anchor.style.color = 'var(--text-muted)';
		const anchorPath = row.createEl('code', {
			text: node.instance.anchorPath || '(vault root)',
		});
		anchorPath.style.background = 'var(--background-modifier-form-field)';
		anchorPath.style.padding = '0 0.3em';
		anchorPath.style.borderRadius = '3px';
		anchorPath.style.fontSize = '0.92em';

		const stats = row.createSpan({
			text: ` — ${node.instance.hits.length} hit${node.instance.hits.length === 1 ? '' : 's'}`,
		});
		stats.style.color = 'var(--text-muted)';

		// Preview of the first few hit folder names (relative to anchor)
		const previewCount = Math.min(node.instance.hits.length, 3);
		if (previewCount > 0) {
			const previews: string[] = [];
			for (let i = 0; i < previewCount; i++) {
				const path = node.instance.hits[i].folderPath;
				const idx = path.lastIndexOf('/');
				previews.push(idx === -1 ? path : path.slice(idx + 1));
			}
			const previewSpan = row.createSpan({
				text: `: ${previews.join(', ')}${node.instance.hits.length > previewCount ? ', …' : ''}`,
			});
			previewSpan.style.color = 'var(--text-faint)';
			previewSpan.style.fontStyle = 'italic';
		}

		// Recurse for nested instances
		if (node.children.length > 0) {
			renderInstanceTree(parent, node.children, depth + 1);
		}
	}
}

// ─── Detection tree renderer ──────────────────────────────────────────

/**
 * Recursively render a `DetectionTreeNode` into the DOM.
 *
 * Visual scheme:
 *   - Hit folders: bold name + signal-coloured swatches + accent left border
 *     (so you can scan the tree and see lit-up folders at a glance).
 *   - Ancestor-only folders: dimmed/muted text — they exist purely to give
 *     the hit folders a location.
 *   - Elision badge: "(N more folders, no matches)" rendered subdued at the
 *     bottom of each node's children list. Non-interactive — the user is
 *     told what was hidden, but doesn't need to drill into non-hit branches
 *     (that's what would defeat the elision).
 *   - Filter mode: when `activeSignalFilter` is non-null, only show hits
 *     that include that signal. Other hits are dimmed-but-visible.
 *
 * Default expansion: depth 0 (root children) and depth 1 are open by
 * default; deeper levels are collapsed so the initial view is compact.
 * Click a folder row to toggle its subtree.
 */
function renderDetectionTreeNode(
	parent: HTMLElement,
	node: DetectionTreeNode,
	depth: number,
	activeSignalFilter: number | null,
	isRoot: boolean,
): void {
	if (!isRoot) {
		const row = parent.createDiv();
		row.style.display = 'flex';
		row.style.alignItems = 'center';
		row.style.gap = '0.35em';
		row.style.padding = '0.18em 0.3em';
		row.style.paddingLeft = `${depth * 1.0}em`;
		row.style.borderRadius = '3px';
		row.style.cursor = node.children.size > 0 ? 'pointer' : 'default';
		row.style.userSelect = 'none';

		const isHit = node.hits.length > 0;
		const filterMatch =
			activeSignalFilter === null ||
			node.hits.some((h) => h.signalIndex === activeSignalFilter);

		// Hover effect
		row.addEventListener('mouseenter', () => {
			row.style.background = 'var(--background-modifier-hover)';
		});
		row.addEventListener('mouseleave', () => {
			row.style.background = '';
		});

		// Expansion arrow (or empty space if leaf)
		const arrow = row.createSpan();
		arrow.style.minWidth = '0.8em';
		arrow.style.fontSize = '0.8em';
		arrow.style.color = 'var(--text-muted)';
		const startsExpanded = depth < 2;
		arrow.setText(node.children.size > 0 ? (startsExpanded ? '▾' : '▸') : ' ');

		// Signal-colour swatch row (one per hit, up to 4 visible)
		if (isHit) {
			const swatches = row.createSpan();
			swatches.style.display = 'inline-flex';
			swatches.style.gap = '2px';
			const visible = node.hits.slice(0, 4);
			for (const hit of visible) {
				const sw = swatches.createSpan();
				sw.style.display = 'inline-block';
				sw.style.width = '7px';
				sw.style.height = '7px';
				sw.style.borderRadius = '50%';
				sw.style.background = colorForSignalIndex(hit.signalIndex);
				sw.title = hit.signalLabel;
			}
			if (node.hits.length > visible.length) {
				const more = swatches.createSpan({
					text: `+${node.hits.length - visible.length}`,
				});
				more.style.fontSize = '0.7em';
				more.style.color = 'var(--text-muted)';
				more.style.marginLeft = '0.2em';
			}
		}

		// Folder icon — slightly smaller for ancestor-only rows
		const icon = row.createSpan({ text: '📁' });
		icon.style.fontSize = '0.92em';

		// Name
		const nameSpan = row.createSpan({ text: node.name });
		nameSpan.style.fontWeight = isHit ? '600' : '400';
		if (!isHit) nameSpan.style.color = 'var(--text-muted)';
		if (!filterMatch) {
			row.style.opacity = '0.4'; // dim non-matching-filter rows
		}

		// Hit accent — coloured left border using the FIRST signal's colour
		if (isHit) {
			row.style.borderLeft = `3px solid ${colorForSignalIndex(node.hits[0].signalIndex)}`;
			row.style.paddingLeft = `${depth * 1.0 + 0.1}em`;
		}

		// Signal label inline (only when filter is off + not too many)
		if (isHit && activeSignalFilter === null && node.hits.length <= 2) {
			const labels = row.createSpan({
				text: node.hits.map((h) => h.signalLabel).join(', '),
			});
			labels.style.fontSize = '0.74em';
			labels.style.color = 'var(--text-muted)';
			labels.style.marginLeft = '0.4em';
			labels.style.fontStyle = 'italic';
		}

		// Children container
		const childWrap = parent.createDiv();
		if (!startsExpanded) childWrap.style.display = 'none';
		// Recurse
		const childKeys = [...node.children.keys()].sort();
		for (const key of childKeys) {
			renderDetectionTreeNode(childWrap, node.children.get(key)!, depth + 1, activeSignalFilter, false);
		}
		// Elision badge for non-hit children
		if (node.elidedChildCount > 0) {
			const elision = childWrap.createDiv();
			elision.style.paddingLeft = `${(depth + 1) * 1.0}em`;
			elision.style.fontSize = '0.78em';
			elision.style.color = 'var(--text-faint)';
			elision.style.fontStyle = 'italic';
			elision.setText(`… ${node.elidedChildCount} other folder(s), no matches`);
		}

		// Toggle expand on row click
		if (node.children.size > 0) {
			row.addEventListener('click', () => {
				const open = childWrap.style.display === 'none';
				childWrap.style.display = open ? '' : 'none';
				arrow.setText(open ? '▾' : '▸');
			});
		}
	} else {
		// Root node — render its children directly without the row chrome.
		const childKeys = [...node.children.keys()].sort();
		for (const key of childKeys) {
			renderDetectionTreeNode(parent, node.children.get(key)!, 0, activeSignalFilter, false);
		}
		// Root-level elision (vault folders without any hits in their subtree)
		if (node.elidedChildCount > 0) {
			const elision = parent.createDiv();
			elision.style.fontSize = '0.78em';
			elision.style.color = 'var(--text-faint)';
			elision.style.fontStyle = 'italic';
			elision.style.paddingTop = '0.3em';
			elision.setText(`… ${node.elidedChildCount} top-level folder(s) with no matches`);
		}
	}
}
