import { computeBijectivity, type BijectivityVerdict as TemplateBijectivityVerdict } from '../../engine/compileTemplate';
import type { CandidateRow } from '../../engine/scanAndSnapPlan';
import type { MappingRule } from '../../types/settings';
import type { TransferOp } from '../../types/typed';

export type CandidateDirectionStatusKind =
	| 'exact'
	| 'available'
	| 'conditional'
	| 'lossy'
	| 'unavailable'
	| 'uncertain';

export interface CandidateDirectionStatus {
	status: CandidateDirectionStatusKind;
	label: string;
	detail: string;
}

export interface CandidateDirectionalStatus {
	folderToTag: CandidateDirectionStatus;
	tagToFolder: CandidateDirectionStatus;
}

type CandidateDirection = 'folder-to-tag' | 'tag-to-folder';
type CandidateStatusInput = Pick<CandidateRow, 'rule' | 'bijectivity'>;
type DirectionEvidence = {
	status: Exclude<CandidateDirectionStatusKind, 'uncertain'>;
	detail?: string;
};

/**
 * Present each Candidate direction independently without changing rule behavior.
 *
 * The Candidate's current verdict remains authoritative. Template slot details
 * and typed transfer fields are used only to locate loss when they explicitly
 * support a direction; a bare lossy verdict never becomes an invented claim
 * that both directions are lossy.
 */
export function getCandidateDirectionalStatus(
	candidate: CandidateStatusInput,
): CandidateDirectionalStatus {
	const templateDetails = currentTemplateDetails(candidate);
	return {
		folderToTag: describeDirection(candidate, 'folder-to-tag', templateDetails),
		tagToFolder: describeDirection(candidate, 'tag-to-folder', templateDetails),
	};
}

function describeDirection(
	candidate: CandidateStatusInput,
	direction: CandidateDirection,
	templateDetails: TemplateBijectivityVerdict | null,
): CandidateDirectionStatus {
	if (!directionRuns(candidate.rule, direction)) {
		return {
			status: 'unavailable',
			label: 'Not configured',
			detail: `This proposed rule does not run ${directionPhrase(direction)}.`,
		};
	}

	const templateEvidence = templateDetails
		? evidenceFromTemplate(templateDetails, direction)
		: null;
	if (templateEvidence?.status === 'unavailable') {
		return presentation(
			templateEvidence.status,
			direction,
			templateEvidence.detail,
		);
	}

	if (candidate.bijectivity === 'total') {
		return presentation('exact', direction);
	}

	const evidence = templateEvidence ?? evidenceFromTypedRule(candidate.rule, direction);
	if (evidence) {
		return presentation(evidence.status, direction, evidence.detail);
	}

	if (candidate.bijectivity === 'lossy') {
		return presentation(
			'uncertain',
			direction,
			`${directionName(direction)} is available, but the current data does not identify whether this direction causes the lossy round trip.`,
		);
	}

	return presentation('uncertain', direction);
}

function currentTemplateDetails(
	candidate: CandidateStatusInput,
): TemplateBijectivityVerdict | null {
	const { rule, bijectivity } = candidate;
	if (!rule.folderTemplate || !rule.tagTemplate) return null;

	try {
		const details = computeBijectivity(rule.folderTemplate, rule.tagTemplate);
		return details.status === bijectivity ? details : null;
	} catch {
		return null;
	}
}

function evidenceFromTemplate(
	details: TemplateBijectivityVerdict,
	direction: CandidateDirection,
): DirectionEvidence | null {
	if (!details.layer1Pass
		&& details.folderOnlySlots.length === 0
		&& details.tagOnlySlots.length === 0) {
		return null;
	}

	if (direction === 'folder-to-tag') {
		if (details.tagOnlySlots.length > 0) {
			return {
				status: 'unavailable',
				detail: 'Folders cannot supply the tag-only information this rule requires.',
			};
		}
		if (details.folderOnlySlots.length > 0) {
			return {
				status: 'lossy',
				detail: 'Folders produce tags, but folder-only information is dropped.',
			};
		}
		if (details.status === 'conditional') return { status: 'conditional' };
		if (details.status === 'lossy') return { status: 'lossy' };
		return { status: 'exact' };
	}

	if (details.folderOnlySlots.length > 0) {
		return {
			status: 'unavailable',
			detail: 'Tags cannot reconstruct the folder-only information this rule requires.',
		};
	}
	if (details.tagOnlySlots.length > 0) {
		return {
			status: 'lossy',
			detail: 'Tags produce folders, but tag-only information is dropped.',
		};
	}
	if (details.status === 'conditional' || details.status === 'lossy') {
		return { status: 'available' };
	}
	return { status: 'exact' };
}

function evidenceFromTypedRule(
	rule: MappingRule,
	direction: CandidateDirection,
): DirectionEvidence | null {
	const transfer = direction === 'folder-to-tag'
		? rule.transfer
		: rule.inverseTransfer;
	if (transfer) return evidenceFromTransfer(transfer);

	if (rule.cardinality === 'many:1') {
		return { status: direction === 'folder-to-tag' ? 'lossy' : 'available' };
	}
	if (rule.cardinality === '1:many') {
		return { status: direction === 'tag-to-folder' ? 'lossy' : 'available' };
	}
	return null;
}

function evidenceFromTransfer(transfer: TransferOp): DirectionEvidence {
	if (transfer.op === 'opaque') return { status: 'unavailable' };
	if (transfer.op === 'identity') return { status: 'available' };
	if (transfer.op === 'truncation' && transfer.tailHandling === 'drop') {
		return { status: 'available' };
	}
	return { status: 'lossy' };
}

function directionRuns(rule: MappingRule, direction: CandidateDirection): boolean {
	return rule.direction === 'bidirectional' || rule.direction === direction;
}

function presentation(
	status: CandidateDirectionStatusKind,
	direction: CandidateDirection,
	detail?: string,
): CandidateDirectionStatus {
	return {
		status,
		label: labelFor(status),
		detail: detail ?? defaultDetail(status, direction),
	};
}

function labelFor(status: CandidateDirectionStatusKind): string {
	switch (status) {
		case 'exact': return 'Exact';
		case 'available': return 'Available';
		case 'conditional': return 'Conditional';
		case 'lossy': return 'Lossy';
		case 'unavailable': return 'Unavailable';
		case 'uncertain': return 'Uncertain';
	}
}

function defaultDetail(
	status: CandidateDirectionStatusKind,
	direction: CandidateDirection,
): string {
	const subject = direction === 'folder-to-tag' ? 'Folders produce tags' : 'Tags produce folders';
	switch (status) {
		case 'exact':
			return `${subject} with an exact round trip.`;
		case 'available':
			return `${subject}; current evidence does not identify this direction as lossy.`;
		case 'conditional':
			return `${subject}, but exact round trips depend on the input.`;
		case 'lossy':
			return `${subject}, but this direction drops information.`;
		case 'unavailable':
			return `This direction is not available.`;
		case 'uncertain':
			return `${directionName(direction)} is available, but its exactness is not known.`;
	}
}

function directionPhrase(direction: CandidateDirection): string {
	return direction === 'folder-to-tag'
		? 'from folders to tags'
		: 'from tags to folders';
}

function directionName(direction: CandidateDirection): string {
	return direction === 'folder-to-tag' ? 'Folder to tag' : 'Tag to folder';
}
