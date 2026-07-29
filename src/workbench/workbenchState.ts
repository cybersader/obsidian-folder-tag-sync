export const WORKBENCH_STATE_VERSION = 2 as const;

export type WorkbenchSurface = 'map' | 'scope' | 'candidates';
export type WorkbenchMapMode = 'detected' | 'rules' | 'both';
export type CandidateSource = 'scope-selection' | 'detected-instances';
export type CandidateSort = 'noise' | 'conflict';
export type SignalScope = 'name' | 'path' | 'leafName';

/** Stable persisted identity. Runtime-only signal indexes are deliberately excluded. */
export interface SignalFilterIdentity {
	packId: string;
	regex: string;
	scope: SignalScope;
}

export interface WorkbenchScopeState {
	selectedPaths: string[];
	signalFilter: SignalFilterIdentity | null;
}

export interface WorkbenchCandidateState {
	source: CandidateSource;
	sort: CandidateSort;
	/** null initializes to every current candidate; [] is an explicit empty selection. */
	selectedKeys: string[] | null;
}

export interface WorkbenchPreferences {
	/** Presentation only. Incomplete occurrences remain non-actionable. */
	showIncompleteSystems: boolean;
}

export interface WorkbenchState {
	version: typeof WORKBENCH_STATE_VERSION;
	surface: WorkbenchSurface;
	mapMode: WorkbenchMapMode;
	scope: WorkbenchScopeState;
	candidates: WorkbenchCandidateState;
	/** Cross-surface anchored occurrence selection. */
	selectedSystemInstanceKey: string | null;
	preferences: WorkbenchPreferences;
	detailPath: string | null;
}

export interface WorkbenchStateReconciliationInput {
	validFolderPaths?: readonly string[];
	validSignalIdentities?: readonly SignalFilterIdentity[];
	validCandidateKeys?: readonly string[];
	validSystemInstanceKeys?: readonly string[];
	validDetailPaths?: readonly string[];
}

export type WorkbenchRoute = 'map' | 'legacy-scan' | 'legacy-draft';

export function createDefaultWorkbenchState(): WorkbenchState {
	return {
		version: WORKBENCH_STATE_VERSION,
		surface: 'map',
		mapMode: 'both',
		scope: {
			selectedPaths: [],
			signalFilter: null,
		},
		candidates: {
			source: 'scope-selection',
			sort: 'noise',
			selectedKeys: null,
		},
		selectedSystemInstanceKey: null,
		preferences: {
			showIncompleteSystems: true,
		},
		detailPath: null,
	};
}

/**
 * Decode persisted state without throwing. Version 1 is migrated field-for-field
 * to version 2; malformed fields fall back independently.
 */
export function validateWorkbenchState(value: unknown): WorkbenchState {
	const defaults = createDefaultWorkbenchState();
	if (!isRecord(value) || (value.version !== 1 && value.version !== WORKBENCH_STATE_VERSION)) {
		return defaults;
	}

	const scope = isRecord(value.scope) ? value.scope : null;
	const candidates = isRecord(value.candidates) ? value.candidates : null;
	const preferences = isRecord(value.preferences) ? value.preferences : null;

	return {
		version: WORKBENCH_STATE_VERSION,
		surface: isWorkbenchSurface(value.surface) ? value.surface : defaults.surface,
		mapMode: isWorkbenchMapMode(value.mapMode) ? value.mapMode : defaults.mapMode,
		scope: {
			selectedPaths: scope
				? normalizeStringList(scope.selectedPaths, normalizeFolderPath)
				: defaults.scope.selectedPaths,
			signalFilter: scope
				? validateSignalFilterIdentity(scope.signalFilter)
				: defaults.scope.signalFilter,
		},
		candidates: {
			source: candidates && isCandidateSource(candidates.source)
				? candidates.source
				: defaults.candidates.source,
			sort: candidates && isCandidateSort(candidates.sort)
				? candidates.sort
				: defaults.candidates.sort,
			selectedKeys: candidates
				? validateSelectedKeys(candidates.selectedKeys)
				: defaults.candidates.selectedKeys,
		},
		selectedSystemInstanceKey: validateNullableKey(value.selectedSystemInstanceKey),
		preferences: {
			showIncompleteSystems: preferences
				&& typeof preferences.showIncompleteSystems === 'boolean'
				? preferences.showIncompleteSystems
				: defaults.preferences.showIncompleteSystems,
		},
		detailPath: validateNullablePath(value.detailPath),
	};
}

/** Alias for persistence adapters that prefer parsing terminology. */
export const parseWorkbenchState = validateWorkbenchState;

/** Strict shape check after normalization is useful before writing state. */
export function isWorkbenchState(value: unknown): value is WorkbenchState {
	if (!isRecord(value) || value.version !== WORKBENCH_STATE_VERSION) return false;
	if (!isWorkbenchSurface(value.surface) || !isWorkbenchMapMode(value.mapMode)) return false;
	if (!isRecord(value.scope) || !Array.isArray(value.scope.selectedPaths)) return false;
	if (!value.scope.selectedPaths.every((path) => typeof path === 'string')) return false;
	if (value.scope.signalFilter !== null && !isSignalFilterIdentity(value.scope.signalFilter)) return false;
	if (!isRecord(value.candidates)) return false;
	if (!isCandidateSource(value.candidates.source) || !isCandidateSort(value.candidates.sort)) return false;
	if (value.candidates.selectedKeys !== null) {
		if (!Array.isArray(value.candidates.selectedKeys)) return false;
		if (!value.candidates.selectedKeys.every((key) => typeof key === 'string')) return false;
	}
	if (value.selectedSystemInstanceKey !== null
		&& typeof value.selectedSystemInstanceKey !== 'string') return false;
	if (!isRecord(value.preferences)
		|| typeof value.preferences.showIncompleteSystems !== 'boolean') return false;
	return value.detailPath === null || typeof value.detailPath === 'string';
}

/** Open the existing Workbench Map without disturbing persisted choices. */
export function routeToMap(state: unknown): WorkbenchState {
	return { ...validateWorkbenchState(state), surface: 'map' };
}

/** Route the legacy detector to a fresh Scope surface, preserving Map/Candidate choices. */
export function routeLegacyScan(state: unknown): WorkbenchState {
	const current = validateWorkbenchState(state);
	return {
		...current,
		surface: 'scope',
		scope: {
			selectedPaths: [],
			signalFilter: null,
		},
	};
}

/** Route the legacy drafting command to a fresh detected-instance candidate list. */
export function routeLegacyDraft(state: unknown): WorkbenchState {
	const current = validateWorkbenchState(state);
	return {
		...current,
		surface: 'candidates',
		candidates: {
			source: 'detected-instances',
			sort: 'noise',
			selectedKeys: null,
		},
	};
}

export function reduceWorkbenchRoute(state: unknown, route: WorkbenchRoute): WorkbenchState {
	switch (route) {
		case 'map':
			return routeToMap(state);
		case 'legacy-scan':
			return routeLegacyScan(state);
		case 'legacy-draft':
			return routeLegacyDraft(state);
	}
}

/** Compatibility aliases for callers that name reducers by their originating route. */
export const reduceMapRoute = routeToMap;
export const reduceLegacyScanRoute = routeLegacyScan;
export const reduceLegacyDraftRoute = routeLegacyDraft;

export function signalFilterIdentityKey(identity: SignalFilterIdentity): string {
	return `${identity.packId.length}:${identity.packId}:${identity.scope}:${identity.regex.length}:${identity.regex}`;
}

export function reconcileSelectedScopePaths(
	selectedPaths: readonly string[],
	validFolderPaths: readonly string[],
): string[] {
	const valid = new Set(normalizeStringList(validFolderPaths, normalizeFolderPath));
	// The synthetic root is always a valid scope even though folder collection omits it.
	valid.add('');
	return normalizeStringList(selectedPaths, normalizeFolderPath)
		.filter((path) => valid.has(path));
}

export function reconcileSignalFilter(
	filter: SignalFilterIdentity | null,
	validSignals: readonly SignalFilterIdentity[],
): SignalFilterIdentity | null {
	if (filter === null) return null;
	const validated = validateSignalFilterIdentity(filter);
	if (validated === null) return null;
	const validKeys = new Set(
		validSignals
			.map((signal) => validateSignalFilterIdentity(signal))
			.filter((signal): signal is SignalFilterIdentity => signal !== null)
			.map(signalFilterIdentityKey),
	);
	return validKeys.has(signalFilterIdentityKey(validated)) ? validated : null;
}

/** Preserve null's "initialize defaults later" meaning while dropping stale explicit keys. */
export function reconcileSelectedCandidateKeys(
	selectedKeys: readonly string[] | null,
	validCandidateKeys: readonly string[],
): string[] | null {
	if (selectedKeys === null) return null;
	const valid = new Set(normalizeStringList(validCandidateKeys, normalizeCandidateKey));
	return normalizeStringList(selectedKeys, normalizeCandidateKey)
		.filter((key) => valid.has(key));
}

/** Resolve null to all current candidates; an explicit [] remains empty. */
export function resolveSelectedCandidateKeys(
	selectedKeys: readonly string[] | null,
	validCandidateKeys: readonly string[],
): string[] {
	const valid = normalizeStringList(validCandidateKeys, normalizeCandidateKey);
	if (selectedKeys === null) return valid;
	const validSet = new Set(valid);
	return normalizeStringList(selectedKeys, normalizeCandidateKey)
		.filter((key) => validSet.has(key));
}

export function reconcileDetailPath(
	detailPath: string | null,
	validDetailPaths: readonly string[],
): string | null {
	if (detailPath === null) return null;
	const normalized = normalizeFolderPath(detailPath);
	if (normalized === null) return null;
	const valid = new Set(normalizeStringList(validDetailPaths, normalizeFolderPath));
	return valid.has(normalized) ? normalized : null;
}

/** Reconcile a restored state after a fresh vault/session snapshot becomes available. */
export function reconcileWorkbenchState(
	state: unknown,
	input: WorkbenchStateReconciliationInput,
): WorkbenchState {
	const current = validateWorkbenchState(state);
	const selectedPaths = input.validFolderPaths
		? reconcileSelectedScopePaths(current.scope.selectedPaths, input.validFolderPaths)
		: [...current.scope.selectedPaths];
	const signalFilter = input.validSignalIdentities
		? reconcileSignalFilter(current.scope.signalFilter, input.validSignalIdentities)
		: cloneSignalFilter(current.scope.signalFilter);
	const selectedKeys = input.validCandidateKeys
		? reconcileSelectedCandidateKeys(current.candidates.selectedKeys, input.validCandidateKeys)
		: current.candidates.selectedKeys === null ? null : [...current.candidates.selectedKeys];
	const selectedSystemInstanceKey = input.validSystemInstanceKeys
		? reconcileNullableKey(current.selectedSystemInstanceKey, input.validSystemInstanceKeys)
		: current.selectedSystemInstanceKey;
	const detailPath = input.validDetailPaths
		? reconcileDetailPath(current.detailPath, input.validDetailPaths)
		: current.detailPath;

	return {
		...current,
		scope: { selectedPaths, signalFilter },
		candidates: { ...current.candidates, selectedKeys },
		selectedSystemInstanceKey,
		detailPath,
	};
}

function validateSelectedKeys(value: unknown): string[] | null {
	if (value === null) return null;
	if (!Array.isArray(value)) return null;
	return normalizeStringList(value, normalizeCandidateKey);
}

function validateNullablePath(value: unknown): string | null {
	if (value === null) return null;
	return normalizeFolderPath(value);
}

function validateNullableKey(value: unknown): string | null {
	if (value === null || value === undefined) return null;
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	return trimmed === '' ? null : trimmed;
}

function reconcileNullableKey(
	value: string | null,
	validKeys: readonly string[],
): string | null {
	const normalized = validateNullableKey(value);
	if (normalized === null) return null;
	return new Set(validKeys).has(normalized) ? normalized : null;
}

function validateSignalFilterIdentity(value: unknown): SignalFilterIdentity | null {
	if (value === null) return null;
	if (!isRecord(value) || !isSignalScope(value.scope)) return null;
	if (typeof value.packId !== 'string' || typeof value.regex !== 'string') return null;
	const packId = value.packId.trim();
	if (packId === '' || value.regex === '') return null;
	return { packId, regex: value.regex, scope: value.scope };
}

function isSignalFilterIdentity(value: unknown): value is SignalFilterIdentity {
	return validateSignalFilterIdentity(value) !== null;
}

function normalizeStringList(
	value: unknown,
	normalize: (item: unknown) => string | null,
): string[] {
	if (!Array.isArray(value)) return [];
	const unique = new Set<string>();
	for (const item of value) {
		const normalized = normalize(item);
		if (normalized !== null) unique.add(normalized);
	}
	return [...unique].sort(compareCodePoints);
}

function normalizeFolderPath(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const trimmed = value.trim();
	if (trimmed === '') return '';
	const normalized = trimmed
		.replace(/\\/g, '/')
		.replace(/\/{2,}/g, '/')
		.replace(/^\/+|\/+$/g, '');
	return normalized === '' ? null : normalized;
}

function normalizeCandidateKey(value: unknown): string | null {
	if (typeof value !== 'string') return null;
	const normalized = value.trim();
	return normalized === '' ? null : normalized;
}

function cloneSignalFilter(filter: SignalFilterIdentity | null): SignalFilterIdentity | null {
	return filter ? { ...filter } : null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isWorkbenchSurface(value: unknown): value is WorkbenchSurface {
	return value === 'map' || value === 'scope' || value === 'candidates';
}

function isWorkbenchMapMode(value: unknown): value is WorkbenchMapMode {
	return value === 'detected' || value === 'rules' || value === 'both';
}

function isCandidateSource(value: unknown): value is CandidateSource {
	return value === 'scope-selection' || value === 'detected-instances';
}

function isCandidateSort(value: unknown): value is CandidateSort {
	return value === 'noise' || value === 'conflict';
}

function isSignalScope(value: unknown): value is SignalScope {
	return value === 'name' || value === 'path' || value === 'leafName';
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
