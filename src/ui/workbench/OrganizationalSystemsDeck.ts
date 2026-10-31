import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type { OrganizationalSystemCard } from '../../workbench/organizationalSystemsProjection';
import {
	describeSemanticPath,
	renderFullPath,
	renderSemanticPath,
} from './SemanticPath';
import { describeOrganizationalSystemMarker } from './organizationalSystemMarker';

export interface OrganizationalSystemsDeckOptions {
	onSelectSystem(occurrenceKey: string | null): void;
}

interface DisplayEvidence {
	relation: 'member' | 'support';
	expectedFolderType: string | null;
	path: string;
}

/** Persistent, occurrence-first overview shared by every Workbench surface. */
export class OrganizationalSystemsDeck {
	private snapshot: WorkbenchSessionSnapshot;
	private possibleOpen = false;

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

	revealSelected(): void {
		const selectedKey = this.snapshot.state.selectedSystemInstanceKey;
		if (!selectedKey) return;
		const card = this.snapshot.organizationalSystems.cards.find(
			(candidate) => candidate.occurrenceKey === selectedKey,
		);
		if (card?.status !== 'actionable' && !this.possibleOpen) {
			this.possibleOpen = true;
			this.render();
		}
		requestAnimationFrame(() => {
			const selectedCard = Array.from(
				this.container.querySelectorAll<HTMLElement>('[data-dtf-system-occurrence-key]'),
			).find((element) => element.dataset.dtfSystemOccurrenceKey === selectedKey);
			selectedCard?.scrollIntoView({ block: 'nearest' });
		});
	}

	destroy(): void {
		this.container.empty();
	}

	private render(): void {
		const snapshot = this.snapshot;
		const selectedKey = snapshot.state.selectedSystemInstanceKey;
		const cards = snapshot.organizationalSystems.cards;
		const ready = cards.filter((card) => card.status === 'actionable');
		const possible = cards.filter((card) => card.status !== 'actionable');
		const selected = cards.find((card) => card.occurrenceKey === selectedKey) ?? null;
		if (selected && selected.status !== 'actionable') this.possibleOpen = true;

		this.container.empty();
		this.container.addClass('dtf-organizational-systems');
		this.container.dataset.dtfOrganizationalSystems = '1';

		const headingRow = this.container.createDiv({ cls: 'dtf-orgsys-heading-row' });
		const headingWrap = headingRow.createDiv();
		headingWrap.createEl('h3', { text: 'Organizational systems in this vault' });
		headingWrap.createDiv({
			cls: 'dtf-orgsys-heading-description',
			text: 'Select an organizational system to inspect the folders that identified it. Choose where rules apply in the next step.',
		});

		const summary = this.container.createDiv({ cls: 'dtf-orgsys-summary' });
		summary.setText(
			`${ready.length} ready · ${possible.length} need more folders`,
		);

		this.renderGroup(
			this.container,
			'Ready organizational systems',
			'These occurrences have enough identifying folder evidence to propose rules after you choose where the rules apply.',
			ready,
			selectedKey,
			'ready',
		);

		const possibleGroup = this.container.createEl('details', {
			cls: 'dtf-orgsys-group dtf-orgsys-possible-group',
		});
		possibleGroup.dataset.dtfPossibleSystems = '1';
		possibleGroup.open = this.possibleOpen;
		possibleGroup.addEventListener('toggle', () => {
			this.possibleOpen = possibleGroup.open;
		});
		const possibleSummary = possibleGroup.createEl('summary');
		possibleSummary.createSpan({
			cls: 'dtf-orgsys-group-title',
			text: `Organizational systems needing more folders (${possible.length})`,
		});
		possibleGroup.createDiv({
			cls: 'dtf-orgsys-group-description',
			text: 'These occurrences need more identifying folders or a required parent organizational system. They remain inspect-only and cannot propose rules yet.',
		});
		this.renderCardList(possibleGroup, possible, selectedKey, 'possible');
	}

	private renderGroup(
		parent: HTMLElement,
		title: string,
		description: string,
		cards: readonly OrganizationalSystemCard[],
		selectedKey: string | null,
		kind: 'ready' | 'possible',
	): void {
		const group = parent.createDiv({ cls: `dtf-orgsys-group is-${kind}` });
		group.dataset.dtfSystemGroup = kind;
		group.createDiv({
			cls: 'dtf-orgsys-group-title',
			text: `${title} (${cards.length})`,
		});
		group.createDiv({ cls: 'dtf-orgsys-group-description', text: description });
		this.renderCardList(group, cards, selectedKey, kind);
	}

	private renderCardList(
		parent: HTMLElement,
		cards: readonly OrganizationalSystemCard[],
		selectedKey: string | null,
		kind: 'ready' | 'possible',
	): void {
		const cardList = parent.createEl('ul', { cls: 'dtf-orgsys-card-list' });
		cardList.dataset.dtfSystemGroupList = kind;
		cardList.setAttr(
			'aria-label',
			kind === 'ready' ? 'Ready organizational systems' : 'Possible organizational systems',
		);
		if (cards.length === 0) {
			cardList.createEl('li', {
				cls: 'dtf-orgsys-empty',
				text: kind === 'ready'
					? 'No organizational systems are ready to propose rules.'
					: 'No organizational systems need more folders.',
			});
			return;
		}
		for (const card of cards) {
			this.renderOccurrenceItem(cardList, card, card.occurrenceKey === selectedKey);
		}
	}

	private renderOccurrenceItem(
		parent: HTMLElement,
		card: OrganizationalSystemCard,
		selected: boolean,
	): void {
		const marker = describeOrganizationalSystemMarker(card.occurrenceKey);
		const item = parent.createEl('li', { cls: 'dtf-orgsys-occurrence-item' });
		item.dataset.dtfSystemOccurrenceItem = card.occurrenceKey;
		item.style.setProperty('--dtf-organizational-system-marker-color', marker.colorToken);

		const button = item.createEl('button', { cls: 'dtf-orgsys-card' });
		button.dataset.dtfSystemOccurrenceKey = card.occurrenceKey;
		button.dataset.dtfSystemStatus = card.status;
		button.setAttr('aria-selected', String(selected));
		button.setAttr('aria-pressed', String(selected));
		button.setAttr('aria-label', occurrenceSelectionLabel(card));
		if (selected) button.addClass('is-selected');
		button.addEventListener('click', () => this.options.onSelectSystem(card.occurrenceKey));

		const objectKind = button.createSpan({ cls: 'dtf-workbench-object-kind' });
		const markerElement = objectKind.createSpan({
			cls: 'dtf-orgsys-occurrence-marker',
			text: '●',
		});
		markerElement.dataset.dtfOrganizationalSystemMarker = card.occurrenceKey;
		markerElement.setAttr('aria-hidden', 'true');
		markerElement.style.color = marker.colorToken;
		objectKind.createSpan({
			text: card.status === 'actionable'
				? ' Ready organizational system'
				: ' Possible organizational system',
		});

		const title = button.createSpan({ cls: 'dtf-orgsys-card-title' });
		title.createSpan({ text: card.packName });
		title.createSpan({
			cls: `dtf-orgsys-status is-${card.status}`,
			text: statusLabel(card.status),
		});

		renderSemanticPath(button, card.anchorPath, {
			role: 'system-occurrence-anchor',
			focusLabel: 'Recognized here',
			variant: 'stacked',
		});
		button.createSpan({
			cls: 'dtf-workbench-consequence',
			text: statusConsequence(card),
		});

		if (selected) this.renderEvidenceDisclosure(item, card);
	}

	private renderEvidenceDisclosure(parent: HTMLElement, card: OrganizationalSystemCard): void {
		const evidence = parent.createEl('details', {
			cls: 'dtf-orgsys-evidence-disclosure dtf-orgsys-selected-evidence',
		});
		evidence.dataset.dtfSelectedSystemEvidence = '1';
		evidence.dataset.dtfSystemEvidenceOccurrenceKey = card.occurrenceKey;
		evidence.createEl('summary', {
			text: 'Why Folder Tag Sync recognized this organizational system',
		});
		evidence.createDiv({
			cls: 'dtf-orgsys-shape',
			text: recognitionSummary(card),
		});

		const relations = evidence.createDiv({ cls: 'dtf-orgsys-relations' });
		const displayEvidence = collectDisplayEvidence(card);
		this.renderEvidenceSection(
			relations,
			'Folders that identify this organizational system',
			displayEvidence.filter((item) => item.relation === 'member'),
		);
		this.renderEvidenceSection(
			relations,
			'Additional supporting folders',
			displayEvidence.filter((item) => item.relation === 'support'),
		);
		if (card.missingRoles.length > 0) {
			const missing = relations.createDiv({ cls: 'dtf-orgsys-evidence-section' });
			missing.dataset.dtfEvidenceSection = 'missing';
			missing.createDiv({
				cls: 'dtf-orgsys-evidence-section-title',
				text: 'Folders still needed',
			});
			for (const role of card.missingRoles) {
				this.renderPlainRelation(missing, `Expected folder type: ${role}`, 'missing');
			}
		}
		if (card.parentPackId) {
			const parentSection = relations.createDiv({ cls: 'dtf-orgsys-evidence-section' });
			parentSection.dataset.dtfEvidenceSection = 'parent';
			parentSection.createDiv({
				cls: 'dtf-orgsys-evidence-section-title',
				text: 'Required parent organizational system',
			});
			this.renderPlainRelation(
				parentSection,
				`${card.parentPackId} — ${card.parentOccurrenceKey ? 'found' : 'not found at this location'}`,
				'parent',
			);
		}
		if (card.suppressionReason) {
			this.renderPlainRelation(
				relations,
				'A required parent organizational system is not ready at this location.',
				'suppressed',
			);
		}
		if (relations.childElementCount === 0) {
			relations.createSpan({
				cls: 'dtf-orgsys-detail-empty',
				text: 'No identifying folders are attached to this exact occurrence.',
			});
		}
	}

	private renderEvidenceSection(
		parent: HTMLElement,
		title: string,
		items: readonly DisplayEvidence[],
	): void {
		if (items.length === 0) return;
		const section = parent.createDiv({ cls: 'dtf-orgsys-evidence-section' });
		section.dataset.dtfEvidenceSection = items[0].relation;
		section.createDiv({ cls: 'dtf-orgsys-evidence-section-title', text: title });
		for (const item of items) this.renderEvidenceRow(section, item);
	}

	private renderEvidenceRow(parent: HTMLElement, evidence: DisplayEvidence): void {
		const row = parent.createDiv({ cls: 'dtf-orgsys-evidence-row' });
		row.dataset.dtfRelation = evidence.relation;
		if (evidence.expectedFolderType) {
			row.createDiv({
				cls: 'dtf-orgsys-evidence-role',
				text: `Expected folder type: ${evidence.expectedFolderType}`,
			});
		}
		renderFullPath(row, evidence.path, {
			role: `system-${evidence.relation}-evidence`,
			label: 'Folder found',
		});
	}

	private renderPlainRelation(
		parent: HTMLElement,
		value: string,
		relation: string,
	): void {
		const row = parent.createDiv({ cls: 'dtf-orgsys-evidence-row is-plain' });
		row.dataset.dtfRelation = relation;
		row.createDiv({ cls: 'dtf-orgsys-relation-value', text: value });
	}
}

function collectDisplayEvidence(card: OrganizationalSystemCard): DisplayEvidence[] {
	const byIdentity = new Map<string, DisplayEvidence>();
	for (const evidence of card.evidence) {
		const expectedFolderType = evidence.label?.trim() || evidence.role || null;
		const key = `${evidence.relation.length}:${evidence.relation}:`
			+ `${evidence.role.length}:${evidence.role}:`
			+ evidence.folderPath;
		if (!byIdentity.has(key)) {
			byIdentity.set(key, {
				relation: evidence.relation,
				expectedFolderType,
				path: evidence.folderPath,
			});
		}
	}

	if (byIdentity.size === 0) {
		for (const path of card.memberPaths) {
			byIdentity.set(`member:${path}`, {
				relation: 'member',
				expectedFolderType: null,
				path,
			});
		}
		for (const path of card.supportPaths) {
			byIdentity.set(`support:${path}`, {
				relation: 'support',
				expectedFolderType: null,
				path,
			});
		}
	}
	return [...byIdentity.values()];
}

function recognitionSummary(card: OrganizationalSystemCard): string {
	const evidenceKind = card.countBy === 'roles'
		? 'expected folder types'
		: 'matching folders';
	return `${card.evidenceCount} ${evidenceKind} found; ${card.minEvidence} needed.`;
}

function occurrenceSelectionLabel(card: OrganizationalSystemCard): string {
	const path = describeSemanticPath(card.anchorPath);
	const location = path.context
		? `Recognized here: ${path.focus}. Parent context: ${path.context}.`
		: `Recognized here: ${path.focus}.`;
	return `Inspect ${card.packName} organizational system. ${location} ${statusLabel(card.status)}. `
		+ 'Selection only changes which exact occurrence is inspected; it does not add, enable, or silently choose rules.';
}

function statusLabel(status: OrganizationalSystemCard['status']): string {
	if (status === 'actionable') return 'Ready';
	return 'More folders needed';
}

function statusConsequence(card: OrganizationalSystemCard): string {
	if (card.status === 'actionable') {
		return 'Ready to propose rules after you choose where they apply.';
	}
	if (card.status === 'suppressed') {
		return 'More evidence is needed. Its required parent organizational system was not recognized at this location.';
	}
	const missing = card.missingRoles.length > 0
		? ` Missing expected folder types: ${card.missingRoles.join(', ')}.`
		: '';
	return `More evidence is needed before this organizational system can propose rules.${missing}`;
}
