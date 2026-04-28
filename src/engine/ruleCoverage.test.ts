/**
 * Tests for the rule-coverage analyzer — verifies forward/inverse coverage
 * computation, conflict detection, and the aggregate report shape.
 */

import { describe, expect, test } from 'bun:test';
import {
	computeForwardCoverage,
	computeInverseCoverage,
	computeConflicts,
	buildCoverageReport,
} from './ruleCoverage';
import { compileTemplate } from './compileTemplate';
import type { MappingRule } from '../types/settings';

const baseOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

function ruleWithTemplates(
	id: string,
	folder: string,
	tag: string,
	priority = 10,
): MappingRule {
	return {
		id,
		name: id,
		enabled: true,
		priority,
		direction: 'bidirectional',
		folderTemplate: folder,
		tagTemplate: tag,
		folderPattern: compileTemplate(folder).regex.source,
		tagPattern: compileTemplate(tag).regex.source,
		options: baseOptions,
	};
}

describe('ruleCoverage — forward', () => {
	const projectsRule = ruleWithTemplates(
		'projects',
		'Projects/{deeper...}',
		'#projects/{deeper...}',
	);
	const sampleVault = [
		'Projects',
		'Projects/Web',
		'Projects/Web/Auth',
		'Areas/Health',
		'Templates',
	];

	test('finds all matching folders + counts', () => {
		const cov = computeForwardCoverage(projectsRule, sampleVault);
		expect(cov.matchedFolderCount).toBe(3); // Projects + Projects/Web + Projects/Web/Auth
		expect(cov.matchedFolders).toEqual(['Projects', 'Projects/Web', 'Projects/Web/Auth']);
	});

	test('produces sample emissions for matched folders', () => {
		const cov = computeForwardCoverage(projectsRule, sampleVault);
		expect(cov.sampleEmissions.length).toBeGreaterThan(0);
		expect(cov.sampleEmissions[0].tags[0]).toMatch(/^#projects/);
	});

	test('respects maxSamples cap', () => {
		const manyVault = Array.from({ length: 50 }, (_, i) => `Projects/sub${i}`);
		const cov = computeForwardCoverage(projectsRule, manyVault, 5);
		expect(cov.matchedFolderCount).toBe(50);
		expect(cov.matchedFolders.length).toBe(5);
	});

	test('zero matches when no folder matches the rule', () => {
		const cov = computeForwardCoverage(projectsRule, ['Templates', 'Random']);
		expect(cov.matchedFolderCount).toBe(0);
		expect(cov.matchedFolders).toEqual([]);
		expect(cov.sampleEmissions).toEqual([]);
	});
});

describe('ruleCoverage — inverse', () => {
	const projectsRule = ruleWithTemplates(
		'projects',
		'Projects/{deeper...}',
		'#projects/{deeper...}',
	);
	const sampleTags = [
		'#projects/web',
		'#projects/auth/oauth',
		'#areas/health',
		'#topic',
	];

	test('finds tags matching the rule pattern', () => {
		const cov = computeInverseCoverage(projectsRule, sampleTags);
		expect(cov.matchedTagCount).toBe(2);
		expect(cov.matchedTags).toContain('#projects/web');
		expect(cov.matchedTags).toContain('#projects/auth/oauth');
	});

	test('handles tags with and without leading #', () => {
		const cov = computeInverseCoverage(projectsRule, ['projects/web', '#projects/x']);
		expect(cov.matchedTagCount).toBe(2);
	});
});

describe('ruleCoverage — conflicts', () => {
	test('detects folders matching 2+ rules', () => {
		const ruleA = ruleWithTemplates('rule-a', 'Projects/{deeper...}', '#a/{deeper...}');
		const ruleB = ruleWithTemplates('rule-b', '{root}/{deeper...}', '#all/{deeper...}');
		const conflicts = computeConflicts([ruleA, ruleB], [
			'Projects',
			'Projects/Web',
			'Areas/Health',
		]);
		// Projects + descendants match BOTH rule-a (Projects/...) and rule-b ({root}/...)
		expect(conflicts.length).toBeGreaterThan(0);
		const projectsConflict = conflicts.find(c => c.folderPath === 'Projects/Web');
		expect(projectsConflict).toBeDefined();
		expect(projectsConflict!.matchingRuleIds).toContain('rule-a');
		expect(projectsConflict!.matchingRuleIds).toContain('rule-b');
	});

	test('skips disabled rules', () => {
		const ruleA = ruleWithTemplates('rule-a', 'Projects/{deeper...}', '#a/{deeper...}');
		const ruleB = ruleWithTemplates('rule-b', 'Projects/{deeper...}', '#b/{deeper...}');
		ruleB.enabled = false;
		const conflicts = computeConflicts([ruleA, ruleB], ['Projects']);
		expect(conflicts).toEqual([]);
	});
});

describe('ruleCoverage — aggregate report', () => {
	test('builds report with forward + inverse + conflicts + unmatched', () => {
		const ruleA = ruleWithTemplates('rule-a', 'Projects/{deeper...}', '#projects/{deeper...}');
		const ruleB = ruleWithTemplates('rule-b', 'Areas/{deeper...}', '#areas/{deeper...}');
		const folders = ['Projects', 'Projects/Web', 'Areas', 'Areas/Health', 'Templates'];
		const tags = ['#projects/web', '#areas/health', '#unrelated'];
		const report = buildCoverageReport([ruleA, ruleB], folders, tags);

		expect(report.totalFolders).toBe(5);
		expect(report.totalTags).toBe(3);
		expect(report.forwardCoverage.length).toBe(2);
		expect(report.inverseCoverage.length).toBe(2);
		expect(report.unmatchedFolders).toContain('Templates');
	});
});
