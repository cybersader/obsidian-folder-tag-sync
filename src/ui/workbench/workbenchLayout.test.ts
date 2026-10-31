import { describe, expect, test } from 'bun:test';
import {
	classifyWorkbenchLayout,
	WORKBENCH_LAYOUT_THRESHOLDS,
} from './workbenchLayout';

const spacious = {
	bodyWidth: 1400,
	bodyHeight: 800,
	panelWidth: 1000,
	panelHeight: 720,
};

describe('classifyWorkbenchLayout', () => {
	test('uses side browser and inspector only when both dimensions fit', () => {
		expect(classifyWorkbenchLayout(spacious)).toEqual({
			density: 'spacious',
			systemsBrowser: 'side',
			folderInspector: 'side',
		});
	});

	test('treats the screenshot-shaped split as compact overlays', () => {
		expect(classifyWorkbenchLayout({
			bodyWidth: 924,
			bodyHeight: 900,
			panelWidth: 900,
			panelHeight: 720,
		})).toEqual({
			density: 'spacious',
			systemsBrowser: 'overlay',
			folderInspector: 'overlay',
		});
	});

	test('height can force compact or tight even when width is generous', () => {
		expect(classifyWorkbenchLayout({ ...spacious, panelHeight: 600 }).density).toBe('compact');
		expect(classifyWorkbenchLayout({ ...spacious, panelHeight: 479 }).density).toBe('tight');
		expect(classifyWorkbenchLayout({ ...spacious, bodyHeight: 519 }).systemsBrowser).toBe('overlay');
	});

	test('width can force tight even in a tall leaf', () => {
		expect(classifyWorkbenchLayout({ ...spacious, panelWidth: 559 }).density).toBe('tight');
	});

	test('threshold boundaries are inclusive for side and spacious modes', () => {
		const thresholds = WORKBENCH_LAYOUT_THRESHOLDS;
		expect(classifyWorkbenchLayout({
			bodyWidth: thresholds.systemsSideMinWidth,
			bodyHeight: thresholds.systemsSideMinHeight,
			panelWidth: thresholds.inspectorSideMinWidth,
			panelHeight: thresholds.spaciousMinHeight,
		})).toEqual({
			density: 'spacious',
			systemsBrowser: 'side',
			folderInspector: 'side',
		});
	});

	test('zero-size startup measurements fail closed to tight overlays', () => {
		expect(classifyWorkbenchLayout({
			bodyWidth: 0,
			bodyHeight: 0,
			panelWidth: 0,
			panelHeight: 0,
		})).toEqual({
			density: 'tight',
			systemsBrowser: 'overlay',
			folderInspector: 'overlay',
		});
	});
});
