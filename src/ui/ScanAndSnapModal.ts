/**
 * Scan & Snap modal — the first user-clickable piece of the rule-authoring
 * builder (Phase 1b). It turns "your vault appears to use these known
 * organizational systems" into a flat, triage-able list of *candidate rules*
 * you can review and commit — without hand-writing a single regex.
 *
 * The flow it wires:
 *   1. collect vault folders → detectPacks(folders, manifest.packs)
 *   2. for each non-suppressed detected pack, load its rule-pack JSON via the
 *      vault adapter (same path logic as DetectVaultModal) → packRulesById
 *   3. buildScanAndSnapPlan(...) — the pure planner does the scoping, coverage,
 *      bijectivity, and union-aware conflict analysis (see scanAndSnapPlan.ts)
 *   4. render one row per CandidateRow, enabled by default, junk-first
 *   5. on "Add N rules" → confirm → merge selected candidates' .rule into
 *      settings (dedupe by id) via the onApply callback
 *
 * READ-ONLY by design: it never creates or moves folders. It only drafts rules
 * from recognized packs — raw-structure synthesis is a later phase.
 *
 * Sibling to DetectVaultModal; reuses its structural patterns deliberately
 * (collectVaultFolders, bundled-manifest import, adapter pack-loading, the
 * stat-bar / makeStat style, the apply-via-callback shape).
 */

import { App, Modal, Notice, TFolder } from 'obsidian';
import { detectPacks, type ManifestPackEntry } from '../engine/detectPacks';
import { loadRulePackFromJSON } from '../engine/rulePackLoader';
import {
	buildScanAndSnapPlan,
	sortCandidatesByConflict,
	sortCandidatesByNoise,
	type CandidateRow,
	type ScanAndSnapPlan,
} from '../engine/scanAndSnapPlan';
import type { MappingRule } from '../types/settings';
import bundledManifest from '../../rule-packs/manifest.json';

interface ManifestFile {
	version: number;
	packs: Array<ManifestPackEntry & { file: string; description: string; ruleCount: number }>;
}

export class ScanAndSnapModal extends Modal {
	private readonly onApply: (rules: MappingRule[]) => void | Promise<void>;
	private readonly existingRules: MappingRule[];
	private readonly groupPrecedence?: string[];

	private candidates: CandidateRow[] = [];
	private readonly selected = new Set<string>();
	private listContainer!: HTMLElement;
	private addBtn!: HTMLButtonElement;

	constructor(
		app: App,
		existingRules: MappingRule[],
		groupPrecedence: string[] | undefined,
		onApply: (rules: MappingRule[]) => void | Promise<void>,
	) {
		super(app);
		this.existingRules = existingRules;
		this.groupPrecedence = groupPrecedence;
		this.onApply = onApply;
	}

	async onOpen(): Promise<void> {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('dtf-scan-snap-modal');
		modalEl.style.width = 'min(940px, 95vw)';
		modalEl.style.maxHeight = '90vh';

		contentEl.createEl('h2', { text: 'Scan & snap — draft rules from your vault' });

		const status = contentEl.createDiv();
		status.style.padding = '0.6em';
		status.style.fontStyle = 'italic';
		status.style.color = 'var(--text-muted)';
		status.setText('Scanning vault…');

		// ─── Detect → load packs → plan ───────────────────────────────
		const manifest = bundledManifest as ManifestFile;
		const folderPaths = this.collectVaultFolders();
		const detectionResults = detectPacks(folderPaths, manifest.packs);

		const packRulesById = new Map<string, MappingRule[]>();
		const packNamesById = new Map<string, string>();
		const loadErrors: string[] = [];

		const adapter = this.app.vault.adapter;
		for (const result of detectionResults) {
			if (result.suppressedByMissingParent) continue;
			const packEntry = manifest.packs.find((p) => p.id === result.packId);
			if (!packEntry) continue;
			packNamesById.set(packEntry.id, packEntry.name);
			const path = `${this.app.vault.configDir}/plugins/folder-tag-sync/rule-packs/${packEntry.file}`;
			try {
				const json = await adapter.read(path);
				const parsed = loadRulePackFromJSON(json);
				if (parsed.ok) {
					packRulesById.set(result.packId, parsed.pack.rules);
				} else {
					loadErrors.push(`${packEntry.name}: ${parsed.errors[0]}`);
				}
			} catch (err) {
				loadErrors.push(`${packEntry.name}: ${(err as Error).message}`);
			}
		}

		const plan: ScanAndSnapPlan = buildScanAndSnapPlan({
			folderPaths,
			detectionResults,
			packRulesById,
			existingRules: this.existingRules,
			packNamesById,
			groupPrecedence: this.groupPrecedence,
		});

		status.remove();

		// ─── Empty state ──────────────────────────────────────────────
		if (plan.candidates.length === 0) {
			const empty = contentEl.createDiv();
			empty.style.padding = '1em';
			empty.style.textAlign = 'center';
			empty.style.color = 'var(--text-muted)';
			empty.createEl('p', {
				text: 'No known organizational systems detected to draft rules from — you can author a rule manually or browse packs.',
			});
			if (loadErrors.length > 0) {
				const err = empty.createEl('p', { text: `Note: ${loadErrors.length} pack(s) failed to load.` });
				err.style.fontSize = '0.82em';
				err.title = loadErrors.join('\n');
			}
			const closeBtn = empty.createEl('button', { text: 'Close' });
			closeBtn.style.marginTop = '0.6em';
			closeBtn.addEventListener('click', () => this.close());
			return;
		}

		// Default sort: junk first (0-match / no-emit rows at top, easy to cull).
		// Default selection: every candidate enabled.
		this.candidates = sortCandidatesByNoise(plan.candidates);
		for (const c of this.candidates) this.selected.add(c.id);

		// ─── Stat bar ─────────────────────────────────────────────────
		const statBar = contentEl.createDiv();
		statBar.style.display = 'grid';
		statBar.style.gridTemplateColumns = 'repeat(auto-fit, minmax(120px, 1fr))';
		statBar.style.gap = '0.5em';
		statBar.style.marginBottom = '0.7em';
		this.makeStat(statBar, 'Candidates', plan.summary.totalCandidates);
		this.makeStat(statBar, 'Would touch files', plan.summary.touchingCandidates);
		this.makeStat(statBar, 'Conflicts', plan.summary.conflictingCandidates);
		this.makeStat(statBar, 'Overlap existing', plan.summary.collidingWithExistingCandidates);
		this.makeStat(statBar, 'Systems', plan.summary.distinctSourcePacks.length);

		// ─── Pack-load error notice (non-fatal) ───────────────────────
		if (loadErrors.length > 0) {
			const warn = contentEl.createDiv();
			warn.style.padding = '0.4em 0.6em';
			warn.style.fontSize = '0.83em';
			warn.style.color = 'var(--text-muted)';
			warn.style.fontStyle = 'italic';
			warn.style.marginBottom = '0.4em';
			warn.setText(`Note: ${loadErrors.length} pack(s) failed to load and were skipped.`);
			warn.title = loadErrors.join('\n');
		}

		// ─── Hint line ────────────────────────────────────────────────
		const hint = contentEl.createDiv();
		hint.style.fontSize = '0.84em';
		hint.style.color = 'var(--text-muted)';
		hint.style.marginBottom = '0.5em';
		hint.setText(
			'Every candidate is checked by default. Junk (zero-match) rows are at the top — uncheck or ignore them. Review conflicts before adding.',
		);

		// ─── Toolbar ──────────────────────────────────────────────────
		const toolbar = contentEl.createDiv();
		toolbar.style.display = 'flex';
		toolbar.style.gap = '0.4em';
		toolbar.style.marginBottom = '0.5em';
		toolbar.style.flexWrap = 'wrap';

		const selectAllBtn = toolbar.createEl('button', { text: 'Select all' });
		selectAllBtn.addEventListener('click', () => {
			for (const c of this.candidates) this.selected.add(c.id);
			this.renderList();
			this.refreshAddBtn();
		});
		const selectNoneBtn = toolbar.createEl('button', { text: 'Select none' });
		selectNoneBtn.addEventListener('click', () => {
			this.selected.clear();
			this.renderList();
			this.refreshAddBtn();
		});
		const sortNoiseBtn = toolbar.createEl('button', { text: 'Sort: junk first' });
		sortNoiseBtn.addEventListener('click', () => {
			this.candidates = sortCandidatesByNoise(this.candidates);
			this.renderList();
		});
		const sortConflictBtn = toolbar.createEl('button', { text: 'Sort: conflicts first' });
		sortConflictBtn.addEventListener('click', () => {
			this.candidates = sortCandidatesByConflict(this.candidates);
			this.renderList();
		});

		// ─── Candidate list ───────────────────────────────────────────
		this.listContainer = contentEl.createDiv();
		this.listContainer.dataset.dtfScanSnapTree = '1';
		this.listContainer.style.maxHeight = '52vh';
		this.listContainer.style.overflow = 'auto';
		this.listContainer.style.background = 'var(--background-secondary)';
		this.listContainer.style.padding = '0.5em 0.6em';
		this.listContainer.style.borderRadius = '6px';
		this.listContainer.style.fontSize = '0.88em';
		this.listContainer.style.marginBottom = '0.7em';

		this.renderList();

		// ─── Footer actions ───────────────────────────────────────────
		const actions = contentEl.createDiv();
		actions.style.display = 'flex';
		actions.style.gap = '0.5em';
		actions.style.justifyContent = 'flex-end';
		actions.style.alignItems = 'center';
		actions.style.marginTop = '0.5em';

		const cancelBtn = actions.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => this.close());

		this.addBtn = actions.createEl('button', { text: '' });
		this.addBtn.addClass('mod-cta');
		this.refreshAddBtn();
		this.addBtn.addEventListener('click', () => this.confirmAndAdd());
	}

	// ─── Stat-card helper (mirrors DetectVaultModal) ──────────────────
	private makeStat(parent: HTMLElement, label: string, value: number): void {
		const card = parent.createDiv();
		card.style.padding = '0.4em 0.6em';
		card.style.background = 'var(--background-secondary)';
		card.style.borderRadius = '6px';
		const v = card.createEl('div', { text: String(value) });
		v.style.fontSize = '1.2em';
		v.style.fontWeight = '600';
		v.style.lineHeight = '1.1';
		const l = card.createEl('div', { text: label });
		l.style.fontSize = '0.75em';
		l.style.color = 'var(--text-muted)';
	}

	// ─── List rendering ───────────────────────────────────────────────
	private renderList(): void {
		this.listContainer.empty();
		for (const candidate of this.candidates) {
			this.renderCandidateRow(this.listContainer, candidate);
		}
	}

	private renderCandidateRow(parent: HTMLElement, candidate: CandidateRow): void {
		const row = parent.createDiv();
		row.dataset.dtfCandidateRow = '1';
		row.style.display = 'flex';
		row.style.flexDirection = 'column';
		row.style.gap = '0.2em';
		row.style.padding = '0.4em 0.4em';
		row.style.borderRadius = '4px';
		row.style.borderBottom = '1px solid var(--background-modifier-border)';
		row.addEventListener('mouseenter', () => { row.style.background = 'var(--background-modifier-hover)'; });
		row.addEventListener('mouseleave', () => { row.style.background = ''; });

		// ── Header line: checkbox · anchor · source · chips · badge ──
		const head = row.createDiv();
		head.style.display = 'flex';
		head.style.alignItems = 'center';
		head.style.gap = '0.4em';
		head.style.flexWrap = 'wrap';

		const cb = head.createEl('input', { type: 'checkbox' });
		cb.checked = this.selected.has(candidate.id);
		cb.addEventListener('change', () => {
			if (cb.checked) this.selected.add(candidate.id);
			else this.selected.delete(candidate.id);
			this.refreshAddBtn();
		});

		const anchorLabel = candidate.anchorPath || '(vault root)';
		const anchorSpan = head.createSpan({ text: anchorLabel });
		anchorSpan.style.fontWeight = '600';
		anchorSpan.style.fontFamily = 'var(--font-monospace)';
		anchorSpan.style.fontSize = '0.92em';

		const sourceSpan = head.createSpan({ text: candidate.sourcePackName });
		sourceSpan.style.fontSize = '0.76em';
		sourceSpan.style.color = 'var(--text-muted)';

		// Coverage chip
		this.renderCoverageChip(head, candidate);

		// Bijectivity chip
		this.renderBijectivityChip(head, candidate);

		// Conflict badge
		this.renderConflictBadge(head, candidate);

		// ── Sample emissions (folder → tags), like DetectVaultModal ──
		const samples = candidate.coverage.sampleEmissions.slice(0, 3);
		if (samples.length > 0) {
			const sampleWrap = row.createDiv();
			sampleWrap.style.fontFamily = 'var(--font-monospace)';
			sampleWrap.style.fontSize = '0.78em';
			sampleWrap.style.color = 'var(--text-muted)';
			sampleWrap.style.paddingLeft = '1.6em';
			sampleWrap.style.lineHeight = '1.5';
			for (const s of samples) {
				const line = sampleWrap.createDiv();
				line.createSpan({ text: s.folder });
				line.createSpan({ text: ' → ' });
				const tagsText = s.tags.map((t) => (t.startsWith('#') ? t : `#${t}`)).join(', ');
				const tags = line.createSpan({ text: tagsText || '(no tag)' });
				tags.style.color = s.tags.length > 0 ? 'var(--text-success, rgb(40, 140, 70))' : 'var(--text-faint)';
			}
			if (candidate.coverage.matchCount > samples.length) {
				const more = sampleWrap.createDiv({
					text: `… ${candidate.coverage.matchCount - samples.length} more`,
				});
				more.style.color = 'var(--text-faint)';
			}
		}
	}

	private renderCoverageChip(parent: HTMLElement, candidate: CandidateRow): void {
		const count = candidate.coverage.matchCount;
		const chip = parent.createSpan();
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.padding = '0.05em 0.5em';
		chip.style.borderRadius = '999px';
		chip.style.fontSize = '0.74em';
		chip.style.fontWeight = '600';
		if (count > 0) {
			chip.setText(`${count} files`);
			chip.style.background = 'rgba(40, 140, 70, 0.15)';
			chip.style.color = 'var(--text-success, rgb(40, 140, 70))';
			chip.style.border = '1px solid rgba(40, 140, 70, 0.35)';
		} else {
			chip.setText('0 — no match');
			chip.style.background = 'var(--background-modifier-form-field)';
			chip.style.color = 'var(--text-muted)';
			chip.style.border = '1px solid var(--background-modifier-border)';
		}
	}

	private renderBijectivityChip(parent: HTMLElement, candidate: CandidateRow): void {
		const v = candidate.bijectivity;
		// 'unknown' shows nothing.
		if (v === 'unknown') return;
		const chip = parent.createSpan();
		chip.style.display = 'inline-flex';
		chip.style.alignItems = 'center';
		chip.style.padding = '0.05em 0.5em';
		chip.style.borderRadius = '999px';
		chip.style.fontSize = '0.74em';
		chip.style.fontWeight = '600';
		if (v === 'lossy') {
			chip.setText('Lossy');
			chip.style.background = 'rgba(200, 140, 30, 0.15)';
			chip.style.color = 'var(--text-warning, rgb(180, 120, 20))';
			chip.style.border = '1px solid rgba(200, 140, 30, 0.4)';
			chip.title = 'Lossy — the tag does not fully reconstruct the folder. Inverse sync may not recover the original.';
		} else if (v === 'total') {
			chip.setText('1:1');
			chip.style.background = 'var(--background-modifier-form-field)';
			chip.style.color = 'var(--text-muted)';
			chip.style.border = '1px solid var(--background-modifier-border)';
			chip.title = 'Bijective — folder and tag round-trip exactly.';
		} else {
			// conditional
			chip.setText('Conditional');
			chip.style.background = 'var(--background-modifier-form-field)';
			chip.style.color = 'var(--text-muted)';
			chip.style.border = '1px solid var(--background-modifier-border)';
			chip.title = 'Conditionally reversible — round-trips for some inputs but not all.';
		}
	}

	private renderConflictBadge(parent: HTMLElement, candidate: CandidateRow): void {
		const c = candidate.conflict;
		if (!c.conflicts) return;

		const badge = parent.createSpan();
		badge.style.display = 'inline-flex';
		badge.style.alignItems = 'center';
		badge.style.padding = '0.05em 0.5em';
		badge.style.borderRadius = '999px';
		badge.style.fontSize = '0.74em';
		badge.style.fontWeight = '600';

		const winnerNote = c.predictedWinnerId
			? ` Rule "${c.predictedWinnerId}" wins here.`
			: '';
		const overlapNote = c.overlappingFolderSample.length > 0
			? ` Overlaps at: ${c.overlappingFolderSample.join(', ')}.`
			: '';

		if (c.collidesWithExisting) {
			// Dangerous — collides with an already-installed rule.
			badge.setText('Overlaps an existing rule');
			badge.style.background = 'rgba(200, 60, 60, 0.18)';
			badge.style.color = 'var(--text-error, rgb(190, 50, 50))';
			badge.style.border = '1px solid rgba(200, 60, 60, 0.5)';
			badge.title = `This candidate overlaps a rule already in your settings.${winnerNote}${overlapNote}`;
		} else {
			// Benign — candidate-vs-candidate only. Read softer.
			badge.setText('Overlaps another candidate');
			badge.style.background = 'rgba(200, 140, 30, 0.12)';
			badge.style.color = 'var(--text-muted)';
			badge.style.border = '1px solid rgba(200, 140, 30, 0.3)';
			badge.title = `This candidate overlaps another candidate (benign — nothing is committed yet).${winnerNote}${overlapNote}`;
		}
	}

	private refreshAddBtn(): void {
		const n = this.selected.size;
		this.addBtn.disabled = n === 0;
		this.addBtn.setText(n === 0 ? 'Add rules' : `Add ${n} rule${n === 1 ? '' : 's'}`);
	}

	// ─── Confirm + commit ─────────────────────────────────────────────
	private confirmAndAdd(): void {
		const chosen = this.candidates.filter((c) => this.selected.has(c.id));
		if (chosen.length === 0) {
			new Notice('No candidates selected.');
			return;
		}

		const systems = new Set(chosen.map((c) => c.sourcePackName));
		const collides = chosen.filter((c) => c.conflict.collidesWithExisting).length;

		// Confirm via a small modal (mirrors confirmImportRulePack in main.ts).
		const confirmModal = new Modal(this.app);
		confirmModal.setTitle('Add drafted rules');
		const { contentEl } = confirmModal;
		contentEl.createEl('p', {
			text: `Add ${chosen.length} rule${chosen.length === 1 ? '' : 's'} from ${systems.size} system${systems.size === 1 ? '' : 's'}?`,
		});
		if (collides > 0) {
			const warn = contentEl.createEl('p', {
				text: `${collides} of these overlap a rule already in your settings — review them if you want to avoid collisions.`,
			});
			warn.style.color = 'var(--text-error, rgb(190, 50, 50))';
			warn.style.fontSize = '0.88em';
		}
		contentEl.createEl('p', {
			text: 'Rules already present in your settings are skipped. Nothing is moved or deleted.',
		}).style.fontSize = '0.84em';

		const btnRow = contentEl.createDiv();
		btnRow.style.display = 'flex';
		btnRow.style.gap = '0.5em';
		btnRow.style.justifyContent = 'flex-end';
		btnRow.style.marginTop = '1em';

		const cancelBtn = btnRow.createEl('button', { text: 'Cancel' });
		cancelBtn.addEventListener('click', () => confirmModal.close());

		const addBtn = btnRow.createEl('button', { text: `Add ${chosen.length} rule${chosen.length === 1 ? '' : 's'}` });
		addBtn.addClass('mod-cta');
		addBtn.addEventListener('click', async () => {
			confirmModal.close();
			await this.commit(chosen);
		});

		confirmModal.open();
	}

	private async commit(chosen: CandidateRow[]): Promise<void> {
		// Dedupe within the selection by id, then hand the rules to onApply.
		// onApply is responsible for skipping ids already present in settings.
		const seen = new Set<string>();
		const rules: MappingRule[] = [];
		for (const c of chosen) {
			if (seen.has(c.rule.id)) continue;
			seen.add(c.rule.id);
			rules.push(c.rule);
		}
		await this.onApply(rules);
		new Notice(`✓ Added ${rules.length} rule${rules.length === 1 ? '' : 's'}`);
		this.close();
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

	onClose(): void {
		this.contentEl.empty();
	}
}
