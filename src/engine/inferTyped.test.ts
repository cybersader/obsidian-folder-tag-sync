import { describe, expect, test } from 'bun:test';
import { inferTypedModel, inferPrefixMarker, inferAxisFromMarker, inferTransferOp } from './inferTyped';
import type { MappingRule } from '../types/settings';

const baseOptions = {
	createFolders: true,
	addTags: true,
	removeOrphanedTags: false,
	syncOnFileCreate: true,
	syncOnFileMove: true,
	syncOnFileRename: true,
};

function rule(partial: Partial<MappingRule>): MappingRule {
	return {
		id: 'test',
		name: 'test',
		enabled: true,
		priority: 100,
		direction: 'bidirectional',
		options: baseOptions,
		...partial,
	};
}

describe('inferPrefixMarker', () => {
	test('double-dash entity prefix', () => {
		expect(inferPrefixMarker('--cybersader')).toBe('--');
	});
	test('single-dash capture prefix', () => {
		expect(inferPrefixMarker('-clip')).toBe('-');
	});
	test('slash system prefix', () => {
		expect(inferPrefixMarker('/')).toBe('/');
	});
	test('underscore output prefix', () => {
		expect(inferPrefixMarker('_')).toBe('_');
	});
	test('word with no prefix', () => {
		expect(inferPrefixMarker('projects')).toBe('');
	});
});

describe('inferAxisFromMarker', () => {
	test('maps prefix to SEACOW axis', () => {
		expect(inferAxisFromMarker('/')).toBe('system');
		expect(inferAxisFromMarker('--')).toBe('entity');
		expect(inferAxisFromMarker('-')).toBe('capture');
		expect(inferAxisFromMarker('_')).toBe('output');
		expect(inferAxisFromMarker('')).toBe('work');
	});
});

describe('inferTransferOp', () => {
	test('fully-anchored simple tag → marker-only', () => {
		const op = inferTransferOp(rule({ tagPattern: '^-inbox$' }));
		expect(op).toEqual({ op: 'marker-only', marker: '-inbox' });
	});

	test('bare prefix pattern → identity', () => {
		const op = inferTransferOp(rule({ tagPattern: '^-clip/' }));
		expect(op).toEqual({ op: 'identity' });
	});

	test('pattern with captures + $ anchor → truncation (drop)', () => {
		const op = inferTransferOp(rule({ tagPattern: '^-clip/([^/]+)(?:/([^/]+))?$' }));
		expect(op?.op).toBe('truncation');
	});
});

describe('inferTypedModel (end-to-end on seacow-style rules)', () => {
	test('capture-inbox → marker-only + capture axis', () => {
		const r = rule({
			direction: 'tag-to-folder',
			tagPattern: '^-inbox$',
			tagEntryPoint: '-inbox',
			folderEntryPoint: 'Capture/Inbox',
		});
		const t = inferTypedModel(r);
		expect(t.transfer).toEqual({ op: 'marker-only', marker: '-inbox' });
		expect(t.tag?.axis).toBe('capture');
		expect(t.tag?.prefixMarker).toBe('-');
		expect(t.tag?.coordination).toBe('flat-keyword');
		expect(t.folder?.scheme).toBe('container-only');
		expect(t.folderEntry).toBe('Capture/Inbox');
	});

	test('entity-cybersader → identity + entity axis + authority-root folder', () => {
		const r = rule({
			direction: 'bidirectional',
			tagPattern: '^--cybersader/',
			tagEntryPoint: '--cybersader',
			folderPattern: '^Entity/Cybersader/',
			folderEntryPoint: 'Entity/Cybersader',
		});
		const t = inferTypedModel(r);
		expect(t.transfer).toEqual({ op: 'identity' });
		expect(t.tag?.axis).toBe('entity');
		expect(t.tag?.prefixMarker).toBe('--');
		expect(t.tag?.authority).toBe('mutual');
	});

	test('system-templates → identity + system axis', () => {
		const r = rule({
			direction: 'bidirectional',
			tagPattern: '^/',
			tagEntryPoint: '/',
			folderPattern: '^System/',
			folderEntryPoint: 'System',
		});
		const t = inferTypedModel(r);
		expect(t.tag?.axis).toBe('system');
		expect(t.tag?.prefixMarker).toBe('/');
		expect(t.transfer).toEqual({ op: 'identity' });
	});
});
