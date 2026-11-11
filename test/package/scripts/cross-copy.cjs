// Loads the CommonJS and the ESM build of the SDK in one process (what a
// bundler or a dual-package dependency tree does) and checks that each
// copy's isObolError recognises the other copy's errors.
const { pathToFileURL } = require('node:url');
const { resolve } = require('node:path');

(async () => {
  const cjs = require(resolve('dist/cjs/src/index.js'));
  const esm = await import(
    pathToFileURL(resolve('dist/esm/src/index.js')).href
  );
  const browser = await import(
    pathToFileURL(resolve('dist/browser/src/index.js')).href
  );
  const thrownBy = sdk => {
    try {
      sdk.cluster.computeConfigHash({ version: 'v1.9.0' });
    } catch (e) {
      return e;
    }
    throw new Error('expected a throw');
  };
  const copies = { cjs, esm, browser };
  const result = {
    distinctClasses:
      cjs.ObolError !== esm.ObolError && esm.ObolError !== browser.ObolError,
    matrix: {},
    plain: {},
  };
  for (const [from, thrower] of Object.entries(copies)) {
    const error = thrownBy(thrower);
    for (const [to, checker] of Object.entries(copies)) {
      result.matrix[`${from}->${to}`] = {
        instanceOf: error instanceof checker.ObolError,
        isObolError: checker.isObolError(error),
        withCode: checker.isObolError(error, error.code),
        withOtherCode: checker.isObolError(error, 'TX_REVERTED'),
        code: error.code,
      };
    }
    // An API error (subclass) crosses too.
    const api = new thrower.ObolApiError('API_NOT_FOUND', 'nope', {
      status: 404,
      endpoint: '/x',
      method: 'GET',
    });
    for (const [to, checker] of Object.entries(copies)) {
      result.matrix[`api ${from}->${to}`] = {
        isObolError: checker.isObolError(api, 'API_NOT_FOUND'),
      };
    }
  }
  // Things that are not ObolErrors, in every copy.
  for (const [name, sdk] of Object.entries(copies)) {
    const lookalike = Object.assign(new Error('x'), {
      name: 'ObolError',
      code: 'PAYLOAD_INVALID',
      details: {},
    });
    result.plain[name] = [
      sdk.isObolError(new Error('x')),
      sdk.isObolError(lookalike),
      sdk.isObolError({ code: 'PAYLOAD_INVALID' }),
      sdk.isObolError(null),
      sdk.isObolError(undefined),
      sdk.isObolError('PAYLOAD_INVALID'),
    ];
  }
  process.stdout.write(JSON.stringify(result));
})().catch(e => {
  console.error(e);
  process.exit(1);
});
