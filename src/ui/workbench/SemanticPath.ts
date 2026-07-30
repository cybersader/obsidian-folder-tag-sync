export interface SemanticPathDescription {
	fullPath: string;
	context: string | null;
	focus: string;
	isRoot: boolean;
}

export interface SemanticPathRenderOptions {
	/** Stable semantic role used by real-Obsidian regression tests. */
	role: string;
	/** Label for the focused path segment, such as "Applies here". */
	focusLabel: string;
	/** Label for the structural parent path. Default: "Parent context". */
	contextLabel?: string;
	/** Compact paths stay inline when space allows; stacked paths read as two rows. */
	variant?: 'compact' | 'stacked';
	/** Additional class for a surface-specific layout hook. */
	className?: string;
}

/**
 * Separate a vault-relative path into structural context and the segment that
 * carries the current semantic meaning. Empty paths explicitly mean vault root.
 */
export function describeSemanticPath(path: string): SemanticPathDescription {
	if (path === '') {
		return {
			fullPath: '',
			context: null,
			focus: 'Vault root',
			isRoot: true,
		};
	}

	const segments = path.split('/');
	return {
		fullPath: path,
		context: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
		focus: segments.at(-1) ?? path,
		isRoot: false,
	};
}

/** Render a labelled path whose context and active segment remain distinct. */
export function renderSemanticPath(
	parent: HTMLElement,
	path: string,
	options: SemanticPathRenderOptions,
): HTMLElement {
	const description = describeSemanticPath(path);
	const contextLabel = options.contextLabel ?? 'Parent context';
	const variant = options.variant ?? 'stacked';
	const root = parent.createDiv({
		cls: [
			'dtf-semantic-path',
			`is-${variant}`,
			options.className ?? '',
		].filter(Boolean).join(' '),
	});
	root.dataset.dtfSemanticPath = options.role;
	root.setAttribute(
		'aria-label',
		description.context
			? `${options.focusLabel}: ${description.focus}. ${contextLabel}: ${description.context}.`
			: `${options.focusLabel}: ${description.focus}.`,
	);
	root.title = description.fullPath || 'Vault root';

	if (description.context) {
		renderPathPart(root, 'context', contextLabel, description.context);
	}
	renderPathPart(root, 'focus', options.focusLabel, description.focus);
	return root;
}

function renderPathPart(
	parent: HTMLElement,
	kind: 'context' | 'focus',
	label: string,
	value: string,
): void {
	const part = parent.createDiv({ cls: `dtf-semantic-path-part is-${kind}` });
	part.dataset[kind === 'context' ? 'dtfPathContext' : 'dtfPathFocus'] = '1';
	part.createSpan({ cls: 'dtf-semantic-path-label', text: label });
	part.createSpan({ cls: 'dtf-semantic-path-value', text: value });
}
