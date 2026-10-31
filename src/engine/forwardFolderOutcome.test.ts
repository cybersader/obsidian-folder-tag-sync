import { expect, test } from 'bun:test';
import type { MappingRule } from '../types/settings';
import { evaluateForwardFolder } from './forwardFolderOutcome';
import { evaluateOutlineRuleSet } from '../ui/workbench/outlineReviewPlan';

for (const [name, thrown] of [['empty Error', new Error('')], ['blank Error', new Error(' ')], ['object throw', {}], ['null throw', null]] as const) {
	test(`legacy outline output fallback survives ${name}`, () => {
		const rule = { id: 'x', name: 'X', enabled: true, priority: 1, direction: 'folder-to-tag', folderPattern: '^Work', options: {},
			get transfer() { throw thrown; } } as unknown as MappingRule;
		expect(evaluateForwardFolder('Work', [rule]).error).toBe('Rule output could not be generated.');
		expect(evaluateOutlineRuleSet(['Work'], [rule], [], [])[0].current.error).toBe('Rule output could not be generated.');
	});
}
