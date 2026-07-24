import { anonymizeSupportSnapshot } from './anonymize';
import type { SupportSnapshot } from './collectSupportSnapshot';

export const SUPPORT_BUNDLE_FORMAT_VERSION = 1 as const;
export const DEFAULT_SUPPORT_BUNDLE_MAX_BYTES = 2 * 1024 * 1024;

export type SupportBundleMode = 'readable' | 'anonymized';

/** Values used only during sanitization. They are never written to the bundle. */
export interface SupportPrivacyContext {
	forbiddenValues?: readonly string[];
}

export interface BuildSupportBundleOptions {
	mode?: SupportBundleMode;
	generatedAt?: string;
	maxBytes?: number;
	privacyContext?: SupportPrivacyContext;
}

export interface SupportBundleSuccess {
	ok: true;
	text: string;
	byteLength: number;
	mode: SupportBundleMode;
	omitted: {
		debugEntries: boolean;
		detailedDiagnostics: boolean;
	};
}

export interface SupportBundleTooLarge {
	ok: false;
	reason: 'too-large';
	requiredBytes: number;
	maxBytes: number;
	mode: SupportBundleMode;
	omitted: {
		debugEntries: boolean;
		detailedDiagnostics: boolean;
	};
}

export type SupportBundleResult = SupportBundleSuccess | SupportBundleTooLarge;

/**
 * Serialize a previously collected snapshot. The same snapshot can be passed
 * repeatedly to switch modes without re-reading the vault or mutating settings.
 */
export function buildSupportBundle(
	snapshot: SupportSnapshot,
	options: BuildSupportBundleOptions = {},
): SupportBundleResult {
	const mode = options.mode ?? 'readable';
	const generatedAt = options.generatedAt ?? new Date().toISOString();
	const maxBytes = options.maxBytes ?? DEFAULT_SUPPORT_BUNDLE_MAX_BYTES;
	const modeSnapshot = mode === 'anonymized'
		? anonymizeSupportSnapshot(snapshot)
		: cloneJsonish(snapshot);
	const sanitized = sanitizeSnapshot(modeSnapshot, options.privacyContext);

	let includeDebugEntries = true;
	let includeDetailedDiagnostics = true;
	let text = renderBundle(
		sanitized,
		mode,
		generatedAt,
		includeDebugEntries,
		includeDetailedDiagnostics,
		options.privacyContext,
	);
	let byteLength = utf8ByteLength(text);

	// Size policy is ordered and explicit: logs first, diagnostics second. The
	// complete folder tree is never capped or sliced.
	if (byteLength > maxBytes && sanitized.debugEntries.length > 0) {
		includeDebugEntries = false;
		text = renderBundle(
			sanitized,
			mode,
			generatedAt,
			includeDebugEntries,
			includeDetailedDiagnostics,
			options.privacyContext,
		);
		byteLength = utf8ByteLength(text);
	}

	if (byteLength > maxBytes) {
		includeDetailedDiagnostics = false;
		text = renderBundle(
			sanitized,
			mode,
			generatedAt,
			includeDebugEntries,
			includeDetailedDiagnostics,
			options.privacyContext,
		);
		byteLength = utf8ByteLength(text);
	}

	const omitted = {
		debugEntries: !includeDebugEntries,
		detailedDiagnostics: !includeDetailedDiagnostics,
	};

	if (byteLength > maxBytes) {
		return {
			ok: false,
			reason: 'too-large',
			requiredBytes: byteLength,
			maxBytes,
			mode,
			omitted,
		};
	}

	return { ok: true, text, byteLength, mode, omitted };
}

/** Render the complete folder list as a deterministic Unicode hierarchy. */
export function renderFullFolderTree(folderPaths: readonly string[]): string {
	interface TreeNode {
		children: Map<string, TreeNode>;
	}

	const root: TreeNode = { children: new Map() };
	const paths = [...new Set(folderPaths.filter((path) => path !== ''))]
		.sort(compareCodePoints);

	for (const path of paths) {
		let node = root;
		for (const segment of path.split('/')) {
			if (segment === '') continue;
			let child = node.children.get(segment);
			if (!child) {
				child = { children: new Map() };
				node.children.set(segment, child);
			}
			node = child;
		}
	}

	const lines = ['<vault-root>'];
	const renderChildren = (node: TreeNode, prefix: string): void => {
		const children = [...node.children.entries()].sort(([a], [b]) => compareCodePoints(a, b));
		for (let index = 0; index < children.length; index++) {
			const [name, child] = children[index];
			const isLast = index === children.length - 1;
			lines.push(`${prefix}${isLast ? '└── ' : '├── '}${escapeTreeSegment(name)}`);
			renderChildren(child, `${prefix}${isLast ? '    ' : '│   '}`);
		}
	};
	renderChildren(root, '');
	return lines.join('\n');
}

function renderBundle(
	snapshot: SupportSnapshot,
	mode: SupportBundleMode,
	generatedAt: string,
	includeDebugEntries: boolean,
	includeDetailedDiagnostics: boolean,
	privacyContext: SupportPrivacyContext | undefined,
): string {
	const omitted = {
		debugEntries: !includeDebugEntries,
		detailedDiagnostics: !includeDetailedDiagnostics,
	};
	const runtime = {
		bundle: {
			formatVersion: SUPPORT_BUNDLE_FORMAT_VERSION,
			generatedAt,
			mode,
			omitted,
			snapshotSchemaVersion: snapshot.schemaVersion,
		},
		runtime: snapshot.runtime,
		vaultSummary: {
			folderCount: snapshot.vault.folderPaths.length,
			markdownFileCount: snapshot.vault.markdownFileCount,
		},
	};
	const diagnostics = includeDetailedDiagnostics
		? snapshot.diagnostics
		: {
			detection: { summary: snapshot.diagnostics.detection.summary },
			installedRules: { summary: snapshot.diagnostics.installedRules.summary },
		};
	const debugLines = includeDebugEntries
		? snapshot.debugEntries.map((entry) => stableStringify(entry, 0)).join('\n') || '<none>'
		: '<omitted by size policy>';

	const sections = [
		`FOLDER TAG SYNC SUPPORT BUNDLE v${SUPPORT_BUNDLE_FORMAT_VERSION}`,
		'',
		'=== PRIVACY ===',
		'Includes: plugin runtime data, complete configuration, derived diagnostics, and the full folder-only tree.',
		'Excludes: vault name, absolute paths, note filenames, note contents, frontmatter, and tag inventory.',
		`Mode: ${mode}`,
		`Debug entries: ${includeDebugEntries ? 'included after sanitization' : 'omitted by size policy'}`,
		`Detailed diagnostics: ${includeDetailedDiagnostics ? 'included with bounded per-folder rows (see summary counters)' : 'omitted by size policy'}`,
		'',
		'=== RUNTIME JSON ===',
		stableStringify(runtime, 2),
		'',
		'=== CONFIGURATION JSON ===',
		stableStringify(snapshot.configuration, 2),
		'',
		'=== DIAGNOSTICS JSON ===',
		stableStringify(diagnostics, 2),
		'',
		'=== FULL FOLDER TREE ===',
		renderFullFolderTree(snapshot.vault.folderPaths),
		'',
		'=== SANITIZED DEBUG JSONL ===',
		debugLines,
		'',
	];

	return scrubSensitiveString(sections.join('\n'), privacyContext, true);
}

function sanitizeSnapshot(
	snapshot: SupportSnapshot,
	privacyContext: SupportPrivacyContext | undefined,
): SupportSnapshot {
	return sanitizeValue(snapshot, privacyContext, false) as SupportSnapshot;
}

function sanitizeValue(
	value: unknown,
	privacyContext: SupportPrivacyContext | undefined,
	inDebug: boolean,
	key = '',
): unknown {
	if (value === null || value === undefined) return value;
	if (typeof value === 'string') {
		return scrubSensitiveString(value, privacyContext, true);
	}
	if (typeof value !== 'object') return value;
	if (Array.isArray(value)) {
		return value.map((item) => sanitizeValue(item, privacyContext, inDebug, key));
	}

	const out: Record<string, unknown> = {};
	for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
		const normalizedKey = childKey.toLowerCase().replace(/[^a-z]/g, '');
		const childIsDebug = inDebug || key === 'debugEntries' || childKey === 'debugEntries';
		if (isForbiddenPayloadKey(normalizedKey)) {
			out[childKey] = `<redacted-${normalizedKey}>`;
			continue;
		}
		if (childIsDebug && isVaultContextKey(normalizedKey)) {
			out[childKey] = '<redacted-vault-context>';
			continue;
		}
		if (childIsDebug && isNoteDerivedTagKey(normalizedKey)) {
			out[childKey] = '<redacted-note-tags>';
			continue;
		}
		out[childKey] = sanitizeValue(child, privacyContext, childIsDebug, childKey);
	}
	return out;
}

function isForbiddenPayloadKey(key: string): boolean {
	return key === 'content'
		|| key === 'contents'
		|| key === 'frontmatter'
		|| key === 'stack'
		|| key === 'stacktrace';
}

function isVaultContextKey(key: string): boolean {
	return key === 'vault'
		|| key === 'vaultname'
		|| key === 'vaultpath'
		|| key === 'vaultroot'
		|| key === 'absolutepath'
		|| key === 'basepath';
}

function isNoteDerivedTagKey(key: string): boolean {
	if (!key.includes('tag')) return false;
	return !key.endsWith('count') && !key.endsWith('counts');
}

function scrubSensitiveString(
	input: string,
	privacyContext: SupportPrivacyContext | undefined,
	redactNoteLeaves: boolean,
): string {
	let value = input;
	value = value.replace(/file:\/{2,3}[^\r\n"'<>]*/giu, '<redacted-file-url>');
	value = value.replace(
		/(^|[\s("'=])(?:[A-Za-z]:[\\/]|\\\\)[^\r\n"'<>]*/gu,
		(_match, prefix: string) => `${prefix}<redacted-absolute-path>`,
	);
	value = value.replace(
		/(^|[\s("'=])\/(?!\/)(?:[^/\s"'<>]+\/)+[^\r\n"'<>]*/gu,
		(_match, prefix: string) => `${prefix}<redacted-absolute-path>`,
	);

	const forbidden = [...new Set(privacyContext?.forbiddenValues ?? [])]
		.filter((item) => item !== '')
		.sort((a, b) => b.length - a.length || compareCodePoints(a, b));
	for (const item of forbidden) {
		value = value.replace(new RegExp(escapeRegExp(item), 'gi'), '<redacted-private-context>');
	}

	if (redactNoteLeaves) {
		value = value.replace(
			/(^|[\s("'=\\/])[^\s"'<>]*\.(?:md|markdown|canvas|base)(?=$|[\s"')},;:\]])/giu,
			(_match, prefix: string) => `${prefix}<redacted-note-leaf>`,
		);
	}
	return value;
}

function stableStringify(value: unknown, indent: number): string {
	return JSON.stringify(toStableJson(value, new Set()), null, indent);
}

function toStableJson(value: unknown, ancestors: Set<object>): unknown {
	if (value === null) return null;
	if (typeof value === 'string' || typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : null;
	if (typeof value === 'bigint') return value.toString();
	if (typeof value === 'undefined' || typeof value === 'function' || typeof value === 'symbol') {
		return null;
	}
	if (value instanceof Date) return value.toISOString();
	if (typeof value !== 'object') return String(value);
	if (ancestors.has(value)) return '<circular>';

	ancestors.add(value);
	let stable: unknown;
	if (Array.isArray(value)) {
		stable = value.map((item) => toStableJson(item, ancestors));
	} else {
		const object = value as Record<string, unknown>;
		const sorted: Record<string, unknown> = {};
		for (const key of Object.keys(object).sort(compareCodePoints)) {
			const child = object[key];
			if (child === undefined || typeof child === 'function' || typeof child === 'symbol') continue;
			sorted[key] = toStableJson(child, ancestors);
		}
		stable = sorted;
	}
	ancestors.delete(value);
	return stable;
}

function escapeTreeSegment(segment: string): string {
	const controlCharacters = new RegExp('[\\x00-\\x1f\\x7f-\\x9f]', 'gu');
	return segment.replace(controlCharacters, (character) => {
		return `\\u${character.charCodeAt(0).toString(16).padStart(4, '0')}`;
	});
}

function utf8ByteLength(value: string): number {
	return new TextEncoder().encode(value).length;
}

function cloneJsonish<T>(value: T): T {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((item) => cloneJsonish(item)) as T;
	const clone: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		clone[key] = cloneJsonish(child);
	}
	return clone as T;
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
