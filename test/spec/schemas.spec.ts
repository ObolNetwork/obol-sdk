// spec/schemas/ is generated from the TypeBox input schemas (`yarn
// spec:schemas`); this fails when a schema changed without regenerating.
import { readdirSync, readFileSync } from 'node:fs';
import { specSchemas } from '../../scripts/specSchemas.js';

describe('spec/schemas', () => {
  const expected = specSchemas();

  it('has one file per operation input and nothing else', () => {
    expect(
      readdirSync('spec/schemas')
        .filter(f => f.endsWith('.json'))
        .sort(),
    ).toEqual(Object.keys(expected).sort());
  });

  it.each(Object.keys(expected))('%s is up to date', name => {
    expect(readFileSync(`spec/schemas/${name}`, 'utf8')).toBe(expected[name]);
  });
});
