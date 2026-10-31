export interface WorkbenchScopePresentationState {
	/** null means the split should use its default plan height. */
	preferredPlanHeight: number | null;
	chooserScrollTop: number;
	planScrollTop: number;
}

export interface WorkbenchScopePresentationUpdate {
	preferredPlanHeight?: number | null;
	chooserScrollTop?: number;
	planScrollTop?: number;
}

export interface WorkbenchScopeSplitMetrics {
	chooserMinimumHeight: number;
	planMinimumHeight: number;
	separatorThickness: number;
	defaultPlanHeight: number;
}

export interface WorkbenchScopeSplit {
	chooserHeight: number;
	planHeight: number;
	minPlanHeight: number;
	maxPlanHeight: number;
	separatorThickness: number;
}

export const WORKBENCH_SCOPE_SPLIT_METRICS: WorkbenchScopeSplitMetrics = {
	chooserMinimumHeight: 180,
	planMinimumHeight: 140,
	separatorThickness: 6,
	defaultPlanHeight: 240,
};

export function createDefaultWorkbenchScopePresentationState(): WorkbenchScopePresentationState {
	return {
		preferredPlanHeight: null,
		chooserScrollTop: 0,
		planScrollTop: 0,
	};
}

export function cloneWorkbenchScopePresentationState(
	state: WorkbenchScopePresentationState,
): WorkbenchScopePresentationState {
	return updateWorkbenchScopePresentationState(state, {});
}

export function updateWorkbenchScopePresentationState(
	state: WorkbenchScopePresentationState,
	update: WorkbenchScopePresentationUpdate,
): WorkbenchScopePresentationState {
	return {
		preferredPlanHeight: normalizePreferredHeight(
			update.preferredPlanHeight === undefined
				? state.preferredPlanHeight
				: update.preferredPlanHeight,
		),
		chooserScrollTop: normalizeScrollOffset(
			update.chooserScrollTop === undefined
				? state.chooserScrollTop
				: update.chooserScrollTop,
		),
		planScrollTop: normalizeScrollOffset(
			update.planScrollTop === undefined
				? state.planScrollTop
				: update.planScrollTop,
		),
	};
}

/**
 * Calculate the currently applicable Scope split without changing the user's
 * preferred plan height. Viewport constraints therefore clamp only the returned
 * heights; a later, taller viewport can apply the original preference again.
 */
export function calculateWorkbenchScopeSplit(
	availableHeight: number,
	state: WorkbenchScopePresentationState,
	metrics: WorkbenchScopeSplitMetrics = WORKBENCH_SCOPE_SPLIT_METRICS,
): WorkbenchScopeSplit {
	const height = normalizeNonNegative(availableHeight);
	const chooserMinimumHeight = normalizeNonNegative(metrics.chooserMinimumHeight);
	const planMinimumHeight = normalizeNonNegative(metrics.planMinimumHeight);
	const separatorThickness = Math.min(
		normalizeNonNegative(metrics.separatorThickness),
		height,
	);
	const contentHeight = height - separatorThickness;
	const minimumTotal = chooserMinimumHeight + planMinimumHeight;

	if (contentHeight <= 0) {
		return {
			chooserHeight: 0,
			planHeight: 0,
			minPlanHeight: 0,
			maxPlanHeight: 0,
			separatorThickness,
		};
	}

	if (minimumTotal > contentHeight) {
		const chooserRatio = minimumTotal > 0
			? chooserMinimumHeight / minimumTotal
			: 0.5;
		const chooserHeight = contentHeight * chooserRatio;
		const planHeight = contentHeight - chooserHeight;
		return {
			chooserHeight,
			planHeight,
			minPlanHeight: planHeight,
			maxPlanHeight: planHeight,
			separatorThickness,
		};
	}

	const preferredPlanHeight = state.preferredPlanHeight === null
		? normalizeNonNegative(metrics.defaultPlanHeight)
		: normalizeNonNegative(state.preferredPlanHeight);
	const maxPlanHeight = contentHeight - chooserMinimumHeight;
	const planHeight = clamp(
		preferredPlanHeight,
		planMinimumHeight,
		maxPlanHeight,
	);

	return {
		chooserHeight: contentHeight - planHeight,
		planHeight,
		minPlanHeight: planMinimumHeight,
		maxPlanHeight,
		separatorThickness,
	};
}

export function normalizeWorkbenchScopeScrollOffset(value: number): number {
	return normalizeScrollOffset(value);
}

function normalizePreferredHeight(value: number | null): number | null {
	return value !== null && Number.isFinite(value) && value >= 0 ? value : null;
}

function normalizeScrollOffset(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function normalizeNonNegative(value: number): number {
	return Number.isFinite(value) && value > 0 ? value : 0;
}

function clamp(value: number, minimum: number, maximum: number): number {
	return Math.min(Math.max(value, minimum), maximum);
}
