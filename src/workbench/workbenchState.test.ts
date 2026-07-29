import { describe, expect, test } from 'bun:test';
import {
	createDefaultWorkbenchState,
	reconcileDetailPath,
	reconcileSelectedCandidateKeys,
	reconcileSelectedScopePaths,
	reconcileSignalFilter,
	reconcileWorkbenchState,
	reduceWorkbenchRoute,
	resolveSelectedCandidateKeys,
	routeLegacyDraft,
	routeLegacyScan,
	routeToMap,
	validateWorkbenchState,
	type SignalFilterIdentity,
} from './workbenchState';

const JD_SIGNAL: SignalFilterIdentity = {
	packId: 'jd',
	regex: '^\\d{1,2} - ',
	scope: 'leafName',
};

function populatedState() {
	return validateWorkbenchState({
		version: 1,
		surface: 'scope',
		mapMode: 'rules',
		scope: {
			selectedPaths: ['Projects/Web', 'Areas'],
			signalFilter: JD_SIGNAL,
		},
		candidates: {
			source: 'scope-selection',
			sort: 'conflict',
			selectedKeys: ['candidate-b', 'candidate-a'],
		},
		detailPath: 'Projects/Web',
	});
}

describe('workbench state validation', () => {
	test('defaults non-objects and unsupported versions to a fresh current state', () => {
		expect(validateWorkbenchState(null)).toEqual(createDefaultWorkbenchState());
		expect(validateWorkbenchState({ version: 99, surface: 'scope' })).toEqual(
			createDefaultWorkbenchState(),
		);
	});

	test('migrates version 1 fields and initializes deck state without losing choices', () => {
		const state = populatedState();
		expect(state.version).toBe(2);
		expect(state.surface).toBe('scope');
		expect(state.scope.selectedPaths).toEqual(['Areas', 'Projects/Web']);
		expect(state.candidates.sort).toBe('conflict');
		expect(state.selectedSystemInstanceKey).toBeNull();
		expect(state.preferences.showIncompleteSystems).toBe(true);
	});

	test('validates persistent deck selection and presentation preference', () => {
		const state = validateWorkbenchState({
			...createDefaultWorkbenchState(),
			selectedSystemInstanceKey: ' occurrence:para ',
			preferences: { showIncompleteSystems: false },
		});
		expect(state.selectedSystemInstanceKey).toBe('occurrence:para');
		expect(state.preferences.showIncompleteSystems).toBe(false);
	});

	test('accepts valid fields independently while rejecting invalid enums and object shapes', () => {
		const state = validateWorkbenchState({
			version: 1,
			surface: 'sideways',
			mapMode: 'rules',
			scope: [],
			candidates: {
				source: 'detected-instances',
				sort: 'alphabetical',
				selectedKeys: { not: 'an array' },
			},
			detailPath: 42,
		});

		expect(state).toEqual({
			version: 2,
			surface: 'map',
			mapMode: 'rules',
			scope: { selectedPaths: [], signalFilter: null },
			candidates: {
				source: 'detected-instances',
				sort: 'noise',
				selectedKeys: null,
			},
			selectedSystemInstanceKey: null,
			preferences: { showIncompleteSystems: true },
			detailPath: null,
		});
	});

	test('normalizes, deduplicates, and code-point sorts persisted paths and keys', () => {
		const state = validateWorkbenchState({
			version: 1,
			surface: 'candidates',
			mapMode: 'both',
			scope: {
				selectedPaths: [' Zed/Child/ ', 'Areas', 'Areas', '\\Projects\\Web', 7, ''],
				signalFilter: JD_SIGNAL,
			},
			candidates: {
				source: 'scope-selection',
				sort: 'conflict',
				selectedKeys: ['z', 'a', 'z', '', 8],
			},
			detailPath: '/Projects/Web/',
		});

		expect(state.scope.selectedPaths).toEqual(['', 'Areas', 'Projects/Web', 'Zed/Child']);
		expect(state.candidates.selectedKeys).toEqual(['a', 'z']);
		expect(state.detailPath).toBe('Projects/Web');
		expect(state.scope.signalFilter).toEqual(JD_SIGNAL);
	});

	test('preserves selectedKeys null separately from an explicit empty selection', () => {
		const defaultsPending = validateWorkbenchState({
			...createDefaultWorkbenchState(),
			candidates: { source: 'scope-selection', sort: 'noise', selectedKeys: null },
		});
		const explicitlyNone = validateWorkbenchState({
			...createDefaultWorkbenchState(),
			candidates: { source: 'scope-selection', sort: 'noise', selectedKeys: [] },
		});

		expect(defaultsPending.candidates.selectedKeys).toBeNull();
		expect(explicitlyNone.candidates.selectedKeys).toEqual([]);
		expect(resolveSelectedCandidateKeys(null, ['b', 'a'])).toEqual(['a', 'b']);
		expect(resolveSelectedCandidateKeys([], ['b', 'a'])).toEqual([]);
	});
});

describe('workbench route reducers', () => {
	test('map routing changes only the surface', () => {
		const before = populatedState();
		const after = routeToMap(before);

		expect(after).toEqual({ ...before, surface: 'map' });
		expect(after).not.toBe(before);
	});

	test('legacy scan opens a clean Scope while preserving unrelated Map/Candidate/detail state', () => {
		const before = populatedState();
		const after = routeLegacyScan(before);

		expect(after.surface).toBe('scope');
		expect(after.scope).toEqual({ selectedPaths: [], signalFilter: null });
		expect(after.mapMode).toBe(before.mapMode);
		expect(after.candidates).toEqual(before.candidates);
		expect(after.detailPath).toBe(before.detailPath);
	});

	test('legacy draft opens clean detected-instance Candidates and preserves unrelated state', () => {
		const before = populatedState();
		const after = routeLegacyDraft(before);

		expect(after.surface).toBe('candidates');
		expect(after.candidates).toEqual({
			source: 'detected-instances',
			sort: 'noise',
			selectedKeys: null,
		});
		expect(after.mapMode).toBe(before.mapMode);
		expect(after.scope).toEqual(before.scope);
		expect(after.detailPath).toBe(before.detailPath);
	});

	test('generic route reducer delegates all three entry points', () => {
		const state = populatedState();
		expect(reduceWorkbenchRoute(state, 'map').surface).toBe('map');
		expect(reduceWorkbenchRoute(state, 'legacy-scan').scope.selectedPaths).toEqual([]);
		expect(reduceWorkbenchRoute(state, 'legacy-draft').candidates.source).toBe('detected-instances');
	});
});

describe('restored-state reconciliation', () => {
	test('reconciles scopes, signal identity, candidate keys, and detail path independently', () => {
		const state = populatedState();
		const reconciled = reconcileWorkbenchState(state, {
			validFolderPaths: ['Projects/Web', 'Other'],
			validSignalIdentities: [JD_SIGNAL],
			validCandidateKeys: ['candidate-a', 'candidate-c'],
			validDetailPaths: ['Other'],
		});

		expect(reconciled.scope.selectedPaths).toEqual(['Projects/Web']);
		expect(reconciled.scope.signalFilter).toEqual(JD_SIGNAL);
		expect(reconciled.candidates.selectedKeys).toEqual(['candidate-a']);
		expect(reconciled.detailPath).toBeNull();
	});

	test('reconciles selected organizational-system occurrence independently', () => {
		const state = validateWorkbenchState({
			...createDefaultWorkbenchState(),
			selectedSystemInstanceKey: 'occurrence:para',
		});
		expect(reconcileWorkbenchState(state, {
			validSystemInstanceKeys: ['occurrence:para', 'occurrence:jd'],
		}).selectedSystemInstanceKey).toBe('occurrence:para');
		expect(reconcileWorkbenchState(state, {
			validSystemInstanceKeys: ['occurrence:jd'],
		}).selectedSystemInstanceKey).toBeNull();
	});

	test('uses exact stable signal identity rather than transient indexes or labels', () => {
		expect(reconcileSignalFilter(JD_SIGNAL, [{ ...JD_SIGNAL }])).toEqual(JD_SIGNAL);
		expect(reconcileSignalFilter(JD_SIGNAL, [{ ...JD_SIGNAL, scope: 'path' }])).toBeNull();
		expect(reconcileSignalFilter(JD_SIGNAL, [{ ...JD_SIGNAL, regex: '^other$' }])).toBeNull();
	});

	test('keeps root as a valid scope and drops missing folders deterministically', () => {
		expect(reconcileSelectedScopePaths(['Missing', '', 'Projects', 'Projects'], ['Projects']))
			.toEqual(['', 'Projects']);
	});

	test('preserves candidate null semantics during reconciliation and filters explicit arrays', () => {
		expect(reconcileSelectedCandidateKeys(null, ['a'])).toBeNull();
		expect(reconcileSelectedCandidateKeys([], ['a'])).toEqual([]);
		expect(reconcileSelectedCandidateKeys(['b', 'a', 'b'], ['a', 'c'])).toEqual(['a']);
	});

	test('detail paths require an exact current folder', () => {
		expect(reconcileDetailPath('Projects/Web', ['Projects/Web'])).toBe('Projects/Web');
		expect(reconcileDetailPath('Projects', ['Projects/Web'])).toBeNull();
	});
});
