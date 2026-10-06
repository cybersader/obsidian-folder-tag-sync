import { describe, expect, test } from 'bun:test';
import type { MappingRule } from '../types/settings';
import { buildGuidedNotePreviewPlan } from './guidedNotePreview';

export const rule = (id = 'draft', overrides: Partial<MappingRule> = {}): MappingRule => ({
	id, name: id, enabled: true, priority: 1, direction: 'folder-to-tag', folderPattern: '^Work',
	options: { createFolders: false, addTags: true, removeOrphanedTags: false,
		syncOnFileCreate: false, syncOnFileMove: false, syncOnFileRename: false }, ...overrides,
});
describe('guided note scope and hypothetical precedence', () => {
	test('same-ID replacement retains index and wins full tie; all snapshots are cloned', () => {
		const installed = [rule(), rule('competitor')];
		const p = buildGuidedNotePreviewPlan(rule('draft', { enabled: false }), installed, [], ['Work']);
		expect(p.folders[0].hypothetical.winner?.id).toBe('draft');
		expect(p.hypotheticalRules.map((r) => r.id)).toEqual(['draft', 'competitor']);
		p.hypotheticalRules[0].options.addTags = false;
		expect(installed[0].options.addTags).toBe(true);
	});
	test('competitor keeps raw draft matches in scope, disabled unrelated rules do not compete', () => {
		const p = buildGuidedNotePreviewPlan(rule(), [rule('competitor', { group: 'first' }), rule('disabled', { enabled: false })], ['first'], ['Work', 'Other']);
		expect(p.folders).toHaveLength(1);
		expect(p.folders[0].draftMatches).toBe(true);
		expect(p.folders[0].hypothetical.winner?.id).toBe('competitor');
	});
	test('old coverage remains on edit even when old rule was disabled', () => {
		const p = buildGuidedNotePreviewPlan(rule('draft', { folderPattern: '^New' }), [rule('draft', { enabled: false, folderPattern: '^Old' })], [], ['Old', 'New']);
		expect(p.folders.map((f) => f.folderPath)).toEqual(['Old', 'New']);
		expect(p.folders[0].hypothetical.state).toBe('no-match');
	});
	test('duplicate IDs are rejected', () => {
		expect(() => buildGuidedNotePreviewPlan(rule(), [rule('x'), rule('x')], [], ['Work'])).toThrow('Duplicate');
	});
	test('invalid winner is not replaced by valid loser', () => {
		const p = buildGuidedNotePreviewPlan(rule('draft', { tagEntryPoint: '#/' }), [rule('loser', { priority: 10 })], [], ['Work']);
		expect(p.folders[0].hypothetical.state).toBe('invalid');
		expect(p.folders[0].hypothetical.winner?.id).toBe('draft');
	});
	test('legitimate empty output differs from invalid', () => {
		const p = buildGuidedNotePreviewPlan(rule('draft', { transfer: { op: 'opaque' } }), [], [], ['Work']);
		expect(p.folders[0].hypothetical.state).toBe('empty');
	});
	test('reverse-only is an explanatory refusal', () => {
		const p = buildGuidedNotePreviewPlan(rule('draft', { direction: 'tag-to-folder' }), [], [], ['Work']);
		expect(p.refusal).toContain('movement');
		expect(p.folders).toEqual([]);
	});
	test('compiler option/group differences are field-level warnings', () => {
		const p = buildGuidedNotePreviewPlan(rule(), [rule('draft', { group: 'old', options: { ...rule().options, frontmatterMemory: true } })], [], ['Work']);
		expect(p.changedFields.map((f) => f.field)).toEqual(['group', 'options.frontmatterMemory']);
	});
});
