export type WorkbenchDensity = 'spacious' | 'compact' | 'tight';
export type WorkbenchOverlayMode = 'side' | 'overlay';

export interface WorkbenchLayoutMeasurements {
	bodyWidth: number;
	bodyHeight: number;
	panelWidth: number;
	panelHeight: number;
}

export interface WorkbenchLayout {
	density: WorkbenchDensity;
	systemsBrowser: WorkbenchOverlayMode;
	folderInspector: WorkbenchOverlayMode;
}

export const WORKBENCH_LAYOUT_THRESHOLDS = {
	systemsSideMinWidth: 1120,
	systemsSideMinHeight: 520,
	spaciousMinWidth: 840,
	spaciousMinHeight: 680,
	tightBelowWidth: 560,
	tightBelowHeight: 480,
	inspectorSideMinWidth: 960,
	inspectorSideMinHeight: 560,
} as const;

/**
 * Classify Workbench presentation from the space each surface actually owns.
 * This stays pure so the geometry policy can be adjusted from real-Obsidian
 * evidence without coupling it to ResizeObserver or DOM timing.
 */
export function classifyWorkbenchLayout(
	measurements: WorkbenchLayoutMeasurements,
): WorkbenchLayout {
	const {
		bodyWidth,
		bodyHeight,
		panelWidth,
		panelHeight,
	} = measurements;
	const thresholds = WORKBENCH_LAYOUT_THRESHOLDS;

	const density: WorkbenchDensity =
		panelWidth >= thresholds.spaciousMinWidth
		&& panelHeight >= thresholds.spaciousMinHeight
			? 'spacious'
			: panelWidth < thresholds.tightBelowWidth
				|| panelHeight < thresholds.tightBelowHeight
					? 'tight'
					: 'compact';

	return {
		density,
		systemsBrowser:
			bodyWidth >= thresholds.systemsSideMinWidth
			&& bodyHeight >= thresholds.systemsSideMinHeight
				? 'side'
				: 'overlay',
		folderInspector:
			panelWidth >= thresholds.inspectorSideMinWidth
			&& panelHeight >= thresholds.inspectorSideMinHeight
				? 'side'
				: 'overlay',
	};
}
