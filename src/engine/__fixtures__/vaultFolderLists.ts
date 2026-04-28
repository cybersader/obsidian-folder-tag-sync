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

// ─── Deep / real-world fixtures ──────────────────────────────────────────
// These exercise scenarios documented as supported (concepts pages, philosophy
// doc, agent-context) but historically untested:
//   - 5+ level path depth (folder-classifiers.md: "deep Output taxonomies")
//   - Emoji + JD-prefix + depth combined (cyberbase-actual workflow)
//   - SEACOW per-entity scoping at depth (Entity/User/Output/.../...)
//   - Authority-root + nested work axes stacked (axes.md)
//   - Hyphenated / underscored deep classification (LCSH-style)
// Source: Apr 2026 audit + seacowr-knowledge-platform-meta-framework notes
// (github.com/cybersader/seacowr-knowledge-platform-meta-framework).

/**
 * 5-level PARA hierarchy. Tests that `^Projects(?:/|$)` style patterns match
 * at depth, that identity transfer preserves all segments, and that the
 * forward+inverse round-trip survives 5-deep folder names with spaces, kebabs,
 * and parens.
 */
export const PARA_DEEP_VAULT = [
	'Projects',
	'Projects/Web',
	'Projects/Web/Auth',
	'Projects/Web/Auth/oauth-rewrite',
	'Projects/Web/Auth/oauth-rewrite/v2',
	'Projects/Mobile',
	'Projects/Mobile/iOS',
	'Projects/Mobile/iOS/Onboarding',
	'Projects/Mobile/iOS/Onboarding/Variants',
	'Projects/Mobile/iOS/Onboarding/Variants/A-B-Tests',
	'Areas',
	'Areas/Health',
	'Areas/Health/Exercise',
	'Areas/Health/Exercise/Routines',
	'Areas/Health/Exercise/Routines/2026',
	'Areas/Health/Exercise/Routines/2026/Q1',
	'Resources',
	'Resources/Books',
	'Resources/Books/Programming',
	'Resources/Books/Programming/Rust',
	'Archive',
	'Archive/2024',
	'Archive/2024/Projects',
	'Archive/2024/Projects/Old-Web',
];

/**
 * Real-world cyberbase layout from the seacowr meta-framework notes.
 * Combines emoji + JD-prefix + depth + the canonical SEACOW(r) axes
 * (Capture / Output / System / relation). Tests that detection-normalization
 * (commit 6eb9ba3) actually works at depth, that JD + emoji folders match
 * cyberbase-actual / seacow-cyberbase rules at 5+ deep, and that daily-notes /
 * clipping / inbox flows round-trip correctly.
 *
 * Layout from `03-examples/cyberbase/folder-structure.md` of the seacowr repo.
 */
export const SEACOW_CYBERBASE_REAL_VAULT = [
	// SYSTEM
	'_attachments',
	'_attachments/images',
	'_attachments/images/2026',
	'_attachments/images/2026/04',
	'_excalidraw',
	'✅ TASKS',
	'✅ TASKS/Active',
	// CAPTURE
	'⬇️ Clipping',
	'⬇️ Clipping/2026-04-28-article',
	'⬇️ INBOX, DROPZONE',
	'⬇️ INBOX, DROPZONE/2026-04-28',
	// OUTPUT — emoji + JD prefixes, deeply nested
	'📁 01 - Projects',
	'📁 01 - Projects/Cybersecurity',
	'📁 01 - Projects/Cybersecurity/Pentest Journal',
	'📁 01 - Projects/Cybersecurity/Pentest Journal/2024-Q4',
	'📁 01 - Projects/Cybersecurity/Pentest Journal/2024-Q4/lateral-movement',
	'📁 02 - CyberNews',
	'📁 02 - CyberNews/2026',
	'📁 02 - CyberNews/2026/04',
	'📁 03 - Curations, Stacks',
	'📁 04 - Cyber & Digital Trust',
	'📁 04 - Cyber & Digital Trust/Frameworks',
	'📁 04 - Cyber & Digital Trust/Frameworks/NIST',
	'📁 04 - Cyber & Digital Trust/Frameworks/NIST/CSF',
	'📁 04 - Cyber & Digital Trust/Frameworks/NIST/CSF/2.0',
	'📁 05 - Organizational Cyber',
	'📁 06 - Learning, Notes',
	'📁 06 - Learning, Notes/Languages',
	'📁 06 - Learning, Notes/Languages/Rust',
	'📁 06 - Learning, Notes/Languages/Rust/Ownership',
	'📁 06 - Learning, Notes/Languages/Rust/Ownership/borrow-checker',
	'📅 Changelog',
	// CAPTURE + WORK
	'🕸️ UNSTRUCTURED',
	'🕸️ UNSTRUCTURED/synthesis',
	// CAPTURE + RELATION
	'🕸️ Daily Notes',
	'🕸️ Daily Notes/2026',
	'🕸️ Daily Notes/2026/04',
];

/**
 * Multi-axis emoji + JD + depth combinations. Tests cross-pack matching:
 * SEACOW outer + JD-numbered Output rules should both fire; F1 group
 * precedence (Step 3) should disambiguate. Specifically combines all
 * three normalization axes (emoji, JD-prefix, depth).
 */
export const MIXED_DEPTH_EMOJI_JD_VAULT = [
	'Capture',
	'Capture/Clips',
	'Capture/Clips/2026',
	'Capture/Clips/2026/04',
	'Capture/Clips/2026/04/Web',
	'Capture/Inbox',
	'Capture/Inbox/2026-04-28',
	'Output',
	'Output/📁 01 - Projects',
	'Output/📁 01 - Projects/Web',
	'Output/📁 01 - Projects/Web/Auth',
	'Output/📁 01 - Projects/Web/Auth/oauth-rewrite',
	'Output/📁 01 - Projects/Web/Auth/oauth-rewrite/v2',
	'Output/📁 02 - Areas',
	'Output/📁 02 - Areas/Health',
	'Output/📁 02 - Areas/Health/Logs',
	'System',
	'System/Templates',
	'System/Templates/Daily',
];

/**
 * Per-entity scoping at depth. Tests that `^Entity/Cybersader(?:/|$)` matches
 * under Cybersader at 5+ deep but does NOT match under Entity/Bob — i.e.
 * the per-entity scope is correctly anchored (no false positives across
 * sibling entities). Also exercises stacked axes (Entity + Output via JD).
 */
export const ENTITY_PER_USER_DEEP_VAULT = [
	'Entity',
	'Entity/Cybersader',
	'Entity/Cybersader/Output',
	'Entity/Cybersader/Output/📁 01 - Projects',
	'Entity/Cybersader/Output/📁 01 - Projects/Cybersecurity',
	'Entity/Cybersader/Output/📁 01 - Projects/Cybersecurity/Pentest Journal',
	'Entity/Cybersader/Output/📁 01 - Projects/Cybersecurity/Pentest Journal/2024-Q4',
	'Entity/Cybersader/Capture',
	'Entity/Cybersader/Capture/Inbox',
	'Entity/Bob',
	'Entity/Bob/Output',
	'Entity/Bob/Output/📁 01 - Personal',
	'Entity/Bob/Output/📁 01 - Personal/Health',
	'Entity/Bob/Output/📁 01 - Personal/Health/Logs',
	'Entity/Bob/Output/📁 01 - Personal/Health/Logs/2026',
	'Entity/Bob/Capture',
	'Entity/Bob/Capture/Inbox',
];

/**
 * Enterprise JD-style vault — generic representation of a corporate-style
 * knowledge vault using single-digit numbered top-level buckets, mixed
 * with control-framework folders and a few utility folders. Tests that
 * detection + single-digit-JD matching works on this shape end-to-end.
 *
 * Generic — no organization-specific names. Used by the
 * `enterprise-jd-vault` starter pack tests.
 */
export const ENTERPRISE_JD_DEEP_VAULT = [
	'0 - Tasks, Planning',
	'0 - Tasks, Planning/Q1-Tracker',
	'0 - Tasks, Planning/Annual Planning - WORKSPACE',
	'0 - Tasks, Planning/Office Hours',
	'1 - Workspaces, Projects',
	'1 - Workspaces, Projects/AI Adoption',
	'1 - Workspaces, Projects/Auth Resilience',
	'1 - Workspaces, Projects/Identity Management',
	'2 - Areas, Initiatives',
	'2 - Areas, Initiatives/3rd Party Risk Management',
	'2 - Areas, Initiatives/Resilient-Culture',
	'2 - Areas, Initiatives/Vulnerability-Management',
	'3 - Docs, Intel, SOPs',
	'3 - Docs, Intel, SOPs/01 - Member-Facing Policies',
	'3 - Docs, Intel, SOPs/10 - Standards, Procedures, SOPs',
	'3 - Docs, Intel, SOPs/11 - Playbooks',
	'3 - Docs, Intel, SOPs/60 - Regulations',
	'3 - Docs, Intel, SOPs/Detection-Architecture',
	'4 - Topics, Knowledge, External, Misc',
	'4 - Topics, Knowledge, External, Misc/AI Prompts',
	'4 - Topics, Knowledge, External, Misc/Reading List',
	'5 - Archive, Admin',
	'5 - Archive, Admin/HR-Benefits',
	'6 - Ideation, Sandbox',
	'6 - Ideation, Sandbox/POC',
	'7 - Vault Config & Management',
	'7 - Vault Config & Management/Dataview Queries',
	'99 - ARCHIVE',
	'99 - ARCHIVE/Closed Initiatives',
	'_attachments',
	'Templates',
	'Bases Templates',
	'Slides Templates',
	'Risk Threats Library',
	'TaskNotes',
	'TaskNotes/Views',
	'Test',
	'output',
	'export',
	'Excalidraw',
	'CSV import',
	'Markwhen',
];

/**
 * LCSH-style deep classification taxonomy — 6+ levels, hyphenated names.
 * Documentation (folder-classifiers.md line 39) explicitly claims support
 * for "deep Output taxonomies (multi-level subject classifications like
 * LCSH-style trees)" but no fixture historically tested this.
 *
 * Stresses identity transfer at depth + glob slot template matching:
 * `Resources/{topic}/{deeper...}` should capture `topic` plus a long tail.
 */
export const DEEP_TAXONOMY_VAULT = [
	'Resources',
	'Resources/Computer-Science',
	'Resources/Computer-Science/Programming-Languages',
	'Resources/Computer-Science/Programming-Languages/Type-Systems',
	'Resources/Computer-Science/Programming-Languages/Type-Systems/Substructural',
	'Resources/Computer-Science/Programming-Languages/Type-Systems/Substructural/Linear',
	'Resources/Computer-Science/Programming-Languages/Type-Systems/Substructural/Affine',
	'Resources/Computer-Science/Distributed-Systems',
	'Resources/Computer-Science/Distributed-Systems/Consensus',
	'Resources/Computer-Science/Distributed-Systems/Consensus/Paxos',
	'Resources/Computer-Science/Distributed-Systems/Consensus/Raft',
	'Resources/Mathematics',
	'Resources/Mathematics/Topology',
	'Resources/Mathematics/Topology/Algebraic',
	'Resources/Mathematics/Topology/Algebraic/Cohomology',
	'Resources/Mathematics/Topology/Algebraic/Homotopy',
];
