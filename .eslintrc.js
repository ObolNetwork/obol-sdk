module.exports = {
  env: {
    browser: true,
    es2021: true,
  },
  extends: 'standard-with-typescript',
  overrides: [
    {
      env: {
        node: true,
      },
      files: ['.eslintrc.{js,cjs}'],
      parserOptions: {
        sourceType: 'script',
      },
    },
    {
      // The one place that wraps the library's list types.
      files: ['src/internal/sszLists.ts'],
      rules: { 'no-restricted-imports': 'off' },
    },
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module',
  },
  ignorePatterns: ['**/dist/**', '**/*.spec.ts', '**/test/**'],
  rules: {
    // The browser build has no `Buffer` (only Next.js polyfills it): use
    // Uint8Array and src/internal/bytes.ts. test/package/browserNoBuffer.spec.ts
    // runs the built bundle without it.
    'no-restricted-globals': [
      'error',
      {
        name: 'Buffer',
        message:
          'Buffer is not available in browsers; use Uint8Array (src/internal/bytes.ts).',
      },
    ],
    // The library's list types hash with `Buffer` (mixInLength); the SDK's
    // subclasses in src/internal/sszLists.ts do not.
    'no-restricted-imports': [
      'error',
      {
        paths: [
          {
            name: '@chainsafe/ssz',
            importNames: ['ByteListType', 'ListBasicType', 'ListCompositeType'],
            message:
              'Import the list types from src/internal/sszLists.ts: the library ones need Buffer to hash.',
          },
        ],
      },
    ],
    '@typescript-eslint/ban-types': [
      'error',
      {
        extendDefaults: true,
        types: {
          Buffer: {
            message:
              'Buffer is not available in browsers; use Uint8Array (src/internal/bytes.ts).',
          },
        },
      },
    ],
    '@typescript-eslint/strict-boolean-expressions': 0,
    '@typescript-eslint/comma-dangle': 0,
    '@typescript-eslint/dot-notation': 0,
    '@typescript-eslint/indent': 0,
    '@typescript-eslint/consistent-type-definitions': 0,
    '@typescript-eslint/non-nullable-type-assertion-style': 0,
    '@typescript-eslint/semi': 'off',
    '@typescript-eslint/space-before-function-paren': 'off',
    '@typescript-eslint/member-delimiter-style': 'off',
    'no-useless-catch': 0,
    'new-cap': 0,
    "@typescript-eslint/naming-convention": 'off',
    '@typescript-eslint/prefer-nullish-coalescing': 'off'
  },
};