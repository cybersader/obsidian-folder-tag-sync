import { App, Modal, Notice, Platform, Setting, apiVersion } from 'obsidian';
import type { ManifestPackEntry } from '../engine/detectPacks';
import {
	collectSupportSnapshotAsync,
	type SupportSnapshot,
} from '../support/collectSupportSnapshot';
import { collectSupportPlatformInfo } from '../support/platformInfo';
import {
	buildSupportBundle,
	type SupportBundleMode,
	type SupportBundleResult,
} from '../support/supportBundle';
import { copyTextToClipboard } from '../utils/clipboard';
import bundledManifest from '../../rule-packs/manifest.json';
import type DynamicTagsFoldersPlugin from '../main';

interface ManifestFile {
	packs: ManifestPackEntry[];
}

/**
 * Preview-first, local-only support bundle surface. Nothing leaves Obsidian
 * until the user explicitly copies the exact text shown in the preview.
 */
export class SupportBundleModal extends Modal {
	private snapshot: SupportSnapshot | null = null;
	private generatedAt = '';
	private mode: SupportBundleMode = 'readable';
	private result: SupportBundleResult | null = null;
	private collecting = false;
	private collectionGeneration = 0;

	private statusEl!: HTMLElement;
	private statsEl!: HTMLElement;
	private previewEl!: HTMLTextAreaElement;
	private copyButton!: HTMLButtonElement;
	private refreshButton!: HTMLButtonElement;

	constructor(app: App, private readonly plugin: DynamicTagsFoldersPlugin) {
		super(app);
	}

	onOpen(): void {
		this.modalEl.addClass('dtf-support-bundle-modal');
		this.modalEl.dataset.dtfSupportBundle = '1';
		this.contentEl.empty();

		this.contentEl.createEl('h2', { text: 'Support bundle' });
		this.contentEl.createEl('p', {
			cls: 'dtf-support-bundle-intro',
			text: 'Build a local troubleshooting snapshot containing plugin configuration, derived rule diagnostics, a complete folder-only tree, and a sanitized debug-log tail.',
		});

		const privacy = this.contentEl.createDiv({ cls: 'dtf-support-bundle-privacy' });
		privacy.createEl('strong', { text: 'Preview before sharing.' });
		privacy.createSpan({
			text: ' Readable mode includes relative folder names and rule configuration. Note filenames, note contents, frontmatter, the vault name, and absolute paths are excluded.',
		});

		const modeSetting = new Setting(this.contentEl)
			.setName('Anonymize names')
			.setDesc('Replace folder, rule, group, tag, pattern, and template names with stable aliases while preserving structure and relationships.');
		modeSetting.settingEl.dataset.dtfSupportMode = this.mode;
		modeSetting.addToggle((toggle) => toggle
			.setValue(false)
			.onChange((enabled) => {
				this.mode = enabled ? 'anonymized' : 'readable';
				modeSetting.settingEl.dataset.dtfSupportMode = this.mode;
				this.rebuildPreview();
			}),
		);

		this.statusEl = this.contentEl.createDiv({ cls: 'dtf-support-bundle-status' });
		this.statusEl.dataset.dtfSupportStatus = 'collecting';
		this.statusEl.setText('Collecting folder-only diagnostics…');

		this.statsEl = this.contentEl.createDiv({ cls: 'dtf-support-bundle-stats' });

		this.previewEl = this.contentEl.createEl('textarea', {
			cls: 'dtf-support-bundle-preview',
			attr: {
				readonly: 'readonly',
				spellcheck: 'false',
				'aria-label': 'Support bundle preview',
			},
		});
		this.previewEl.dataset.dtfSupportPreview = '1';

		const actions = this.contentEl.createDiv({ cls: 'dtf-support-bundle-actions' });
		this.refreshButton = actions.createEl('button', { text: 'Refresh' });
		this.refreshButton.dataset.dtfSupportRefresh = '1';
		this.refreshButton.addEventListener('click', () => {
			void this.refreshSnapshot();
		});

		this.copyButton = actions.createEl('button', { text: 'Copy' });
		this.copyButton.addClass('mod-cta');
		this.copyButton.dataset.dtfSupportCopy = '1';
		this.copyButton.disabled = true;
		this.copyButton.addEventListener('click', () => {
			void this.copyPreview();
		});

		const closeButton = actions.createEl('button', { text: 'Close' });
		closeButton.addEventListener('click', () => this.close());

		void this.refreshSnapshot();
	}

	onClose(): void {
		this.collectionGeneration++;
		this.collecting = false;
		this.contentEl.empty();
		this.snapshot = null;
		this.result = null;
	}

	private async refreshSnapshot(): Promise<void> {
		const generation = ++this.collectionGeneration;
		this.collecting = true;
		this.snapshot = null;
		this.result = null;
		this.setStatus('collecting', 'Collecting folder-only diagnostics…');
		this.copyButton.disabled = true;
		this.refreshButton.disabled = true;
		this.previewEl.value = '';
		this.statsEl.empty();

		// Yield once so large production vaults visibly paint the collecting state.
		await new Promise<void>((resolve) => window.setTimeout(resolve, 0));

		try {
			const debug = await this.plugin.debugLogger.readRecentEntries();
			const generatedAt = new Date().toISOString();
			const snapshot = await collectSupportSnapshotAsync({
				app: this.app,
				settings: this.plugin.settings,
				pluginManifest: {
					id: this.plugin.manifest.id,
					name: this.plugin.manifest.name,
					version: this.plugin.manifest.version,
					minAppVersion: this.plugin.manifest.minAppVersion,
					isDesktopOnly: this.plugin.manifest.isDesktopOnly,
					obsidianVersion: apiVersion,
					debugLog: {
						enabled: this.plugin.debugLogger.isEnabled(),
						...debug.status,
					},
				},
				platform: collectSupportPlatformInfo(Platform),
				packManifest: (bundledManifest as ManifestFile).packs,
				debugEntries: debug.entries,
			}, {
				isCancelled: () => generation !== this.collectionGeneration,
			});
			if (generation !== this.collectionGeneration) return;
			this.generatedAt = generatedAt;
			this.snapshot = snapshot;
			this.collecting = false;
			this.rebuildPreview();
		} catch (error) {
			if (generation !== this.collectionGeneration) return;
			const message = error instanceof Error ? error.message : 'Unknown error';
			this.collecting = false;
			this.snapshot = null;
			this.result = null;
			this.previewEl.value = '';
			this.setStatus('failed', `Could not build support bundle: ${message}`);
			new Notice(`Could not build support bundle: ${message}`);
		} finally {
			if (generation === this.collectionGeneration) {
				this.refreshButton.disabled = false;
			}
		}
	}

	private rebuildPreview(): void {
		if (this.collecting || !this.snapshot) return;

		this.result = buildSupportBundle(this.snapshot, {
			mode: this.mode,
			generatedAt: this.generatedAt,
			privacyContext: {
				forbiddenValues: [this.app.vault.getName()],
			},
		});

		this.statsEl.empty();
		this.addStat('Folders', this.snapshot.vault.folderPaths.length.toLocaleString());
		this.addStat('Markdown files', this.snapshot.vault.markdownFileCount.toLocaleString());
		const ruleSummary = this.snapshot.diagnostics.installedRules.summary;
		this.addStat(
			'Rule detail rows',
			`${ruleSummary.folderDetailsIncluded.toLocaleString()} of ${this.snapshot.vault.folderPaths.length.toLocaleString()}`,
		);
		this.addStat('Mode', this.mode === 'readable' ? 'Readable' : 'Anonymized');

		if (!this.result.ok) {
			this.previewEl.value = '';
			this.copyButton.disabled = true;
			this.addStat('Required size', formatBytes(this.result.requiredBytes));
			this.setStatus(
				'too-large',
				`The complete configuration and folder tree require ${formatBytes(this.result.requiredBytes)}, above the ${formatBytes(this.result.maxBytes)} copy limit. Nothing was partially copied.`,
			);
			return;
		}

		this.previewEl.value = this.result.text;
		this.copyButton.disabled = false;
		this.addStat('Bundle size', formatBytes(this.result.byteLength));
		const omissions: string[] = [];
		if (this.result.omitted.debugEntries) omissions.push('debug log');
		if (this.result.omitted.detailedDiagnostics) omissions.push('detailed diagnostics');
		this.setStatus(
			'ready',
			omissions.length > 0
				? `Ready. Omitted by size policy: ${omissions.join(', ')}.`
				: 'Ready to review and copy.',
		);
	}

	private async copyPreview(): Promise<void> {
		if (!this.result?.ok) return;
		const result = this.result;
		const generation = this.collectionGeneration;
		this.copyButton.disabled = true;
		this.setStatus('copying', 'Copying support bundle…');

		const copied = await copyTextToClipboard(result.text);
		if (generation !== this.collectionGeneration || this.result !== result) return;
		if (copied.ok) {
			this.setStatus('copied', 'Copied. The clipboard exactly matches the preview.');
			new Notice('Support bundle copied to clipboard');
		} else {
			this.setStatus('failed', `Could not copy: ${copied.error}`);
			new Notice(`Could not copy support bundle: ${copied.error}`);
		}
		this.copyButton.disabled = false;
	}

	private setStatus(status: string, message: string): void {
		this.modalEl.dataset.dtfSupportStatus = status;
		this.statusEl.dataset.dtfSupportStatus = status;
		this.statusEl.setText(message);
	}

	private addStat(label: string, value: string): void {
		const stat = this.statsEl.createDiv({ cls: 'dtf-support-bundle-stat' });
		stat.createSpan({ cls: 'dtf-support-bundle-stat-label', text: `${label}: ` });
		stat.createSpan({ text: value });
	}
}

function formatBytes(bytes: number): string {
	if (bytes < 1024) return `${bytes} B`;
	if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
	return `${(bytes / (1024 * 1024)).toFixed(2)} MiB`;
}
