import type { App, DataAdapter, PluginManifest } from 'obsidian';

export const DEBUG_LOG_SCHEMA = 'folder-tag-sync.debug';
export const DEBUG_LOG_VERSION = 1 as const;

const DEFAULT_PLUGIN_ID = 'folder-tag-sync';
const MAX_LOG_BYTES = 512 * 1024;
const MAX_RECENT_ENTRIES = 100;
const MAX_RECENT_BYTES = 64 * 1024;
const MAX_ENTRY_BYTES = 32 * 1024;
const MAX_MESSAGE_LENGTH = 2048;
const MAX_STRING_LENGTH = 4096;
const MAX_OBJECT_KEYS = 50;
const MAX_ARRAY_ITEMS = 50;
const MAX_DEPTH = 6;
const MAX_NODES = 500;

export type DebugLogLevel = 'info' | 'warn' | 'error';
export type DebugLoggerPluginIdentity = string | Pick<PluginManifest, 'id'>;

export type SafeJsonValue =
	| null
	| boolean
	| number
	| string
	| SafeJsonValue[]
	| { [key: string]: SafeJsonValue };

export interface DebugLogEntry {
	schema: typeof DEBUG_LOG_SCHEMA;
	version: typeof DEBUG_LOG_VERSION;
	timestamp: string;
	level: DebugLogLevel;
	/** Human-readable description retained for existing logger call sites. */
	message: string;
	/** Stable event label. Existing message-based calls use the same value. */
	event: string;
	data?: SafeJsonValue;
}

export type DebugLogSource = 'current' | 'backup';

export interface DebugLogReadError {
	source: DebugLogSource;
	message: string;
}

export interface DebugLogReadStatus {
	returnedCount: number;
	validEntryCount: number;
	malformedLineCount: number;
	returnedBytes: number;
	truncated: boolean;
	errors: DebugLogReadError[];
}

export interface DebugLogReadResult {
	entries: DebugLogEntry[];
	status: DebugLogReadStatus;
}

type OptionalAdapter = Partial<
	Pick<DataAdapter, 'append' | 'exists' | 'read' | 'remove' | 'rename' | 'stat' | 'write'>
>;

interface SerializationState {
	seen: WeakSet<object>;
	remainingNodes: number;
}

interface ParsedEntry {
	entry: DebugLogEntry;
	bytes: number;
}

/**
 * Structured, bounded debug logging for the plugin's private configuration
 * directory. Writes are serialized and appended rather than read/re-written.
 */
export class DebugLogger {
	private readonly logPath: string;
	private readonly backupPath: string;
	private enabled: boolean;
	private queue: Promise<void> = Promise.resolve();
	private enableGeneration = 0;

	constructor(app: App, plugin: DebugLoggerPluginIdentity, enabled?: boolean);
	/**
	 * Compatibility overload for the existing integration. New code should pass
	 * the plugin manifest (or plugin id) explicitly.
	 */
	constructor(app: App, enabled?: boolean);
	constructor(
		private readonly app: App,
		pluginOrEnabled: DebugLoggerPluginIdentity | boolean = DEFAULT_PLUGIN_ID,
		enabled = false
	) {
		const pluginId = typeof pluginOrEnabled === 'boolean'
			? DEFAULT_PLUGIN_ID
			: typeof pluginOrEnabled === 'string'
				? pluginOrEnabled
				: pluginOrEnabled.id;

		this.enabled = typeof pluginOrEnabled === 'boolean' ? pluginOrEnabled : enabled;
		this.logPath = normalizeLogPath(
			`${app.vault.configDir}/plugins/${pluginId}/debug.log`
		);
		this.backupPath = `${this.logPath}.1`;
	}

	/** Log a structured entry at the specified level. */
	log(level: DebugLogLevel, message: string, data?: unknown): Promise<void> {
		if (!this.enabled) return Promise.resolve();

		const generation = this.enableGeneration;
		const line = serializeEntry(level, message, data);

		return this.enqueue(async () => {
			if (!this.isActiveGeneration(generation)) return;

			const adapter = this.app.vault.adapter as OptionalAdapter;
			let writeError: unknown;

			try {
				await this.rotateIfNeeded(adapter, utf8ByteLength(line), generation);
				if (!this.isActiveGeneration(generation)) return;
				if (typeof adapter.append !== 'function') {
					throw new Error('Vault adapter does not support append');
				}
				await adapter.append(this.logPath, line);
			} catch (error) {
				writeError = error;
			}

			if (!this.isActiveGeneration(generation)) return;
			if (writeError !== undefined) {
				this.writeInternalError('Failed to append debug log', writeError);
			}
			this.writeConsole(level, message, data);
		});
	}

	info(message: string, data?: unknown): Promise<void> {
		return this.log('info', message, data);
	}

	warn(message: string, data?: unknown): Promise<void> {
		return this.log('warn', message, data);
	}

	error(message: string, data?: unknown): Promise<void> {
		return this.log('error', message, data);
	}

	/**
	 * Explicitly clear the current log and its retained backup. Construction does
	 * not clear either file.
	 */
	clear(): Promise<void> {
		if (!this.enabled) return Promise.resolve();
		const generation = this.enableGeneration;

		return this.enqueue(async () => {
			if (!this.isActiveGeneration(generation)) return;
			const adapter = this.app.vault.adapter as OptionalAdapter;

			try {
				if (typeof adapter.write === 'function') {
					await adapter.write(this.logPath, '');
				}
				if (!this.isActiveGeneration(generation)) return;
				await this.removeIfPresent(adapter, this.backupPath);
			} catch (error) {
				if (this.isActiveGeneration(generation)) {
					this.writeInternalError('Failed to clear debug log', error);
				}
			}
		});
	}

	/**
	 * Read a bounded, chronological tail from the backup and current logs.
	 * Malformed, legacy, or unsupported-schema lines are skipped and counted.
	 */
	async readRecentEntries(): Promise<DebugLogReadResult> {
		await this.queue.catch(() => undefined);

		const adapter = this.app.vault.adapter as OptionalAdapter;
		const errors: DebugLogReadError[] = [];
		let malformedLineCount = 0;
		const parsedEntries: ParsedEntry[] = [];

		for (const source of [
			{ kind: 'backup' as const, path: this.backupPath },
			{ kind: 'current' as const, path: this.logPath },
		]) {
			const content = await this.readSource(adapter, source.path, source.kind, errors);
			if (content === null) continue;

			for (const line of content.split(/\r?\n/)) {
				if (line.trim().length === 0) continue;
				const entry = parseEntry(line);
				if (entry === null) {
					malformedLineCount++;
					continue;
				}
				parsedEntries.push({ entry, bytes: utf8ByteLength(line) + 1 });
			}
		}

		const selected: ParsedEntry[] = [];
		let returnedBytes = 0;

		for (let index = parsedEntries.length - 1; index >= 0; index--) {
			const candidate = parsedEntries[index];
			if (selected.length >= MAX_RECENT_ENTRIES) break;
			if (candidate.bytes > MAX_RECENT_BYTES - returnedBytes) break;
			selected.push(candidate);
			returnedBytes += candidate.bytes;
		}

		selected.reverse();
		return {
			entries: selected.map(({ entry }) => entry),
			status: {
				returnedCount: selected.length,
				validEntryCount: parsedEntries.length,
				malformedLineCount,
				returnedBytes,
				truncated: selected.length < parsedEntries.length,
				errors,
			},
		};
	}

	getLogPath(): string {
		return this.logPath;
	}

	isEnabled(): boolean {
		return this.enabled;
	}

	/** Enable or disable logging immediately, invalidating queued log writes. */
	setEnabled(enabled: boolean): void {
		if (this.enabled === enabled) return;
		this.enabled = enabled;
		this.enableGeneration++;
	}

	private enqueue(operation: () => Promise<void>): Promise<void> {
		const scheduled = this.queue.then(operation, operation);
		this.queue = scheduled.catch(() => undefined);
		return scheduled;
	}

	private isActiveGeneration(generation: number): boolean {
		return this.enabled && generation === this.enableGeneration;
	}

	private async rotateIfNeeded(
		adapter: OptionalAdapter,
		incomingBytes: number,
		generation: number
	): Promise<void> {
		if (typeof adapter.stat !== 'function') return;

		let size: number | null = null;
		try {
			size = (await adapter.stat(this.logPath))?.size ?? null;
		} catch {
			return;
		}

		if (size === null || size + incomingBytes <= MAX_LOG_BYTES) return;
		if (!this.isActiveGeneration(generation)) return;

		const currentExists = await this.pathExists(adapter, this.logPath);
		if (currentExists === false || !this.isActiveGeneration(generation)) return;

		if (typeof adapter.rename === 'function') {
			try {
				await this.removeIfPresent(adapter, this.backupPath);
				if (!this.isActiveGeneration(generation)) return;
				await adapter.rename(this.logPath, this.backupPath);
				return;
			} catch {
				// Fall through to a read/write rotation when rename is unavailable
				// or cannot replace an existing backup on this adapter.
			}
		}

		if (
			typeof adapter.read !== 'function'
			|| typeof adapter.write !== 'function'
			|| !this.isActiveGeneration(generation)
		) {
			return;
		}

		try {
			const current = await adapter.read(this.logPath);
			if (!this.isActiveGeneration(generation)) return;
			await adapter.write(this.backupPath, current);
			if (!this.isActiveGeneration(generation)) return;
			await adapter.write(this.logPath, '');
		} catch {
			// Rotation is best-effort. The caller still attempts to append the entry.
		}
	}

	private async readSource(
		adapter: OptionalAdapter,
		path: string,
		source: DebugLogSource,
		errors: DebugLogReadError[]
	): Promise<string | null> {
		if (typeof adapter.read !== 'function') {
			errors.push({ source, message: 'Vault adapter does not support read' });
			return null;
		}

		const exists = await this.pathExists(adapter, path);
		if (exists === false) return null;

		try {
			return await adapter.read(path);
		} catch (error) {
			if (!isMissingFileError(error)) {
				errors.push({ source, message: describeError(error) });
			}
			return null;
		}
	}

	private async pathExists(adapter: OptionalAdapter, path: string): Promise<boolean | null> {
		if (typeof adapter.exists !== 'function') return null;
		try {
			return await adapter.exists(path);
		} catch {
			return null;
		}
	}

	private async removeIfPresent(adapter: OptionalAdapter, path: string): Promise<void> {
		if (typeof adapter.remove !== 'function') return;
		const exists = await this.pathExists(adapter, path);
		if (exists === false) return;
		try {
			await adapter.remove(path);
		} catch (error) {
			if (!isMissingFileError(error)) throw error;
		}
	}

	private writeConsole(level: DebugLogLevel, message: string, data?: unknown): void {
		if (!this.enabled) return;
		try {
			const args: [string] | [string, unknown] = data === undefined
				? [message]
				: [message, data];
			if (level === 'info') console.debug(...args);
			else if (level === 'warn') console.warn(...args);
			else console.error(...args);
		} catch {
			// Hostile console data must not break plugin work.
		}
	}

	private writeInternalError(message: string, error: unknown): void {
		if (!this.enabled) return;
		try {
			console.error(message, describeError(error));
		} catch {
			// Logging failures must never escape into sync operations.
		}
	}
}

function serializeEntry(level: DebugLogLevel, message: string, data?: unknown): string {
	const safeMessage = truncateString(safeString(message, '[Unserializable message]'), MAX_MESSAGE_LENGTH);
	const entry: DebugLogEntry = {
		schema: DEBUG_LOG_SCHEMA,
		version: DEBUG_LOG_VERSION,
		timestamp: new Date().toISOString(),
		level,
		message: safeMessage,
		event: safeMessage,
	};

	if (data !== undefined) {
		try {
			entry.data = toSafeJson(data, {
				seen: new WeakSet<object>(),
				remainingNodes: MAX_NODES,
			});
		} catch (error) {
			entry.data = `[Unserializable data: ${describeError(error)}]`;
		}
	}

	let serialized = safeStringify(entry);
	const originalBytes = utf8ByteLength(serialized) + 1;
	if (originalBytes > MAX_ENTRY_BYTES && entry.data !== undefined) {
		const preview = truncateString(safeStringify(entry.data), 8000);
		entry.data = {
			'$truncated': true,
			originalBytes,
			preview,
		};
		serialized = safeStringify(entry);
	}

	if (utf8ByteLength(serialized) + 1 > MAX_ENTRY_BYTES) {
		delete entry.data;
		serialized = safeStringify(entry);
	}

	return `${serialized}\n`;
}

function safeStringify(value: SafeJsonValue | DebugLogEntry): string {
	try {
		return JSON.stringify(value);
	} catch {
		return JSON.stringify({
			schema: DEBUG_LOG_SCHEMA,
			version: DEBUG_LOG_VERSION,
			timestamp: new Date().toISOString(),
			level: 'error',
			message: '[Entry serialization failed]',
			event: '[Entry serialization failed]',
		});
	}
}

function toSafeJson(value: unknown, state: SerializationState, depth = 0): SafeJsonValue {
	if (value === null) return null;
	if (typeof value === 'string') return truncateString(value, MAX_STRING_LENGTH);
	if (typeof value === 'boolean') return value;
	if (typeof value === 'number') return Number.isFinite(value) ? value : safeString(value, '[Number]');
	if (typeof value === 'bigint') return `${safeString(value, 'unknown')}n`;
	if (typeof value === 'undefined') return '[Undefined]';
	if (typeof value === 'symbol') return safeString(value, '[Symbol]');
	if (typeof value === 'function') return `[Function: ${safeFunctionName(value)}]`;
	if (depth >= MAX_DEPTH) return '[Max depth]';
	if (state.remainingNodes <= 0) return '[Node limit]';

	const objectValue = value as object;
	try {
		if (state.seen.has(objectValue)) return '[Circular]';
		state.seen.add(objectValue);
	} catch {
		return '[Unserializable object]';
	}
	state.remainingNodes--;

	if (isDate(value)) {
		try {
			return value.toISOString();
		} catch {
			return '[Invalid Date]';
		}
	}

	if (isError(value)) {
		const result: { [key: string]: SafeJsonValue } = {};
		result.name = safeProperty(value, 'name', 'Error', state, depth + 1);
		result.message = safeProperty(value, 'message', '[Unavailable]', state, depth + 1);
		result.stack = safeProperty(value, 'stack', '[Unavailable]', state, depth + 1);
		return result;
	}

	if (Array.isArray(value)) {
		let arrayLength = 0;
		try {
			arrayLength = value.length;
		} catch {
			return '[Unserializable array]';
		}

		const result: SafeJsonValue[] = [];
		for (let index = 0; index < Math.min(arrayLength, MAX_ARRAY_ITEMS); index++) {
			try {
				result.push(toSafeJson(value[index], state, depth + 1));
			} catch (error) {
				result.push(`[Unreadable item: ${describeError(error)}]`);
			}
		}
		if (arrayLength > MAX_ARRAY_ITEMS) {
			result.push(`[${arrayLength - MAX_ARRAY_ITEMS} more items]`);
		}
		return result;
	}

	let keys: string[];
	try {
		keys = Object.keys(value as object);
	} catch (error) {
		return `[Unserializable object: ${describeError(error)}]`;
	}

	const result: { [key: string]: SafeJsonValue } = Object.create(null) as {
		[key: string]: SafeJsonValue;
	};
	for (const key of keys.slice(0, MAX_OBJECT_KEYS)) {
		const safeKey = truncateString(key, 256);
		try {
			result[safeKey] = toSafeJson(
				(value as Record<string, unknown>)[key],
				state,
				depth + 1
			);
		} catch (error) {
			result[safeKey] = `[Unreadable property: ${describeError(error)}]`;
		}
	}
	if (keys.length > MAX_OBJECT_KEYS) {
		result.$truncatedKeys = keys.length - MAX_OBJECT_KEYS;
	}
	return result;
}

function safeProperty(
	value: object,
	key: string,
	fallback: string,
	state: SerializationState,
	depth: number
): SafeJsonValue {
	try {
		return toSafeJson((value as Record<string, unknown>)[key], state, depth);
	} catch {
		return fallback;
	}
}

function parseEntry(line: string): DebugLogEntry | null {
	let parsed: unknown;
	try {
		parsed = JSON.parse(line);
	} catch {
		return null;
	}

	if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
	const candidate = parsed as Record<string, unknown>;
	if (candidate.schema !== DEBUG_LOG_SCHEMA || candidate.version !== DEBUG_LOG_VERSION) return null;
	if (typeof candidate.timestamp !== 'string' || !isLevel(candidate.level)) return null;

	const message = typeof candidate.message === 'string'
		? candidate.message
		: typeof candidate.event === 'string'
			? candidate.event
			: null;
	if (message === null) return null;
	const event = typeof candidate.event === 'string' ? candidate.event : message;

	const entry: DebugLogEntry = {
		schema: DEBUG_LOG_SCHEMA,
		version: DEBUG_LOG_VERSION,
		timestamp: candidate.timestamp,
		level: candidate.level,
		message,
		event,
	};
	if ('data' in candidate) entry.data = candidate.data as SafeJsonValue;
	return entry;
}

function isLevel(value: unknown): value is DebugLogLevel {
	return value === 'info' || value === 'warn' || value === 'error';
}

function isDate(value: unknown): value is Date {
	try {
		return value instanceof Date;
	} catch {
		return false;
	}
}

function isError(value: unknown): value is Error {
	try {
		return value instanceof Error;
	} catch {
		return false;
	}
}

function safeFunctionName(value: Function): string {
	try {
		return truncateString(value.name || 'anonymous', 128);
	} catch {
		return 'unknown';
	}
}

function safeString(value: unknown, fallback: string): string {
	try {
		return String(value);
	} catch {
		return fallback;
	}
}

function truncateString(value: string, maxLength: number): string {
	if (value.length <= maxLength) return value;
	return `${value.slice(0, maxLength)}…[truncated]`;
}

function describeError(error: unknown): string {
	if (isError(error)) {
		return truncateString(error.message || error.name || 'Error', 512);
	}
	return truncateString(safeString(error, 'Unknown error'), 512);
}

function isMissingFileError(error: unknown): boolean {
	try {
		const code = (error as { code?: unknown })?.code;
		if (code === 'ENOENT' || code === 'NotFound') return true;
	} catch {
		return false;
	}
	return /not found|no such file|does not exist/i.test(describeError(error));
}

function normalizeLogPath(value: string): string {
	return value.replace(/\\/g, '/').replace(/\/{2,}/g, '/');
}

function utf8ByteLength(value: string): number {
	if (typeof TextEncoder !== 'undefined') {
		return new TextEncoder().encode(value).byteLength;
	}

	let bytes = 0;
	for (let index = 0; index < value.length; index++) {
		const codePoint = value.codePointAt(index) ?? 0;
		if (codePoint <= 0x7f) bytes += 1;
		else if (codePoint <= 0x7ff) bytes += 2;
		else if (codePoint <= 0xffff) bytes += 3;
		else {
			bytes += 4;
			index++;
		}
	}
	return bytes;
}
