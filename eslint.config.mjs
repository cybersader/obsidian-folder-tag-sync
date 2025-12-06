import tsparser from "@typescript-eslint/parser";
import obsidianmd from "eslint-plugin-obsidianmd";
import tseslint from "typescript-eslint";

export default tseslint.config(
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
      "obsidianmd/ui/sentence-case": ["error", { enforceCamelCaseLower: true }],
      "obsidianmd/settings-tab/no-manual-html-headings": "error",
      "obsidianmd/settings-tab/no-problematic-settings-headings": "error",
      "obsidianmd/no-forbidden-elements": "error",
      "obsidianmd/sample-names": "error",
      "obsidianmd/validate-manifest": "error",
    },
  }
);
