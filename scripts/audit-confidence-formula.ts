/**
 * Audit script — compares the refined `calculateMatchConfidence` (Formula 3)
 * against user-authored priorities on shipped rule packs.
 *
 * Run: `bun scripts/audit-confidence-formula.ts`
 *
 * Output: a markdown report at `audit-confidence-formula.md` in the repo root,
 * showing per-pack ordering by new-formula confidence vs. user-authored priority,
 * with the percentage agreement on within-pack rules.
 *
 * Used at the Increment 1 Step 1 user-testing checkpoint (see
 * `docs/about/development-plan.md`) — if >80% of within-pack rules agree
 * between confidence ordering and priority ordering, we proceed to Step 2
 * (swap sort order). If less, we surface specific disagreements and iterate.
 */

import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

import { calculateMatchConfidence } from '../src/engine/ruleMatcher';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(__dirname, '..');
const PACKS_DIR = join(REPO_ROOT, 'rule-packs');
const OUTPUT_PATH = join(REPO_ROOT, 'audit-confidence-formula.md');

interface RulePackRule {
	id: string;
	name: string;
	priority: number;
	folderPattern?: string;
	tagPattern?: string;
	folderAnchor?: 'root' | 'any-segment' | { under: string };
}

interface RulePack {
	id: string;
	name: string;
	rules: RulePackRule[];
}

interface AuditedRule {
	id: string;
	name: string;
	priority: number;
	folderConfidence: number | null;
	tagConfidence: number | null;
	combinedScore: number;  // max of folder/tag for sorting
	folderPattern?: string;
	folderAnchor?: string;
}

interface PackAudit {
	packId: string;
	packName: string;
	rules: AuditedRule[];
	priorityOrder: AuditedRule[];     // sorted ascending by priority
	confidenceOrder: AuditedRule[];   // sorted descending by combinedScore
	agreement: number;                // % of within-pack rules in same order
	disagreements: Array<{ rule: AuditedRule; priorityRank: number; confidenceRank: number }>;
}

function describeAnchor(a: RulePackRule['folderAnchor']): string {
	if (a === undefined) return '(none — defaults to root)';
	if (a === 'root') return 'root';
	if (a === 'any-segment') return 'any-segment';
	if (typeof a === 'object' && 'under' in a) return `under "${a.under}"`;
	return String(a);
}

function auditPack(pack: RulePack): PackAudit {
	// Use the rule's pattern itself as the input for confidence calculation.
	// This gives us the score the engine would assign on a guaranteed-match scenario.
	// In real use, the input is a folder path / tag string, but for audit purposes
	// the pattern itself is a stable proxy that produces consistent scores.
	const audited: AuditedRule[] = pack.rules.map((rule) => {
		const folderConfidence = rule.folderPattern
			? calculateMatchConfidence(
				rule.folderPattern,
				rule.folderPattern,
				rule.folderAnchor as any
			)
			: null;
		const tagConfidence = rule.tagPattern
			? calculateMatchConfidence(rule.tagPattern, rule.tagPattern)
			: null;
		// For the score, use folder if present (anchor-aware); else tag
		const combinedScore = folderConfidence ?? tagConfidence ?? 0;

		return {
			id: rule.id,
			name: rule.name,
			priority: rule.priority,
			folderConfidence,
			tagConfidence,
			combinedScore,
			folderPattern: rule.folderPattern,
			folderAnchor: describeAnchor(rule.folderAnchor)
		};
	});

	const priorityOrder = [...audited].sort((a, b) => a.priority - b.priority);
	const confidenceOrder = [...audited].sort((a, b) => b.combinedScore - a.combinedScore);

	// Compute agreement: count rules where priority rank == confidence rank
	let agreed = 0;
	const disagreements: PackAudit['disagreements'] = [];
	for (let i = 0; i < priorityOrder.length; i++) {
		const ruleByPriority = priorityOrder[i];
		const confidenceRank = confidenceOrder.findIndex((r) => r.id === ruleByPriority.id);
		if (confidenceRank === i) {
			agreed++;
		} else {
			disagreements.push({
				rule: ruleByPriority,
				priorityRank: i,
				confidenceRank
			});
		}
	}
	const agreement = priorityOrder.length === 0 ? 100 : Math.round((agreed / priorityOrder.length) * 100);

	return {
		packId: pack.id,
		packName: pack.name,
		rules: audited,
		priorityOrder,
		confidenceOrder,
		agreement,
		disagreements
	};
}

function loadPacks(): RulePack[] {
	const files = readdirSync(PACKS_DIR).filter((f) => f.endsWith('.json') && f !== 'manifest.json');
	const packs: RulePack[] = [];
	for (const file of files) {
		try {
			const raw = readFileSync(join(PACKS_DIR, file), 'utf-8');
			const parsed = JSON.parse(raw) as RulePack;
			if (parsed.rules && Array.isArray(parsed.rules)) {
				packs.push(parsed);
			}
		} catch (err) {
			console.error(`Skipping ${file}: ${err}`);
		}
	}
	return packs;
}

function fmtScore(s: number | null): string {
	if (s === null) return '—';
	return s.toFixed(3);
}

function generateReport(audits: PackAudit[]): string {
	const lines: string[] = [];

	lines.push('# Confidence-formula audit — Increment 1 Step 1');
	lines.push('');
	lines.push('Generated by `scripts/audit-confidence-formula.ts`. Compares the refined `calculateMatchConfidence` (Formula 3 from the specificity-and-groups research) against user-authored priorities on shipped rule packs.');
	lines.push('');
	lines.push('**Decision gate** (per the development plan): if >80% of within-pack rules agree between confidence ordering and priority ordering, we ship the formula refinement (still tiebreak-only) and proceed to Increment 1 Step 2 (swap sort order so confidence becomes primary, priority becomes tiebreak override). If less than 80%, surface the specific disagreements and iterate the formula before promoting.');
	lines.push('');
	lines.push('## Summary');
	lines.push('');
	lines.push('| Pack | Rule count | Agreement % | Verdict |');
	lines.push('|---|---|---|---|');
	for (const audit of audits) {
		const verdict = audit.agreement >= 80 ? '✓ proceed' : '⚠ surface disagreements';
		lines.push(`| ${audit.packName} (\`${audit.packId}\`) | ${audit.rules.length} | ${audit.agreement}% | ${verdict} |`);
	}
	const overallAgreement = audits.length === 0
		? 100
		: Math.round(audits.reduce((sum, a) => sum + a.agreement, 0) / audits.length);
	lines.push('');
	lines.push(`**Overall average agreement**: ${overallAgreement}%`);
	lines.push('');

	for (const audit of audits) {
		lines.push(`## ${audit.packName} (\`${audit.packId}\`)`);
		lines.push('');
		lines.push(`**Rules**: ${audit.rules.length}. **Agreement**: ${audit.agreement}%.`);
		lines.push('');

		lines.push('### Priority order (user-authored)');
		lines.push('');
		lines.push('| Rank | Rule | Priority | Folder confidence | Tag confidence | Anchor | Folder pattern |');
		lines.push('|---|---|---|---|---|---|---|');
		audit.priorityOrder.forEach((rule, i) => {
			lines.push(`| ${i + 1} | \`${rule.id}\` | ${rule.priority} | ${fmtScore(rule.folderConfidence)} | ${fmtScore(rule.tagConfidence)} | ${rule.folderAnchor ?? '—'} | \`${(rule.folderPattern ?? '—').replaceAll('|', '\\|')}\` |`);
		});
		lines.push('');

		lines.push('### Confidence order (Formula 3 derived)');
		lines.push('');
		lines.push('| Rank | Rule | Confidence | Priority |');
		lines.push('|---|---|---|---|');
		audit.confidenceOrder.forEach((rule, i) => {
			lines.push(`| ${i + 1} | \`${rule.id}\` | ${fmtScore(rule.combinedScore)} | ${rule.priority} |`);
		});
		lines.push('');

		if (audit.disagreements.length > 0) {
			lines.push('### Disagreements');
			lines.push('');
			lines.push('Rules where the user-authored priority rank differs from the Formula-3-derived confidence rank.');
			lines.push('');
			lines.push('| Rule | Priority rank | Confidence rank | Drift |');
			lines.push('|---|---|---|---|');
			audit.disagreements.forEach(({ rule, priorityRank, confidenceRank }) => {
				const drift = confidenceRank - priorityRank;
				const driftStr = drift > 0 ? `+${drift}` : `${drift}`;
				lines.push(`| \`${rule.id}\` | ${priorityRank + 1} | ${confidenceRank + 1} | ${driftStr} |`);
			});
			lines.push('');
		} else {
			lines.push('### Disagreements');
			lines.push('');
			lines.push('*None.* Priority order and confidence order are identical for this pack.');
			lines.push('');
		}

		lines.push('---');
		lines.push('');
	}

	lines.push('## How to read this report');
	lines.push('');
	lines.push('- **Priority order** is what the user authored: rule with priority 10 ranked 1st, priority 20 ranked 2nd, etc. (Lower priority = higher precedence in the existing engine.)');
	lines.push('- **Confidence order** is what Formula 3 derives: highest-confidence rule ranked 1st, lowest ranked last.');
	lines.push('- **Agreement** is the % of rules whose rank in the priority order matches their rank in the confidence order.');
	lines.push('- **Disagreements** show rules whose ranks differ — these are the load-bearing cases for the user-testing-checkpoint decision.');
	lines.push('');
	lines.push('A high disagreement count for a specific pack means either (a) the formula misjudges that pack\'s shape and needs refinement, or (b) the user authored priorities that don\'t reflect specificity (e.g., priority assigned for unrelated reasons). The user-testing checkpoint is where that distinction gets settled.');
	lines.push('');

	return lines.join('\n');
}

// --- Main ---

const packs = loadPacks();
console.log(`Loaded ${packs.length} rule pack(s) from ${PACKS_DIR}`);

const audits = packs.map(auditPack);
const report = generateReport(audits);

writeFileSync(OUTPUT_PATH, report, 'utf-8');
console.log(`Audit report written to ${OUTPUT_PATH}`);

// Print summary to stdout
console.log('');
for (const audit of audits) {
	const verdict = audit.agreement >= 80 ? '✓' : '⚠';
	console.log(`${verdict} ${audit.packName.padEnd(40)} ${audit.agreement}% agreement (${audit.rules.length} rules)`);
}
const overall = audits.length === 0 ? 100 : Math.round(audits.reduce((s, a) => s + a.agreement, 0) / audits.length);
console.log('');
console.log(`Overall average: ${overall}%`);
