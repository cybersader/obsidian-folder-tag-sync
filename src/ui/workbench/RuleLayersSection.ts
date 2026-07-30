import type { WorkbenchSessionSnapshot } from '../../workbench/WorkbenchSession';
import type { RuleLayer } from '../../workbench/organizationalSystemsProjection';

/** Persistent installed-rule view grouped by runtime precedence, not claimed ownership. */
export class RuleLayersSection {
	private snapshot: WorkbenchSessionSnapshot;

	constructor(
		private readonly container: HTMLElement,
		snapshot: WorkbenchSessionSnapshot,
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
		this.container.empty();
		this.container.addClass('dtf-rule-layers');
		this.container.dataset.dtfRuleLayers = '1';

		const disclosure = this.container.createEl('details', { cls: 'dtf-rule-layers-disclosure' });
		disclosure.dataset.dtfRuleLayersDisclosure = '1';
		const summary = disclosure.createEl('summary', { cls: 'dtf-rule-layers-summary' });
		summary.createSpan({ text: 'Installed rule layers' });
		const layerCount = this.snapshot.organizationalSystems.ruleLayers.length;
		summary.createSpan({
			cls: 'dtf-rule-layers-summary-count',
			text: `${layerCount} layer${layerCount === 1 ? '' : 's'}`,
		});

		const body = disclosure.createDiv({ cls: 'dtf-rule-layers-body' });
		body.createDiv({
			cls: 'dtf-rule-layers-description',
			text: 'These are installed runtime precedence groups, not detected systems. Higher listed precedence is evaluated first. Any system link shown here is only a current inference.',
		});
		const layers = body.createDiv({ cls: 'dtf-rule-layer-list' });
		if (layerCount === 0) {
			layers.createDiv({
				cls: 'dtf-rule-layer-empty',
				text: 'No installed rule layers.',
			});
			return;
		}

		for (const layer of this.snapshot.organizationalSystems.ruleLayers) {
			this.renderLayer(layers, layer);
		}
	}

	private renderLayer(parent: HTMLElement, layer: RuleLayer): void {
		const selectedKey = this.snapshot.state.selectedSystemInstanceKey;
		const associated = selectedKey !== null
			&& layer.association.certainty === 'inferred'
			&& layer.association.occurrenceKeys.includes(selectedKey);
		const enabledCount = layer.rules.filter((rule) => rule.enabled).length;
		const disabledCount = layer.rules.length - enabledCount;

		const card = parent.createDiv({ cls: 'dtf-rule-layer-card' });
		card.dataset.dtfRuleLayerKey = layer.key;
		if (associated) card.addClass('is-associated');
		card.createDiv({
			cls: 'dtf-workbench-object-kind',
			text: 'Runtime layer',
		});

		const title = card.createDiv({ cls: 'dtf-rule-layer-title' });
		title.createSpan({ text: layer.label });
		if (layer.precedenceIndex !== null) {
			title.createSpan({
				cls: 'dtf-rule-layer-rank',
				text: `Precedence ${layer.precedenceIndex + 1}`,
			});
		}

		card.createDiv({
			cls: 'dtf-rule-layer-counts',
			text: `${layer.rules.length} installed rule${layer.rules.length === 1 ? '' : 's'} · `
				+ `${enabledCount} enabled · ${disabledCount} disabled`,
		});

		const association = card.createDiv({ cls: 'dtf-rule-layer-association' });
		if (layer.association.certainty === 'inferred') {
			association.dataset.dtfRuleAssociation = 'inferred';
			association.createDiv({
				cls: 'dtf-rule-layer-association-label',
				text: 'Possible system link — inferred',
			});
			association.createDiv({
				text: associated
					? 'This layer may relate to the selected system because their current rule-group identities match. No deployment ownership is recorded.'
					: `Current rule-group identities suggest ${layer.association.occurrenceKeys.length} possible system occurrence link${layer.association.occurrenceKeys.length === 1 ? '' : 's'}. No deployment ownership is recorded.`,
			});
		} else {
			association.dataset.dtfRuleAssociation = 'unknown';
			association.createDiv({
				cls: 'dtf-rule-layer-association-label',
				text: 'No system link recorded',
			});
			association.createDiv({
				text: 'Installed rules do not yet store durable occurrence provenance.',
			});
		}
	}
}
