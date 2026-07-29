#!/usr/bin/env node
/**
 * Builds rule-packs/manifest.json and rule-packs/catalog.json from every
 * source pack JSON file in rule-packs/.
 *
 * Validation: parses every pack, runs basic schema checks, fails the build
 * on any error. Bundle-size guard: any single pack > 25KB or total > 200KB
 * fails the build (community PRs that bloat the bundle won't merge).
 *
 * Run via: bun run scripts/build-rule-pack-manifest.mjs
 * Wired into the build pipeline so manifest stays in sync with packs.
 */

import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { resolve, join, basename } from 'node:path';

const PACKS_DIR = resolve(process.cwd(), 'rule-packs');
const MANIFEST_PATH = join(PACKS_DIR, 'manifest.json');
const CATALOG_PATH = join(PACKS_DIR, 'catalog.json');
const GENERATED_FILES = new Set(['manifest.json', 'catalog.json']);
const PACK_SIZE_BYTES = 25 * 1024;
const TOTAL_SIZE_BYTES = 200 * 1024;

const errors = [];
const packs = [];
const catalog = {};
const seenPackIds = new Set();
let totalBytes = 0;

function isRecord(value) {
	return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function validatePositiveInteger(value, path, entry) {
	if (value === undefined) return;
	if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isInteger(value) || value <= 0) {
		errors.push(`${entry}: ${path} must be a positive integer`);
	}
}

function validateEnum(value, allowed, path, entry) {
	if (value === undefined) return;
	if (typeof value !== 'string' || !allowed.includes(value)) {
		errors.push(`${entry}: ${path} must be one of: ${allowed.join(', ')}`);
	}
}

function validateDetection(detection, entry) {
	if (detection === undefined) return;
	if (!isRecord(detection)) {
		errors.push(`${entry}: 'detection' must be an object`);
		return;
	}

	validatePositiveInteger(detection.minSignals, 'detection.minSignals', entry);
	validateEnum(
		detection.scopedUnderMode,
		['local', 'pack-global'],
		'detection.scopedUnderMode',
		entry,
	);
	if (
		detection.scopedUnder !== undefined
		&& detection.scopedUnder !== null
		&& (typeof detection.scopedUnder !== 'string' || detection.scopedUnder.trim() === '')
	) {
		errors.push(`${entry}: detection.scopedUnder must be null or a non-empty string`);
	}

	if (detection.occurrence !== undefined) {
		if (!isRecord(detection.occurrence)) {
			errors.push(`${entry}: detection.occurrence must be an object`);
		} else {
			validateEnum(
				detection.occurrence.countBy,
				['roles', 'folders'],
				'detection.occurrence.countBy',
				entry,
			);
			validatePositiveInteger(
				detection.occurrence.minEvidence,
				'detection.occurrence.minEvidence',
				entry,
			);
		}
	}

	if (!Array.isArray(detection.anyOf)) {
		errors.push(`${entry}: 'detection.anyOf' must be an array of signals`);
		return;
	}
	for (const [i, signal] of detection.anyOf.entries()) {
		const prefix = `detection.anyOf[${i}]`;
		if (!isRecord(signal)) {
			errors.push(`${entry}: ${prefix} must be an object`);
			continue;
		}
		if (typeof signal.folderRegex !== 'string' || signal.folderRegex.length === 0) {
			errors.push(`${entry}: ${prefix}.folderRegex must be a non-empty string`);
			continue;
		}
		try {
			new RegExp(signal.folderRegex, 'i');
		} catch (err) {
			errors.push(`${entry}: ${prefix}.folderRegex invalid — ${err.message}`);
		}
		validateEnum(signal.scope, ['name', 'path', 'leafName'], `${prefix}.scope`, entry);
		validateEnum(signal.relation, ['member', 'support'], `${prefix}.relation`, entry);
		if (signal.label !== undefined && typeof signal.label !== 'string') {
			errors.push(`${entry}: ${prefix}.label must be a string`);
		}
		if (
			signal.role !== undefined
			&& (typeof signal.role !== 'string' || signal.role.trim() === '')
		) {
			errors.push(`${entry}: ${prefix}.role must be a non-empty string`);
		}
	}
}

const entries = readdirSync(PACKS_DIR)
	.filter((f) => f.endsWith('.json') && !GENERATED_FILES.has(f))
	.sort((a, b) => a.localeCompare(b));

for (const entry of entries) {
	const filePath = join(PACKS_DIR, entry);
	const stat = statSync(filePath);
	const fallbackId = basename(entry, '.json');

	if (stat.size > PACK_SIZE_BYTES) {
		errors.push(
			`${entry}: ${(stat.size / 1024).toFixed(1)}KB exceeds ${PACK_SIZE_BYTES / 1024}KB per-pack budget`,
		);
		continue;
	}
	totalBytes += stat.size;

	let pack;
	try {
		pack = JSON.parse(readFileSync(filePath, 'utf-8'));
	} catch (err) {
		errors.push(`${entry}: JSON parse error — ${err.message}`);
		continue;
	}

	const packId = pack.id ?? fallbackId;
	if (typeof packId !== 'string' || packId.trim() === '') {
		errors.push(`${entry}: 'id' must be a non-empty string when provided`);
		continue;
	}
	if (seenPackIds.has(packId)) {
		errors.push(`${entry}: duplicate pack id '${packId}'`);
		continue;
	}
	seenPackIds.add(packId);

	const required = ['name', 'description', 'version', 'author', 'rules'];
	for (const field of required) {
		if (pack[field] === undefined) {
			errors.push(`${entry}: missing required field '${field}'`);
		}
	}
	if (!Array.isArray(pack.rules)) {
		errors.push(`${entry}: 'rules' must be an array`);
	}

	// Validate the full detection schema before metadata is embedded into main.js.
	validateDetection(pack.detection, entry);

	catalog[packId] = pack;
	packs.push({
		id: packId,
		file: entry,
		name: pack.name,
		description: pack.description,
		version: pack.version,
		author: pack.author,
		axes: pack.axes ?? [],
		compatibleWith: pack.compatibleWith ?? [],
		exclusiveWith: pack.exclusiveWith ?? [],
		ruleCount: Array.isArray(pack.rules) ? pack.rules.length : 0,
		// Include detection signals + establish summary directly in the
		// manifest so the bundled-into-main.js manifest carries enough info
		// to run detection without re-reading per-pack JSON files. Adds a
		// few hundred bytes per pack — well under the 25KB-per-pack budget.
		detection: pack.detection ?? null,
		establish: pack.establish ?? null,
		sizeBytes: stat.size,
	});
}

if (totalBytes > TOTAL_SIZE_BYTES) {
	errors.push(
		`Total rule-packs/ size ${(totalBytes / 1024).toFixed(1)}KB exceeds ${TOTAL_SIZE_BYTES / 1024}KB cap`,
	);
}

if (errors.length) {
	console.error('Pack manifest build failed:');
	for (const err of errors) console.error(`  • ${err}`);
	process.exit(1);
}

const manifest = {
	version: 1,
	generatedAt: new Date().toISOString(),
	packCount: packs.length,
	totalBytes,
	packs: packs.sort((a, b) => a.id.localeCompare(b.id)),
};

writeFileSync(MANIFEST_PATH, JSON.stringify(manifest, null, 2) + '\n');
writeFileSync(CATALOG_PATH, JSON.stringify(catalog, null, 2) + '\n');
console.log(
	`✓ rule-packs/manifest.json + catalog.json written — ${packs.length} packs, ${(totalBytes / 1024).toFixed(1)}KB total`,
);
