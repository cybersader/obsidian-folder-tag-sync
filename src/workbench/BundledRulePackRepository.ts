import bundledCatalog from '../../rule-packs/catalog.json';
import {
	loadRulePackFromObject,
	type RulePack,
} from '../engine/rulePackLoader';

export type BundledRulePackRepositoryErrorCode =
	| 'invalid-catalog'
	| 'invalid-pack'
	| 'pack-id-mismatch'
	| 'missing-id';

export interface BundledRulePackRepositoryError {
	code: BundledRulePackRepositoryErrorCode;
	message: string;
	packId?: string;
	details: readonly string[];
	availableIds: readonly string[];
}

export interface BundledRulePackEntry {
	id: string;
	pack: RulePack;
}

export type BundledRulePackGetResult =
	| { ok: true; id: string; pack: RulePack }
	| { ok: false; error: BundledRulePackRepositoryError };

function isCatalog(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** Freeze the cache recursively so consumers cannot mutate shared pack state. */
function deepFreeze<T>(value: T, seen = new WeakSet<object>()): T {
	if (value === null || typeof value !== 'object' || seen.has(value)) return value;
	seen.add(value);
	for (const child of Object.values(value as Record<string, unknown>)) {
		deepFreeze(child, seen);
	}
	return Object.freeze(value);
}

/**
 * Pure repository over the build-generated bundled catalog.
 *
 * Construction eagerly validates every raw pack through the production loader
 * and caches the immutable normalized result. No Obsidian or filesystem API is
 * involved; esbuild embeds the statically imported JSON when this module is
 * bundled.
 */
export class BundledRulePackRepository {
	private readonly packsById = new Map<string, RulePack>();
	private readonly failuresById = new Map<string, BundledRulePackRepositoryError>();
	private readonly catalogIds: readonly string[];
	private readonly entries: readonly BundledRulePackEntry[];
	private readonly validationErrors: readonly BundledRulePackRepositoryError[];

	constructor(catalog: unknown = bundledCatalog) {
		if (!isCatalog(catalog)) {
			const error = deepFreeze<BundledRulePackRepositoryError>({
				code: 'invalid-catalog',
				message: 'Bundled rule-pack catalog must be an object keyed by pack id',
				details: ['Catalog root must be a JSON object'],
				availableIds: [],
			});
			this.catalogIds = Object.freeze([]);
			this.entries = Object.freeze([]);
			this.validationErrors = Object.freeze([error]);
			return;
		}

		const ids = Object.keys(catalog).sort((a, b) => a.localeCompare(b));
		this.catalogIds = Object.freeze(ids.slice());
		const errors: BundledRulePackRepositoryError[] = [];

		for (const id of ids) {
			const loaded = loadRulePackFromObject(catalog[id]);
			if (!loaded.ok) {
				const error = deepFreeze<BundledRulePackRepositoryError>({
					code: 'invalid-pack',
					message: `Bundled rule pack '${id}' failed validation`,
					packId: id,
					details: loaded.errors.slice(),
					availableIds: this.catalogIds,
				});
				this.failuresById.set(id, error);
				errors.push(error);
				continue;
			}

			if (loaded.pack.id !== undefined && loaded.pack.id !== id) {
				const error = deepFreeze<BundledRulePackRepositoryError>({
					code: 'pack-id-mismatch',
					message: `Catalog key '${id}' does not match embedded pack id '${loaded.pack.id}'`,
					packId: id,
					details: [`Expected '${id}', received '${loaded.pack.id}'`],
					availableIds: this.catalogIds,
				});
				this.failuresById.set(id, error);
				errors.push(error);
				continue;
			}

			// Packs authored before stable ids use the filename-derived catalog key.
			const pack = deepFreeze<RulePack>({ ...loaded.pack, id });
			this.packsById.set(id, pack);
		}

		this.entries = Object.freeze(
			ids.flatMap((id) => {
				const pack = this.packsById.get(id);
				return pack ? [deepFreeze<BundledRulePackEntry>({ id, pack })] : [];
			}),
		);
		this.validationErrors = Object.freeze(errors.slice());
	}

	/** All valid bundled packs, ordered deterministically by id. */
	list(): readonly BundledRulePackEntry[] {
		return this.entries;
	}

	/** Retrieve a cached pack or a structured validation/not-found error. */
	get(id: string): BundledRulePackGetResult {
		const failure = this.failuresById.get(id);
		if (failure) return { ok: false, error: failure };

		const pack = this.packsById.get(id);
		if (pack) return { ok: true, id, pack };

		return {
			ok: false,
			error: deepFreeze<BundledRulePackRepositoryError>({
				code: 'missing-id',
				message: `No bundled rule pack exists with id '${id}'`,
				packId: id,
				details: [],
				availableIds: this.catalogIds,
			}),
		};
	}

	/** Catalog-wide validation failures, empty for the generated built-ins. */
	getErrors(): readonly BundledRulePackRepositoryError[] {
		return this.validationErrors;
	}
}

export const bundledRulePackRepository = new BundledRulePackRepository();
export default bundledRulePackRepository;
