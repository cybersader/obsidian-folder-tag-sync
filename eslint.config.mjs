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
const PROJECT_BRANDS = ["Path Lens"];

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
        { enforceCamelCaseLower: true, brands: [...PROJECT_BRANDS, ...DEFAULT_BRANDS] },
      ],
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/validate-manifest": "error",
    },
  }
);
