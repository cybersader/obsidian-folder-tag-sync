/**
 * Sanity script: load templates-demo.json and exercise forward/inverse
 * on each enabled rule to confirm end-to-end loader + runtime integration.
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { loadRulePackFromJSON } from '../src/engine/rulePackLoader';
import { applyRuleForward, applyRuleInverse } from '../src/engine/applyTransfer';

const json = readFileSync(join(import.meta.dir, '../rule-packs/templates-demo.json'), 'utf-8');
const result = loadRulePackFromJSON(json);
if (!result.ok) {
  console.error('LOAD FAILED:', result.errors);
  process.exit(1);
}
console.log(`Loaded ${result.pack.rules.length} rules from templates-demo.json`);
for (const r of result.pack.rules) {
  console.log(` - ${r.id}: bijective=${r.bijective} folderTemplate=${r.folderTemplate} tagTemplate=${r.tagTemplate}`);
}
console.log();

const r1 = result.pack.rules[0];
console.log('Rule 1 (identity):');
console.log('  Forward Projects/Web Auth →', applyRuleForward('Projects/Web Auth', r1).tags);
console.log('  Inverse #projects/Web Auth →', applyRuleInverse('#projects/Web Auth', r1).folder);

const r2 = result.pack.rules[1];
console.log('Rule 2 (kebab-case):');
console.log('  Forward Areas/My Health →', applyRuleForward('Areas/My Health', r2).tags);
console.log('  Inverse #areas/my-health →', applyRuleInverse('#areas/my-health', r2).folder);

const r3 = result.pack.rules[2];
console.log('Rule 3 (glob):');
console.log('  Forward Projects/Web/Auth/oauth.md →', applyRuleForward('Projects/Web/Auth/oauth.md', r3).tags);
console.log('  Inverse #projects/Web/Auth/oauth.md →', applyRuleInverse('#projects/Web/Auth/oauth.md', r3).folder);

const r4 = result.pack.rules[3];
console.log('Rule 4 (marker-only):');
console.log('  Forward Capture/Inbox/2026/04/note.md →', applyRuleForward('Capture/Inbox/2026/04/note.md', r4).tags);
