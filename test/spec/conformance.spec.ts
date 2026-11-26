// spec/errors.md, the code unions in src/codes.ts and the codes src/ actually
// uses must be one set: a code thrown or emitted that errors.md does not
// list, or a documented code nothing uses, fails here.
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { FINDING_CODES, OBOL_ERROR_CODES } from '../../src/codes.js';

const doc = readFileSync('spec/errors.md', 'utf8');
const section = (from: string, to?: string): string => {
  const start = doc.indexOf(from);
  const end = to === undefined ? doc.length : doc.indexOf(to, start);
  return doc.slice(start, end);
};
/** First cells of the table rows: `| \`CODE\` …`, without a `[severity]`. */
const tableCodes = (text: string): string[] =>
  [...text.matchAll(/^\| `([A-Z][A-Z0-9_]+)`/gm)].map(m => m[1]);

const documentedErrors = tableCodes(section('## Errors', '## Findings'));
const findingsText = section('## Findings');
const incentiveIssues = [
  ...findingsText
    .slice(findingsText.indexOf('Incentive claim issues'))
    .split('Their meaning')[0]
    .matchAll(/`([A-Z][A-Z0-9_]+)`/g),
]
  .map(m => m[1])
  .filter(c => c !== 'INCENTIVES_PREFLIGHT_FAILED');
const documentedFindings = [...tableCodes(findingsText), ...incentiveIssues];

const sources = (dir: string): string[] =>
  readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    return statSync(path).isDirectory()
      ? sources(path)
      : path.endsWith('.ts')
        ? [path]
        : [];
  });
const src = sources('src')
  .filter(p => !p.endsWith('codes.ts'))
  .map(p => readFileSync(p, 'utf8'))
  .join('\n');

const used = (pattern: RegExp): string[] => [
  ...new Set([...src.matchAll(pattern)].map(m => m[1])),
];

describe('spec conformance: codes', () => {
  it('errors.md lists exactly the ObolErrorCode union', () => {
    expect([...new Set(documentedErrors)].sort()).toEqual(
      [...OBOL_ERROR_CODES].sort(),
    );
  });

  it('errors.md lists exactly the FindingCode union', () => {
    expect([...new Set(documentedFindings)].sort()).toEqual(
      [...FINDING_CODES].sort(),
    );
  });

  it('every error src/ throws is documented', () => {
    const thrown = used(
      /new Obol(?:Api)?Error(?:<[^>]*>)?\(\s*'([A-Z][A-Z0-9_]+)'/g,
    ).concat(used(/exitError\(\s*'([A-Z][A-Z0-9_]+)'/g));
    expect(thrown.filter(c => !OBOL_ERROR_CODES.includes(c as never))).toEqual(
      [],
    );
  });

  it('every finding src/ emits is documented', () => {
    const emitted = used(/(?:finding|issue)\(\s*'([A-Z][A-Z0-9_]+)'/g);
    expect(emitted.filter(c => !FINDING_CODES.includes(c as never))).toEqual(
      [],
    );
  });

  it('every documented code is used in src/', () => {
    const all = [...OBOL_ERROR_CODES, ...FINDING_CODES];
    expect(all.filter(c => !src.includes(`'${c}'`))).toEqual([]);
  });
});
