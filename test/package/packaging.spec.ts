/**
 * What the built package imports at run time must be installable by a
 * consumer: a dependency or a peer dependency. A bundled package
 * (`noExternal` in tsup.config.ts: @noble/*, @chainsafe/ssz and its merkle
 * tree) must not be imported by any build, which is what lets it live in
 * devDependencies. The goal is one tarball: apart from the viem peer, a
 * consumer installs only @sinclair/typebox (exact, no dependencies).
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
      expect(packages).toContain('viem');
      // Nothing but viem, typebox and (Node-only blst entry) the optional
      // @chainsafe/blst peer is imported at run time.
      expect(
        packages.filter(
          n =>
            n !== 'viem' &&
            n !== '@sinclair/typebox' &&
            n !== '@chainsafe/blst',
        ),
      ).toEqual([]);
      if (build === 'browser') expect(imported.filter(builtin)).toEqual([]);
    },
    60_000,
  );

  it('bundled packages are devDependencies, not dependencies', () => {
    for (const name of [
      '@noble/curves',
      '@chainsafe/ssz',
      '@chainsafe/persistent-merkle-tree',
      '@chainsafe/as-sha256',
    ]) {
      expect(Object.keys(pkg.dependencies)).not.toContain(name);
      expect(Object.keys(pkg.devDependencies)).toContain(name);
    }
    expect(Object.keys(pkg.dependencies)).toEqual(['@sinclair/typebox']);
    expect(pkg.dependencies['@sinclair/typebox']).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it.each(['esm', 'browser'])(
    'dist/%s carries no WebAssembly (as-sha256 stays tree-shaken out)',
    build => {
      const files = jsFiles(join('dist', build, 'src'));
      expect(files.length).toBeGreaterThan(0);
      for (const file of files) {
        expect({ file, wasm: /WebAssembly\./.test(readFileSync(file, 'utf8')) }).toEqual({
          file,
          wasm: false,
        });
      }
    },
  );
});
