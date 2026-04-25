#!/usr/bin/env node
/**
 * Builds rule-packs/manifest.json from every *.json file in rule-packs/.
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
const PACK_SIZE_BYTES = 25 * 1024;
const TOTAL_SIZE_BYTES = 200 * 1024;

const errors = [];
const packs = [];
let totalBytes = 0;

const entries = readdirSync(PACKS_DIR).filter(
	(f) => f.endsWith('.json') && f !== 'manifest.json',
);

for (const entry of entries) {
	const filePath = join(PACKS_DIR, entry);
	const stat = statSync(filePath);
	const id = basename(entry, '.json');

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

	const required = ['name', 'description', 'version', 'author', 'rules'];
	for (const field of required) {
		if (pack[field] === undefined) {
			errors.push(`${entry}: missing required field '${field}'`);
		}
	}
	if (!Array.isArray(pack.rules)) {
		errors.push(`${entry}: 'rules' must be an array`);
	}

	// Validate detection regexes compile (catch typos before they hit users)
	if (pack.detection?.anyOf) {
		for (const [i, sig] of pack.detection.anyOf.entries()) {
			if (typeof sig.folderRegex !== 'string') {
				errors.push(`${entry}: detection.anyOf[${i}].folderRegex must be a string`);
				continue;
			}
			try {
				new RegExp(sig.folderRegex, 'i');
			} catch (err) {
				errors.push(`${entry}: detection.anyOf[${i}].folderRegex invalid — ${err.message}`);
			}
		}
	}

	packs.push({
		id: pack.id ?? id,
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
console.log(
	`✓ rule-packs/manifest.json written — ${packs.length} packs, ${(totalBytes / 1024).toFixed(1)}KB total`,
);
