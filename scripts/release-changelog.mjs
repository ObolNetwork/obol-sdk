// release-it `after:bump` hook: node scripts/release-changelog.mjs <version> <previousVersion>
//
// CHANGELOG.md is hand-written. A "#### Unreleased" section is retitled as the new version and
// kept as it is. Without one the release fails: regenerating the whole file from commits
// (auto-changelog -p) is how the 2.15.0 notes were lost.
//
// CHANGELOG_FROM_COMMITS=1 opts in to a generated section instead: this release's commit
// subjects (v<previous>..HEAD), inserted above the newest entry. Nothing else in the file changes.
import { execFileSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';

const [version, previous] = process.argv.slice(2);
if (!version || !previous) {
  console.error('usage: release-changelog.mjs <version> <previousVersion>');
  process.exit(1);
}

const file = 'CHANGELOG.md';
const changelog = readFileSync(file, 'utf8');
const unreleased = /^#### Unreleased[ \t]*$/m;
const date = new Date().toLocaleDateString('en-GB', {
  day: 'numeric',
  month: 'long',
  year: 'numeric',
  timeZone: 'UTC',
});
const heading =
  `#### [v${version}](https://github.com/ObolNetwork/obol-sdk/compare/v${previous}...v${version})` +
  `\n\n> ${date}`;

if (unreleased.test(changelog)) {
  writeFileSync(file, changelog.replace(unreleased, heading));
  console.log(`CHANGELOG.md: kept the Unreleased notes as v${version}`);
} else if (process.env.CHANGELOG_FROM_COMMITS === '1') {
  const subjects = execFileSync(
    'git',
    ['log', '--no-merges', '--format=- %s', `v${previous}..HEAD`],
    { encoding: 'utf8' },
  ).trim();
  const section = `${heading}\n\n${subjects || '- No changes.'}\n\n`;
  const newest = changelog.search(/^#### \[/m);
  writeFileSync(
    file,
    newest === -1
      ? `${changelog.trimEnd()}\n\n${section}`
      : changelog.slice(0, newest) + section + changelog.slice(newest),
  );
  console.log(
    `CHANGELOG.md: added v${version} from v${previous}..HEAD commit subjects`,
  );
} else {
  console.error(
    `CHANGELOG.md has no "#### Unreleased" section, so there are no notes for v${version}.\n` +
      'Add one (for a final release after RCs, summarise them there) and run the release again,\n' +
      'or set CHANGELOG_FROM_COMMITS=1 to add a section generated from commit subjects.',
  );
  process.exit(1);
}
