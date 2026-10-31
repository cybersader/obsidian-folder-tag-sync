import type { App, TFile } from 'obsidian';
import type { GuidedPreviewReadPort, PreviewConfiguration, PreviewFile } from './guidedNotePreviewRunner';

/** The actual App adapter used by the modal. Only read/list/cache/event capabilities cross the boundary. */
export function createGuidedPreviewReadPort(app: App, configuration: () => PreviewConfiguration): GuidedPreviewReadPort {
	const find = (f: PreviewFile): TFile => {
		const file = app.vault.getAbstractFileByPath(f.path) as TFile | null;
		if (!file || file.extension !== 'md') throw new Error('Note no longer exists');
		return file;
	};
	return {
		configuration,
		files: () => app.vault.getMarkdownFiles().map((f) => ({ path: f.path, folder: f.parent?.path ?? '', stamp: `${f.stat.mtime}:${f.stat.size}` })),
		read: (file) => app.vault.read(find(file)),
		cacheTags: (file) => app.metadataCache.getFileCache(find(file))?.frontmatter?.tags,
		fileStamp: (file) => { const f = find(file); return `${f.stat.mtime}:${f.stat.size}`; },
		subscribe: (listener) => {
			const folder = (f: { path: string; parent?: { path: string } | null; extension?: string }) => f.extension ? f.parent?.path ?? '' : f.path;
			const refs = [app.vault.on('modify', (f) => listener(f.path)),
				app.vault.on('create', (f) => listener(f.path, folder(f))),
				app.vault.on('delete', (f) => listener(f.path, folder(f))),
				app.vault.on('rename', (f, old) => listener(f.path, folder(f), 'extension' in f ? old.split('/').slice(0, -1).join('/') : old))];
			const metadata = app.metadataCache.on('changed', (f) => listener(f.path));
			return () => { refs.forEach((ref) => app.vault.offref(ref)); app.metadataCache.offref(metadata); };
		},
		yieldBatch: () => new Promise((resolve) => setTimeout(resolve, 0)),
	};
}
