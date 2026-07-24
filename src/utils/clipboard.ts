export type ClipboardCopyMethod = 'clipboard' | 'execCommand';

export type ClipboardCopyResult =
	| { ok: true; method: ClipboardCopyMethod }
	| { ok: false; error: string };

interface RestorableTextSelection {
	element: {
		focus?: (options?: FocusOptions) => void;
		setSelectionRange?: (start: number, end: number, direction?: string) => void;
	};
	start: number;
	end: number;
	direction?: string;
}

/**
 * Copy text without imposing UI policy on callers. The modern async Clipboard
 * API is preferred; a temporary textarea is used as a safe legacy fallback.
 */
export async function copyTextToClipboard(text: string): Promise<ClipboardCopyResult> {
	let primaryError: string | null = null;
	let clipboard: Clipboard | undefined;
	try {
		clipboard = typeof navigator !== 'undefined' ? navigator.clipboard : undefined;
	} catch (error) {
		primaryError = describeError(error);
	}

	if (clipboard) {
		try {
			const writeText = clipboard.writeText;
			if (typeof writeText === 'function') {
				await writeText.call(clipboard, text);
				return { ok: true, method: 'clipboard' };
			}
		} catch (error) {
			primaryError = describeError(error);
		}
	}

	const fallback = copyWithTemporaryTextarea(text);
	if (fallback.ok) return fallback;

	const reasons = [];
	if (primaryError !== null) reasons.push(`Clipboard API failed: ${primaryError}`);
	else reasons.push('Clipboard API is unavailable');
	reasons.push(`Fallback failed: ${fallback.error}`);
	return { ok: false, error: reasons.join('; ') };
}

function copyWithTemporaryTextarea(text: string): ClipboardCopyResult {
	try {
		return copyWithTemporaryTextareaUnsafe(text);
	} catch (error) {
		return { ok: false, error: describeError(error) };
	}
}

function copyWithTemporaryTextareaUnsafe(text: string): ClipboardCopyResult {
	if (typeof document === 'undefined' || typeof document.createElement !== 'function') {
		return { ok: false, error: 'Document API is unavailable' };
	}
	if (typeof document.execCommand !== 'function') {
		return { ok: false, error: 'document.execCommand is unavailable' };
	}

	const container = document.body ?? document.documentElement;
	if (!container || typeof container.appendChild !== 'function') {
		return { ok: false, error: 'Document has no append target' };
	}

	const activeElement = document.activeElement as HTMLElement | null;
	const textSelection = captureTextSelection(activeElement);
	const selection = captureDocumentSelection();
	const textarea = document.createElement('textarea');

	textarea.value = text;
	textarea.setAttribute('readonly', '');
	textarea.setAttribute('aria-hidden', 'true');
	textarea.style.position = 'fixed';
	textarea.style.top = '0';
	textarea.style.left = '-9999px';
	textarea.style.width = '1px';
	textarea.style.height = '1px';
	textarea.style.opacity = '0';
	textarea.style.pointerEvents = 'none';

	try {
		container.appendChild(textarea);
		focusWithoutScrolling(textarea);
		textarea.select();
		textarea.setSelectionRange(0, textarea.value.length);

		if (!document.execCommand('copy')) {
			return { ok: false, error: 'document.execCommand returned false' };
		}
		return { ok: true, method: 'execCommand' };
	} catch (error) {
		return { ok: false, error: describeError(error) };
	} finally {
		try {
			textarea.remove();
		} catch {
			try {
				textarea.parentNode?.removeChild(textarea);
			} catch {
				// Cleanup is best-effort on legacy DOM implementations.
			}
		}
		restoreFocusAndSelection(activeElement, textSelection, selection);
	}
}

function captureTextSelection(activeElement: HTMLElement | null): RestorableTextSelection | null {
	if (activeElement === null) return null;
	const candidate = activeElement as unknown as {
		selectionStart?: number | null;
		selectionEnd?: number | null;
		selectionDirection?: string | null;
		focus?: (options?: FocusOptions) => void;
		setSelectionRange?: (start: number, end: number, direction?: string) => void;
	};

	try {
		if (
			typeof candidate.selectionStart !== 'number'
			|| typeof candidate.selectionEnd !== 'number'
			|| typeof candidate.setSelectionRange !== 'function'
		) {
			return null;
		}
		return {
			element: candidate,
			start: candidate.selectionStart,
			end: candidate.selectionEnd,
			direction: candidate.selectionDirection ?? undefined,
		};
	} catch {
		return null;
	}
}

function captureDocumentSelection(): Range[] {
	if (typeof window === 'undefined' || typeof window.getSelection !== 'function') return [];

	try {
		const selection = window.getSelection();
		if (selection === null) return [];
		const ranges: Range[] = [];
		for (let index = 0; index < selection.rangeCount; index++) {
			ranges.push(selection.getRangeAt(index).cloneRange());
		}
		return ranges;
	} catch {
		return [];
	}
}

function restoreFocusAndSelection(
	activeElement: HTMLElement | null,
	textSelection: RestorableTextSelection | null,
	ranges: Range[]
): void {
	if (activeElement && typeof activeElement.focus === 'function') {
		focusWithoutScrolling(activeElement);
	}

	if (textSelection !== null) {
		try {
			textSelection.element.setSelectionRange?.(
				textSelection.start,
				textSelection.end,
				textSelection.direction
			);
		} catch {
			// Some input types expose selection fields but reject restoration.
		}
	}

	if (
		ranges.length > 0
		&& typeof window !== 'undefined'
		&& typeof window.getSelection === 'function'
	) {
		try {
			const selection = window.getSelection();
			selection?.removeAllRanges();
			for (const range of ranges) selection?.addRange(range);
		} catch {
			// DOM selection restoration is best-effort.
		}
	}
}

function focusWithoutScrolling(element: { focus: (options?: FocusOptions) => void }): void {
	try {
		element.focus({ preventScroll: true });
	} catch {
		try {
			element.focus();
		} catch {
			// Focus restoration is best-effort.
		}
	}
}

function describeError(error: unknown): string {
	try {
		if (error instanceof Error) return truncate(error.message || error.name || 'Error');
		return truncate(String(error));
	} catch {
		return 'Unknown error';
	}
}

function truncate(value: string): string {
	return value.length <= 512 ? value : `${value.slice(0, 512)}…[truncated]`;
}
