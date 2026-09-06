import {
	ItemView,
	Notice,
	setIcon,
	type ViewStateResult,
	WorkspaceLeaf,
} from 'obsidian';
import {
	sortCandidatesByConflict,
	sortCandidatesByNoise,
} from '../engine/scanAndSnapPlan';
import {
	isWorkbenchSessionCancelledError,
	WorkbenchSession,
	type WorkbenchSessionSnapshot,
} from '../workbench/WorkbenchSession';
import { buildOrganizationalSystemsProjection } from '../workbench/organizationalSystemsProjection';
import {
	createDefaultWorkbenchState,
	reduceWorkbenchRoute,
	resolveSelectedCandidateKeys,
	validateWorkbenchState,
	type WorkbenchCandidateState,
	type WorkbenchRoute,
	type WorkbenchState,
	type WorkbenchSurface,
} from '../workbench/workbenchState';
import type DynamicTagsFoldersPlugin from '../main';
import { OrganizationalSystemsDeck } from './workbench/OrganizationalSystemsDeck';
import { RuleLayersSection } from './workbench/RuleLayersSection';
import { renderSemanticPath } from './workbench/SemanticPath';
import { WorkbenchCandidatePanel } from './workbench/WorkbenchCandidatePanel';
import { WorkbenchMapPanel } from './workbench/WorkbenchMapPanel';
import { WorkbenchOutlinePanel } from './workbench/WorkbenchOutlinePanel';
import { describeOrganizationalSystemMarker } from './workbench/organizationalSystemMarker';
import {
	createDefaultWorkbenchMapPresentationState,
	type WorkbenchMapPresentationState,
} from './workbench/workbenchMapPresentation';
import { WorkbenchScopePanel } from './workbench/WorkbenchScopePanel';
import {
	createDefaultWorkbenchScopePresentationState,
	type WorkbenchScopePresentationState,
} from './workbench/workbenchScopePresentation';
import {
	classifyWorkbenchLayout,
	type WorkbenchLayout,
} from './workbench/workbenchLayout';

export const TAXONOMY_WORKBENCH_VIEW = 'taxonomy-workbench-map';

type ActiveWorkbenchPanel =
	| WorkbenchMapPanel
	| WorkbenchScopePanel
	| WorkbenchCandidatePanel
	| WorkbenchOutlinePanel;

/** Persistent ItemView shell for the Map, Scope, and Candidates surfaces. */
export class TaxonomyWorkbenchView extends ItemView {
	private readonly plugin: DynamicTagsFoldersPlugin;
	private state: WorkbenchState = freezeWorkbenchState(createDefaultWorkbenchState());
	private mapPresentationState: WorkbenchMapPresentationState =
		createDefaultWorkbenchMapPresentationState();
	private scopePresentationState: WorkbenchScopePresentationState =
		createDefaultWorkbenchScopePresentationState();
	private snapshot: WorkbenchSessionSnapshot | null = null;
	private activePanel: ActiveWorkbenchPanel | null = null;
	private activePanelSurface: WorkbenchSurface | null = null;
	private navigationEl: HTMLElement | null = null;
	private statusEl: HTMLElement | null = null;
	private headerEl: HTMLElement | null = null;
	private systemsSummaryEl: HTMLElement | null = null;
	private systemsToggleEl: HTMLButtonElement | null = null;
	private systemsBrowserEl: HTMLElement | null = null;
	private systemsScrimEl: HTMLButtonElement | null = null;
	private bodyEl: HTMLElement | null = null;
	private deckEl: HTMLElement | null = null;
	private panelEl: HTMLElement | null = null;
	private systemsDeck: OrganizationalSystemsDeck | null = null;
	private ruleLayersSection: RuleLayersSection | null = null;
	private layoutObserver: ResizeObserver | null = null;
	private layout: WorkbenchLayout = classifyWorkbenchLayout({
		bodyWidth: 0,
		bodyHeight: 0,
		panelWidth: 0,
		panelHeight: 0,
	});
	private layoutInitialized = false;
	private systemsBrowserOpen = false;
	private collectionGeneration = 0;
	private opened = false;
	private scanning = false;
	private snapshotStale = false;
	private collectionError: string | null = null;
	private sourceUnsubscribe: (() => void) | null = null;
	private refreshTimer: ReturnType<typeof setTimeout> | null = null;

	constructor(leaf: WorkspaceLeaf, plugin: DynamicTagsFoldersPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return TAXONOMY_WORKBENCH_VIEW;
	}

	getDisplayText(): string {
		return 'Taxonomy Workbench';
	}

	getIcon(): string {
		return 'layers';
	}

	getState(): Record<string, unknown> {
		return cloneWorkbenchState(this.state) as unknown as Record<string, unknown>;
	}

	async setState(state: unknown, result: ViewStateResult): Promise<void> {
		const next = freezeWorkbenchState(validateWorkbenchState(state));
		const previous = this.state;
		result.history = !sameWorkbenchState(previous, next);
		this.setLocalState(next);

		if (!this.opened) return;
		this.renderNavigation();

		if (this.shouldCollectForStateChange(previous, next)) {
			this.destroyActivePanel();
			this.panelEl?.empty();
			await this.collectSnapshot();
			return;
		}

		this.updateSnapshotState(next, previous.candidates.sort !== next.candidates.sort);
		this.renderActivePanel();
	}

	/** Merge an external route into state and recollect current vault/settings data. */
	async applyRoute(route: WorkbenchRoute): Promise<void> {
		const previous = this.state;
		const next = freezeWorkbenchState(reduceWorkbenchRoute(previous, route));
		this.setLocalState(next);

		if (!this.opened) return;
		this.renderNavigation();
		if (previous.surface !== next.surface) {
			this.destroyActivePanel();
			this.panelEl?.empty();
		}

		// Commands and Settings links are explicit requests to open/scan the live
		// Workbench. Always recollect so a reused leaf cannot show stale folders,
		// enabled-rule coverage, conflicts, or detections from its prior snapshot.
		await this.collectSnapshot();
	}

	protected async onOpen(): Promise<void> {
		this.opened = true;
		this.sourceUnsubscribe = this.plugin.subscribeWorkbenchSourceChanges((revision) => {
			this.handleSourceRevisionChange(revision);
		});
		this.buildShell();
		await this.collectSnapshot();
	}

	protected async onClose(): Promise<void> {
		this.opened = false;
		this.collectionGeneration++;
		this.scanning = false;
		this.snapshotStale = false;
		this.sourceUnsubscribe?.();
		this.sourceUnsubscribe = null;
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		this.destroyActivePanel();
		this.destroyPersistentDeck();
		this.layoutObserver?.disconnect();
		this.layoutObserver = null;
		this.snapshot = null;
		this.mapPresentationState = createDefaultWorkbenchMapPresentationState();
		this.scopePresentationState = createDefaultWorkbenchScopePresentationState();
		this.navigationEl = null;
		this.statusEl = null;
		this.systemsSummaryEl = null;
		this.systemsToggleEl = null;
		this.systemsBrowserEl = null;
		this.systemsScrimEl = null;
		this.bodyEl = null;
		this.deckEl = null;
		this.panelEl = null;
		this.systemsBrowserOpen = false;
		this.layoutInitialized = false;
		this.layout = classifyWorkbenchLayout({
			bodyWidth: 0,
			bodyHeight: 0,
			panelWidth: 0,
			panelHeight: 0,
		});
		this.contentEl.empty();
		this.contentEl.removeClass('dtf-workbench-shell');
		this.contentEl.removeClass('is-workbench-spacious');
		this.contentEl.removeClass('is-workbench-compact');
		this.contentEl.removeClass('is-workbench-tight');
	}

	private buildShell(): void {
		const root = this.contentEl;
		root.empty();
		root.addClass('dtf-workbench-shell');
		root.dataset.dtfWorkbenchShell = '1';
		root.style.display = 'flex';
		root.style.flexDirection = 'column';
		root.style.height = '100%';
		root.style.minHeight = '0';
		root.style.padding = '0.6em 0.8em';
		root.style.gap = '0.55em';

		const header = root.createDiv({ cls: 'dtf-workbench-header' });
		this.headerEl = header;
		header.style.display = 'flex';
		header.style.alignItems = 'center';
		header.style.justifyContent = 'space-between';
		header.style.gap = '0.6em';
		header.style.flexWrap = 'wrap';
		header.style.flex = '0 0 auto';

		const title = header.createEl('h2', { text: 'Taxonomy Workbench' });
		title.style.margin = '0';
		title.style.fontSize = '1.15em';

		this.navigationEl = header.createDiv();
		this.navigationEl.dataset.dtfWorkbenchSurfaceNav = '1';
		this.navigationEl.setAttr('role', 'tablist');
		this.navigationEl.setAttr('aria-label', 'Taxonomy Workbench surfaces');
		this.navigationEl.style.display = 'flex';
		this.navigationEl.style.alignItems = 'center';
		this.navigationEl.style.gap = '0.35em';
		this.navigationEl.style.flexWrap = 'wrap';
		this.renderNavigation();

		this.statusEl = root.createDiv();
		this.statusEl.style.flex = '0 0 auto';
		this.statusEl.setAttr('aria-live', 'polite');
		this.renderStatus();
		this.placeStatus();

		this.systemsSummaryEl = root.createDiv({ cls: 'dtf-workbench-systems-summary' });
		this.systemsSummaryEl.dataset.dtfSystemsSummary = '1';
		this.renderSystemsSummary();

		const body = root.createDiv({ cls: 'dtf-workbench-body' });
		body.dataset.dtfWorkbenchBody = '1';
		this.bodyEl = body;

		this.systemsScrimEl = body.createEl('button', {
			cls: 'dtf-workbench-systems-scrim',
			attr: { 'aria-label': 'Close organizational systems browser' },
		});
		this.systemsScrimEl.addEventListener('click', () => this.setSystemsBrowserOpen(false));

		this.systemsBrowserEl = body.createDiv({ cls: 'dtf-workbench-systems-browser' });
		this.systemsBrowserEl.id = 'dtf-workbench-systems-browser';
		this.systemsBrowserEl.dataset.dtfSystemsBrowser = '1';
		const browserToolbar = this.systemsBrowserEl.createDiv({ cls: 'dtf-systems-browser-toolbar' });
		browserToolbar.createDiv({ text: 'Organizational systems' });
		const closeBrowser = browserToolbar.createEl('button', { text: 'Close' });
		closeBrowser.dataset.dtfSystemsBrowserClose = '1';
		closeBrowser.setAttr('aria-label', 'Close organizational systems browser');
		closeBrowser.addEventListener('click', () => this.setSystemsBrowserOpen(false));
		this.systemsBrowserEl.addEventListener('keydown', (event) => {
			if (!this.systemsBrowserOpen) return;
			if (event.key === 'Escape') {
				event.preventDefault();
				this.setSystemsBrowserOpen(false);
				return;
			}
			if (event.key === 'Tab' && this.layout.systemsBrowser === 'overlay') {
				this.trapSystemsBrowserFocus(event);
			}
		});

		this.deckEl = this.systemsBrowserEl.createDiv({ cls: 'dtf-workbench-persistent-deck' });
		this.deckEl.dataset.dtfWorkbenchPersistentDeck = '1';

		const panel = body.createDiv({ cls: 'dtf-workbench-active-panel' });
		this.panelEl = panel;
		panel.id = 'dtf-workbench-active-panel';
		panel.setAttr('role', 'tabpanel');
		panel.dataset.dtfWorkbenchCurrentSurface = this.state.surface;

		this.layoutObserver = new ResizeObserver(() => {
			this.updateWorkbenchLayout();
		});
		this.layoutObserver.observe(root);
		this.layoutObserver.observe(body);
		this.layoutObserver.observe(panel);
		this.updateWorkbenchLayout();
		requestAnimationFrame(() => this.updateWorkbenchLayout());
	}

	private updateWorkbenchLayout(): void {
		const body = this.bodyEl;
		const panel = this.panelEl;
		if (!body || !panel) return;

		const next = classifyWorkbenchLayout({
			bodyWidth: body.clientWidth,
			bodyHeight: body.clientHeight,
			panelWidth: panel.clientWidth,
			panelHeight: panel.clientHeight,
		});
		this.layout = next;
		this.contentEl.dataset.dtfWorkbenchDensity = next.density;
		this.contentEl.dataset.dtfSystemsBrowserMode = next.systemsBrowser;
		this.contentEl.dataset.dtfFolderInspectorMode = next.folderInspector;
		this.contentEl.toggleClass('is-workbench-spacious', next.density === 'spacious');
		this.contentEl.toggleClass('is-workbench-compact', next.density === 'compact');
		this.contentEl.toggleClass('is-workbench-tight', next.density === 'tight');

		const hasUsableMeasurements = body.clientWidth > 0
			&& body.clientHeight > 0
			&& panel.clientWidth > 0
			&& panel.clientHeight > 0;
		if (!this.layoutInitialized && hasUsableMeasurements) {
			this.layoutInitialized = true;
			this.systemsBrowserOpen = next.systemsBrowser === 'side';
		}
		this.updateSystemsBrowserState();
	}

	private renderSystemsSummary(): void {
		const summary = this.systemsSummaryEl;
		if (!summary) return;
		summary.empty();

		if (this.isPrototypeSurface()) {
			summary.setAttr('aria-hidden', 'true');
			this.systemsToggleEl = null;
			// The drawer must not keep the panel inert while it is hidden.
			this.systemsBrowserOpen = false;
			this.updateSystemsBrowserState();
			return;
		}
		summary.removeAttribute('aria-hidden');

		const snapshot = this.snapshot;
		const selected = snapshot?.organizationalSystems.cards.find((card) =>
			card.occurrenceKey === this.state.selectedSystemInstanceKey) ?? null;

		this.systemsToggleEl = summary.createEl('button', {
			cls: 'dtf-systems-sidebar-toggle clickable-icon',
		});
		this.systemsToggleEl.dataset.dtfSystemsBrowserToggle = '1';
		this.systemsToggleEl.setAttr('aria-controls', 'dtf-workbench-systems-browser');
		this.systemsToggleEl.disabled = snapshot === null;
		this.systemsToggleEl.addEventListener('click', () => {
			this.setSystemsBrowserOpen(!this.systemsBrowserOpen);
		});

		const identity = summary.createDiv({ cls: 'dtf-systems-summary-identity' });
		identity.createSpan({ cls: 'dtf-systems-summary-label', text: 'Organizational systems' });
		if (!snapshot) {
			identity.createSpan({ cls: 'dtf-systems-summary-detail', text: 'Collecting…' });
		} else {
			const possibleCount = snapshot.occurrenceStats.incompleteCount
				+ snapshot.occurrenceStats.suppressedCount;
			identity.createSpan({
				cls: 'dtf-systems-summary-counts',
				text: `${snapshot.occurrenceStats.actionableCount} ready · ${possibleCount} possible`,
			});
			const detail = identity.createDiv({ cls: 'dtf-systems-summary-detail' });
			if (selected) {
				detail.dataset.dtfSelectedSystemSummary = '1';
				const marker = describeOrganizationalSystemMarker(selected.occurrenceKey);
				const markerEl = detail.createSpan({ cls: 'dtf-organizational-system-marker' });
				markerEl.dataset.dtfOrganizationalSystemMarker = selected.occurrenceKey;
				markerEl.style.setProperty('--dtf-organizational-system-marker-color', marker.colorToken);
				markerEl.setAttr('aria-hidden', 'true');
				detail.createSpan({
					cls: 'dtf-workbench-object-kind',
					text: 'Focused organizational system',
				});
				detail.createSpan({ cls: 'dtf-systems-summary-name', text: selected.packName });
				detail.createSpan({
					cls: `dtf-orgsys-status is-${selected.status}`,
					text: selected.status === 'actionable' ? 'Ready' : 'More folders needed',
				});
				renderSemanticPath(detail, selected.anchorPath, {
					role: 'summary-selected-system-anchor',
					focusLabel: 'Recognized here',
					variant: 'compact',
				});
			} else {
				detail.setText(
					'Choose a ready organizational system to start, or inspect the folder tree first.',
				);
			}
		}

		this.updateSystemsBrowserState();
	}

	private setSystemsBrowserOpen(open: boolean): void {
		if (this.systemsBrowserOpen === open) return;
		this.systemsBrowserOpen = open;
		this.updateSystemsBrowserState();
		if (open) {
			this.systemsDeck?.revealSelected();
			requestAnimationFrame(() => {
				const selected = this.systemsBrowserEl
					?.querySelector<HTMLElement>('[data-dtf-system-occurrence-key][aria-selected="true"]');
				(selected ?? this.systemsBrowserEl
					?.querySelector<HTMLElement>('.dtf-systems-browser-toolbar button'))
					?.focus({ preventScroll: true });
			});
		} else {
			requestAnimationFrame(() => this.systemsToggleEl?.focus());
		}
	}

	private updateSystemsBrowserState(): void {
		const open = this.systemsBrowserOpen;
		const overlay = this.layout.systemsBrowser === 'overlay';
		const overlayOpen = open && overlay;
		if (open) this.contentEl.addClass('is-systems-browser-open');
		else this.contentEl.removeClass('is-systems-browser-open');

		this.systemsBrowserEl?.toggleClass('is-open', open);
		this.systemsBrowserEl?.setAttr('aria-hidden', String(!open));
		if (this.systemsBrowserEl) {
			if (open) this.systemsBrowserEl.removeAttribute('inert');
			else this.systemsBrowserEl.setAttribute('inert', '');
			if (overlayOpen) {
				this.systemsBrowserEl.setAttr('role', 'dialog');
				this.systemsBrowserEl.setAttr('aria-modal', 'true');
				this.systemsBrowserEl.setAttr('aria-label', 'Organizational systems');
			} else {
				this.systemsBrowserEl.removeAttribute('role');
				this.systemsBrowserEl.removeAttribute('aria-modal');
				this.systemsBrowserEl.removeAttribute('aria-label');
			}
		}
		this.systemsToggleEl?.setAttr('aria-expanded', String(open));
		if (this.systemsToggleEl) {
			const label = overlay
				? `${open ? 'Close' : 'Open'} organizational systems drawer`
				: `${open ? 'Hide' : 'Show'} organizational systems sidebar`;
			this.systemsToggleEl.setAttr('aria-label', label);
			this.systemsToggleEl.setAttr('title', label);
			setIcon(this.systemsToggleEl, open ? 'panel-left-close' : 'panel-left');
		}
		this.systemsScrimEl?.setAttr('aria-hidden', String(!overlayOpen));
		if (this.systemsScrimEl) this.systemsScrimEl.tabIndex = overlayOpen ? 0 : -1;
		if (this.panelEl) {
			if (overlayOpen) {
				this.panelEl.setAttribute('inert', '');
				this.panelEl.setAttr('aria-hidden', 'true');
			} else {
				this.panelEl.removeAttribute('inert');
				this.panelEl.removeAttribute('aria-hidden');
			}
		}
	}

	private trapSystemsBrowserFocus(event: KeyboardEvent): void {
		const browser = this.systemsBrowserEl;
		if (!browser) return;
		const focusable = Array.from(browser.querySelectorAll<HTMLElement>(
			'button:not([disabled]), details > summary, [href], [tabindex]:not([tabindex="-1"])',
		)).filter((element) => element.offsetParent !== null);
		if (focusable.length === 0) return;
		const first = focusable[0];
		const last = focusable[focusable.length - 1];
		if (event.shiftKey && document.activeElement === first) {
			event.preventDefault();
			last.focus();
		} else if (!event.shiftKey && document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	}

	/** The hidden outline prototype owns the whole pane: no tabs, no deck. */
	private isPrototypeSurface(): boolean {
		return this.state.surface === 'outline';
	}

	/**
	 * The outline prototype collapses the title and the status line into one
	 * header row; every other surface keeps the status on its own line.
	 */
	private placeStatus(): void {
		const status = this.statusEl;
		const header = this.headerEl;
		if (!status || !header) return;
		if (this.isPrototypeSurface()) {
			if (status.parentElement !== header) header.appendChild(status);
			return;
		}
		if (status.parentElement === header) header.after(status);
	}

	private renderNavigation(): void {
		const navigation = this.navigationEl;
		if (!navigation) return;
		navigation.empty();
		this.contentEl.dataset.dtfWorkbenchCurrentSurface = this.state.surface;
		this.contentEl.toggleClass('is-workbench-prototype', this.isPrototypeSurface());
		this.placeStatus();
		if (this.panelEl) {
			this.panelEl.dataset.dtfWorkbenchCurrentSurface = this.state.surface;
			this.panelEl.setAttr('aria-labelledby', `dtf-workbench-tab-${this.state.surface}`);
		}
		if (this.isPrototypeSurface()) {
			navigation.setAttr('aria-hidden', 'true');
			return;
		}
		navigation.removeAttribute('aria-hidden');

		const surfaces: Array<{
			surface: WorkbenchSurface;
			label: string;
			shortLabel: string;
		}> = [
			{ surface: 'map', label: 'Explore your vault', shortLabel: 'Explore' },
			{ surface: 'scope', label: 'Choose where rules apply', shortLabel: 'Choose' },
			{ surface: 'candidates', label: 'Review proposed rules', shortLabel: 'Review' },
		];
		for (const [index, { surface, label, shortLabel }] of surfaces.entries()) {
			const button = navigation.createEl('button');
			button.createSpan({ cls: 'dtf-workbench-job-label-full', text: label });
			button.createSpan({ cls: 'dtf-workbench-job-label-short', text: shortLabel });
			button.setAttr('aria-label', label);
			const active = this.state.surface === surface;
			button.id = `dtf-workbench-tab-${surface}`;
			button.dataset.dtfWorkbenchSurfaceButton = surface;
			button.setAttr('role', 'tab');
			button.setAttr('aria-controls', 'dtf-workbench-active-panel');
			button.setAttr('aria-selected', String(active));
			button.tabIndex = active ? 0 : -1;
			if (active) {
				button.dataset.dtfWorkbenchActiveSurface = '1';
				button.addClass('mod-cta');
			}
			button.addEventListener('click', () => {
				void this.navigateToSurface(surface);
			});
			button.addEventListener('keydown', (event) => {
				if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
				event.preventDefault();
				const targetIndex = event.key === 'Home'
					? 0
					: event.key === 'End'
						? surfaces.length - 1
						: (index + (event.key === 'ArrowRight' ? 1 : -1) + surfaces.length)
							% surfaces.length;
				const target = surfaces[targetIndex].surface;
				void this.navigateToSurface(target).then(() => {
					this.navigationEl
						?.querySelector<HTMLElement>(`[data-dtf-workbench-surface-button="${target}"]`)
						?.focus();
				});
			});
		}
	}

	private renderStatus(): void {
		const status = this.statusEl;
		if (!status) return;
		status.empty();

		if (this.scanning) {
			status.removeAttribute('role');
			status.dataset.dtfWorkbenchStatus = 'scanning';
			status.style.display = 'block';
			status.style.padding = '0.45em 0.65em';
			status.style.borderRadius = '6px';
			status.style.background = 'var(--background-secondary)';
			status.style.color = 'var(--text-muted)';
			status.setText('Scanning the vault and collecting workbench data…');
			return;
		}

		if (this.collectionError) {
			status.setAttr('role', 'alert');
			status.dataset.dtfWorkbenchStatus = 'error';
			status.style.display = 'flex';
			status.style.alignItems = 'center';
			status.style.justifyContent = 'space-between';
			status.style.gap = '0.5em';
			status.style.flexWrap = 'wrap';
			status.style.padding = '0.55em 0.7em';
			status.style.borderRadius = '6px';
			status.style.background = 'rgba(200, 60, 60, 0.12)';
			status.style.border = '1px solid rgba(200, 60, 60, 0.4)';
			status.style.color = 'var(--text-error, rgb(190, 50, 50))';
			status.createDiv({ text: `Workbench collection failed: ${this.collectionError}` });
			const retry = status.createEl('button', { text: 'Retry' });
			retry.addEventListener('click', () => {
				void this.collectSnapshot();
			});
			return;
		}

		if (this.snapshotStale) {
			status.removeAttribute('role');
			status.dataset.dtfWorkbenchStatus = 'stale';
			status.style.display = 'block';
			status.style.padding = '0.45em 0.65em';
			status.style.borderRadius = '6px';
			status.style.background = 'var(--background-secondary)';
			status.style.color = 'var(--text-muted)';
			status.setText('Vault folders or rule settings changed. Refreshing the workbench…');
			return;
		}

		status.removeAttribute('role');
		status.dataset.dtfWorkbenchStatus = 'ready';
		status.style.display = 'none';
	}

	private async navigateToSurface(surface: WorkbenchSurface): Promise<void> {
		if (surface === this.state.surface) return;
		const next = freezeWorkbenchState({ ...cloneWorkbenchState(this.state), surface });
		this.setLocalState(next);
		this.renderNavigation();

		if (surface === 'candidates') {
			this.destroyActivePanel();
			this.panelEl?.empty();
			await this.collectSnapshot();
			return;
		}

		this.updateSnapshotState(next);
		this.renderActivePanel();
	}

	private handleSourceRevisionChange(revision: number): void {
		if (!this.opened || !this.snapshot || revision === this.snapshot.sourceRevision) return;
		this.snapshotStale = true;
		this.renderStatus();
		this.renderActivePanel();
		this.scheduleSourceRefresh();
	}

	private scheduleSourceRefresh(): void {
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = setTimeout(() => {
			this.refreshTimer = null;
			if (this.opened) void this.collectSnapshot();
		}, 300);
	}

	private async collectSnapshot(): Promise<void> {
		if (!this.opened) return;
		if (this.refreshTimer !== null) clearTimeout(this.refreshTimer);
		this.refreshTimer = null;
		const generation = ++this.collectionGeneration;
		this.scanning = true;
		this.collectionError = null;
		this.renderStatus();

		const session = new WorkbenchSession({
			root: this.app.vault.getRoot(),
			settings: this.plugin.settings,
			sourceRevision: this.plugin.getWorkbenchSourceRevision(),
		});

		try {
			const snapshot = await session.collect(this.state, {
				isCancelled: () => !this.opened || generation !== this.collectionGeneration,
			});
			if (!this.opened || generation !== this.collectionGeneration) return;
			this.snapshot = snapshot;
			this.state = freezeWorkbenchState(snapshot.state);
			this.scanning = false;
			this.snapshotStale = snapshot.sourceRevision
				!== this.plugin.getWorkbenchSourceRevision();
			this.collectionError = null;
			this.renderNavigation();
			this.renderStatus();
			this.renderPersistentDeck();
			this.renderActivePanel();
			if (this.snapshotStale) this.scheduleSourceRefresh();
		} catch (error) {
			if (isWorkbenchSessionCancelledError(error)
				|| !this.opened
				|| generation !== this.collectionGeneration) return;
			this.scanning = false;
			this.collectionError = errorMessage(error);
			this.renderStatus();
			await this.plugin.debugLogger.error('Taxonomy Workbench collection failed', {
				surface: this.state.surface,
				error: this.collectionError,
			});
		}
	}

	private renderPersistentDeck(): void {
		this.renderSystemsSummary();
		const container = this.deckEl;
		const snapshot = this.snapshot;
		if (!container || !snapshot || this.isPrototypeSurface()) return;

		if (this.systemsDeck && this.ruleLayersSection) {
			this.systemsDeck.update(snapshot);
			this.ruleLayersSection.update(snapshot);
			return;
		}

		container.empty();
		const systemsEl = container.createDiv();
		const layersEl = container.createDiv();
		this.systemsDeck = new OrganizationalSystemsDeck(systemsEl, snapshot, {
			onSelectSystem: (occurrenceKey) => this.selectSystemInstance(occurrenceKey),
		});
		this.ruleLayersSection = new RuleLayersSection(layersEl, snapshot);
	}

	private renderActivePanel(): void {
		const container = this.panelEl;
		const snapshot = this.snapshot;
		if (!container || !snapshot) return;

		if (this.activePanel && this.activePanelSurface !== this.state.surface) {
			this.destroyActivePanel();
		}

		if (this.activePanelSurface === 'map'
			&& this.activePanel instanceof WorkbenchMapPanel) {
			this.activePanel.update(snapshot);
			return;
		}
		if (this.activePanelSurface === 'scope'
			&& this.activePanel instanceof WorkbenchScopePanel) {
			this.activePanel.update(
				snapshot,
				this.state.scope,
				this.scopePresentationState,
			);
			return;
		}
		if (this.activePanelSurface === 'candidates'
			&& this.activePanel instanceof WorkbenchCandidatePanel) {
			this.activePanel.update(snapshot);
			return;
		}
		if (this.activePanelSurface === 'outline'
			&& this.activePanel instanceof WorkbenchOutlinePanel) {
			this.activePanel.update(snapshot, this.state.scope);
			return;
		}

		container.empty();
		this.activePanelSurface = this.state.surface;
		if (this.state.surface === 'map') {
			this.activePanel = new WorkbenchMapPanel(container, {
				onStateChange: (state) => this.acceptPanelState(state),
				onRefresh: () => this.collectSnapshot(),
				onOpenSettings: (ruleId) => this.openPluginSettings(ruleId),
				onChooseBranchInScope: (path) => this.chooseBranchInScope(path),
				onOpenSystemsBrowser: () => this.setSystemsBrowserOpen(true),
				onSelectSystem: (occurrenceKey) => this.selectSystemInstance(occurrenceKey),
				onOpenSystemOccurrence: (occurrenceKey) => {
					this.openSystemOccurrence(occurrenceKey);
				},
				onPresentationStateChange: (presentationState) => {
					this.mapPresentationState = presentationState;
				},
			}, this.mapPresentationState);
			this.activePanel.render(snapshot);
			return;
		}

		if (this.state.surface === 'scope') {
			this.activePanel = new WorkbenchScopePanel(container, {
				snapshot,
				scope: this.state.scope,
				presentationState: this.scopePresentationState,
				onSelectedPathsChange: (selectedPaths) => {
					this.acceptScopeState({ ...this.state.scope, selectedPaths });
				},
				onSignalFilterChange: (signalFilter) => {
					this.acceptScopeState({ ...this.state.scope, signalFilter });
				},
				onRouteToCandidates: () => {
					void this.draftScopeCandidates();
				},
				onRefresh: () => {
					void this.collectSnapshot();
				},
				onSelectSystem: (occurrenceKey) => this.selectSystemInstance(occurrenceKey),
				onPresentationStateChange: (presentationState) => {
					this.scopePresentationState = presentationState;
				},
			});
			return;
		}

		// The hidden annotated-outline prototype. Checked before the Candidates
		// fallback and deliberately absent from the visible surface navigation.
		if (this.state.surface === 'outline') {
			this.activePanel = new WorkbenchOutlinePanel(container, {
				snapshot,
				scope: this.state.scope,
				onSelectedPathsChange: (selectedPaths) => {
					this.acceptScopeState({ ...this.state.scope, selectedPaths });
					void this.collectSnapshot();
				},
			});
			return;
		}

		this.activePanel = new WorkbenchCandidatePanel(container, {
			snapshot,
			onInstall: async (selectedRules) => {
				if (this.snapshotStale
					|| this.snapshot?.sourceRevision
						!== this.plugin.getWorkbenchSourceRevision()) {
					await this.collectSnapshot();
					throw new Error('Proposed rules were refreshed because the vault or rule settings changed. Review the updated plan before saving.');
				}
				const result = await this.plugin.installWorkbenchRules(selectedRules);
				await this.collectSnapshot();
				return result;
			},
			onCandidateStateChange: (candidateState) => {
				this.acceptCandidateState(candidateState);
			},
			onEditScope: () => this.navigateToSurface('scope'),
			onRefresh: () => this.collectSnapshot(),
			onReviewAddedRule: (ruleId) => this.openPluginSettings(ruleId),
			onReviewInstalledRule: (ruleId) => this.openPluginSettings(ruleId),
			onSelectSystem: (occurrenceKey) => this.selectSystemInstance(occurrenceKey),
			isSnapshotStale: () => this.snapshotStale,
		});
	}

	private selectSystemInstance(occurrenceKey: string | null): void {
		const preserveBrowserFocus = this.systemsBrowserEl?.contains(document.activeElement) ?? false;
		const next = freezeWorkbenchState({
			...cloneWorkbenchState(this.state),
			selectedSystemInstanceKey: occurrenceKey,
		});
		this.setLocalState(next);
		this.updateSnapshotState(next);
		this.renderActivePanel();
		if (preserveBrowserFocus && occurrenceKey) {
			requestAnimationFrame(() => {
				this.systemsDeck?.revealSelected();
				this.findSystemOccurrenceButton(occurrenceKey)?.focus({ preventScroll: true });
			});
		}
	}

	private openSystemOccurrence(occurrenceKey: string): void {
		this.selectSystemInstance(occurrenceKey);
		this.setSystemsBrowserOpen(true);
		requestAnimationFrame(() => {
			this.systemsDeck?.revealSelected();
			this.findSystemOccurrenceButton(occurrenceKey)?.focus({ preventScroll: true });
		});
	}

	private findSystemOccurrenceButton(occurrenceKey: string): HTMLButtonElement | null {
		return Array.from(
			this.systemsBrowserEl?.querySelectorAll<HTMLButtonElement>(
				'[data-dtf-system-occurrence-key]',
			) ?? [],
		).find((button) => button.dataset.dtfSystemOccurrenceKey === occurrenceKey) ?? null;
	}

	private acceptPanelState(state: WorkbenchState): void {
		const next = freezeWorkbenchState(validateWorkbenchState(state));
		this.setLocalState(next);
		this.updateSnapshotState(next);
	}

	private acceptScopeState(scope: WorkbenchState['scope']): void {
		const next = freezeWorkbenchState({
			...cloneWorkbenchState(this.state),
			scope: {
				selectedPaths: [...scope.selectedPaths],
				signalFilter: scope.signalFilter ? { ...scope.signalFilter } : null,
			},
		});
		this.setLocalState(next);
		this.updateSnapshotState(next);
	}

	private acceptCandidateState(candidateState: WorkbenchCandidateState): void {
		const sortChanged = this.state.candidates.sort !== candidateState.sort;
		const next = freezeWorkbenchState({
			...cloneWorkbenchState(this.state),
			candidates: {
				...candidateState,
				selectedKeys: candidateState.selectedKeys === null
					? null
					: [...candidateState.selectedKeys],
			},
		});
		this.setLocalState(next);
		this.updateSnapshotState(next, sortChanged);
		if (sortChanged) this.renderActivePanel();
	}

	private async chooseBranchInScope(path: string): Promise<void> {
		const next = freezeWorkbenchState({
			...cloneWorkbenchState(this.state),
			surface: 'scope',
			scope: {
				...cloneWorkbenchState(this.state).scope,
				selectedPaths: [path],
			},
		});
		this.setLocalState(next);
		this.updateSnapshotState(next);
		this.renderNavigation();
		this.renderActivePanel();
	}

	private async draftScopeCandidates(): Promise<void> {
		const next = freezeWorkbenchState({
			...cloneWorkbenchState(this.state),
			surface: 'candidates',
			candidates: {
				...cloneWorkbenchState(this.state).candidates,
				source: 'scope-selection',
				selectedKeys: null,
			},
		});
		this.setLocalState(next);
		this.renderNavigation();
		this.destroyActivePanel();
		this.panelEl?.empty();
		await this.collectSnapshot();
	}

	private updateSnapshotState(next: WorkbenchState, resortCandidates = false): void {
		const snapshot = this.snapshot;
		if (!snapshot) return;

		let candidatePlan = snapshot.candidatePlan;
		if (candidatePlan && resortCandidates) {
			const candidates = next.candidates.sort === 'conflict'
				? sortCandidatesByConflict([...candidatePlan.candidates])
				: sortCandidatesByNoise([...candidatePlan.candidates]);
			Object.freeze(candidates);
			candidatePlan = { ...candidatePlan, candidates };
			Object.freeze(candidatePlan);
		}

		const validCandidateKeys = candidatePlan?.candidates.map((candidate) => candidate.key) ?? [];
		const selectedCandidateKeys = resolveSelectedCandidateKeys(
			next.candidates.selectedKeys,
			validCandidateKeys,
		);
		Object.freeze(selectedCandidateKeys);

		const installedRules = snapshot.organizationalSystems.ruleLayers
			.flatMap((layer) => [...layer.rules]);
		const groupPrecedence = snapshot.organizationalSystems.ruleLayers
			.filter((layer) => layer.group !== null && layer.precedenceIndex !== null)
			.sort((a, b) => a.precedenceIndex! - b.precedenceIndex!)
			.map((layer) => layer.group!);
		const organizationalSystems = buildOrganizationalSystemsProjection({
			detectionResults: snapshot.detectionResults,
			candidates: candidatePlan?.candidates,
			installedRules,
			groupPrecedence,
			candidateSort: next.candidates.sort,
		});
		const occurrenceStats = {
			...snapshot.occurrenceStats,
			visibleCount: organizationalSystems.cards.length,
		};

		const updated: WorkbenchSessionSnapshot = {
			...snapshot,
			state: next,
			candidatePlan,
			selectedCandidateKeys,
			organizationalSystems,
			occurrenceStats,
		};
		this.snapshot = Object.freeze(updated);
		this.renderPersistentDeck();
	}

	private shouldCollectForStateChange(
		previous: WorkbenchState,
		next: WorkbenchState,
	): boolean {
		if (!this.snapshot) return true;
		// The hidden outline prototype plans candidates from the same checked
		// folders, so it recollects on the same conditions as scope-selection.
		if (next.surface === 'outline') {
			if (!this.snapshot.candidatePlan) return true;
			if (previous.surface !== 'outline') return true;
			return !sameScopeState(previous, next);
		}
		if (next.surface !== 'candidates') return false;
		if (!this.snapshot.candidatePlan) return true;
		if (previous.surface !== 'candidates') return true;
		if (previous.candidates.source !== next.candidates.source) return true;
		return next.candidates.source === 'scope-selection'
			&& !sameScopeState(previous, next);
	}

	private setLocalState(next: WorkbenchState): void {
		const statusChanged = this.scanning || this.collectionError !== null;
		if (this.scanning) this.collectionGeneration++;
		this.scanning = false;
		this.collectionError = null;
		this.state = next;
		if (statusChanged) this.renderStatus();
		if (this.opened) this.app.workspace.requestSaveLayout();
	}

	private destroyActivePanel(): void {
		this.activePanel?.destroy();
		this.activePanel = null;
		this.activePanelSurface = null;
	}

	private destroyPersistentDeck(): void {
		this.systemsDeck?.destroy();
		this.ruleLayersSection?.destroy();
		this.systemsDeck = null;
		this.ruleLayersSection = null;
		this.deckEl?.empty();
	}

	private openPluginSettings(ruleId?: string): void {
		if (ruleId) this.plugin.focusRuleId = ruleId;
		const setting = (
			this.app as unknown as {
				setting?: { open: () => void; openTabById: (id: string) => unknown };
			}
		).setting;
		if (!setting) {
			new Notice('Could not open settings.');
			return;
		}
		setting.open();
		setting.openTabById(this.plugin.manifest.id);
	}
}

function freezeWorkbenchState(state: WorkbenchState): WorkbenchState {
	const clone = cloneWorkbenchState(state);
	if (clone.scope.signalFilter) Object.freeze(clone.scope.signalFilter);
	Object.freeze(clone.scope.selectedPaths);
	Object.freeze(clone.scope);
	if (clone.candidates.selectedKeys) Object.freeze(clone.candidates.selectedKeys);
	Object.freeze(clone.candidates);
	Object.freeze(clone.preferences);
	return Object.freeze(clone);
}

function cloneWorkbenchState(state: WorkbenchState): WorkbenchState {
	return {
		...state,
		scope: {
			selectedPaths: [...state.scope.selectedPaths],
			signalFilter: state.scope.signalFilter ? { ...state.scope.signalFilter } : null,
		},
		candidates: {
			...state.candidates,
			selectedKeys: state.candidates.selectedKeys === null
				? null
				: [...state.candidates.selectedKeys],
		},
		preferences: { ...state.preferences },
	};
}

function sameWorkbenchState(a: WorkbenchState, b: WorkbenchState): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
}

function sameScopeState(a: WorkbenchState, b: WorkbenchState): boolean {
	return JSON.stringify(a.scope) === JSON.stringify(b.scope);
}

function errorMessage(error: unknown): string {
	if (error instanceof Error && error.message.trim() !== '') return error.message;
	if (typeof error === 'string' && error.trim() !== '') return error;
	return 'Unknown error';
}
