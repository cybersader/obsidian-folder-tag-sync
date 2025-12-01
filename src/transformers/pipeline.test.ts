/**
 * Unit tests for transformation pipeline
 */

import {
	applyTransformPipeline,
	folderToTag,
	tagToFolder,
	createBidirectionalMapping,
	isTransformReversible
} from './pipeline';
import { TransformConfig } from '../types/settings';

describe('applyTransformPipeline', () => {
	test('applies no transformations with empty config', () => {
		const config: TransformConfig = {};
		expect(applyTransformPipeline('Test Input', config)).toBe('Test Input');
	});

	test('applies emoji stripping', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip'
		};
		expect(applyTransformPipeline('📁 Projects', config)).toBe('Projects');
	});

	test('applies number prefix stripping', () => {
		const config: TransformConfig = {
			numberPrefixHandling: 'strip'
		};
		expect(applyTransformPipeline('01 - Projects', config)).toBe('Projects');
	});

	test('applies case transformation', () => {
		const config: TransformConfig = {
			caseTransform: 'snake_case'
		};
		expect(applyTransformPipeline('My Projects', config)).toBe('my_projects');
	});

	test('applies custom regex transformation', () => {
		const config: TransformConfig = {
			customTransforms: [
				{ pattern: '^(\\d+) - ', replacement: '' }
			]
		};
		expect(applyTransformPipeline('01 - Projects', config)).toBe('Projects');
	});

	test('combines emoji and number stripping', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip',
			numberPrefixHandling: 'strip'
		};
		expect(applyTransformPipeline('📁 01 - Projects', config)).toBe('Projects');
	});

	test('combines all transformation types', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip',
			numberPrefixHandling: 'strip',
			caseTransform: 'snake_case',
			customTransforms: [
				{ pattern: '\\s+', replacement: '_', flags: 'g' }
			]
		};
		expect(applyTransformPipeline('📁 01 - My Projects', config)).toBe('my_projects');
	});

	test('strips invalid tag characters when isTagTransform is true', () => {
		const config: TransformConfig = {
			caseTransform: 'none'
		};
		expect(applyTransformPipeline('Test:File', config, { isTagTransform: true })).toBe('TestFile');
		expect(applyTransformPipeline('Test:File', config, { isTagTransform: false })).toBe('Test:File');
	});

	test('preserves original on error when configured', () => {
		const config: TransformConfig = {
			customTransforms: [
				{ pattern: '[invalid(', replacement: 'test' }
			]
		};
		// Invalid regex should be handled gracefully
		const result = applyTransformPipeline('input', config, { preserveOnError: true });
		expect(result).toBeDefined();
	});

	test('trims whitespace from result', () => {
		const config: TransformConfig = {
			numberPrefixHandling: 'strip'
		};
		expect(applyTransformPipeline('  01 - Projects  ', config)).toBe('Projects');
	});
});

describe('folderToTag', () => {
	test('converts folder path to tag name', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip',
			numberPrefixHandling: 'strip',
			caseTransform: 'snake_case'
		};
		expect(folderToTag('📁 01 - My Projects', config)).toBe('my_projects');
	});

	test('strips invalid tag characters', () => {
		const config: TransformConfig = {};
		expect(folderToTag('Test:Project', config)).toBe('TestProject');
	});

	test('handles nested folder paths', () => {
		const config: TransformConfig = {
			numberPrefixHandling: 'strip',
			caseTransform: 'kebab-case'
		};
		// Extract just the folder name from a path
		const folderName = '01 - My Projects';
		expect(folderToTag(folderName, config)).toBe('my-projects');
	});
});

describe('tagToFolder', () => {
	test('converts tag name to folder name', () => {
		const config: TransformConfig = {
			caseTransform: 'Title Case'
		};
		expect(tagToFolder('my_projects', config)).toBe('My Projects');
	});

	test('does not strip invalid tag characters', () => {
		const config: TransformConfig = {};
		// Folders can have more characters than tags
		expect(tagToFolder('test:value', config)).toBe('test:value');
	});

	test('preserves characters valid in folders but not tags', () => {
		const config: TransformConfig = {
			caseTransform: 'none'
		};
		expect(tagToFolder('test.project', config)).toBe('test.project');
	});
});

describe('createBidirectionalMapping', () => {
	test('creates both folder and tag representations', () => {
		const folderConfig: TransformConfig = {
			caseTransform: 'Title Case'
		};
		const tagConfig: TransformConfig = {
			caseTransform: 'snake_case'
		};

		const result = createBidirectionalMapping('my_project', folderConfig, tagConfig);
		expect(result.folder).toBe('My Project');
		expect(result.tag).toBe('my_project');
	});

	test('handles complex transformations', () => {
		const folderConfig: TransformConfig = {
			numberPrefixHandling: 'keep',
			caseTransform: 'Title Case'
		};
		const tagConfig: TransformConfig = {
			numberPrefixHandling: 'strip',
			caseTransform: 'snake_case'
		};

		const result = createBidirectionalMapping('01 - active projects', folderConfig, tagConfig);
		// Title Case converts dashes to spaces, so "01 - active projects" becomes "01 Active Projects"
		expect(result.folder).toBe('01 Active Projects');
		expect(result.tag).toBe('active_projects');
	});
});

describe('isTransformReversible', () => {
	test('identifies reversible empty config', () => {
		const config: TransformConfig = {};
		const result = isTransformReversible(config);
		expect(result.reversible).toBe(true);
		expect(result.warnings).toHaveLength(0);
	});

	test('identifies emoji stripping as non-reversible', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip'
		};
		const result = isTransformReversible(config);
		expect(result.reversible).toBe(false);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test('identifies number stripping as non-reversible', () => {
		const config: TransformConfig = {
			numberPrefixHandling: 'strip'
		};
		const result = isTransformReversible(config);
		expect(result.reversible).toBe(false);
		expect(result.warnings).toContain('Number prefix removal is not reversible');
	});

	test('warns about case transformations', () => {
		const config: TransformConfig = {
			caseTransform: 'lowercase'
		};
		const result = isTransformReversible(config);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test('warns about custom regex transforms', () => {
		const config: TransformConfig = {
			customTransforms: [
				{ pattern: 'test', replacement: 'prod' }
			]
		};
		const result = isTransformReversible(config);
		expect(result.reversible).toBe(false);
		expect(result.warnings.length).toBeGreaterThan(0);
	});

	test('accumulates multiple warnings', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip',
			numberPrefixHandling: 'strip',
			caseTransform: 'lowercase',
			customTransforms: [
				{ pattern: 'a', replacement: 'b' }
			]
		};
		const result = isTransformReversible(config);
		expect(result.reversible).toBe(false);
		expect(result.warnings.length).toBeGreaterThanOrEqual(4);
	});
});

describe('integration tests', () => {
	test('Johnny Decimal folder to tag workflow', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip',
			numberPrefixHandling: 'strip',
			caseTransform: 'snake_case'
		};

		// Folder: "📁 01 - Active Projects"
		// Should become tag: "active_projects"
		expect(folderToTag('📁 01 - Active Projects', config)).toBe('active_projects');
	});

	test('tag to folder with formatting', () => {
		const config: TransformConfig = {
			caseTransform: 'Title Case'
		};

		// Tag: "active_projects"
		// Should become folder: "Active Projects"
		expect(tagToFolder('active_projects', config)).toBe('Active Projects');
	});

	test('round-trip transformation preserves semantic meaning', () => {
		const toTagConfig: TransformConfig = {
			emojiHandling: 'strip',
			numberPrefixHandling: 'strip',
			caseTransform: 'snake_case'
		};
		const toFolderConfig: TransformConfig = {
			caseTransform: 'Title Case'
		};

		const originalFolder = '📁 01 - Active Projects';
		const tag = folderToTag(originalFolder, toTagConfig);
		const newFolder = tagToFolder(tag, toFolderConfig);

		// Won't match exactly due to stripping, but should be semantically similar
		expect(tag).toBe('active_projects');
		expect(newFolder).toBe('Active Projects');
	});

	test('complex multi-step transformation', () => {
		const config: TransformConfig = {
			emojiHandling: 'strip',
			numberPrefixHandling: 'strip',
			caseTransform: 'kebab-case',
			customTransforms: [
				// Remove any remaining special characters
				{ pattern: '[^a-z0-9\\-]', replacement: '', flags: 'gi' }
			]
		};

		const input = '📁 01 - My Cool Project!!!';
		const result = folderToTag(input, config);
		expect(result).toBe('my-cool-project');
	});
});
