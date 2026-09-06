import { describe, expect, test } from 'bun:test';
import {
	calculateWorkbenchScopeSplit,
	cloneWorkbenchScopePresentationState,
	createDefaultWorkbenchScopePresentationState,
	normalizeWorkbenchScopeScrollOffset,
	updateWorkbenchScopePresentationState,
	WORKBENCH_SCOPE_SPLIT_METRICS,
	type WorkbenchScopePresentationState,
} from './workbenchScopePresentation';

describe('Workbench Scope presentation state', () => {
	test('initializes view-local split and scroll state', () => {
		expect(createDefaultWorkbenchScopePresentationState()).toEqual({
			preferredPlanHeight: null,
			chooserScrollTop: 0,
			planScrollTop: 0,
		});
	});

	test('clones and updates immutably while normalizing transient values', () => {
		const state: WorkbenchScopePresentationState = {
			preferredPlanHeight: 275,
			chooserScrollTop: 42.5,
			planScrollTop: 18,
		};
		const clone = cloneWorkbenchScopePresentationState(state);
		const updated = updateWorkbenchScopePresentationState(state, {
			preferredPlanHeight: Number.NaN,
			chooserScrollTop: -10,
			planScrollTop: Number.POSITIVE_INFINITY,
		});

		expect(clone).toEqual(state);
		expect(clone).not.toBe(state);
		expect(updated).toEqual({
			preferredPlanHeight: null,
			chooserScrollTop: 0,
			planScrollTop: 0,
		});
		expect(state).toEqual({
			preferredPlanHeight: 275,
			chooserScrollTop: 42.5,
			planScrollTop: 18,
		});
	});

	test('supports returning to the default plan height without changing scroll place', () => {
		expect(updateWorkbenchScopePresentationState({
			preferredPlanHeight: 320,
			chooserScrollTop: 75,
			planScrollTop: 24,
		}, {
			preferredPlanHeight: null,
		})).toEqual({
			preferredPlanHeight: null,
			chooserScrollTop: 75,
			planScrollTop: 24,
		});
	});

	test('normalizes scroll offsets independently for DOM event handling', () => {
		expect(normalizeWorkbenchScopeScrollOffset(12.75)).toBe(12.75);
		expect(normalizeWorkbenchScopeScrollOffset(0)).toBe(0);
		expect(normalizeWorkbenchScopeScrollOffset(-1)).toBe(0);
		expect(normalizeWorkbenchScopeScrollOffset(Number.NaN)).toBe(0);
	});
});

describe('calculateWorkbenchScopeSplit', () => {
	const state = createDefaultWorkbenchScopePresentationState();

	test('uses the default plan height and reserves separator space', () => {
		expect(calculateWorkbenchScopeSplit(600, state)).toEqual({
			chooserHeight: 354,
			planHeight: WORKBENCH_SCOPE_SPLIT_METRICS.defaultPlanHeight,
			minPlanHeight: WORKBENCH_SCOPE_SPLIT_METRICS.planMinimumHeight,
			maxPlanHeight: 414,
			separatorThickness: WORKBENCH_SCOPE_SPLIT_METRICS.separatorThickness,
		});
	});

	test('clamps the applied plan height between both pane minimums', () => {
		expect(calculateWorkbenchScopeSplit(600, {
			...state,
			preferredPlanHeight: 20,
		})).toEqual({
			chooserHeight: 454,
			planHeight: 140,
			minPlanHeight: 140,
			maxPlanHeight: 414,
			separatorThickness: 6,
		});
		expect(calculateWorkbenchScopeSplit(500, {
			...state,
			preferredPlanHeight: 900,
		})).toEqual({
			chooserHeight: 180,
			planHeight: 314,
			minPlanHeight: 140,
			maxPlanHeight: 314,
			separatorThickness: 6,
		});
	});

	test('keeps viewport clamping temporary and reapplies the stored preference later', () => {
		const preferred: WorkbenchScopePresentationState = {
			...state,
			preferredPlanHeight: 500,
		};

		expect(calculateWorkbenchScopeSplit(500, preferred).planHeight).toBe(314);
		expect(preferred.preferredPlanHeight).toBe(500);
		expect(calculateWorkbenchScopeSplit(900, preferred).planHeight).toBe(500);
	});

	test('compresses both minimums proportionally only when the viewport cannot fit them', () => {
		const split = calculateWorkbenchScopeSplit(166, state);
		expect(split).toEqual({
			chooserHeight: 90,
			planHeight: 70,
			minPlanHeight: 70,
			maxPlanHeight: 70,
			separatorThickness: 6,
		});
		expect(split.chooserHeight + split.planHeight + split.separatorThickness).toBe(166);
	});

	test('normalizes invalid or empty available height', () => {
		expect(calculateWorkbenchScopeSplit(Number.NaN, state)).toEqual({
			chooserHeight: 0,
			planHeight: 0,
			minPlanHeight: 0,
			maxPlanHeight: 0,
			separatorThickness: 0,
		});
		expect(calculateWorkbenchScopeSplit(-100, state)).toEqual({
			chooserHeight: 0,
			planHeight: 0,
			minPlanHeight: 0,
			maxPlanHeight: 0,
			separatorThickness: 0,
		});
	});
});
