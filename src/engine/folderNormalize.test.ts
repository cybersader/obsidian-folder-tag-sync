/**
 * Direct unit coverage for the shared emoji/JD-prefix normalizer. Previously
 * these helpers were copy-pasted (and only indirectly exercised) inside
 * detectPacks.ts and detectionTree.ts. Now extracted to one module, they get
 * first-class tests pinning the exact edge cases both consumers depend on.
 */

import { describe, expect, test } from 'bun:test';
import {
	stripEmojiOnly,
	stripJDPrefix,
	stripEmojiAndJD,
	matchesNormalized,
} from './folderNormalize';

describe('stripEmojiOnly', () => {
	test('strips emoji + leading space, leaves JD prefix intact', () => {
		expect(stripEmojiOnly('📁 01 - Projects')).toBe('01 - Projects');
	});

	test('strips emoji with variation selector', () => {
		expect(stripEmojiOnly('⬇️ INBOX')).toBe('INBOX');
	});

	test('no-op on plain words', () => {
		expect(stripEmojiOnly('Projects')).toBe('Projects');
	});

	test('collapses internal whitespace left by stripped emoji', () => {
		expect(stripEmojiOnly('🗂️  Areas')).toBe('Areas');
	});
});

describe('stripJDPrefix', () => {
	test('strips dash-style JD prefix', () => {
		expect(stripJDPrefix('01 - Projects')).toBe('Projects');
	});

	test('strips dot-style numeric prefix', () => {
		expect(stripJDPrefix('1. Notes')).toBe('Notes');
	});

	test('no-op when no numeric prefix', () => {
		expect(stripJDPrefix('Projects')).toBe('Projects');
	});
});

describe('stripEmojiAndJD', () => {
	test('strips both emoji and JD prefix on a single segment', () => {
		expect(stripEmojiAndJD('📁 01 - Projects')).toBe('Projects');
	});

	test('strips emoji + JD on a single decorated segment (no slash)', () => {
		// `.trim()` removes the leading space the emoji-strip leaves at the very
		// start, so the lone segment normalizes cleanly.
		expect(stripEmojiAndJD('📁 01 - Projects')).toBe('Projects');
	});

	test('normalizes an inner segment when emoji abuts text (no space)', () => {
		expect(stripEmojiAndJD('Output/📁01 - Projects')).toBe('Output/Projects');
	});

	test('already-clean path is unchanged', () => {
		expect(stripEmojiAndJD('Areas/Health')).toBe('Areas/Health');
	});

	test('KNOWN QUIRK: emoji+space after a `/` leaves a leading space that blocks JD strip', () => {
		// stripEmojiOnly collapses the `📁 ` emoji+space globally but only
		// .trim()s the whole-string ends, so an inner segment like `/📁 01 - X`
		// becomes `/ 01 - X` (leading space) — and stripJDPrefix's `^\d` regex no
		// longer matches. This is pre-existing behavior of the original
		// (copy-pasted) implementation, preserved verbatim in the extraction.
		// Detection is unaffected because matchesNormalized also tries the raw
		// and emoji-only forms.
		expect(stripEmojiAndJD('Output/📁 01 - Projects/Web')).toBe('Output/ 01 - Projects/Web');
	});
});

describe('matchesNormalized', () => {
	test('matches against the raw form', () => {
		expect(matchesNormalized(/^Projects$/i, 'Projects')).toBe(true);
	});

	test('matches semantic regex against emoji+JD-decorated folder', () => {
		// `^Projects$` only matches after both emoji and JD prefix are stripped.
		expect(matchesNormalized(/^Projects$/i, '📁 01 - Projects')).toBe(true);
	});

	test('JD regex matches the emoji-only-stripped middle form', () => {
		// `^\d{2} - ...` matches `01 - Projects` (emoji stripped) but NOT the
		// fully-normalized `Projects` — the middle layer is what makes JD pack
		// detection fire on emoji+JD vaults.
		expect(matchesNormalized(/^\d{2} - Projects$/i, '📁 01 - Projects')).toBe(true);
	});

	test('returns false when no form matches', () => {
		expect(matchesNormalized(/^Areas$/i, '📁 01 - Projects')).toBe(false);
	});
});
