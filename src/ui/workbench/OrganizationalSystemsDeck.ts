import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type { OrganizationalSystemCard } from '../../workbench/organizationalSystemsProjection';
import {
	describeSemanticPath,
	renderSemanticPath,
} from './SemanticPath';

export interface OrganizationalSystemsDeckOptions {
	onSelectSystem(occurrenceKey: string | null): void;
	onShowIncompleteChange(show: boolean): void;
}

interface DisplayEvidence {
	relation: 'member' | 'support';
	role: string | null;
	path: string;
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
			text: 'Each card is one system occurrence. Select a card to focus that same occurrence across Map, Scope, and Candidates; selection does not add or enable rules.',
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
		button.setAttr('aria-label', occurrenceSelectionLabel(card));
		if (selected) button.addClass('is-selected');
		button.addEventListener('click', () => this.options.onSelectSystem(card.occurrenceKey));

		button.createSpan({
			cls: 'dtf-workbench-object-kind',
			text: 'System occurrence',
		});
		const title = button.createSpan({ cls: 'dtf-orgsys-card-title' });
		title.createSpan({ text: card.packName });
		title.createSpan({
			cls: `dtf-orgsys-status is-${card.status}`,
			text: statusLabel(card.status),
		});

		renderSemanticPath(button, card.anchorPath, {
			role: 'system-occurrence-anchor',
			focusLabel: 'Applies here',
			variant: 'stacked',
		});
		button.createSpan({
			cls: 'dtf-orgsys-shape',
			text: `Evidence: ${card.evidenceCount} of ${card.minEvidence} ${card.countBy} · `
				+ `${card.memberPaths.length} member folder${card.memberPaths.length === 1 ? '' : 's'} · `
				+ `${card.supportPaths.length} support folder${card.supportPaths.length === 1 ? '' : 's'}`,
		});
		button.createSpan({
			cls: 'dtf-workbench-consequence',
			text: statusConsequence(card.status),
		});
		if (card.missingRoles.length > 0) {
			button.createSpan({
				cls: 'dtf-orgsys-missing',
				text: `Missing member roles: ${card.missingRoles.join(', ')}`,
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

		detail.createDiv({
			cls: 'dtf-workbench-object-kind',
			text: 'Selected system occurrence',
		});
		const title = detail.createDiv({ cls: 'dtf-orgsys-detail-title' });
		title.createSpan({ text: card.packName });
		if (card.status !== 'actionable') {
			title.createSpan({
				cls: 'dtf-orgsys-inspect-only',
				text: 'Inspect only',
			});
		}
		renderSemanticPath(detail, card.anchorPath, {
			role: 'selected-system-anchor',
			focusLabel: 'Applies here',
			variant: 'stacked',
		});
		detail.createDiv({
			cls: 'dtf-workbench-consequence',
			text: statusConsequence(card.status),
		});

		detail.createDiv({
			cls: 'dtf-orgsys-evidence-heading',
			text: 'Evidence folders',
		});
		const relations = detail.createDiv({ cls: 'dtf-orgsys-relations' });
		for (const evidence of collectDisplayEvidence(card)) {
			this.renderEvidenceRow(relations, evidence);
		}
		for (const role of card.missingRoles) {
			this.renderPlainRelation(relations, 'Missing role', role, 'missing');
		}
		if (card.parentOccurrenceKey) {
			this.renderPlainRelation(
				relations,
				'Parent system relationship',
				card.parentPackId ?? 'Parent system detected',
				'parent',
			);
		}
		if (card.suppressionReason) {
			this.renderPlainRelation(
				relations,
				'Why this is inspect only',
				'The required parent system is not actionable at this location.',
				'suppressed',
			);
		}
		if (relations.childElementCount === 0) {
			relations.createSpan({
				cls: 'dtf-orgsys-detail-empty',
				text: 'No folder evidence is attached to this occurrence.',
			});
		}
	}

	private renderEvidenceRow(parent: HTMLElement, evidence: DisplayEvidence): void {
		const row = parent.createDiv({ cls: 'dtf-orgsys-evidence-row' });
		row.dataset.dtfRelation = evidence.relation;
		const heading = row.createDiv({ cls: 'dtf-orgsys-evidence-row-heading' });
		heading.createSpan({
			cls: 'dtf-orgsys-relation-kind',
			text: evidence.relation === 'member' ? 'Member role' : 'Support evidence',
		});
		if (evidence.role) {
			heading.createSpan({ cls: 'dtf-orgsys-evidence-role', text: evidence.role });
		}
		renderSemanticPath(row, evidence.path, {
			role: `system-${evidence.relation}-evidence`,
			contextLabel: 'Inside occurrence',
			focusLabel: 'Evidence folder',
			variant: 'stacked',
		});
	}

	private renderPlainRelation(
		parent: HTMLElement,
		kind: string,
		value: string,
		relation: string,
	): void {
		const row = parent.createDiv({ cls: 'dtf-orgsys-evidence-row is-plain' });
		row.dataset.dtfRelation = relation;
		row.createDiv({ cls: 'dtf-orgsys-relation-kind', text: kind });
		row.createDiv({ cls: 'dtf-orgsys-relation-value', text: value });
	}
}

function collectDisplayEvidence(card: OrganizationalSystemCard): DisplayEvidence[] {
	const byIdentity = new Map<string, DisplayEvidence>();
	for (const evidence of card.evidence) {
		const role = evidence.label?.trim() || evidence.role || null;
		const key = `${evidence.relation.length}:${evidence.relation}:`
			+ `${evidence.role.length}:${evidence.role}:`
			+ evidence.folderPath;
		if (!byIdentity.has(key)) {
			byIdentity.set(key, {
				relation: evidence.relation,
				role,
				path: evidence.folderPath,
			});
		}
	}

	if (byIdentity.size === 0) {
		for (const path of card.memberPaths) {
			byIdentity.set(`member:${path}`, { relation: 'member', role: null, path });
		}
		for (const path of card.supportPaths) {
			byIdentity.set(`support:${path}`, { relation: 'support', role: null, path });
		}
	}
	return [...byIdentity.values()];
}

function occurrenceSelectionLabel(card: OrganizationalSystemCard): string {
	const path = describeSemanticPath(card.anchorPath);
	const location = path.context
		? `Applies here: ${path.focus}. Parent context: ${path.context}.`
		: `Applies here: ${path.focus}.`;
	return `Select ${card.packName} system occurrence. ${location} ${statusLabel(card.status)}. Selection focuses this occurrence across the Workbench; it does not add or enable rules.`;
}

function statusLabel(status: OrganizationalSystemCard['status']): string {
	if (status === 'actionable') return 'Complete';
	if (status === 'suppressed') return 'Suppressed';
	return 'Incomplete';
}

function statusConsequence(status: OrganizationalSystemCard['status']): string {
	if (status === 'actionable') return 'Ready to produce candidate rules.';
	if (status === 'suppressed') return 'Inspect only — its required parent system is not actionable here.';
	return 'Inspect only — add the missing member roles before drafting this occurrence.';
}
