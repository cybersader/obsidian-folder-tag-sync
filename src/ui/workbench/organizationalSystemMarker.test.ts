import { describe, expect, test } from 'bun:test';
import {
	describeOrganizationalSystemMarker,
	ORGANIZATIONAL_SYSTEM_MARKER_COLOR_TOKENS,
} from './organizationalSystemMarker';

const paraAtWork = 'occurrence:4:para:4:Work';
const paraAtHome = 'occurrence:4:para:4:Home';

describe('describeOrganizationalSystemMarker', () => {
	test('returns the same marker across rerenders', () => {
		const first = describeOrganizationalSystemMarker(paraAtWork);
		const second = describeOrganizationalSystemMarker(paraAtWork);

		expect(second).toEqual(first);
		expect(first).toEqual({
			occurrenceKey: paraAtWork,
			colorToken: 'var(--color-pink)',
		});
	});

	test('does not depend on collection ordering', () => {
		const keys = [
			paraAtWork,
			'occurrence:13:johnny-decimal:0:',
			'occurrence:6:seacow:7:Clients',
		];
		const markersByKey = new Map(keys.map((key) => [
			key,
			describeOrganizationalSystemMarker(key),
		]));

		for (const key of [...keys].reverse()) {
			expect(describeOrganizationalSystemMarker(key)).toEqual(markersByKey.get(key));
		}
	});

	test('uses the full occurrence key for repeated pack occurrences', () => {
		const workMarker = describeOrganizationalSystemMarker(paraAtWork);
		const homeMarker = describeOrganizationalSystemMarker(paraAtHome);

		expect(workMarker.occurrenceKey).toBe(paraAtWork);
		expect(homeMarker.occurrenceKey).toBe(paraAtHome);
		expect(workMarker.colorToken).not.toBe(homeMarker.colorToken);
	});

	test('keeps Unicode keys inside the fixed restrained palette', () => {
		const marker = describeOrganizationalSystemMarker(
			'occurrence:4:para:15:知識/📁 Projects',
		);

		expect(ORGANIZATIONAL_SYSTEM_MARKER_COLOR_TOKENS).toContain(marker.colorToken);
		expect(marker.occurrenceKey).toBe('occurrence:4:para:15:知識/📁 Projects');
	});
});
