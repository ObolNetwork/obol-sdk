/**
 * The findings catalogue (src/findings.ts) against what documents it and
 * what uses it: spec/errors.md, the README table, the per-kind lists and the
 * policy group.
 */
import { readFileSync } from 'node:fs';
import {
  FINDING_CODES,
  FINDING_CODES_BY_KIND,
  FINDINGS,
  SIMULATION_FINDING_CODES,
  INFO_FINDING_CODES,
  UNCHECKED_WARNING_CODES,
  findingSeverity,
  type FindingCode,
  type FindingSeveritiesAgree,
} from '../../src/findings.js';
import { PREPARED_KINDS } from '../../src/types.js';

const errorsMd = readFileSync('spec/errors.md', 'utf8');
const readme = readFileSync('README.md', 'utf8');
const migration = readFileSync('MIGRATION.md', 'utf8');

/** `CODE` [severity] rows of the Findings table in spec/errors.md. */
const documentedSeverity = new Map(
  [...errorsMd.matchAll(/^\| `([A-Z0-9_]+)` \[(warning|info)\] \|/gm)].map(
    m => [m[1], m[2]],
  ),
);

/** The codes a caller can meet on `send`: on a Prepared or a simulation. */
const sendable = [
  ...new Set<FindingCode>([
    ...Object.values(FINDING_CODES_BY_KIND).flat(),
    ...SIMULATION_FINDING_CODES,
  ]),
];
const sendableWarnings = sendable.filter(
  code => FINDINGS[code].severity === 'warning',
);

describe('findings catalogue', () => {
  it('FINDING_CODES are the catalogue keys, each with a meaning and guidance', () => {
    expect(FINDING_CODES).toEqual(Object.keys(FINDINGS));
    for (const code of FINDING_CODES) {
      const info = FINDINGS[code];
      expect(['warning', 'info']).toContain(info.severity);
      expect(info.meaning.length).toBeGreaterThan(20);
      expect(info.guidance.length).toBeGreaterThan(3);
      // `note` is information only; every other group is a warning.
      expect(info.severity === 'info').toBe(info.group === 'note');
    }
  });

  it('the severity a finding is emitted with is the catalogue severity', () => {
    // Compile-time: an error here names the codes that disagree.
    const agree: FindingSeveritiesAgree = true;
    expect(agree).toBe(true);
    for (const code of FINDING_CODES) {
      expect([code, findingSeverity(code)]).toEqual([
        code,
        FINDINGS[code].severity,
      ]);
    }
    for (const code of INFO_FINDING_CODES)
      expect(FINDING_CODES).toContain(code);
  });

  it('spec/errors.md gives every finding the catalogue severity', () => {
    for (const code of FINDING_CODES) {
      if (FINDINGS[code].group === 'claim') continue; // listed in prose there
      expect([code, documentedSeverity.get(code)]).toEqual([
        code,
        FINDINGS[code].severity,
      ]);
    }
  });

  it('every prepared kind has a list, of known codes without repeats', () => {
    expect(Object.keys(FINDING_CODES_BY_KIND).sort()).toEqual(
      [...PREPARED_KINDS].sort(),
    );
    for (const codes of Object.values(FINDING_CODES_BY_KIND)) {
      expect(new Set(codes).size).toBe(codes.length);
      for (const code of codes) expect(FINDING_CODES).toContain(code);
    }
  });

  it('the simulation list is every SIMULATION_* code', () => {
    expect([...SIMULATION_FINDING_CODES].sort()).toEqual(
      FINDING_CODES.filter(c => c.startsWith('SIMULATION_')).sort(),
    );
  });

  it('UNCHECKED_WARNING_CODES is exactly the "a check could not run" group', () => {
    expect([...UNCHECKED_WARNING_CODES].sort()).toEqual(
      FINDING_CODES.filter(c => FINDINGS[c].group === 'unchecked').sort(),
    );
    // It never covers a warning about what the transaction does.
    for (const code of UNCHECKED_WARNING_CODES) {
      expect(FINDINGS[code]).toMatchObject({
        severity: 'warning',
        group: 'unchecked',
      });
    }
    expect(UNCHECKED_WARNING_CODES).not.toContain('TOP_UP_CREDENTIALS_FOREIGN');
    expect(UNCHECKED_WARNING_CODES).not.toContain(
      'CONSOLIDATION_CREDENTIALS_DIFFER',
    );
  });

  it.each([
    ['README.md', readme],
    ['MIGRATION.md', migration],
  ])(
    '%s has the table of every warning send can refuse, word for word from the catalogue',
    (_name, text) => {
      for (const code of sendableWarnings) {
        const { meaning, guidance } = FINDINGS[code];
        expect(text).toContain(`| \`${code}\` | ${meaning} | ${guidance} |`);
      }
      // And no row for a code that is not a warning any more.
      const rows = [...text.matchAll(/^\| `([A-Z0-9_]+)` \| .* \| .* \|$/gm)]
        .map(m => m[1])
        .filter(code => (FINDING_CODES as string[]).includes(code));
      expect(
        rows.filter(code => !(sendableWarnings as string[]).includes(code)),
      ).toEqual([]);
    },
  );

  it('there are warnings to document', () => {
    expect(sendableWarnings.length).toBeGreaterThan(10);
  });
});
