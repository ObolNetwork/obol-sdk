/**
 * What the built package imports at run time must be installable by a
 * consumer: a dependency or a peer dependency. A bundled package
 * (`noExternal` in tsup.config.ts: @chainsafe/enr, @noble/*) must not be
 * imported by any build, which is what lets it live in devDependencies.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { builtinModules } from 'node:module';
import { join } from 'node:path';
import { build as esbuild } from 'esbuild';
import { describeDist } from './builtPackage.js';

const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
  peerDependencies: Record<string, string>;
};

const jsFiles = (dir: string): string[] =>
  readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return jsFiles(path);
    return entry.name.endsWith('.js') ? [path] : [];
  });

/**
 * The packages a build imports at run time, from esbuild's own parse of
 * every file (comments and strings that look like imports do not count).
 */
const externalImports = async (build: string): Promise<string[]> => {
  const result = await esbuild({
    entryPoints: jsFiles(`dist/${build}`),
    bundle: true,
    packages: 'external',
    write: false,
    metafile: true,
    outdir: 'unused',
    format: build === 'cjs' ? 'cjs' : 'esm',
    platform: build === 'browser' ? 'browser' : 'node',
    logLevel: 'silent',
  });
  const found = new Set<string>();
  for (const input of Object.values(result.metafile.inputs)) {
    for (const imported of input.imports) {
      if (imported.external === true) found.add(imported.path);
    }
  }
  return [...found];
};

const packageOf = (specifier: string): string =>
  specifier.startsWith('@')
    ? specifier.split('/').slice(0, 2).join('/')
    : specifier.split('/')[0];

describeDist('packaging: run-time imports of the built package', () => {
  const installable = new Set([
    ...Object.keys(pkg.dependencies),
    ...Object.keys(pkg.peerDependencies),
  ]);
  const builtin = (name: string): boolean =>
    name.startsWith('node:') || builtinModules.includes(name);

  it.each(['cjs', 'esm', 'browser'])(
    'dist/%s imports only dependencies and peer dependencies',
    async build => {
      const imported = [
        ...new Set((await externalImports(build)).map(packageOf)),
      ];
      const packages = imported.filter(name => !builtin(name));
      expect(packages.filter(name => !installable.has(name))).toEqual([]);
      // The scan sees the real imports.
      expect(packages).toEqual(
        expect.arrayContaining(['viem', '@chainsafe/ssz']),
      );
      if (build === 'browser') expect(imported.filter(builtin)).toEqual([]);
    },
    60_000,
  );

  it('bundled packages are devDependencies, not dependencies', () => {
    for (const name of ['@chainsafe/enr', '@noble/curves']) {
      expect(Object.keys(pkg.dependencies)).not.toContain(name);
      expect(Object.keys(pkg.devDependencies)).toContain(name);
    }
    expect(Object.keys(pkg.dependencies).sort()).toEqual([
      '@chainsafe/ssz',
      '@sinclair/typebox',
    ]);
  });
});
