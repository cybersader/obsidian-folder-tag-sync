/**
 * uxLabFixture — the invented, marker-owned `UX Lab/` evaluation tree.
 *
 * Nothing here names a real vault. The base tree mirrors the numbered-roots
 * shape the split-UX spec builds inline; the outline extension adds the exact
 * presentation cases the annotated-outline prototype has to survive:
 *
 *   Overlap/               two ready systems (Johnny Decimal + enterprise JD)
 *                          anchored on the SAME folder — two header lines and
 *                          two side-by-side gutter lanes.
 *   Repeated PARA/         one pack, three separate occurrences:
 *                            Studio  — every PARA folder type, with sub-folders
 *                                      so step 3 has projected-tag rows
 *                            Home    — most folder types
 *                            Club    — only Projects, so it stays incomplete
 *   Partial enterprise/    an enterprise-JD occurrence below its threshold.
 *   SEACOW workshop/       member evidence, SUPPORT evidence, and a NESTED
 *                          Johnny Decimal occurrence at Output/Main.
 *   Long context/          a very long invented branch name for width checks.
 *   Negative control/      no detections at all, so it is elided.
 *
 * Pure data: these builders run in the test process and hand plain string
 * arrays to `browser.executeObsidian`, which cannot close over imports.
 */

export const UX_LAB_ROOT = 'UX Lab';

export const UX_LAB_NUMBERED_ROOTS: readonly string[] = [
	'0 - Tasks, Planning',
	'1 - Workspaces, Projects',
	'2 - Areas, Initiatives',
	'3 - Docs, Intel, SOPs',
	'4 - Topics, Knowledge, External, Misc',
	'5 - Archive, Admin',
	'6 - Ideation, Sandbox',
	'7 - Vault Config & Management',
	'99 - ARCHIVE',
];

export const UX_LAB_LONG_BRANCH =
	'An intentionally long invented branch name for horizontal overflow checks';

/** The numbered-roots lanes tree used by the existing split-UX evaluation. */
export function buildUxLabBaseFolders(
	root: string = UX_LAB_ROOT,
	numberedRoots: readonly string[] = UX_LAB_NUMBERED_ROOTS,
): string[] {
	const folders = [root];
	for (const numbered of numberedRoots) {
		const base = `${root}/${numbered}`;
		folders.push(
			base,
			`${base}/Lane 01`,
			`${base}/Lane 01/Step A`,
			`${base}/Lane 01/Step A/Checkpoint`,
			`${base}/Lane 01/Step B`,
			`${base}/Lane 02`,
			`${base}/Lane 02/Research queue`,
			`${base}/Lane 03`,
			`${base}/${UX_LAB_LONG_BRANCH}`,
		);
	}
	return folders;
}

/** Anchors the outline prototype expects, as relative vault paths. */
export const UX_LAB_OUTLINE_ANCHORS = Object.freeze({
	overlap: `${UX_LAB_ROOT}/Overlap`,
	studio: `${UX_LAB_ROOT}/Repeated PARA/Studio`,
	home: `${UX_LAB_ROOT}/Repeated PARA/Home`,
	club: `${UX_LAB_ROOT}/Repeated PARA/Club`,
	partialEnterprise: `${UX_LAB_ROOT}/Partial enterprise`,
	seacow: `${UX_LAB_ROOT}/SEACOW workshop`,
	nestedJd: `${UX_LAB_ROOT}/SEACOW workshop/Output/Main`,
	longContext: `${UX_LAB_ROOT}/Long context/${UX_LAB_LONG_BRANCH}`,
});

/** Every folder the annotated-outline prototype fixture needs. */
export function buildUxLabOutlineFolders(root: string = UX_LAB_ROOT): string[] {
	const long = UX_LAB_LONG_BRANCH;
	return [
		root,

		// Two ready systems sharing one anchor. The leaf folders exist so both
		// packs' rules actually emit a tag at the same folder — that overlap is
		// what step 3 has to report.
		`${root}/Overlap`,
		`${root}/Overlap/0 - Tasks, Planning`,
		`${root}/Overlap/0 - Tasks, Planning/Invented intake`,
		`${root}/Overlap/1 - Workspaces, Projects`,
		`${root}/Overlap/1 - Workspaces, Projects/Invented workspace`,
		`${root}/Overlap/2 - Areas, Initiatives`,
		`${root}/Overlap/2 - Areas, Initiatives/Invented initiative`,
		`${root}/Overlap/3 - Docs, Intel, SOPs`,
		`${root}/Overlap/3 - Docs, Intel, SOPs/Invented runbook`,

		// One pack, three separate occurrences.
		`${root}/Repeated PARA`,
		`${root}/Repeated PARA/Studio`,
		`${root}/Repeated PARA/Studio/Projects`,
		`${root}/Repeated PARA/Studio/Projects/Invented client rebrand`,
		`${root}/Repeated PARA/Studio/Projects/Invented gallery build`,
		`${root}/Repeated PARA/Studio/Areas`,
		`${root}/Repeated PARA/Studio/Areas/Invented studio upkeep`,
		`${root}/Repeated PARA/Studio/Areas/Invented supplier care`,
		`${root}/Repeated PARA/Studio/Resources`,
		`${root}/Repeated PARA/Studio/Archive`,
		`${root}/Repeated PARA/Home`,
		`${root}/Repeated PARA/Home/Projects`,
		`${root}/Repeated PARA/Home/Areas`,
		`${root}/Repeated PARA/Home/Resources`,
		`${root}/Repeated PARA/Club`,
		`${root}/Repeated PARA/Club/Projects`,

		// Below the enterprise threshold.
		`${root}/Partial enterprise`,
		`${root}/Partial enterprise/0 - Tasks, Planning`,
		`${root}/Partial enterprise/1 - Workspaces, Projects`,

		// Member + support evidence, plus a nested Johnny Decimal occurrence.
		`${root}/SEACOW workshop`,
		`${root}/SEACOW workshop/Capture`,
		`${root}/SEACOW workshop/Capture/Inbox`,
		`${root}/SEACOW workshop/Entity`,
		`${root}/SEACOW workshop/Output`,
		`${root}/SEACOW workshop/Output/Main`,
		`${root}/SEACOW workshop/Output/Main/10 - Projects`,
		`${root}/SEACOW workshop/Output/Main/20 - Areas`,
		`${root}/SEACOW workshop/System`,

		// Long names for width checks.
		`${root}/Long context`,
		`${root}/Long context/${long}`,
		`${root}/Long context/${long}/Projects`,
		`${root}/Long context/${long}/Areas`,

		// No detections at all — elided.
		`${root}/Negative control`,
		`${root}/Negative control/Invented loose notes`,
		`${root}/Negative control/Invented scratch`,
	];
}
