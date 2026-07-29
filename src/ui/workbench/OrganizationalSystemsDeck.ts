import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type { OrganizationalSystemCard } from '../../workbench/organizationalSystemsProjection';

export interface OrganizationalSystemsDeckOptions {
	onSelectSystem(occurrenceKey: string | null): void;
	onShowIncompleteChange(show: boolean): void;
}

/** Persistent, occurrence-first overview shared by every Workbench surface. */
export class OrganizationalSystemsDeck {
	private snapshot: WorkbenchSessionSnapshot;

	constructor(
		private readonly container: HTMLElement,
		snapshot: WorkbenchSessionSnapshot,
		private readonly options: OrganizationalSystemsDeckOptions,
	) {
		this.snapshot = snapshot;
		this.render();
	}

	update(snapshot: WorkbenchSessionSnapshot): void {
		this.snapshot = snapshot;
		this.render();
	}

	destroy(): void {
		this.container.empty();
	}

	private render(): void {
		const snapshot = this.snapshot;
		const selectedKey = snapshot.state.selectedSystemInstanceKey;
		const showIncomplete = snapshot.state.preferences.showIncompleteSystems;
		const cards = snapshot.organizationalSystems.cards.filter((card) =>
			showIncomplete || card.status !== 'incomplete');

		this.container.empty();
		this.container.addClass('dtf-organizational-systems');
		this.container.dataset.dtfOrganizationalSystems = '1';

		const headingRow = this.container.createDiv({ cls: 'dtf-orgsys-heading-row' });
		const headingWrap = headingRow.createDiv();
		headingWrap.createEl('h3', { text: 'Organizational systems' });
		headingWrap.createDiv({
			cls: 'dtf-orgsys-heading-description',
			text: 'Each card is one system occurrence anchored in this vault. Folders are evidence inside the occurrence, not standalone systems.',
		});

		const preference = headingRow.createEl('label', { cls: 'dtf-orgsys-preference' });
		const checkbox = preference.createEl('input', { type: 'checkbox' });
		checkbox.checked = showIncomplete;
		checkbox.dataset.dtfShowIncompleteSystems = '1';
		checkbox.addEventListener('change', () => {
			this.options.onShowIncompleteChange(checkbox.checked);
		});
		preference.createSpan({ text: 'Show incomplete systems' });

		const summary = this.container.createDiv({ cls: 'dtf-orgsys-summary' });
		summary.setText(
			`${snapshot.occurrenceStats.actionableCount} complete · `
			+ `${snapshot.occurrenceStats.incompleteCount} incomplete · `
			+ `${snapshot.occurrenceStats.suppressedCount} suppressed`,
		);

		const cardList = this.container.createDiv({ cls: 'dtf-orgsys-card-list' });
		cardList.setAttr('role', 'listbox');
		cardList.setAttr('aria-label', 'Organizational-system occurrences');
		if (cards.length === 0) {
			cardList.createDiv({
				cls: 'dtf-orgsys-empty',
				text: showIncomplete
					? 'No organizational systems were detected.'
					: 'No complete organizational systems are visible. Show incomplete systems to inspect partial evidence.',
			});
		} else {
			for (const card of cards) this.renderCard(cardList, card, card.occurrenceKey === selectedKey);
		}

		const selected = cards.find((card) => card.occurrenceKey === selectedKey) ?? null;
		this.renderSelectedDetail(selected);
	}

	private renderCard(parent: HTMLElement, card: OrganizationalSystemCard, selected: boolean): void {
		const button = parent.createEl('button', { cls: 'dtf-orgsys-card' });
		button.dataset.dtfSystemOccurrenceKey = card.occurrenceKey;
		button.dataset.dtfSystemStatus = card.status;
		button.setAttr('role', 'option');
		button.setAttr('aria-selected', String(selected));
		button.setAttr(
			'aria-label',
			`${card.packName} at ${displayAnchor(card.anchorPath)}, ${statusLabel(card.status)}`,
		);
		if (selected) button.addClass('is-selected');
		button.addEventListener('click', () => this.options.onSelectSystem(card.occurrenceKey));

		const title = button.createSpan({ cls: 'dtf-orgsys-card-title' });
		title.createSpan({ text: card.packName });
		title.createSpan({
			cls: `dtf-orgsys-status is-${card.status}`,
			text: statusLabel(card.status),
		});

		button.createSpan({
			cls: 'dtf-orgsys-anchor',
			text: `At ${displayAnchor(card.anchorPath)}`,
		});
		button.createSpan({
			cls: 'dtf-orgsys-shape',
			text: `${card.evidenceCount}/${card.minEvidence} ${card.countBy} · `
				+ `${card.memberPaths.length} member${card.memberPaths.length === 1 ? '' : 's'} · `
				+ `${card.supportPaths.length} support${card.supportPaths.length === 1 ? '' : 's'}`,
		});
		if (card.missingRoles.length > 0) {
			button.createSpan({
				cls: 'dtf-orgsys-missing',
				text: `Missing: ${card.missingRoles.join(', ')}`,
			});
		}
	}

	private renderSelectedDetail(card: OrganizationalSystemCard | null): void {
		const detail = this.container.createDiv({ cls: 'dtf-orgsys-selected-detail' });
		detail.dataset.dtfSelectedSystemDetail = '1';
		if (!card) {
			detail.createDiv({
				cls: 'dtf-orgsys-detail-empty',
				text: 'Select a system occurrence to inspect its coordinated folder evidence and relationships.',
			});
			return;
		}

		const title = detail.createDiv({ cls: 'dtf-orgsys-detail-title' });
		title.createSpan({ text: `${card.packName} at ${displayAnchor(card.anchorPath)}` });
		if (card.status !== 'actionable') {
			title.createSpan({
				cls: 'dtf-orgsys-inspect-only',
				text: 'Inspect only',
			});
		}

		const relations = detail.createDiv({ cls: 'dtf-orgsys-relations' });
		for (const path of card.memberPaths) this.makeRelationChip(relations, 'Member', path, 'member');
		for (const path of card.supportPaths) this.makeRelationChip(relations, 'Support', path, 'support');
		for (const role of card.missingRoles) this.makeRelationChip(relations, 'Missing role', role, 'missing');
		if (card.parentOccurrenceKey) {
			this.makeRelationChip(relations, 'Scoped under', card.parentPackId ?? 'parent system', 'parent');
		}
		if (card.suppressionReason) {
			this.makeRelationChip(relations, 'Suppressed', card.suppressionReason, 'suppressed');
		}
		if (relations.childElementCount === 0) {
			relations.createSpan({
				cls: 'dtf-orgsys-detail-empty',
				text: 'No folder evidence is attached to this occurrence.',
			});
		}
	}

	private makeRelationChip(
		parent: HTMLElement,
		kind: string,
		value: string,
		relation: string,
	): void {
		const chip = parent.createSpan({ cls: 'dtf-orgsys-relation-chip' });
		chip.dataset.dtfRelation = relation;
		chip.createSpan({ cls: 'dtf-orgsys-relation-kind', text: kind });
		chip.createSpan({ text: value || '(vault root)' });
	}
}

function statusLabel(status: OrganizationalSystemCard['status']): string {
	if (status === 'actionable') return 'Complete';
	if (status === 'suppressed') return 'Suppressed';
	return 'Incomplete';
}

function displayAnchor(path: string): string {
	return path || 'vault root';
}
