import {
	afterEach,
	beforeAll,
	beforeEach,
	describe,
	expect,
	mock,
	spyOn,
	test,
} from 'bun:test';
import type { DebugLogEntry } from './debug';

mock.module('obsidian', () => ({
	App: class {},
	normalizePath: (path: string) => path.replace(/\\/g, '/').replace(/\/{2,}/g, '/'),
}));

let DebugLogger: typeof import('./debug').DebugLogger;
let DEBUG_LOG_SCHEMA: typeof import('./debug').DEBUG_LOG_SCHEMA;
let DEBUG_LOG_VERSION: typeof import('./debug').DEBUG_LOG_VERSION;

beforeAll(async () => {
	({ DebugLogger, DEBUG_LOG_SCHEMA, DEBUG_LOG_VERSION } = await import('./debug'));
});

let consoleDebugSpy: ReturnType<typeof spyOn>;
let consoleWarnSpy: ReturnType<typeof spyOn>;
let consoleErrorSpy: ReturnType<typeof spyOn>;

beforeEach(() => {
	consoleDebugSpy = spyOn(console, 'debug').mockImplementation(() => undefined);
	consoleWarnSpy = spyOn(console, 'warn').mockImplementation(() => undefined);
	consoleErrorSpy = spyOn(console, 'error').mockImplementation(() => undefined);
});

afterEach(() => {
	consoleDebugSpy.mockRestore();
	consoleWarnSpy.mockRestore();
	consoleErrorSpy.mockRestore();
});

class MockAdapter {
	readonly files = new Map<string, string>();
	readonly appendCalls: Array<{ path: string; data: string }> = [];
	readonly writeCalls: Array<{ path: string; data: string }> = [];
	readonly removeCalls: string[] = [];
	readonly renameCalls: Array<{ from: string; to: string }> = [];
	statCalls = 0;
	beforeAppend?: (path: string, data: string, index: number) => Promise<void>;

	async exists(path: string): Promise<boolean> {
		return this.files.has(path);
	}

	async stat(path: string): Promise<{ size: number } | null> {
		this.statCalls++;
		const content = this.files.get(path);
		return content === undefined ? null : { size: new TextEncoder().encode(content).byteLength };
	}

	async read(path: string): Promise<string> {
		const content = this.files.get(path);
		if (content !== undefined) return content;
		const error = new Error(`No such file: ${path}`) as Error & { code: string };
		error.code = 'ENOENT';
		throw error;
	}

	async write(path: string, data: string): Promise<void> {
		this.writeCalls.push({ path, data });
		this.files.set(path, data);
	}

	async append(path: string, data: string): Promise<void> {
		const index = this.appendCalls.length;
		this.appendCalls.push({ path, data });
		await this.beforeAppend?.(path, data, index);
		this.files.set(path, (this.files.get(path) ?? '') + data);
	}

	async remove(path: string): Promise<void> {
		this.removeCalls.push(path);
		if (!this.files.delete(path)) {
			const error = new Error(`Not found: ${path}`) as Error & { code: string };
			error.code = 'ENOENT';
			throw error;
		}
	}

	async rename(from: string, to: string): Promise<void> {
		this.renameCalls.push({ from, to });
		const content = await this.read(from);
		if (this.files.has(to)) throw new Error(`Destination exists: ${to}`);
		this.files.delete(from);
		this.files.set(to, content);
	}
}

function makeApp(adapter: MockAdapter, configDir = '.obsidian') {
	return { vault: { adapter, configDir } } as never;
}

function makeEntry(message: string, data?: unknown): DebugLogEntry {
	const entry: DebugLogEntry = {
		schema: DEBUG_LOG_SCHEMA,
		version: DEBUG_LOG_VERSION,
		timestamp: '2026-07-23T12:00:00.000Z',
		level: 'info',
		message,
		event: message,
	};
	if (data !== undefined) entry.data = data as DebugLogEntry['data'];
	return entry;
}

function line(entry: DebugLogEntry): string {
	return `${JSON.stringify(entry)}\n`;
}

async function waitFor(predicate: () => boolean): Promise<void> {
	for (let attempt = 0; attempt < 100; attempt++) {
		if (predicate()) return;
		await Bun.sleep(1);
	}
	throw new Error('Timed out waiting for test condition');
}

describe('DebugLogger construction and enablement', () => {
	test('derives the normalized plugin-private path from a manifest or plugin id', () => {
		const adapter = new MockAdapter();
		const fromManifest = new DebugLogger(
			makeApp(adapter, '.obsidian\\config'),
			{ id: 'folder-tag-sync' },
			true
		);
		const fromId = new DebugLogger(makeApp(adapter), 'custom-plugin', false);

		expect(fromManifest.getLogPath()).toBe('.obsidian/config/plugins/folder-tag-sync/debug.log');
		expect(fromId.getLogPath()).toBe('.obsidian/plugins/custom-plugin/debug.log');
		expect(adapter.appendCalls).toHaveLength(0);
		expect(adapter.writeCalls).toHaveLength(0);
	});

	test('performs no file or console work while disabled', async () => {
		const adapter = new MockAdapter();
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', false);

		await logger.info('secret', { token: 'must-not-leak' });
		await logger.warn('also secret');
		await logger.error('still secret');

		expect(adapter.statCalls).toBe(0);
		expect(adapter.appendCalls).toHaveLength(0);
		expect(consoleDebugSpy).not.toHaveBeenCalled();
		expect(consoleWarnSpy).not.toHaveBeenCalled();
		expect(consoleErrorSpy).not.toHaveBeenCalled();
	});

	test('enables immediately and invalidates writes still waiting in the queue when disabled', async () => {
		const adapter = new MockAdapter();
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		adapter.beforeAppend = async (_path, _data, index) => {
			if (index === 0) await firstGate;
		};

		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', false);
		await logger.info('ignored while disabled');
		logger.setEnabled(true);
		const first = logger.info('first in flight');
		const queued = logger.info('queued then disabled');
		await waitFor(() => adapter.appendCalls.length === 1);
		logger.setEnabled(false);
		releaseFirst();
		await Promise.all([first, queued]);

		expect(adapter.appendCalls).toHaveLength(1);
		expect(adapter.files.get(logger.getLogPath())).toContain('first in flight');
		expect(adapter.files.get(logger.getLogPath())).not.toContain('queued then disabled');
		expect(consoleDebugSpy).not.toHaveBeenCalled();
	});
});

describe('DebugLogger writes', () => {
	test('serializes append operations so delayed writes retain call order', async () => {
		const adapter = new MockAdapter();
		let releaseFirst!: () => void;
		const firstGate = new Promise<void>((resolve) => {
			releaseFirst = resolve;
		});
		adapter.beforeAppend = async (_path, _data, index) => {
			if (index === 0) await firstGate;
		};
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', true);

		const first = logger.info('first');
		const second = logger.warn('second');
		await waitFor(() => adapter.appendCalls.length === 1);
		expect(adapter.appendCalls).toHaveLength(1);
		releaseFirst();
		await Promise.all([first, second]);

		const entries = adapter.files.get(logger.getLogPath())!
			.trim()
			.split('\n')
			.map((value) => JSON.parse(value) as DebugLogEntry);
		expect(entries.map((entry) => entry.message)).toEqual(['first', 'second']);
		expect(entries.map((entry) => entry.level)).toEqual(['info', 'warn']);
	});

	test('writes one-line schema-versioned JSON and safely bounds circular or hostile data', async () => {
		const adapter = new MockAdapter();
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', true);
		const circular: Record<string, unknown> = { name: 'root' };
		circular.self = circular;
		const hostile: Record<string, unknown> = {};
		Object.defineProperty(hostile, 'boom', {
			enumerable: true,
			get() {
				throw new Error('getter exploded');
			},
		});

		await logger.error('Serialization check', { circular, hostile });

		const raw = adapter.files.get(logger.getLogPath())!;
		expect(raw.trim().split('\n')).toHaveLength(1);
		const entry = JSON.parse(raw) as DebugLogEntry;
		expect(entry.schema).toBe(DEBUG_LOG_SCHEMA);
		expect(entry.version).toBe(DEBUG_LOG_VERSION);
		expect(entry.event).toBe('Serialization check');
		expect((entry.data as Record<string, any>).circular.self).toBe('[Circular]');
		expect((entry.data as Record<string, any>).hostile.boom).toContain('Unreadable property');
		expect(new TextEncoder().encode(raw).byteLength).toBeLessThanOrEqual(32 * 1024);
	});

	test('rotates near 512 KiB and retains exactly one .1 backup', async () => {
		const adapter = new MockAdapter();
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', true);
		const path = logger.getLogPath();
		const previous = 'x'.repeat(512 * 1024);
		adapter.files.set(path, previous);
		adapter.files.set(`${path}.1`, 'stale backup');

		await logger.info('after rotation');

		expect(adapter.files.get(`${path}.1`)).toBe(previous);
		expect(adapter.files.get(path)).toContain('after rotation');
		expect(adapter.files.get(path)).not.toContain(previous.slice(0, 100));
		expect(adapter.removeCalls).toEqual([`${path}.1`]);
		expect(adapter.renameCalls).toEqual([{ from: path, to: `${path}.1` }]);
	});
});

describe('DebugLogger readRecentEntries', () => {
	test('reads backup then current, skips malformed and legacy tail lines, and reports status', async () => {
		const adapter = new MockAdapter();
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', false);
		const path = logger.getLogPath();
		adapter.files.set(`${path}.1`, line(makeEntry('from backup')));
		adapter.files.set(
			path,
			`${line(makeEntry('from current'))}[legacy] old format\n{"schema":"broken"`
		);

		const result = await logger.readRecentEntries();

		expect(result.entries.map((entry) => entry.message)).toEqual([
			'from backup',
			'from current',
		]);
		expect(result.status).toMatchObject({
			returnedCount: 2,
			validEntryCount: 2,
			malformedLineCount: 2,
			truncated: false,
			errors: [],
		});
	});

	test('returns only the latest 100 entries and marks count truncation', async () => {
		const adapter = new MockAdapter();
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', false);
		const entries = Array.from({ length: 105 }, (_, index) => line(makeEntry(`entry-${index}`)));
		adapter.files.set(logger.getLogPath(), entries.join(''));

		const result = await logger.readRecentEntries();

		expect(result.status.returnedCount).toBe(100);
		expect(result.status.validEntryCount).toBe(105);
		expect(result.status.truncated).toBe(true);
		expect(result.entries[0].message).toBe('entry-5');
		expect(result.entries.at(-1)?.message).toBe('entry-104');
	});

	test('keeps returned log data within about 64 KiB', async () => {
		const adapter = new MockAdapter();
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', false);
		const entries = Array.from({ length: 80 }, (_, index) =>
			line(makeEntry(`entry-${index}`, { text: 'x'.repeat(1800) }))
		);
		adapter.files.set(logger.getLogPath(), entries.join(''));

		const result = await logger.readRecentEntries();

		expect(result.status.returnedBytes).toBeLessThanOrEqual(64 * 1024);
		expect(result.status.returnedCount).toBeLessThan(80);
		expect(result.status.truncated).toBe(true);
		expect(result.entries.at(-1)?.message).toBe('entry-79');
	});

	test('returns a contiguous newest tail instead of skipping an oversized middle entry', async () => {
		const adapter = new MockAdapter();
		const logger = new DebugLogger(makeApp(adapter), 'folder-tag-sync', false);
		adapter.files.set(logger.getLogPath(), [
			line(makeEntry('old-small')),
			line(makeEntry('middle-too-large', { text: 'm'.repeat(30_000) })),
			line(makeEntry('newest-large', { text: 'n'.repeat(40_000) })),
		].join(''));

		const result = await logger.readRecentEntries();

		expect(result.entries.map((entry) => entry.message)).toEqual(['newest-large']);
		expect(result.status.truncated).toBe(true);
		expect(result.status.validEntryCount).toBe(3);
	});

	test('returns an empty status instead of throwing when both files are missing', async () => {
		const logger = new DebugLogger(makeApp(new MockAdapter()), 'folder-tag-sync', false);

		await expect(logger.readRecentEntries()).resolves.toEqual({
			entries: [],
			status: {
				returnedCount: 0,
				validEntryCount: 0,
				malformedLineCount: 0,
				returnedBytes: 0,
				truncated: false,
				errors: [],
			},
		});
	});
});
