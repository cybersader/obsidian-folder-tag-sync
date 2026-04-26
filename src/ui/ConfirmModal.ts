/**
 * ConfirmModal — Obsidian-native two-button confirmation dialog.
 *
 * Replaces native `confirm()` for destructive actions. Themed,
 * keyboard-navigable, focus-trapped, and not blocked by browser
 * settings — same surface every other Obsidian modal uses.
 *
 * Usage:
 *   new ConfirmModal(app, {
 *     title: 'Delete rule?',
 *     body: `"${rule.name}" cannot be recovered.`,
 *     confirmLabel: 'Delete',
 *     destructive: true,
 *     onConfirm: () => doDelete(),
 *   }).open();
 */

import { App, Modal, Setting } from 'obsidian';

export interface ConfirmOptions {
	title: string;
	body: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** When true, the confirm button gets the warning styling. Default false. */
	destructive?: boolean;
	onConfirm: () => void;
	onCancel?: () => void;
}

export class ConfirmModal extends Modal {
	private readonly opts: ConfirmOptions;

	constructor(app: App, opts: ConfirmOptions) {
		super(app);
		this.opts = opts;
	}

	onOpen(): void {
		const { contentEl, modalEl } = this;
		contentEl.empty();
		modalEl.addClass('dtf-confirm-modal');

		new Setting(contentEl).setName(this.opts.title).setHeading();

		const body = contentEl.createEl('p');
		body.style.color = 'var(--text-muted)';
		body.style.marginTop = '0';
		body.style.marginBottom = '1.2em';
		body.setText(this.opts.body);

		const buttonRow = contentEl.createDiv();
		buttonRow.style.display = 'flex';
		buttonRow.style.justifyContent = 'flex-end';
		buttonRow.style.gap = '0.5em';

		const cancelBtn = buttonRow.createEl('button', {
			text: this.opts.cancelLabel ?? 'Cancel',
		});
		cancelBtn.addEventListener('click', () => {
			this.opts.onCancel?.();
			this.close();
		});

		const confirmBtn = buttonRow.createEl('button', {
			text: this.opts.confirmLabel ?? 'Confirm',
			cls: this.opts.destructive ? 'mod-warning' : 'mod-cta',
		});
		confirmBtn.addEventListener('click', () => {
			this.opts.onConfirm();
			this.close();
		});

		// Focus the cancel button by default — destructive flows should
		// require a deliberate click rather than a quick Enter keystroke.
		setTimeout(() => cancelBtn.focus(), 0);
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
