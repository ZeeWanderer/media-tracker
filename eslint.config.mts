import tseslint from 'typescript-eslint';
import obsidianmd from "eslint-plugin-obsidianmd";
import globals from "globals";
import { globalIgnores } from "eslint/config";

export default tseslint.config(
	{
		languageOptions: {
			globals: {
				...globals.browser,
			},
			parserOptions: {
				projectService: {
					allowDefaultProject: [
						'eslint.config.js',
						'manifest.json'
					]
				},
				tsconfigRootDir: import.meta.dirname,
				extraFileExtensions: ['.json']
			},
		},
	},
	...obsidianmd.configs.recommended,
	{
		files: ["scripts/**/*.mjs"],
		languageOptions: {
			globals: {
				...globals.node,
			},
		},
		rules: {
			"no-unused-vars": "off",
		},
	},
	{
		files: ["src/**/*.ts"],
		rules: {
			"obsidianmd/ui/sentence-case": "off",
			"obsidianmd/settings-tab/no-manual-html-headings": "off",
			"obsidianmd/commands/no-plugin-id-in-command-id": "off",
			"obsidianmd/commands/no-plugin-name-in-command-name": "off",
			"no-alert": "off",
		},
	},
	globalIgnores([
		"node_modules",
		"dist",
		"esbuild.config.mjs",
		"eslint.config.js",
		"version-bump.mjs",
		"versions.json",
		"main.js",
		"preview/data.js",
		"preview/preview.js",
	]),
);
