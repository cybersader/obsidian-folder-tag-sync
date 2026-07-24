/**
 * Minimal structural shape shared by Obsidian's TFolder and unit-test fixtures.
 * Files do not expose a `children` array, so the collector can stay independent
 * of the Obsidian runtime while still excluding every file leaf.
 */
export interface VaultFolderLike {
	path: string;
	children: readonly VaultEntryLike[];
}

export interface VaultEntryLike {
	path: string;
	children?: readonly VaultEntryLike[];
}

/**
 * Collect every real folder below the synthetic vault root.
 *
 * Returned paths are relative, slash-separated, de-duplicated, and sorted by
 * Unicode code point. The root itself and file leaves are never included.
 */
export function collectVaultFolderPaths(root: VaultFolderLike): string[] {
	const paths = new Set<string>();
	const stack: VaultEntryLike[] = [...root.children];
	const visited = new Set<VaultEntryLike>();

	while (stack.length > 0) {
		const entry = stack.pop()!;
		if (!isFolder(entry) || visited.has(entry)) continue;
		visited.add(entry);

		const relativePath = normalizeRelativeFolderPath(entry.path);
		if (relativePath !== '') paths.add(relativePath);

		for (const child of entry.children) stack.push(child);
	}

	return [...paths].sort(compareCodePoints);
}

function isFolder(entry: VaultEntryLike): entry is VaultFolderLike {
	return Array.isArray(entry.children);
}

function normalizeRelativeFolderPath(path: string): string {
	return path.replace(/\\/g, '/').replace(/^\/+|\/+$/g, '');
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
