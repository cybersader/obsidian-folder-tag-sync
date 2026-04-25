/**
 * EntryPathSuggest — fast fuzzy autocomplete for the guided modal's
 * folderEntry and tagEntry inputs.
 *
 * Built on Obsidian's `AbstractInputSuggest<string>`, which gives us:
 *   - native dropdown rendering (matches the Obsidian theme + dark mode)
 *   - keyboard navigation (↑/↓, Enter, Esc) for free
 *   - focus + outside-click handling
 *   - mobile/touch friendly behavior
 *
 * The class is parameterized over a `sources` array — same class instance
 * for folders or for tags. Sources are pre-computed once when the modal
 * opens (folders walked from vault root, tags expanded from metadataCache);
 * the suggester filters that list per keystroke. Sub-millisecond on 10k
 * entries — no debouncing needed.
 *
 * Pure ranking logic + source builders live in `entryPathHelpers.ts` so
 * they can be unit-tested without DOM / Obsidian runtime imports.
 */

import { AbstractInputSuggest, App } from 'obsidian';
import { rankSuggestions } from './entryPathHelpers';

export { collectFolderSources, collectTagSources } from './entryPathHelpers';

export class EntryPathSuggest extends AbstractInputSuggest<string> {
	private readonly sources: string[];
	private readonly inputEl: HTMLInputElement;
	private readonly onPick?: (value: string) => void;

	constructor(
		app: App,
		inputEl: HTMLInputElement,
		sources: string[],
		onPick?: (value: string) => void,
	) {
		super(app, inputEl);
		this.inputEl = inputEl;
		this.sources = sources;
		this.onPick = onPick;
	}

	getSuggestions(query: string): string[] {
		return rankSuggestions(query, this.sources);
	}

	renderSuggestion(item: string, el: HTMLElement): void {
		// Bold the matched substring for quick scanning. Same idiom Obsidian
		// uses in its built-in file/quick-switcher suggesters.
		const query = this.inputEl.value.trim().toLowerCase();
		if (!query) {
			el.setText(item);
			return;
		}
		const lower = item.toLowerCase();
		const idx = lower.indexOf(query);
		if (idx < 0) {
			el.setText(item);
			return;
		}
		el.createSpan({ text: item.slice(0, idx) });
		el.createEl('strong', { text: item.slice(idx, idx + query.length) });
		el.createSpan({ text: item.slice(idx + query.length) });
	}

	selectSuggestion(item: string): void {
		this.inputEl.value = item;
		this.inputEl.dispatchEvent(new Event('input', { bubbles: true }));
		this.close();
		this.onPick?.(item);
	}
}
