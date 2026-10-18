// release-it `after:bump` hook: node scripts/release-changelog.mjs <version> <previousVersion>
//
// If CHANGELOG.md has a hand-written "#### Unreleased" section, retitle it as the new
// version and keep its text. Otherwise fall back to the generated commit list.
import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [version, previous] = process.argv.slice(2);
if (!version || !previous) {
  console.error('usage: release-changelog.mjs <version> <previousVersion>');
  process.exit(1);
}

const file = 'CHANGELOG.md';
const changelog = readFileSync(file, 'utf8');
const unreleased = /^#### Unreleased[ \t]*$/m;

if (unreleased.test(changelog)) {
  const date = new Date().toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
  const heading =
    `#### [v${version}](https://github.com/ObolNetwork/obol-sdk/compare/v${previous}...v${version})` +
    `\n\n> ${date}`;
  writeFileSync(file, changelog.replace(unreleased, heading));
  console.log(`CHANGELOG.md: kept the Unreleased notes as v${version}`);
} else {
  execSync('npx auto-changelog -p --hide-credit', { stdio: 'inherit' });
}
