import type {
	DetectionDiagnostics,
	FolderRuleDetail,
	InstalledRuleDiagnostics,
	RuleCoverageDetail,
	SupportSnapshot,
} from './collectSupportSnapshot';
import type {
	DynamicTagsFoldersSettings,
	MappingRule,
	TransformConfig,
} from '../types/settings';
import type { TransferOp } from '../types/typed';

/**
 * Produce a deterministic, structurally equivalent snapshot with user-authored
 * identifiers replaced by category-specific aliases. No legend is emitted and
 * the input snapshot is never mutated.
 */
export function anonymizeSupportSnapshot(snapshot: SupportSnapshot): SupportSnapshot {
	const aliases = buildAliases(snapshot);

	return {
		schemaVersion: snapshot.schemaVersion,
		runtime: cloneJsonish(snapshot.runtime),
		configuration: anonymizeSettings(snapshot.configuration, aliases),
		vault: {
			folderPaths: snapshot.vault.folderPaths.map((path) => aliases.folderPath(path)),
			markdownFileCount: snapshot.vault.markdownFileCount,
		},
		diagnostics: {
			detection: anonymizeDetection(snapshot.diagnostics.detection, aliases),
			installedRules: anonymizeInstalledRules(
				snapshot.diagnostics.installedRules,
				aliases,
			),
		},
		debugEntries: snapshot.debugEntries.map((entry) => aliases.debugValue(entry)),
	};
}

class AliasRegistry {
	private readonly folders = new Map<string, string>();
	private readonly rules = new Map<string, string>();
	private readonly groups = new Map<string, string>();
	private readonly tags = new Map<string, string>();
	private readonly regexes = new Map<string, string>();
	private readonly templates = new Map<string, string>();
	private readonly literals = new Map<string, string>();
	private readonly descriptions = new Map<string, string>();
	private replacements: Array<[string, string]> | null = null;

	registerFolders(values: Iterable<string>): void {
		registerSorted(this.folders, values, 'folder');
	}

	registerRulePairs(rules: MappingRule[]): void {
		const ordered = [...rules].sort((a, b) => compareCodePoints(a.id, b.id));
		let index = 1;
		for (const rule of ordered) {
			const alias = numberedAlias('rule', index++);
			if (rule.id) this.rules.set(rule.id, alias);
			if (rule.name) this.rules.set(rule.name, alias);
		}
	}

	registerGroups(values: Iterable<string>): void {
		registerSorted(this.groups, values, 'group');
	}

	registerTags(values: Iterable<string>): void {
		const segments: string[] = [];
		for (const value of values) {
			for (const segment of splitTag(value)) {
				if (segment !== '') segments.push(segment);
			}
		}
		registerSorted(this.tags, segments, 'tag');
	}

	registerRegexes(values: Iterable<string>): void {
		registerSorted(this.regexes, values, 'regex');
	}

	registerTemplates(values: Iterable<string>): void {
		registerSorted(this.templates, values, 'template');
	}

	registerLiterals(values: Iterable<string>): void {
		registerSorted(this.literals, values, 'literal');
	}

	registerDescriptions(values: Iterable<string>): void {
		registerSorted(this.descriptions, values, 'text');
	}

	folderPath(path: string): string {
		return path
			.split('/')
			.map((segment) => this.lookupOrAdd(this.folders, segment, 'folder'))
			.join('/');
	}

	rule(value: string | null): string | null {
		if (value === null) return null;
		return this.lookupOrAdd(this.rules, value, 'rule');
	}

	group(value: string | undefined): string | undefined {
		if (value === undefined) return undefined;
		return this.lookupOrAdd(this.groups, value, 'group');
	}

	tag(value: string): string {
		const hasHash = value.startsWith('#');
		const body = hasHash ? value.slice(1) : value;
		const transformed = body
			.split('/')
			.map((segment) => this.lookupOrAdd(this.tags, segment, 'tag'))
			.join('/');
		return hasHash ? `#${transformed}` : transformed;
	}

	regex(value: string | undefined): string | undefined {
		if (value === undefined) return undefined;
		return this.lookupOrAdd(this.regexes, value, 'regex');
	}

	template(value: string | undefined): string | undefined {
		if (value === undefined) return undefined;
		return this.lookupOrAdd(this.templates, value, 'template');
	}

	literal(value: string | undefined): string | undefined {
		if (value === undefined) return undefined;
		return this.lookupOrAdd(this.literals, value, 'literal');
	}

	description(value: string | undefined): string | undefined {
		if (value === undefined) return undefined;
		return this.lookupOrAdd(this.descriptions, value, 'text');
	}

	debugValue(value: unknown, key = ''): unknown {
		if (value === null || value === undefined) return value;
		if (typeof value === 'string') return this.debugString(value, key);
		if (typeof value !== 'object') return value;
		if (Array.isArray(value)) return value.map((item) => this.debugValue(item, key));

		const out: Record<string, unknown> = {};
		for (const [childKey, child] of Object.entries(value as Record<string, unknown>)) {
			out[childKey] = this.debugValue(child, childKey);
		}
		return out;
	}

	private debugString(value: string, key: string): string {
		const normalizedKey = key.toLowerCase();
		if (/rule(?:id|name)?$/.test(normalizedKey)) return this.rule(value) ?? value;
		if (/group(?:id|name)?$/.test(normalizedKey)) return this.group(value) ?? value;
		if (/folder(?:path|name)?$/.test(normalizedKey)) return this.folderPath(value);
		if (/tag(?:s|path|name)?$/.test(normalizedKey)) return this.tag(value);
		if (/regex|pattern/.test(normalizedKey)) return this.regex(value) ?? value;
		if (/template/.test(normalizedKey)) return this.template(value) ?? value;

		let result = value.replace(/#[^\s,;\]}"']+/gu, (tag) => this.tag(tag));
		for (const [original, alias] of this.getReplacements()) {
			if (original.length < 3 || !result.includes(original)) continue;
			result = result.split(original).join(alias);
		}
		return result;
	}

	private getReplacements(): Array<[string, string]> {
		if (this.replacements) return this.replacements;
		const pairs: Array<[string, string]> = [];
		const add = (map: Map<string, string>): void => {
			for (const pair of map) pairs.push(pair);
		};
		add(this.rules);
		add(this.groups);
		add(this.regexes);
		add(this.templates);
		add(this.literals);
		add(this.descriptions);

		for (const [segment, alias] of this.folders) pairs.push([segment, alias]);
		for (const [segment, alias] of this.tags) pairs.push([segment, alias]);

		pairs.sort((a, b) => b[0].length - a[0].length || compareCodePoints(a[0], b[0]));
		this.replacements = pairs;
		return pairs;
	}

	private lookupOrAdd(map: Map<string, string>, value: string, prefix: string): string {
		if (value === '') return '';
		const existing = map.get(value);
		if (existing) return existing;
		const alias = numberedAlias(prefix, map.size + 1);
		map.set(value, alias);
		this.replacements = null;
		return alias;
	}
}

function buildAliases(snapshot: SupportSnapshot): AliasRegistry {
	const aliases = new AliasRegistry();
	const folderSegments = new Set<string>();
	const groups = new Set<string>();
	const tags = new Set<string>();
	const regexes = new Set<string>();
	const templates = new Set<string>();
	const literals = new Set<string>();
	const descriptions = new Set<string>();

	const addFolderPath = (path: string | undefined): void => {
		if (!path) return;
		for (const segment of path.split('/')) if (segment !== '') folderSegments.add(segment);
	};
	const addTag = (tag: string | undefined): void => {
		if (tag) tags.add(tag);
	};
	const addRegex = (regex: string | undefined): void => {
		if (regex) regexes.add(regex);
	};
	const addTemplate = (template: string | undefined): void => {
		if (template) templates.add(template);
	};

	for (const path of snapshot.vault.folderPaths) addFolderPath(path);
	addFolderPath(snapshot.configuration.options.defaultFolderForUntagged);
	for (const group of snapshot.configuration.groupPrecedence ?? []) groups.add(group);

	for (const rule of snapshot.configuration.rules) {
		if (rule.group) groups.add(rule.group);
		if (rule.description) descriptions.add(rule.description);
		addFolderPath(rule.folderEntryPoint);
		if (typeof rule.folderAnchor === 'object') addFolderPath(rule.folderAnchor.under);
		addTag(rule.tagEntryPoint);
		addRegex(rule.folderPattern);
		addRegex(rule.tagPattern);
		addTemplate(rule.folderTemplate);
		addTemplate(rule.tagTemplate);
		collectTransforms(rule.folderTransforms, regexes, literals);
		collectTransforms(rule.tagTransforms, regexes, literals);
		collectTransferValues(rule.transfer, tags, literals);
		collectTransferValues(rule.inverseTransfer, tags, literals);
	}

	for (const result of snapshot.diagnostics.detection.details.results) {
		for (const signal of result.matchedSignals) {
			addRegex(signal.folderRegex);
			for (const path of signal.exampleMatches) addFolderPath(path);
		}
	}
	for (const signal of snapshot.diagnostics.detection.details.signals) addRegex(signal.regex);
	for (const hit of snapshot.diagnostics.detection.details.hitsByFolder) {
		addFolderPath(hit.folderPath);
		for (const signal of hit.hits) addRegex(signal.signalRegex);
	}
	for (const folder of snapshot.diagnostics.installedRules.details.folders) {
		addFolderPath(folder.folderPath);
		for (const tag of folder.emittedTags) addTag(tag);
	}

	collectDebugTags(snapshot.debugEntries, tags);
	aliases.registerFolders(folderSegments);
	aliases.registerRulePairs(snapshot.configuration.rules);
	aliases.registerGroups(groups);
	aliases.registerTags(tags);
	aliases.registerRegexes(regexes);
	aliases.registerTemplates(templates);
	aliases.registerLiterals(literals);
	aliases.registerDescriptions(descriptions);
	return aliases;
}

function anonymizeSettings(
	settings: DynamicTagsFoldersSettings,
	aliases: AliasRegistry,
): DynamicTagsFoldersSettings {
	const clone = cloneJsonish(settings);
	clone.rules = clone.rules.map((rule) => anonymizeRule(rule, aliases));
	clone.options.defaultFolderForUntagged = aliases.folderPath(
		clone.options.defaultFolderForUntagged,
	);
	if (clone.groupPrecedence) {
		clone.groupPrecedence = clone.groupPrecedence.map((group) => aliases.group(group)!);
	}
	return clone;
}

function anonymizeRule(rule: MappingRule, aliases: AliasRegistry): MappingRule {
	const clone = cloneJsonish(rule);
	clone.id = aliases.rule(rule.id)!;
	clone.name = aliases.rule(rule.name)!;
	clone.description = aliases.description(rule.description);
	clone.group = aliases.group(rule.group);
	clone.folderPattern = aliases.regex(rule.folderPattern);
	clone.tagPattern = aliases.regex(rule.tagPattern);
	clone.folderTemplate = aliases.template(rule.folderTemplate);
	clone.tagTemplate = aliases.template(rule.tagTemplate);
	if (clone.folderEntryPoint !== undefined) {
		clone.folderEntryPoint = aliases.folderPath(clone.folderEntryPoint);
	}
	if (typeof clone.folderAnchor === 'object') {
		clone.folderAnchor.under = aliases.folderPath(clone.folderAnchor.under);
	}
	if (clone.tagEntryPoint !== undefined) clone.tagEntryPoint = aliases.tag(clone.tagEntryPoint);
	clone.folderTransforms = anonymizeTransforms(clone.folderTransforms, aliases);
	clone.tagTransforms = anonymizeTransforms(clone.tagTransforms, aliases);
	clone.transfer = anonymizeTransfer(clone.transfer, aliases);
	clone.inverseTransfer = anonymizeTransfer(clone.inverseTransfer, aliases);
	return clone;
}

function anonymizeTransforms(
	transforms: TransformConfig | undefined,
	aliases: AliasRegistry,
): TransformConfig | undefined {
	if (!transforms) return undefined;
	const clone = cloneJsonish(transforms);
	if (clone.customTransforms) {
		clone.customTransforms = clone.customTransforms.map((transform) => ({
			pattern: aliases.regex(transform.pattern)!,
			replacement: aliases.literal(transform.replacement)!,
			flags: transform.flags,
		}));
	}
	return clone;
}

function anonymizeDetection(
	detection: DetectionDiagnostics,
	aliases: AliasRegistry,
): DetectionDiagnostics {
	return {
		summary: cloneJsonish(detection.summary),
		details: {
			results: detection.details.results.map((result) => ({
				...cloneJsonish(result),
				matchedSignals: result.matchedSignals.map((signal) => ({
					...cloneJsonish(signal),
					folderRegex: aliases.regex(signal.folderRegex)!,
					exampleMatches: signal.exampleMatches.map((path) => aliases.folderPath(path)),
				})),
			})),
			signals: detection.details.signals.map((signal) => ({
				...cloneJsonish(signal),
				regex: aliases.regex(signal.regex)!,
			})),
			hitsByFolder: detection.details.hitsByFolder.map((hit) => ({
				folderPath: aliases.folderPath(hit.folderPath),
				hits: hit.hits.map((signal) => ({
					...cloneJsonish(signal),
					signalRegex: aliases.regex(signal.signalRegex)!,
				})),
			})),
		},
	};
}

function anonymizeInstalledRules(
	diagnostics: InstalledRuleDiagnostics,
	aliases: AliasRegistry,
): InstalledRuleDiagnostics {
	return {
		summary: cloneJsonish(diagnostics.summary),
		details: {
			folders: diagnostics.details.folders.map((folder) =>
				anonymizeFolderRuleDetail(folder, aliases),
			),
			rules: diagnostics.details.rules.map((rule) =>
				anonymizeRuleCoverageDetail(rule, aliases),
			),
		},
	};
}

function anonymizeFolderRuleDetail(
	folder: FolderRuleDetail,
	aliases: AliasRegistry,
): FolderRuleDetail {
	return {
		folderPath: aliases.folderPath(folder.folderPath),
		winnerRuleId: aliases.rule(folder.winnerRuleId),
		winnerRuleName: aliases.rule(folder.winnerRuleName),
		emittedTags: folder.emittedTags.map((tag) => aliases.tag(tag)),
		matchingRuleIds: folder.matchingRuleIds.map((id) => aliases.rule(id)!),
		conflict: folder.conflict,
	};
}

function anonymizeRuleCoverageDetail(
	rule: RuleCoverageDetail,
	aliases: AliasRegistry,
): RuleCoverageDetail {
	return {
		...cloneJsonish(rule),
		ruleId: aliases.rule(rule.ruleId)!,
		ruleName: aliases.rule(rule.ruleName)!,
	};
}

function collectTransferValues(
	transfer: TransferOp | undefined,
	tags: Set<string>,
	literals: Set<string>,
): void {
	if (!transfer) return;
	if (transfer.op === 'marker-only') tags.add(transfer.marker);
	if (transfer.op === 'aggregation') literals.add(transfer.separator);
	if (transfer.op === 'truncation' && transfer.separator) literals.add(transfer.separator);
}

function anonymizeTransfer(
	transfer: TransferOp | undefined,
	aliases: AliasRegistry,
): TransferOp | undefined {
	if (!transfer) return undefined;
	const clone = cloneJsonish(transfer);
	if (clone.op === 'marker-only') clone.marker = aliases.tag(clone.marker);
	if (clone.op === 'aggregation') clone.separator = aliases.literal(clone.separator)!;
	if (clone.op === 'truncation' && clone.separator) {
		clone.separator = aliases.literal(clone.separator);
	}
	return clone;
}

function collectTransforms(
	transforms: TransformConfig | undefined,
	regexes: Set<string>,
	literals: Set<string>,
): void {
	for (const transform of transforms?.customTransforms ?? []) {
		if (transform.pattern) regexes.add(transform.pattern);
		if (transform.replacement) literals.add(transform.replacement);
	}
}

function collectDebugTags(value: unknown, tags: Set<string>): void {
	if (typeof value === 'string') {
		for (const match of value.matchAll(/#[^\s,;\]}"']+/gu)) tags.add(match[0]);
		return;
	}
	if (!value || typeof value !== 'object') return;
	if (Array.isArray(value)) {
		for (const item of value) collectDebugTags(item, tags);
		return;
	}
	for (const child of Object.values(value as Record<string, unknown>)) {
		collectDebugTags(child, tags);
	}
}

function splitTag(value: string): string[] {
	return (value.startsWith('#') ? value.slice(1) : value).split('/');
}

function registerSorted(
	map: Map<string, string>,
	values: Iterable<string>,
	prefix: string,
): void {
	const sorted = [...new Set([...values].filter((value) => value !== ''))]
		.sort(compareCodePoints);
	for (const value of sorted) {
		if (!map.has(value)) map.set(value, numberedAlias(prefix, map.size + 1));
	}
}

function numberedAlias(prefix: string, index: number): string {
	return `${prefix}-${String(index).padStart(3, '0')}`;
}

function cloneJsonish<T>(value: T): T {
	if (value === null || typeof value !== 'object') return value;
	if (Array.isArray(value)) return value.map((item) => cloneJsonish(item)) as T;
	const clone: Record<string, unknown> = {};
	for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
		clone[key] = cloneJsonish(child);
	}
	return clone as T;
}

function compareCodePoints(a: string, b: string): number {
	return a < b ? -1 : a > b ? 1 : 0;
}
