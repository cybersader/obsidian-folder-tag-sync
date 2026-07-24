import { afterEach, describe, expect, test } from 'bun:test';
import { copyTextToClipboard } from './clipboard';

const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
const originalDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');

afterEach(() => {
	restoreGlobal('navigator', originalNavigator);
	restoreGlobal('document', originalDocument);
	restoreGlobal('window', originalWindow);
});

function setGlobal(name: 'navigator' | 'document' | 'window', value: unknown): void {
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
}

function restoreGlobal(name: 'navigator' | 'document' | 'window', descriptor?: PropertyDescriptor): void {
	if (descriptor) Object.defineProperty(globalThis, name, descriptor);
	else delete (globalThis as Record<string, unknown>)[name];
}

interface FakeDomOptions {
	execResult?: boolean;
	execError?: Error;
}

function installFakeDom(options: FakeDomOptions = {}) {
	const calls = {
		appended: 0,
		removed: 0,
		textareaFocus: 0,
		textareaSelect: 0,
		execCommands: [] as string[],
		activeFocus: 0,
		activeSelection: [] as Array<[number, number, string | undefined]>,
		selectionRemoved: 0,
		rangesRestored: 0,
	};

	const activeElement = {
		selectionStart: 2,
		selectionEnd: 5,
		selectionDirection: 'forward',
		focus: () => {
			calls.activeFocus++;
		},
		setSelectionRange: (start: number, end: number, direction?: string) => {
			calls.activeSelection.push([start, end, direction]);
		},
	};

	const originalRange = { cloneRange: () => ({ id: 'cloned-range' }) };
	const selection = {
		rangeCount: 1,
		getRangeAt: () => originalRange,
		removeAllRanges: () => {
			calls.selectionRemoved++;
		},
		addRange: () => {
			calls.rangesRestored++;
		},
	};

	let textarea: Record<string, any>;
	const container = {
		appendChild: (element: Record<string, any>) => {
			calls.appended++;
			element.parentNode = container;
			return element;
		},
		removeChild: (element: Record<string, any>) => {
			calls.removed++;
			element.parentNode = null;
		},
	};

	textarea = {
		value: '',
		style: {},
		parentNode: null,
		setAttribute: () => undefined,
		focus: () => {
			calls.textareaFocus++;
		},
		select: () => {
			calls.textareaSelect++;
		},
		setSelectionRange: () => undefined,
		remove: () => {
			calls.removed++;
			textarea.parentNode = null;
		},
	};

	setGlobal('document', {
		activeElement,
		body: container,
		documentElement: container,
		createElement: (tag: string) => {
			expect(tag).toBe('textarea');
			return textarea;
		},
		execCommand: (command: string) => {
			calls.execCommands.push(command);
			if (options.execError) throw options.execError;
			return options.execResult ?? true;
		},
	});
	setGlobal('window', { getSelection: () => selection });

	return { calls, textarea };
}

describe('copyTextToClipboard', () => {
	test('awaits navigator.clipboard.writeText and reports primary success', async () => {
		let release!: () => void;
		let completed = false;
		const gate = new Promise<void>((resolve) => {
			release = resolve;
		});
		const copied: string[] = [];
		setGlobal('navigator', {
			clipboard: {
				writeText: async (text: string) => {
					copied.push(text);
					await gate;
					completed = true;
				},
			},
		});
		setGlobal('document', {
			createElement: () => {
				throw new Error('fallback should not run');
			},
		});

		const resultPromise = copyTextToClipboard('support bundle');
		await Promise.resolve();
		expect(copied).toEqual(['support bundle']);
		expect(completed).toBe(false);
		release();

		await expect(resultPromise).resolves.toEqual({ ok: true, method: 'clipboard' });
		expect(completed).toBe(true);
	});

	test('falls back after a Clipboard API rejection and restores focus and selections', async () => {
		setGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error('permission denied');
				},
			},
		});
		const { calls, textarea } = installFakeDom();

		const result = await copyTextToClipboard('fallback text');

		expect(result).toEqual({ ok: true, method: 'execCommand' });
		expect(textarea.value).toBe('fallback text');
		expect(calls.appended).toBe(1);
		expect(calls.removed).toBe(1);
		expect(calls.textareaFocus).toBe(1);
		expect(calls.textareaSelect).toBe(1);
		expect(calls.execCommands).toEqual(['copy']);
		expect(calls.activeFocus).toBe(1);
		expect(calls.activeSelection).toEqual([[2, 5, 'forward']]);
		expect(calls.selectionRemoved).toBe(1);
		expect(calls.rangesRestored).toBe(1);
	});

	test('uses the textarea fallback when navigator.clipboard is unavailable', async () => {
		setGlobal('navigator', {});
		const { calls } = installFakeDom();

		await expect(copyTextToClipboard('legacy')).resolves.toEqual({
			ok: true,
			method: 'execCommand',
		});
		expect(calls.removed).toBe(1);
	});

	test('returns a typed failure and still cleans up when fallback copying fails', async () => {
		setGlobal('navigator', {
			clipboard: {
				writeText: async () => {
					throw new Error('blocked');
				},
			},
		});
		const { calls } = installFakeDom({ execResult: false });

		const result = await copyTextToClipboard('cannot copy');

		expect(result.ok).toBe(false);
		if (!result.ok) {
			expect(result.error).toContain('Clipboard API failed: blocked');
			expect(result.error).toContain('document.execCommand returned false');
		}
		expect(calls.appended).toBe(1);
		expect(calls.removed).toBe(1);
		expect(calls.activeFocus).toBe(1);
	});

	test('returns failure without throwing when no browser document exists', async () => {
		setGlobal('navigator', {});
		setGlobal('document', undefined);
		setGlobal('window', undefined);

		const result = await copyTextToClipboard('headless');

		expect(result.ok).toBe(false);
		if (!result.ok) expect(result.error).toContain('Document API is unavailable');
	});
});
