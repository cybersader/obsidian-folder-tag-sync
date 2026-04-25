/**
 * EditModeChooserModal — small chooser shown when a user clicks an
 * existing legacy regex rule whose typed shape was inferable.
 *
 * The principle made visible: even rules authored as raw regex can often
 * be reconstructed in the typed model via heuristic. We don't silently
 * commit to either path — the user picks. The guided path runs
 * inferTypedModel and shows a banner; the advanced path opens the legacy
 * regex form unchanged.
 *
 * Used by SettingsTab.routeRuleEdit(). When inference returns full
 * folder/tag/transfer fields, this modal appears; when inference is
 * ambiguous, the router skips it and opens advanced directly.
 */

import { App, Modal, Setting } from 'obsidian';

export type EditChoice = 'guided' | 'advanced';

export class EditModeChooserModal extends Modal {
	private readonly ruleName: string;
	private readonly onChoose: (choice: EditChoice) => void;

	constructor(app: App, ruleName: string, onChoose: (choice: EditChoice) => void) {
		super(app);
		this.ruleName = ruleName;
		this.onChoose = onChoose;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();

		new Setting(contentEl).setName('Choose edit mode').setHeading();

		const desc = contentEl.createEl('p');
		desc.style.fontSize = '0.9em';
		desc.style.color = 'var(--text-muted)';
		desc.setText(
			`Rule "${this.ruleName}" was authored with raw regex but its shape looks like a typed pattern. Open in the guided editor (with best-effort field reconstruction) or in the advanced regex editor.`,
		);

		const buttonRow = contentEl.createDiv();
		buttonRow.style.display = 'flex';
		buttonRow.style.gap = '0.5em';
		buttonRow.style.justifyContent = 'flex-end';
		buttonRow.style.marginTop = '1em';

		const advancedBtn = buttonRow.createEl('button', { text: 'Open in advanced (regex)' });
		advancedBtn.addEventListener('click', () => {
			this.onChoose('advanced');
			this.close();
		});

		const guidedBtn = buttonRow.createEl('button', {
			text: 'Open in guided (best-effort import)',
			cls: 'mod-cta',
		});
		guidedBtn.addEventListener('click', () => {
			this.onChoose('guided');
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
