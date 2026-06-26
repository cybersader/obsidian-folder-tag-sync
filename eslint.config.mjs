import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";
// The sentence-case rule replaces (does not merge) the default brand list when
// `brands` is supplied, so we re-import the plugin's defaults and append our own
// project proper nouns. Without the spread, recognized brands like "Obsidian"
// and "GitHub" would start failing mid-sentence.
import { DEFAULT_BRANDS } from "eslint-plugin-obsidianmd/dist/lib/rules/ui/brands.js";

// Project-specific proper nouns that legitimately keep their casing in UI text.
// "Path Lens" is a core feature name surfaced to users (see concepts/philosophy).
// "Taxonomy Workbench" is the in-app feature name; "Johnny Decimal" is a named
// organizational system surfaced verbatim in the workbench presets. These are
// multi-word phrases, safe to match case-insensitively (no lowercase clashes).
// "Folder Tag Sync" is the plugin's own product name (manifest `name`), surfaced
// verbatim in the right-click "Open Folder Tag Sync settings" menu item.
const PROJECT_BRANDS = ["Path Lens", "Taxonomy Workbench", "Johnny Decimal", "Folder Tag Sync"];

// All-caps proper nouns matched case-SENSITIVELY (exact token), so they don't
// force unrelated lowercase usages (e.g. the lowercase group id "para" in a
// settings placeholder) to capitalize. "PARA" is Tiago Forte's method, surfaced
// verbatim in a workbench preset button.
const PROJECT_IGNORE_WORDS = ["PARA"];

export default tseslint.config(
  {
    // Test files are excluded from tsconfig's `include`, so the type-aware
    // parser (parserOptions.project) cannot resolve them. They are not shipped
    // UI and don't need the Obsidian submission rules — ignore them entirely.
    ignores: ["**/*.test.ts", "**/*.spec.ts"],
  },
  {
    files: ["src/**/*.ts"],
    languageOptions: {
      parser: tsparser,
      parserOptions: {
        project: "./tsconfig.json",
      },
    },
    plugins: {
      obsidianmd: obsidianmd,
    },
    rules: {
      "obsidianmd/ui/sentence-case": [
        "error",
        {
          enforceCamelCaseLower: true,
          brands: [...PROJECT_BRANDS, ...DEFAULT_BRANDS],
          ignoreWords: PROJECT_IGNORE_WORDS,
        },
      ],
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/validate-manifest": "error",
    },
  }
);
