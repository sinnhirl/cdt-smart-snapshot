import js from '@eslint/js';
import stylisticPlugin from '@stylistic/eslint-plugin';
import {defineConfig, globalIgnores} from 'eslint/config';
import importPlugin from 'eslint-plugin-import';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default defineConfig([
  globalIgnores(['**/node_modules', '**/build/', '**/coverage/']),
  importPlugin.flatConfigs.typescript,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: {...globals.node},
      parserOptions: {
        projectService: {
          allowDefaultProject: [
            '.prettierrc.cjs',
            'eslint.config.mjs',
            'vitest.config.ts',
          ],
        },
      },
      parser: tseslint.parser,
    },
    plugins: {
      js,
      '@typescript-eslint': tseslint.plugin,
      '@stylistic': stylisticPlugin,
    },
    settings: {
      'import/resolver': {typescript: true},
    },
    extends: ['js/recommended'],
  },
  tseslint.configs.recommended,
  tseslint.configs.stylistic,
  {
    name: 'TypeScript rules',
    rules: {
      curly: ['error', 'all'],
      'no-undef': 'off',
      'no-unused-vars': 'off',
      '@typescript-eslint/no-unused-vars': [
        'error',
        {argsIgnorePattern: '^_', varsIgnorePattern: '^_'},
      ],
      '@typescript-eslint/no-explicit-any': ['error', {ignoreRestArgs: true}],
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/consistent-type-exports': 'error',
      '@typescript-eslint/consistent-type-definitions': ['error', 'interface'],
      '@typescript-eslint/array-type': ['error', {default: 'array-simple'}],
      '@typescript-eslint/no-floating-promises': 'error',
      'import/no-cycle': ['error', {maxDepth: Infinity}],
      'import/enforce-node-protocol-usage': ['error', 'always'],
      '@stylistic/function-call-spacing': 'error',
      '@stylistic/semi': 'error',
    },
  },
  {
    name: 'Tests',
    files: ['**/*.test.ts'],
    rules: {
      '@typescript-eslint/no-floating-promises': 'off',
    },
  },
]);
