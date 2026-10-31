import type { MappingRule } from '../types/settings';
import { buildGuidedNotePreviewPlan, type GuidedNotePreviewPlan, type PreviewFolder } from './guidedNotePreview';
import { decideForwardTagDelta, readForwardTagInputs, type ForwardTagDelta } from '../sync/forwardTagDelta';
import { evaluateRule } from './ruleMatcher';

export interface PreviewConfiguration {
	draft: MappingRule;
	rules: readonly MappingRule[];
	precedence: readonly string[];
	formFingerprint: string;
}
export interface PreviewFile {
	path: string;
	folder: string;
	stamp: string;
}
/** No plugin, logger, writer, settings setter, save callback or network capability. */
export interface GuidedPreviewReadPort {
	configuration(): PreviewConfiguration;
	files(): PreviewFile[];
	read(file: PreviewFile): Promise<string>;
	cacheTags(file: PreviewFile): unknown;
	fileStamp(file: PreviewFile): string;
	subscribe(listener: (path: string | null, folder?: string, oldFolder?: string) => void): () => void;
	yieldBatch(): Promise<void>;
}
export interface PreviewNoteRow {
	path: string;
	folder: PreviewFolder;
	delta: ForwardTagDelta | null;
	state: 'changed' | 'unchanged' | 'no-match' | 'empty' | 'invalid' | 'unreadable';
	error: string | null;
	warnings: string[];
}
export interface GuidedPreviewResult {
	status: 'scanning' | 'complete' | 'stale' | 'cancelled' | 'error';
	plan: GuidedNotePreviewPlan | null;
	rows: PreviewNoteRow[];
	total: number;
	relevant: number;
	examined: number;
	skipped: number;
	failed: number;
	unchanged: number;
	changed: number;
	message: string;
}

/** Local ephemeral reader. Obsolete async work can neither replace a new result nor render after close. */
export class GuidedNotePreviewRunner {
	result: GuidedPreviewResult | null = null;
	private token = 0;
	private closed = false;
	private fingerprint = '';
	private fileFingerprints = new Map<string, string>();
	private relevantFiles: PreviewFile[] = [];
	private relevantPaths = new Set<string>();
	private unsubscribe: () => void;
	constructor(private readonly port: GuidedPreviewReadPort, private readonly changed: () => void) {
		this.unsubscribe = port.subscribe((path, folder, oldFolder) => {
			const plan = this.result?.plan;
			if (path === null || this.relevantPaths.has(path)
				|| (path && this.relevantFiles.some((f) => f.path.startsWith(`${path}/`)))) { this.invalidate(); return; }
			if (!plan || folder === undefined) return;
			// A new/renamed folder or note can expand draft or original-edit coverage.
			const original = plan.currentRules.find((r) => r.id === plan.draft.id);
			const scopeRules = [plan.draft, ...(original ? [original] : [])];
			if ([folder, ...(oldFolder === undefined ? [] : [oldFolder])].some((input) => scopeRules.some((rule) =>
				evaluateRule(input, rule, { input, matchType: 'folder', direction: 'folder-to-tag', includeDisabled: true })))) this.invalidate();
		});
	}
	private signature(): string { return JSON.stringify(this.port.configuration()); }
	private fileSignature(file: PreviewFile): string {
		return JSON.stringify({ stamp: this.port.fileStamp(file), cacheTags: this.port.cacheTags(file) });
	}
	checkFreshness(checkFiles = true): void {
		if (this.closed || !this.result || !this.fingerprint) return;
		try {
			if (this.signature() !== this.fingerprint || (checkFiles && this.relevantFiles.some((file) =>
				this.fileSignature(file) !== this.fileFingerprints.get(file.path)))) this.invalidate();
		} catch { this.invalidate(); }
	}
	invalidate(): void {
		if (this.closed || !this.result || ['stale', 'cancelled', 'error'].includes(this.result.status)) return;
		this.token++;
		this.result = { ...this.result, status: 'stale', message: 'Snapshot is stale. Preview again to read current form, rules and notes.' };
		this.changed();
	}
	cancel(): void {
		if (this.closed || this.result?.status !== 'scanning') return;
		this.token++;
		this.result = { ...this.result, status: 'cancelled', message: 'Scan cancelled. Counts and rows are incomplete.' };
		this.changed();
	}
	dispose(): void {
		this.closed = true; this.token++; this.unsubscribe();
		this.result = null; this.relevantPaths.clear(); this.relevantFiles = []; this.fileFingerprints.clear(); this.fingerprint = '';
	}
	async run(): Promise<void> {
		if (this.closed) return;
		this.checkFreshness();
		const token = ++this.token;
		const active = () => !this.closed && token === this.token;
		try {
			const config = structuredClone(this.port.configuration());
			const files = this.port.files().map((f) => ({ ...f }));
			const plan = buildGuidedNotePreviewPlan(config.draft, config.rules, config.precedence, files.map((f) => f.folder));
			const folders = new Map(plan.folders.map((f) => [f.folderPath, f]));
			const relevant = files.filter((f) => folders.has(f.folder));
			this.relevantPaths = new Set(relevant.map((f) => f.path));
			this.relevantFiles = relevant;
			this.fileFingerprints = new Map(relevant.map((file) => [file.path, this.fileSignature(file)]));
			this.fingerprint = this.signature();
			this.result = { status: 'scanning', plan, rows: [], total: files.length, relevant: relevant.length,
				examined: 0, skipped: files.length - relevant.length, failed: 0, unchanged: 0, changed: 0,
				message: 'Reading relevant notes only…' };
			this.changed();
			for (let index = 0; index < relevant.length; index++) {
				if (!active()) return;
				const file = relevant[index];
				const folder = folders.get(file.folder)!;
				let row: PreviewNoteRow;
				try {
					const inputs = readForwardTagInputs(await this.port.read(file), this.port.cacheTags(file));
					if (!active()) return;
					if (this.fileSignature(file) !== this.fileFingerprints.get(file.path)) { this.invalidate(); return; }
					const output = folder.hypothetical;
					// Invalid output is blocked in this surface, not an assertion about live validation.
					const delta = decideForwardTagDelta(inputs.frontmatter, inputs.cacheTags,
						output.state === 'valid' ? output.tags : [], output.winner?.options ?? {});
					row = { path: file.path, folder, delta,
						state: output.state === 'valid' ? delta.shouldWrite ? 'changed' : 'unchanged' : output.state,
						error: output.error, warnings: [...inputs.warnings, ...delta.warnings] };
				} catch {
					if (!active()) return;
					// Do not expose exception text: adapter errors can contain note content or unrelated properties.
					row = { path: file.path, folder, delta: null, state: 'unreadable', error: 'Could not read this note.', warnings: [] };
				}
				const result = this.result!;
				result.rows.push(row); result.examined++;
				if (row.state === 'unreadable') result.failed++;
				else if (row.state === 'changed') result.changed++;
				else if (row.state !== 'invalid') result.unchanged++;
				if ((index + 1) % 25 === 0) {
					this.checkFreshness(false); if (!active()) return;
					this.changed(); await this.port.yieldBatch();
				}
			}
			if (!active()) return;
			this.checkFreshness(); if (!active()) return;
			this.result = { ...this.result!, status: 'complete', message: plan.refusal ?? 'Point-in-time forward prediction. Nothing saved, enabled or applied.' };
			this.changed();
		} catch (error) {
			if (!active()) return;
			this.result = { status: 'error', plan: null, rows: [], total: 0, relevant: 0, examined: 0,
				skipped: 0, failed: 0, unchanged: 0, changed: 0,
				message: error instanceof Error && error.message.startsWith('Duplicate installed rule ID:')
					? error.message : 'Cannot preview this form or configuration. Return to editing to correct it.' };
			this.changed();
		}
	}
}
