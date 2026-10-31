#!/usr/bin/env node
/**
 * Release tag classifier and gate.
 *
 * `.github/workflows/release.yml` runs this BEFORE any release side effect. It
 * decides which publication channel a tag belongs to, and refuses anything it
 * does not recognise instead of guessing.
 *
 * Two channels, and nothing else:
 *
 *   stable  `X.Y.Z`                          -> prerelease=false, make_latest=true
 *   test    `X.Y.Z-workbench-outline.N`      -> prerelease=true,  make_latest=false
 *
 * Why the test suffix sorts the way it does: BRAT (obsidian42-brat) does not
 * read GitHub's "latest release" flag at all. `grabReleaseFromRepository` lists
 * every release and picks the semver-highest. Its `includePrereleases` parameter
 * defaults to false and the install/update call sites pass their
 * `getBetaManifest`/`getManifest` argument straight into it, so pre-releases are
 * only pulled in on the `manifest-beta.json` probe -- which this repo does not
 * ship. `prerelease: true` therefore does isolate a prototype from ordinary
 * followers, but it is not the only thing doing the work. What also keeps them
 * away is semver order: `0.1.41-workbench-outline.1` sorts BELOW `0.1.41`,
 * so `latest` followers keep resolving to the stable release. The
 * `requireStableBase` check below is what protects that invariant: a test tag
 * is only accepted when its base `X.Y.Z` already exists as a stable tag, which
 * makes it impossible to publish a prototype that outranks every stable
 * release. The prerelease and make_latest flags are defence in depth on top.
 *
 * A git tag is NOT the thing BRAT ranks. `grabReleaseFromRepository` reads
 * `/repos/:owner/:repo/releases`, which lists *published* releases only --
 * drafts are invisible to it. So a base version that exists as a git tag but
 * has no published release (or only a draft one) gives no protection at all:
 * the prototype would be the semver-highest release GitHub reports, and
 * `latest` followers would resolve to it. `requirePublishedStableBase` closes
 * that gap by requiring the base version to appear in the list of *published,
 * non-draft* stable releases, which `release.yml` reads from the GitHub API.
 * Both checks must pass, and an unavailable/empty release list is a refusal,
 * not a pass.
 *
 * Usage:
 *   node scripts/validate-release-tag.mjs <tag> [--manifest path] [--stable-tags "a,b,c"] [--stable-releases "a,b,c"] [--github-output path]
 */

import { readFileSync } from 'node:fs';

const STABLE_TAG = /^(\d+)\.(\d+)\.(\d+)$/;
const TEST_TAG = /^(\d+)\.(\d+)\.(\d+)-workbench-outline\.(\d+)$/;

export class ReleaseTagError extends Error {}

/**
 * Classify a tag into a publication channel.
 *
 * @param {string} tag
 * @param {{
 *   stableTags?: string[],
 *   requireStableBase?: boolean,
 *   stableReleases?: string[],
 *   requirePublishedStableBase?: boolean,
 * }} [options]
 * @returns {{ channel: 'stable'|'test', tag: string, baseVersion: string, prerelease: boolean, makeLatest: 'true'|'false' }}
 */
export function classifyReleaseTag(tag, options = {}) {
	if (typeof tag !== 'string' || tag.length === 0) {
		throw new ReleaseTagError('No tag supplied.');
	}
	if (tag !== tag.trim()) {
		throw new ReleaseTagError(`Tag ${JSON.stringify(tag)} has leading or trailing whitespace.`);
	}
	if (tag.startsWith('refs/tags/')) {
		throw new ReleaseTagError(
			`Pass the bare tag name, not the ref: got ${JSON.stringify(tag)}.`,
		);
	}

	const stable = STABLE_TAG.exec(tag);
	if (stable) {
		return {
			channel: 'stable',
			tag,
			baseVersion: tag,
			prerelease: false,
			makeLatest: 'true',
		};
	}

	const test = TEST_TAG.exec(tag);
	if (test) {
		const baseVersion = `${test[1]}.${test[2]}.${test[3]}`;
		if (options.requireStableBase) {
			const stableTags = options.stableTags ?? [];
			if (!stableTags.includes(baseVersion)) {
				throw new ReleaseTagError(
					`Test tag ${tag} has base version ${baseVersion}, which is not an existing `
					+ 'stable release tag. A workbench-outline test build must hang off a stable '
					+ 'version that already exists, so it sorts below it for BRAT followers. '
					+ `Known stable tags: ${stableTags.length ? stableTags.join(', ') : '(none found)'}.`,
				);
			}
		}
		if (options.requirePublishedStableBase) {
			// A git tag proves nothing to BRAT: it ranks *published* releases, and
			// a draft release is not in that list. Fail closed when the published
			// set is missing, empty, or does not contain the base version.
			const stableReleases = options.stableReleases ?? [];
			if (stableReleases.length === 0) {
				throw new ReleaseTagError(
					`Test tag ${tag} cannot be validated: no published stable releases were `
					+ 'supplied. The base version must already be published (not a draft) or a '
					+ 'test build becomes the semver-highest release BRAT can see.',
				);
			}
			if (!stableReleases.includes(baseVersion)) {
				throw new ReleaseTagError(
					`Test tag ${tag} has base version ${baseVersion}, which is not a published, `
					+ 'non-draft stable GitHub release. A git tag alone gives no protection: BRAT '
					+ 'ranks published releases and never sees drafts, so this build would become '
					+ 'the highest release ordinary followers resolve. '
					+ `Published stable releases: ${stableReleases.join(', ')}.`,
				);
			}
		}
		return {
			channel: 'test',
			tag,
			baseVersion,
			prerelease: true,
			makeLatest: 'false',
		};
	}

	throw new ReleaseTagError(
		`Tag ${JSON.stringify(tag)} is not a recognised release tag. `
		+ 'Expected a stable tag "X.Y.Z" or a test tag "X.Y.Z-workbench-outline.N".',
	);
}

/**
 * The tag and the shipped manifest version must be byte-identical.
 *
 * BRAT overwrites the manifest version with the coerced tag when they disagree
 * (validateRepository in BetaPlugins.ts) and shows a "Version mismatch
 * detected" notice, so a mismatch silently changes what testers end up running.
 *
 * @param {string} tag
 * @param {string} manifestVersion
 */
export function assertManifestMatchesTag(tag, manifestVersion) {
	if (manifestVersion !== tag) {
		throw new ReleaseTagError(
			`manifest.json version ${JSON.stringify(manifestVersion)} does not equal tag `
			+ `${JSON.stringify(tag)}. They must match exactly.`,
		);
	}
}

function readManifestVersion(manifestPath) {
	let raw;
	try {
		raw = readFileSync(manifestPath, 'utf8');
	} catch (error) {
		throw new ReleaseTagError(`Could not read ${manifestPath}: ${error.message}`);
	}
	let parsed;
	try {
		parsed = JSON.parse(raw);
	} catch (error) {
		throw new ReleaseTagError(`${manifestPath} is not valid JSON: ${error.message}`);
	}
	if (typeof parsed.version !== 'string' || parsed.version.length === 0) {
		throw new ReleaseTagError(`${manifestPath} has no usable "version" string.`);
	}
	return parsed.version;
}

function parseArgs(argv) {
	const positional = [];
	const flags = {};
	for (let index = 0; index < argv.length; index += 1) {
		const arg = argv[index];
		if (arg.startsWith('--')) {
			flags[arg.slice(2)] = argv[index + 1];
			index += 1;
		} else {
			positional.push(arg);
		}
	}
	return { positional, flags };
}

/** Keep only well-formed `X.Y.Z` entries; anything else is dropped, not trusted. */
function parseStableList(raw) {
	return (raw ?? '')
		.split(/[\s,]+/)
		.map((value) => value.trim())
		.filter((value) => STABLE_TAG.test(value));
}

export function main(argv) {
	const { positional, flags } = parseArgs(argv);
	const tag = positional[0];
	const manifestPath = flags.manifest ?? 'manifest.json';
	const stableTags = parseStableList(flags['stable-tags']);
	const stableReleases = parseStableList(flags['stable-releases']);

	const classified = classifyReleaseTag(tag, {
		stableTags,
		requireStableBase: true,
		stableReleases,
		requirePublishedStableBase: true,
	});
	const manifestVersion = readManifestVersion(manifestPath);
	assertManifestMatchesTag(classified.tag, manifestVersion);

	return { ...classified, manifestVersion, manifestPath };
}

// CLI entry point. Kept side-effect free when imported.
if (process.argv[1] && process.argv[1].endsWith('validate-release-tag.mjs')) {
	try {
		const result = main(process.argv.slice(2));
		const lines = [
			`channel=${result.channel}`,
			`tag=${result.tag}`,
			`base_version=${result.baseVersion}`,
			`prerelease=${result.prerelease}`,
			`make_latest=${result.makeLatest}`,
		];
		process.stdout.write(`${lines.join('\n')}\n`);

		const outputPath = parseArgs(process.argv.slice(2)).flags['github-output']
			?? process.env.GITHUB_OUTPUT;
		if (outputPath) {
			const { appendFileSync } = await import('node:fs');
			appendFileSync(outputPath, `${lines.join('\n')}\n`);
		}
	} catch (error) {
		process.stderr.write(`Release tag rejected: ${error.message}\n`);
		process.exit(1);
	}
}
