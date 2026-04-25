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
				this.renderResult(contentEl, result, manifest, false);
			}
		}

		if (lowConfidence.length > 0) {
			const heading = contentEl.createEl('h3', { text: 'Partial match' });
			heading.style.marginTop = '0.8em';
			heading.style.fontSize = '0.95em';
			heading.style.color = 'var(--text-muted)';
			for (const result of lowConfidence) {
				this.renderResult(contentEl, result, manifest, false);
			}
		}

		if (suppressed.length > 0) {
			const heading = contentEl.createEl('h3', { text: 'Suppressed (parent missing)' });
			heading.style.marginTop = '0.8em';
			heading.style.fontSize = '0.95em';
			heading.style.color = 'var(--text-muted)';
			for (const result of suppressed) {
				this.renderResult(contentEl, result, manifest, true);
			}
		}
	}

	private renderResult(
		parent: HTMLElement,
		result: DetectionResult,
		manifest: ManifestFile,
		suppressed: boolean,
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

		// Matched signals list
		if (result.matchedSignals.length > 0) {
			const sigList = card.createEl('ul');
			sigList.style.fontSize = '0.85em';
			sigList.style.paddingLeft = '1.2em';
			sigList.style.marginTop = '0.2em';
			sigList.style.marginBottom = '0.4em';
			for (const sig of result.matchedSignals) {
				const li = sigList.createEl('li');
				if (sig.label) li.createSpan({ text: sig.label });
				else li.createEl('code', { text: sig.folderRegex });
				if (sig.exampleMatches.length > 0) {
					li.createSpan({ text: ` — ` });
					sig.exampleMatches.forEach((ex, i) => {
						if (i > 0) li.createSpan({ text: ', ' });
						li.createEl('code', { text: ex });
					});
				}
			}
		}

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
