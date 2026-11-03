/**
 * End-to-end tests against a local anvil fork of Hoodi (`yarn test:e2e`).
 * Separate from the unit tests: own root (test-e2e/), own file suffix
 * (*.e2e.ts), and a global setup that starts anvil and stops it afterwards.
 * Without anvil or a reachable Hoodi RPC every suite is skipped with a note.
 */
const base = require('./package.json').jest;

module.exports = {
  ...base,
  roots: ['<rootDir>/test-e2e'],
  testMatch: ['**/*.e2e.ts'],
  globalSetup: '<rootDir>/test-e2e/globalSetup.cjs',
  globalTeardown: '<rootDir>/test-e2e/globalTeardown.cjs',
  // Fork reads go to a public RPC; log scans cover millions of blocks.
  testTimeout: 600_000,
  maxWorkers: 1,
};
