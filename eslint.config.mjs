import tseslint from 'typescript-eslint';
import unicorn from 'eslint-plugin-unicorn';
import unusedImports from 'eslint-plugin-unused-imports';
import react from 'eslint-plugin-react';
import globals from 'globals';

// This config intentionally enables ONLY the mechanical, auto-fixable rules that
// correspond to the "Tier A" SonarQube findings. It is deliberately NOT the full
// recommended rule set, to avoid surfacing hundreds of non-auto-fixable warnings.
export default [
  {
    ignores: [
      'node_modules/**',
      'dist/**',
      'build/**',
      '.scannerwork/**',
      'src/client/tailwind.css',
      '**/*.json',
    ],
  },

  // ServiceNow "fluent" server-side scripts.
  // The target instance runs the ServiceNow "Zurich" release, whose server-side
  // JS engine supports ES2020+ (optional chaining, for-of, includes, replaceAll,
  // Object.hasOwn), so modern transforms are safe to apply here.
  {
    files: ['src/fluent/**/*.js'],
    plugins: { unicorn, '@typescript-eslint': tseslint.plugin },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'script',
      parserOptions: {
        project: './tsconfig.eslint.json',
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.node,
        // ServiceNow server-side globals
        GlideRecord: 'readonly',
        GlideRecordSecure: 'readonly',
        GlideAggregate: 'readonly',
        GlideDateTime: 'readonly',
        GlideDate: 'readonly',
        GlideFilter: 'readonly',
        GlideElement: 'readonly',
        Class: 'readonly',
        gs: 'readonly',
        sn_ws: 'readonly',
        RESTMessageV2: 'readonly',
        JSON: 'readonly',
        current: 'readonly',
        previous: 'readonly',
        request: 'readonly',
        response: 'readonly',
        action: 'readonly',
        template: 'readonly',
        email: 'readonly',
        email_action: 'readonly',
        event: 'readonly',
      },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/catch-error-name': ['error', { name: 'error' }],
      'unicorn/prefer-date-now': 'error',
      // ES2020+ transforms (supported on the Zurich release server engine):
      'unicorn/no-for-loop': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-string-replace-all': 'error',
      'unicorn/prefer-object-has-own': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
    },
  },

  // React / TypeScript client code (runs in the browser).
  {
    files: ['src/client/**/*.{ts,tsx}'],
    plugins: {
      unicorn,
      'unused-imports': unusedImports,
      '@typescript-eslint': tseslint.plugin,
      react,
    },
    languageOptions: {
      parser: tseslint.parser,
      ecmaVersion: 2022,
      sourceType: 'module',
      parserOptions: {
        ecmaFeatures: { jsx: true },
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
      globals: {
        ...globals.browser,
      },
    },
    settings: {
      react: { version: 'detect' },
    },
    rules: {
      'no-var': 'error',
      'prefer-const': 'error',
      'unused-imports/no-unused-imports': 'error',
      '@typescript-eslint/prefer-optional-chain': 'error',
      'unicorn/prefer-number-properties': 'error',
      'unicorn/prefer-string-replace-all': 'error',
      'unicorn/prefer-includes': 'error',
      'unicorn/prefer-date-now': 'error',
      'unicorn/prefer-string-starts-ends-with': 'error',
      'unicorn/prefer-object-has-own': 'error',
      'unicorn/prefer-code-point': 'error',
      'unicorn/prefer-array-flat': 'error',
      'logical-assignment-operators': ['error', 'always'],
      'react/prefer-read-only-props': 'error',
      '@typescript-eslint/prefer-regexp-exec': 'error',
    },
  },
];
