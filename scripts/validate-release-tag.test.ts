// Static validation for the release workflow's tag gate.
//
// Run with `bun test scripts` (the default `bun test src` deliberately only
// covers plugin source, so this file is not part of that surface).
//
// These cases mirror exactly what `.github/workflows/release.yml` asks the
// validator before it is allowed to create a release. They cannot prove how
// GitHub behaves at runtime -- only that the classification and the refusals
// are what the workflow expects.

import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'bun:test';
import YAML from 'yaml';
// @ts-expect-error -- plain .mjs helper, no type declarations by design.
import { assertManifestMatchesTag, classifyReleaseTag } from './validate-release-tag.mjs';

const KNOWN_STABLE = ['0.1.38', '0.1.39', '0.1.40', '0.1.41'];

describe('release tag classification', () => {
	it('treats a bare X.Y.Z tag as the stable channel', () => {
		expect(classifyReleaseTag('0.1.41')).toEqual({
			channel: 'stable',
			tag: '0.1.41',
			baseVersion: '0.1.41',
			prerelease: false,
			makeLatest: 'true',
		});
	});

	it('treats a workbench-outline tag as the test channel, never latest', () => {
		expect(classifyReleaseTag('0.1.41-workbench-outline.1')).toEqual({
			channel: 'test',
			tag: '0.1.41-workbench-outline.1',
			baseVersion: '0.1.41',
			prerelease: true,
			makeLatest: 'false',
		});
	});

	it('accepts a test tag whose base version is an existing stable release', () => {
		const classified = classifyReleaseTag('0.1.41-workbench-outline.2', {
			stableTags: KNOWN_STABLE,
			requireStableBase: true,
		});
		expect(classified.channel).toBe('test');
		expect(classified.prerelease).toBe(true);
		expect(classified.makeLatest).toBe('false');
	});

	it('refuses a test tag whose base version outranks every stable release', () => {
		// 0.1.42-workbench-outline.1 sorts ABOVE the stable 0.1.41, so BRAT's
		// semver-ordered selector would hand the prototype to ordinary followers.
		expect(() => classifyReleaseTag('0.1.42-workbench-outline.1', {
			stableTags: KNOWN_STABLE,
			requireStableBase: true,
		})).toThrow(/not an existing stable release tag/);
	});

	for (const rejected of [
		'v0.1.41',
		'0.1.41-beta.1',
		'0.1.41-workbench-outline',
		'0.1.41-workbench-outline.',
		'0.1.41-workbench-outline.1.2',
		'0.1',
		'0.1.41.1',
		'latest',
		'release-0.1.41',
		'0.1.41 ',
		' 0.1.41',
		'refs/tags/0.1.41',
		'',
	]) {
		it(`refuses the unsupported tag ${JSON.stringify(rejected)}`, () => {
			expect(() => classifyReleaseTag(rejected, {
				stableTags: KNOWN_STABLE,
				requireStableBase: true,
			})).toThrow();
		});
	}
});

// BRAT ranks PUBLISHED releases (grabReleaseFromRepository reads
// /repos/:owner/:repo/releases and takes the semver-highest entry). Draft
// releases are absent from that list, so "a stable git tag exists" is not
// evidence that a stable release exists for BRAT to outrank a test build. This
// repository already demonstrates the divergence: 0.1.0 is a draft release.
describe('published stable base (the BRAT-visible check)', () => {
	const PUBLISHED = ['0.1.39', '0.1.40', '0.1.41'];

	it('accepts a test tag whose base is a published, non-draft stable release', () => {
		const classified = classifyReleaseTag('0.1.41-workbench-outline.1', {
			stableTags: KNOWN_STABLE,
			requireStableBase: true,
			stableReleases: PUBLISHED,
			requirePublishedStableBase: true,
		});
		expect(classified.channel).toBe('test');
		expect(classified.baseVersion).toBe('0.1.41');
		expect(classified.prerelease).toBe(true);
		expect(classified.makeLatest).toBe('false');
	});

	it('refuses a test tag whose base is only a git tag, with no published release', () => {
		// The exact hazard: 0.1.42 was tagged, the release was never published (or
		// is still a draft), so 0.1.42-workbench-outline.1 would be the highest
		// release BRAT can see.
		expect(() => classifyReleaseTag('0.1.42-workbench-outline.1', {
			stableTags: [...KNOWN_STABLE, '0.1.42'],
			requireStableBase: true,
			stableReleases: PUBLISHED,
			requirePublishedStableBase: true,
		})).toThrow(/not a published, non-draft stable GitHub release/);
	});

	it('fails closed when the published release list is unavailable or empty', () => {
		expect(() => classifyReleaseTag('0.1.41-workbench-outline.1', {
			stableTags: KNOWN_STABLE,
			requireStableBase: true,
			stableReleases: [],
			requirePublishedStableBase: true,
		})).toThrow(/no published stable releases were supplied/);
	});

	it('does not require a published base for a stable tag', () => {
		expect(() => classifyReleaseTag('0.1.42', {
			stableTags: KNOWN_STABLE,
			requireStableBase: true,
			stableReleases: [],
			requirePublishedStableBase: true,
		})).not.toThrow();
	});
});

describe('tag / manifest version agreement', () => {
	it('accepts an exact match', () => {
		expect(() => assertManifestMatchesTag('0.1.41-workbench-outline.1', '0.1.41-workbench-outline.1'))
			.not.toThrow();
	});

	for (const [tag, manifestVersion] of [
		['0.1.41', '0.1.40'],
		['0.1.41-workbench-outline.1', '0.1.41'],
		['0.1.41', '0.1.41-workbench-outline.1'],
		['0.1.41', 'v0.1.41'],
		['0.1.41', '0.1.41 '],
	]) {
		it(`refuses tag ${tag} against manifest version ${JSON.stringify(manifestVersion)}`, () => {
			expect(() => assertManifestMatchesTag(tag, manifestVersion)).toThrow(/does not equal tag/);
		});
	}
});

// Static checks on the workflow file itself. These are structural assertions
// about what release.yml declares -- they cannot observe GitHub's runtime
// behaviour, but they do catch the exact hazards the old workflow shipped:
// a wildcard tag trigger, a missing prerelease flag, an action version with no
// make_latest input, broad upload globs, and blanket write permissions.
describe('release workflow declarations', () => {
	const workflow = YAML.parse(readFileSync('.github/workflows/release.yml', 'utf8'));
	// YAML 1.1 parsers can fold a bare `on:` key to boolean true; accept either.
	const triggers = workflow.on ?? workflow[true as unknown as string];
	const publish = workflow.jobs.publish;
	const releaseStep = publish.steps.find(
		(step: { uses?: string }) => step.uses?.startsWith('softprops/action-gh-release'),
	);

	it('never triggers on a wildcard tag', () => {
		expect(triggers.push.tags).not.toContain('*');
		expect(triggers.push.tags).toEqual(['[0-9]+.[0-9]+.[0-9]+']);
	});

	it('offers a manual dispatch gate with a confirmation input', () => {
		expect(triggers).toHaveProperty('workflow_dispatch');
		expect(Object.keys(triggers.workflow_dispatch.inputs)).toEqual(['tag', 'confirm', 'validation_only']);
	});

	it('defaults manual runs to validation and guards the release side effect', () => {
		expect(triggers.workflow_dispatch.inputs.validation_only).toEqual({
			description: 'Run validation and build without creating or updating a release',
			required: true,
			type: 'boolean',
			default: true,
		});
		expect(releaseStep.if).toBe("github.event_name != 'workflow_dispatch' || !inputs.validation_only");
		const confirmation = workflow.jobs.classify.steps.find(
			(step: { name?: string }) => step.name === 'Require explicit confirmation on manual dispatch',
		);
		expect(confirmation.if).toBe(
			"github.event_name == 'workflow_dispatch' && !inputs.validation_only && inputs.confirm != 'PUBLISH'",
		);
		// Validation still exercises dependency setup and the production build.
		expect(publish.if).toBeUndefined();
		const build = publish.steps.find((step: { run?: string }) => step.run === 'bun run build');
		expect(build).toBeDefined();
		expect(build.if).toBeUndefined();
	});

	it('grants no permissions by default and write only to the publishing job', () => {
		expect(workflow.permissions).toEqual({});
		expect(workflow.jobs.classify.permissions).toEqual({ contents: 'read' });
		expect(publish.permissions).toEqual({ contents: 'write' });
	});

	it('validates the tag in a separate job that the publish job depends on', () => {
		expect(publish.needs).toBe('classify');
		const gate = workflow.jobs.classify.steps
			.map((step: { run?: string }) => step.run ?? '')
			.join('\n');
		expect(gate).toContain('validate-release-tag.mjs');
	});

	it('installs locked dependencies after the gate and before validator self-tests', () => {
		const steps = workflow.jobs.classify.steps as Array<{
			id?: string;
			uses?: string;
			run?: string;
			'continue-on-error'?: boolean;
		}>;
		const checkout = steps.findIndex((step) => step.uses?.startsWith('actions/checkout@'));
		const setup = steps.findIndex((step) => step.uses?.startsWith('oven-sh/setup-bun@'));
		const gate = steps.findIndex((step) => step.id === 'gate');
		const install = steps.findIndex((step) => step.run?.startsWith('bun install'));
		const selfTest = steps.findIndex((step) => step.run === 'bun test scripts');

		expect(checkout).toBeGreaterThanOrEqual(0);
		expect(setup).toBeGreaterThan(checkout);
		expect(gate).toBeGreaterThan(setup);
		expect(install).toBeGreaterThan(gate);
		expect(selfTest).toBeGreaterThan(install);
		expect(steps[install]?.run).toBe('bun install --frozen-lockfile --ignore-scripts');
		expect(steps[install]?.['continue-on-error']).not.toBe(true);
		expect(steps[selfTest]?.['continue-on-error']).not.toBe(true);
	});

	it('checks the base version against published, non-draft releases, not just tags', () => {
		const steps = workflow.jobs.classify.steps as Array<{ id?: string; run?: string }>;
		const published = steps.find((step) => step.id === 'published');
		expect(published).toBeDefined();
		// Drafts are invisible to BRAT, so they must be excluded here too.
		expect(published?.run).toContain('draft == false');
		expect(published?.run).toContain('/releases');
		const gate = steps.find((step) => step.id === 'gate');
		expect(gate?.run).toContain('--stable-releases');
		expect(gate?.run).toContain('--stable-tags');
	});

	it('guards the free-text dispatch tag before it reaches an output or a checkout ref', () => {
		const resolve = (workflow.jobs.classify.steps as Array<{ id?: string; run?: string }>)
			.find((step) => step.id === 'resolve');
		expect(resolve?.run).toContain('[!0-9A-Za-z.-]');
	});

	it('pins the release action to a commit SHA that exposes make_latest', () => {
		expect(releaseStep.uses).toMatch(/^softprops\/action-gh-release@[0-9a-f]{40}$/);
		expect(releaseStep.with).toHaveProperty('make_latest');
		expect(releaseStep.with).toHaveProperty('prerelease');
	});

	it('drives prerelease and make_latest from the classifier, not from a constant', () => {
		expect(releaseStep.with.prerelease).toBe('${{ needs.classify.outputs.prerelease }}');
		expect(releaseStep.with.make_latest).toBe('${{ needs.classify.outputs.make_latest }}');
	});

	it('uploads exactly the three plugin assets and nothing matched by a glob', () => {
		const files = String(releaseStep.with.files)
			.split('\n')
			.map((file: string) => file.trim())
			.filter(Boolean);
		expect(files).toEqual(['main.js', 'manifest.json', 'styles.css']);
		for (const file of files) {
			expect(file).not.toMatch(/[*?[\]]/);
		}
		expect(releaseStep.with.fail_on_unmatched_files).toBe(true);
	});
});
