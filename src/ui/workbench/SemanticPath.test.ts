import { describe, expect, test } from 'bun:test';
import { describeSemanticPath } from './SemanticPath';

describe('describeSemanticPath', () => {
	test('treats the vault root as the focused location', () => {
		expect(describeSemanticPath('')).toEqual({
			fullPath: '',
			context: null,
			focus: 'Vault root',
			isRoot: true,
		});
	});

	test('keeps a single folder as the focused segment without invented context', () => {
		expect(describeSemanticPath('Work')).toEqual({
			fullPath: 'Work',
			context: null,
			focus: 'Work',
			isRoot: false,
		});
	});

	test('separates parent context from the applicable segment', () => {
		expect(describeSemanticPath('OrgDeckFixture/Work')).toEqual({
			fullPath: 'OrgDeckFixture/Work',
			context: 'OrgDeckFixture',
			focus: 'Work',
			isRoot: false,
		});
	});

	test('retains every parent segment in a deeply nested path', () => {
		expect(describeSemanticPath('Clients/Acme/Operations/Incident response')).toEqual({
			fullPath: 'Clients/Acme/Operations/Incident response',
			context: 'Clients/Acme/Operations',
			focus: 'Incident response',
			isRoot: false,
		});
	});

	test('preserves Unicode and long folder names verbatim', () => {
		const path = '📁 Knowledge/非常に長い親フォルダー/Incident Response Plan (IRP)';
		expect(describeSemanticPath(path)).toEqual({
			fullPath: path,
			context: '📁 Knowledge/非常に長い親フォルダー',
			focus: 'Incident Response Plan (IRP)',
			isRoot: false,
		});
	});
});
