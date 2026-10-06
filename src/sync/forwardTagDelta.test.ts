import { describe, expect, test } from 'bun:test';
import { decideForwardTagDelta, readForwardTagInputs } from './forwardTagDelta';

const options = { removeOrphanedTags: true, frontmatterMemory: true };
const fm = 'tags: [manual, old]\nfts:\n  origin: "Old"\n  ruleId: "other"\n  tags:\n    - "old"\n    - "manual"';
describe('exact forward write decision', () => {
	test('legacy witness removes actual disk tags even from a different rule, including manual tags', () => {
		const d = decideForwardTagDelta(fm, ['#old', '#manual'], ['#new'], options);
		expect(d.tagsToRemove).toEqual(['#old', '#manual']);
		expect(d.updatedTags).toEqual(['#new']);
		expect(d.witnessWritten).toBe(true);
	});
	test('no witness preserves unrelated disk tags', () => {
		const d = decideForwardTagDelta('tags: [manual]', [], ['#new'], options);
		expect(d.updatedTags).toEqual(['#manual', '#new']);
		expect(d.removed).toEqual([]);
	});
	test('empty emitted output is an early no-op even with witness and orphan cleanup', () => {
		const d = decideForwardTagDelta(fm, [], [], options);
		expect(d.shouldWrite).toBe(false);
		expect(d.witnessWritten).toBe(false);
		expect(d.removed).toEqual([]);
	});
	test('cache suppresses additions but never reconstructs disk tags', () => {
		const d = decideForwardTagDelta('tags: [manual]', ['#cached'], ['#cached', '#new'], options);
		expect(d.newTagsToAdd).toEqual(['#new']);
		expect(d.updatedTags).toEqual(['#manual', '#new']);
		expect(d.warnings.length).toBeGreaterThan(0);
	});
	test('already present means no witness refresh', () => {
		const d = decideForwardTagDelta('tags: [new]', [], ['#new'], options);
		expect(d.shouldWrite).toBe(false);
		expect(d.witnessWritten).toBe(false);
	});
	test('unsupported disk shape warns about actual reconstruction loss', () => {
		const d = decideForwardTagDelta('tags:\n- manual', ['#manual'], ['#new'], options);
		expect(d.updatedTags).toEqual(['#new']);
		expect(d.warnings.length).toBeGreaterThan(0);
	});
	test('BOM/CRLF parsing mirrors the writer and does not retain the body in tag inputs', () => {
		const i = readForwardTagInputs('﻿---\r\ntags: [manual]\r\n---\r\nprivate body', ['manual']);
		expect(i.frontmatter).toBe('tags: [manual]');
		expect(i.cacheTags).toEqual(['#manual']);
		expect(JSON.stringify(i)).not.toContain('private body');
	});
	test('malformed frontmatter is flagged', () => {
		expect(readForwardTagInputs('---\ntags: [bad]\nno fence', []).warnings.length).toBeGreaterThan(0);
	});
});
