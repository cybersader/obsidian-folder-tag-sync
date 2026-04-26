/**
 * Synthetic vault folder fixtures — flat string arrays representing what
 * `app.vault.getAllLoadedFiles()` would surface from a vault organized by
 * each well-known system. Used by detectPacks.test.ts to validate detection
 * coverage without spinning up a real Obsidian vault.
 *
 * Each fixture is shaped to be the minimum that should trigger the matching
 * rule-pack's detection, plus a couple of nested children to exercise scope
 * variants. Add fixtures here when introducing new packs or testing edge
 * cases (lowercase, emoji, etc.) — the test file consumes them by import.
 */

export const PARA_VAULT = [
	'Projects',
	'Projects/Web',
	'Projects/Web/auth-rewrite',
	'Areas',
	'Areas/Health',
	'Resources',
	'Archive',
];

/**
 * Lowercase variant — exercises case-insensitive detection (regex compiled
 * with the `i` flag in detectPacks.ts).
 */
export const PARA_VAULT_LOWERCASE = [
	'projects',
	'projects/web',
	'areas',
	'resources',
	'archive',
];

export const JD_VAULT = [
	'10 - Projects',
	'10 - Projects/Web',
	'20 - Areas',
	'20 - Areas/Health',
	'30 - Resources',
	'40 - Archive',
];

export const SEACOW_VAULT = [
	'Capture',
	'Capture/Inbox',
	'Capture/Clips',
	'Entity',
	'Entity/Cybersader',
	'Output',
	'Output/Main',
	'Output/Public',
	'System',
	'System/Templates',
];

/**
 * Cyberbase vault — emoji-prefixed folder names. The cyberbase-actual rule
 * pack ships with no detection metadata by design (it's a user-specific
 * pack, not auto-detect-worthy), so these folders should NOT surface that
 * pack. This fixture pins that behavior so any future addition of detection
 * signals is intentional.
 */
export const CYBERBASE_VAULT = [
	'⬇️ Clipping',
	'⬇️ INBOX, DROPZONE',
	'📁 01 - Foo',
	'📁 02 - Bar',
	'✅ TASKS',
	'🕸️ UNSTRUCTURED',
	'👤 VaultUser1',
	'👤 VaultUser1/⬇️ INBOX',
];

/** Composite — PARA + JD coexisting, no exclusivity declared between them. */
export const MULTI_SYSTEM_VAULT = [...PARA_VAULT, ...JD_VAULT];

export const EMPTY_VAULT: string[] = [];

/** Generic noise — should not match any pack. */
export const NOISE_VAULT = [
	'random',
	'misc',
	'stuff',
	'Notes',
	'Drafts',
];
