/**
 * Tests for the per-folder rule view — verifies the folder-major transpose:
 * winning rule, emitted tags, all matching rule ids, and the conflict flag.
 * Covers a folder matched by one rule, by two (conflict + precedence-correct
 * winner), and by none.
 */

import { describe, expect, test } from 'bun:test';
import { computeFolderRuleEntry, computeFolderRuleView } from './folderRuleView';
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
		name: `Rule ${id}`,
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

describe('folderRuleView — matched by one rule', () => {
	const projects = ruleWithTemplates('projects', 'Projects/{deeper...}', '#projects/{deeper...}');
	const folders = ['Projects', 'Projects/Web', 'Areas/Health', 'Templates'];

	test('records the winning rule, its emission, and a single matching id with no conflict', () => {
		const view = computeFolderRuleView(folders, [projects]);

		const web = view.get('Projects/Web');
		expect(web).toBeDefined();
		expect(web!.winnerRuleId).toBe('projects');
		expect(web!.winnerRuleName).toBe('Rule projects');
		expect(web!.matchingRuleIds).toEqual(['projects']);
		expect(web!.conflict).toBe(false);
		expect(web!.emittedTags.length).toBeGreaterThan(0);
		expect(web!.emittedTags[0]).toMatch(/^#projects/);
	});

	test('an unmatched folder gets a null-winner entry', () => {
		const view = computeFolderRuleView(folders, [projects]);
		const templates = view.get('Templates');
		expect(templates).toBeDefined();
		expect(templates!.winnerRuleId).toBeNull();
		expect(templates!.winnerRuleName).toBeNull();
		expect(templates!.emittedTags).toEqual([]);
		expect(templates!.matchingRuleIds).toEqual([]);
		expect(templates!.conflict).toBe(false);
	});
});

describe('folderRuleView — matched by two rules (conflict + precedence)', () => {
	// Both rules match Projects/* but live in different groups, so cross-group
	// resolution is decided by groupPrecedence — not specificity or priority.
	function pair(): [MappingRule, MappingRule] {
		const a = ruleWithTemplates('rule-a', 'Projects/{deeper...}', '#a/{deeper...}');
		a.group = 'high';
		const b = ruleWithTemplates('rule-b', 'Projects/{deeper...}', '#b/{deeper...}');
		b.group = 'low';
		return [a, b];
	}

	test('flags conflict and lists both matching ids', () => {
		const [a, b] = pair();
		const view = computeFolderRuleView(['Projects/Web'], [a, b], ['high', 'low']);
		const web = view.get('Projects/Web')!;
		expect(web.conflict).toBe(true);
		expect(web.matchingRuleIds).toContain('rule-a');
		expect(web.matchingRuleIds).toContain('rule-b');
	});

	test('precedence order decides the winner (high group wins)', () => {
		const [a, b] = pair();
		const view = computeFolderRuleView(['Projects/Web'], [a, b], ['high', 'low']);
		const web = view.get('Projects/Web')!;
		expect(web.winnerRuleId).toBe('rule-a');
		expect(web.emittedTags[0]).toMatch(/^#a/);
	});

	test('single-entry evaluation is identical to the corresponding Map entry', () => {
		const [a, b] = pair();
		const entry = computeFolderRuleEntry('Projects/Web', [a, b], ['high', 'low']);
		const view = computeFolderRuleView(['Projects/Web'], [a, b], ['high', 'low']);
		expect(entry).toEqual(view.get('Projects/Web'));
	});

	test('flipping precedence flips the winner', () => {
		const [a, b] = pair();
		const view = computeFolderRuleView(['Projects/Web'], [a, b], ['low', 'high']);
		const web = view.get('Projects/Web')!;
		expect(web.winnerRuleId).toBe('rule-b');
		expect(web.emittedTags[0]).toMatch(/^#b/);
		// Conflict is independent of which rule wins.
		expect(web.conflict).toBe(true);
	});
});

describe('folderRuleView — matched by none', () => {
	test('every folder reports null winner when no rule matches', () => {
		const projects = ruleWithTemplates('projects', 'Projects/{deeper...}', '#projects/{deeper...}');
		const view = computeFolderRuleView(['Areas', 'Areas/Health', 'Templates'], [projects]);
		for (const entry of view.values()) {
			expect(entry.winnerRuleId).toBeNull();
			expect(entry.matchingRuleIds).toEqual([]);
			expect(entry.conflict).toBe(false);
			expect(entry.emittedTags).toEqual([]);
		}
	});

	test('disabled rules never win or conflict', () => {
		const projects = ruleWithTemplates('projects', 'Projects/{deeper...}', '#projects/{deeper...}');
		projects.enabled = false;
		const view = computeFolderRuleView(['Projects', 'Projects/Web'], [projects]);
		const web = view.get('Projects/Web')!;
		expect(web.winnerRuleId).toBeNull();
		expect(web.matchingRuleIds).toEqual([]);
	});
});
