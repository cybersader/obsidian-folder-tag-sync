/**
 * Unit tests for case transformers
 */

import {
	toSnakeCase,
	toTitleCase,
	toKebabCase,
	toCamelCase,
	toPascalCase,
	applyCaseTransform
} from './caseTransformers';

describe('toSnakeCase', () => {
	test('converts spaces to underscores', () => {
		expect(toSnakeCase('My Project')).toBe('my_project');
	});

	test('converts Title Case to snake_case', () => {
		expect(toSnakeCase('My Project Name')).toBe('my_project_name');
	});

	test('handles camelCase', () => {
		expect(toSnakeCase('myProjectName')).toBe('my_project_name');
	});

	test('handles PascalCase', () => {
		expect(toSnakeCase('MyProjectName')).toBe('my_project_name');
	});

	test('handles hyphens', () => {
		expect(toSnakeCase('my-project-name')).toBe('my_project_name');
	});

	test('handles already snake_case', () => {
		expect(toSnakeCase('my_project_name')).toBe('my_project_name');
	});

	test('handles empty string', () => {
		expect(toSnakeCase('')).toBe('');
	});

	test('handles single word', () => {
		expect(toSnakeCase('Project')).toBe('project');
	});
});

describe('toTitleCase', () => {
	test('converts snake_case to Title Case', () => {
		expect(toTitleCase('my_project_name')).toBe('My Project Name');
	});

	test('converts kebab-case to Title Case', () => {
		expect(toTitleCase('my-project-name')).toBe('My Project Name');
	});

	test('handles already Title Case', () => {
		expect(toTitleCase('My Project Name')).toBe('My Project Name');
	});

	test('handles single word', () => {
		expect(toTitleCase('project')).toBe('Project');
	});

	test('handles empty string', () => {
		expect(toTitleCase('')).toBe('');
	});
});

describe('bidirectional transformations', () => {
	test('snake_case <-> Title Case is lossless', () => {
		const original = 'My Project Name';
		const snaked = toSnakeCase(original);
		const restored = toTitleCase(snaked);
		expect(restored).toBe(original);
	});

	test('multiple round trips are stable', () => {
		const original = 'My Project Name';
		let result = original;
		for (let i = 0; i < 5; i++) {
			result = toTitleCase(toSnakeCase(result));
		}
		expect(result).toBe(original);
	});
});

describe('applyCaseTransform', () => {
	test('applies snake_case transform', () => {
		expect(applyCaseTransform('My Project', 'snake_case')).toBe('my_project');
	});

	test('applies Title Case transform', () => {
		expect(applyCaseTransform('my_project', 'Title Case')).toBe('My Project');
	});

	test('applies kebab-case transform', () => {
		expect(applyCaseTransform('My Project', 'kebab-case')).toBe('my-project');
	});

	test('applies no transform when type is "none"', () => {
		expect(applyCaseTransform('My Project', 'none')).toBe('My Project');
	});

	test('handles unknown transform type', () => {
		expect(applyCaseTransform('My Project', 'unknown')).toBe('My Project');
	});
});
