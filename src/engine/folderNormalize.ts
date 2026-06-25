/**
 * folderNormalize — emoji / Johnny-Decimal prefix normalization for folder
 * and path strings.
 *
 * Pure. No Obsidian, no I/O. Real-world Obsidian vaults decorate folder names
 * with emoji and JD-style numeric prefixes (`📁 01 - Projects`, `⬇️ INBOX`).
 * Pack/detection signals are written against the *semantic* name (`^Projects$`,
 * `^INBOX$`). These helpers bridge the two by stripping the decoration so the
 * semantic regex can still match.
 *
 * Shared by `detectPacks.ts` and `detectionTree.ts` (previously copy-pasted
 * in both). Keeping a single source of truth means a folder that detects as a
 * hit in one file detects identically in the other.
 */

/**
 * Strip decorative emoji from a folder/path string. Per-segment for paths.
 *
 * Examples:
 *   "📁 01 - Projects" → "01 - Projects"   (emoji + leading space gone, JD intact)
 *   "⬇️ INBOX"        → "INBOX"
 *   "Projects"        → "Projects"          (no-op)
 */
export function stripEmojiOnly(target: string): string {
	return target
		.replace(/[\u{1F600}-\u{1F64F}]/gu, '')
		.replace(/[\u{1F300}-\u{1F5FF}]/gu, '')
		.replace(/[\u{1F680}-\u{1F6FF}]/gu, '')
		.replace(/[\u{1F1E0}-\u{1F1FF}]/gu, '')
		.replace(/[\u{2600}-\u{26FF}]/gu, '')
		.replace(/[\u{2700}-\u{27BF}]/gu, '')
		.replace(/[\u{1F900}-\u{1F9FF}]/gu, '')
		.replace(/[\u{2B00}-\u{2BFF}]/gu, '')
		.replace(/[\u{FE00}-\u{FE0F}]/gu, '')
		.replace(/\s+/g, ' ')
		.trim();
}

/**
 * Strip the Johnny-Decimal-style numeric prefix from a single segment.
 * "01 - Projects" → "Projects"; "1. Notes" → "Notes"; "Projects" → "Projects".
 */
export function stripJDPrefix(segment: string): string {
	const jdMatch = segment.match(/^\d+\s*-\s*(.+)$/);
	if (jdMatch) return jdMatch[1].trim();
	const simpleMatch = segment.match(/^\d+\.?\s+(.+)$/);
	if (simpleMatch) return simpleMatch[1].trim();
	return segment;
}

/**
 * Strip emoji AND the JD numeric prefix per segment. Used for detecting
 * convention-blind systems (PARA on emoji+JD-prefixed folders) but NOT for
 * JD pack detection itself (which needs to MATCH the prefix).
 *
 * Examples:
 *   "📁 01 - Projects"            → "Projects"
 *   "Output/📁01 - Projects"      → "Output/Projects"   (emoji abuts text)
 *
 * Known quirk: when an emoji sits directly after a `/` on an *inner* segment
 * (`Output/📁 01 - Projects/Web`), stripEmojiOnly collapses the emoji+space to
 * a single leading space on that segment but only trims the whole-string ends,
 * so the segment becomes ` 01 - Projects` and stripJDPrefix's `^\d` regex no
 * longer fires — the JD prefix survives on inner segments. This is the
 * original (pre-extraction) behavior, preserved verbatim. Detection still
 * works because `matchesNormalized` also tests the emoji-only and raw forms.
 */
export function stripEmojiAndJD(target: string): string {
	return stripEmojiOnly(target).split('/').map(stripJDPrefix).join('/');
}

/**
 * Test a regex against three forms of the target — raw, emoji-only-stripped,
 * and emoji+JD-stripped. Any match counts. The middle form is essential for
 * detecting JD packs against emoji+JD folders (`📁 01 - Projects`): the JD
 * regex `^\d{2} - ...` matches the emoji-only form `01 - Projects` but not
 * the fully-normalized form `Projects`. Without this middle layer, JD
 * detection silently misses the very vaults it's designed to detect.
 */
export function matchesNormalized(regex: RegExp, target: string): boolean {
	if (regex.test(target)) return true;
	const emojiOnly = stripEmojiOnly(target);
	if (emojiOnly !== target && regex.test(emojiOnly)) return true;
	const fullNormalize = stripEmojiAndJD(target);
	if (fullNormalize !== emojiOnly && regex.test(fullNormalize)) return true;
	return false;
}
