import { App, FuzzySuggestModal } from 'obsidian';
import type { RulePack } from '../engine/rulePackLoader';

/**
 * Fuzzy-suggest modal for picking a rule pack from a list of already-loaded
 * packs. Invoked after the plugin discovers and parses all JSON files in
 * `.obsidian/plugins/folder-tag-sync/rule-packs/`. Selecting a pack hands it
 * off to the caller's onChoose callback, which typically presents the
 * replace-vs-append confirmation.
 */
export class RulePackPickerModal extends FuzzySuggestModal<RulePack> {
	private readonly packs: RulePack[];
	private readonly onChoose: (pack: RulePack) => void;

	constructor(app: App, packs: RulePack[], onChoose: (pack: RulePack) => void) {
		super(app);
		this.packs = packs;
		this.onChoose = onChoose;
		this.setPlaceholder('Pick a rule pack to import…');
	}

	getItems(): RulePack[] {
		return this.packs;
	}

	getItemText(pack: RulePack): string {
		return `${pack.name} — ${pack.description} (${pack.rules.length} rules)`;
	}

	onChooseItem(pack: RulePack): void {
		this.onChoose(pack);
	}
}
