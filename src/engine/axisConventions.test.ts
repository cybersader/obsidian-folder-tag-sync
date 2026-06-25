/**
 * Coverage for the shared axis-convention table + slug helper. These were
 * lifted out of the guided rule-editor UI so the synthesizer can reuse them
 * Obsidian-free.
 */

import { describe, expect, test } from 'bun:test';
import { AXIS_CONVENTIONS, slugifyToTagEntry } from './axisConventions';
import { ALL_AXES } from '../types/typed';

describe('AXIS_CONVENTIONS table shape', () => {
	test('has an entry for every SEACOW axis', () => {
		for (const axis of ALL_AXES) {
			expect(AXIS_CONVENTIONS[axis]).toBeDefined();
		}
		expect(Object.keys(AXIS_CONVENTIONS).sort()).toEqual([...ALL_AXES].sort());
	});

	test('every entry has label, marker, description', () => {
		for (const conv of Object.values(AXIS_CONVENTIONS)) {
			expect(typeof conv.label).toBe('string');
			expect(conv.label.length).toBeGreaterThan(0);
			expect(typeof conv.description).toBe('string');
			// marker is a TagPrefixMarker — a string or null, never undefined.
			expect(conv.marker === null || typeof conv.marker === 'string').toBe(true);
		}
	});

	test('markers match the documented SEACOW convention', () => {
		expect(AXIS_CONVENTIONS.system.marker).toBe('/');
		expect(AXIS_CONVENTIONS.entity.marker).toBe('--');
		expect(AXIS_CONVENTIONS.capture.marker).toBe('-');
		expect(AXIS_CONVENTIONS.output.marker).toBe('_');
		expect(AXIS_CONVENTIONS.work.marker).toBeNull();
		expect(AXIS_CONVENTIONS.relation.marker).toBeNull();
	});
});

describe('slugifyToTagEntry', () => {
	test('spaces become hyphens, lowercased', () => {
		expect(slugifyToTagEntry('Project Notes')).toBe('project-notes');
	});

	test('strips emoji + JD prefix before slugging', () => {
		expect(slugifyToTagEntry('📁 01 - Project Notes')).toBe('project-notes');
	});

	test('strips emoji-only decoration', () => {
		expect(slugifyToTagEntry('⬇️ INBOX')).toBe('inbox');
	});

	test('already-clean slug is a near no-op', () => {
		expect(slugifyToTagEntry('already-clean')).toBe('already-clean');
	});

	test('drops tag-invalid punctuation', () => {
		// `.,;:?!@\` are all forbidden in Obsidian tags — the slug collapse
		// turns them into separators, then trims.
		expect(slugifyToTagEntry('Tasks, Planning!')).toBe('tasks-planning');
	});

	test('collapses runs of separators and trims', () => {
		expect(slugifyToTagEntry('  Web / Auth  ')).toBe('web-auth');
	});
});
