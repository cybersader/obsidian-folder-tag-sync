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

		const heading = this.container.createDiv({ cls: 'dtf-rule-layers-heading' });
		heading.createEl('h3', { text: 'Rule layers' });
		heading.createDiv({
			text: 'Installed rules grouped by runtime precedence. Links to organizational systems are current-snapshot inferences, not ownership.',
		});

		const layers = this.container.createDiv({ cls: 'dtf-rule-layer-list' });
		if (this.snapshot.organizationalSystems.ruleLayers.length === 0) {
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
			text: `${layer.rules.length} rule${layer.rules.length === 1 ? '' : 's'} · `
				+ `${enabledCount} enabled · ${disabledCount} disabled`,
		});

		const association = card.createDiv({ cls: 'dtf-rule-layer-association' });
		if (layer.association.certainty === 'inferred') {
			association.dataset.dtfRuleAssociation = 'inferred';
			association.setText(
				associated
					? 'Inferred association with the selected system'
					: `Inferred association with ${layer.association.occurrenceKeys.length} system occurrence${layer.association.occurrenceKeys.length === 1 ? '' : 's'}`,
			);
		} else {
			association.dataset.dtfRuleAssociation = 'unknown';
			association.setText('System association unknown — no durable provenance');
		}
	}
}
