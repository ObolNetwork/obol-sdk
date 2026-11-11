/**
 * Helpers for the tests that run the built package (`dist/`), in a child
 * Node process so the real module formats are loaded (not ts-jest's view of
 * `src/`). CI builds before it tests; locally a missing or stale build skips
 * these tests with a warning instead of testing old code.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';

const newestSource = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce((newest, entry) => {
    const path = join(dir, entry.name);
    const time = entry.isDirectory()
      ? newestSource(path)
      : statSync(path).mtimeMs;
    return Math.max(newest, time);
  }, 0);

const BUILDS = [
  'dist/browser/src/index.js',
  'dist/esm/src/index.js',
  'dist/cjs/src/index.js',
];

/** Why the build cannot be tested, or null when it is there and current. */
export const distProblem = (): string | null => {
  const missing = BUILDS.find(file => !existsSync(file));
  if (missing !== undefined) return `${missing} is missing`;
  const built = Math.min(...BUILDS.map(file => statSync(file).mtimeMs));
  return built < newestSource('src') ? 'dist/ is older than src/' : null;
};

/**
 * `describe` for the built package: runs when `dist/` is current; fails in
 * CI when it is not (the workflow builds first); otherwise skips, saying
 * why.
 */
export const describeDist = (name: string, fn: () => void): void => {
  const problem = distProblem();
  if (problem === null) {
    describe(name, fn);
    return;
  }
  if (process.env.CI !== undefined && process.env.CI !== '') {
    describe(name, () => {
      it('needs a current build', () => {
        throw new Error(`${problem}: run \`yarn build\` before the tests`);
      });
    });
    return;
  }
  console.warn(`Skipping "${name}": ${problem} (run \`yarn build\`)`);
  describe.skip(name, fn);
};

/** Runs a script with plain Node (no loaders) and parses its JSON output. */
export const runNode = <R>(script: string, args: string[] = []): R =>
  JSON.parse(
    execFileSync(process.execPath, [script, ...args], {
      encoding: 'utf8',
      // No NODE_OPTIONS from Jest (--experimental-vm-modules).
      env: { ...process.env, NODE_OPTIONS: '' },
      maxBuffer: 16 * 1024 * 1024,
    }),
  ) as R;
