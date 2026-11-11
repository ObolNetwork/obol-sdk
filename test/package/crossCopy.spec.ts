/**
 * isObolError across copies of the SDK: the CommonJS, ESM and browser
 * builds each have their own ObolError class (as do two installed versions),
 * so `instanceof` fails between them. rc.12 checks a `Symbol.for` brand.
 */
import { ObolApiError, ObolError, isObolError } from '../../src/errors.js';
import { describeDist, runNode } from './builtPackage.js';

interface Output {
  distinctClasses: boolean;
  matrix: Record<
    string,
    {
      instanceOf?: boolean;
      isObolError: boolean;
      withCode?: boolean;
      withOtherCode?: boolean;
      code?: string;
    }
  >;
  plain: Record<string, boolean[]>;
}

describeDist('isObolError across the CJS, ESM and browser builds', () => {
  let output: Output;
  beforeAll(() => {
    output = runNode<Output>('test/package/scripts/cross-copy.cjs');
  }, 120_000);

  it('the builds really are separate copies (instanceof fails across them)', () => {
    expect(output.distinctClasses).toBe(true);
    expect(output.matrix['cjs->esm'].instanceOf).toBe(false);
    expect(output.matrix['esm->cjs'].instanceOf).toBe(false);
    expect(output.matrix['esm->esm'].instanceOf).toBe(true);
  });

  it.each([
    'cjs->esm',
    'esm->cjs',
    'cjs->browser',
    'browser->cjs',
    'esm->browser',
    'browser->esm',
    'cjs->cjs',
    'esm->esm',
    'browser->browser',
  ])('%s: recognised, with and without a code', pair => {
    expect(output.matrix[pair]).toMatchObject({
      isObolError: true,
      withCode: true,
      withOtherCode: false,
      code: 'PAYLOAD_INVALID',
    });
    expect(output.matrix[`api ${pair}`].isObolError).toBe(true);
  });

  it('does not take other errors or look-alikes for ObolErrors', () => {
    for (const results of Object.values(output.plain)) {
      expect(results).toEqual([false, false, false, false, false, false]);
    }
  });
});

describe('isObolError (source)', () => {
  it('recognises ObolError and ObolApiError, and narrows by code', () => {
    const error = new ObolError('WALLET_REQUIRED', 'x');
    expect(isObolError(error)).toBe(true);
    expect(isObolError(error, 'WALLET_REQUIRED')).toBe(true);
    expect(isObolError(error, 'TX_REJECTED')).toBe(false);
    expect(
      isObolError(
        new ObolApiError('API_ERROR', 'x', {
          status: 500,
          endpoint: '/',
          method: 'GET',
        }),
        'API_ERROR',
      ),
    ).toBe(true);
  });

  it('the brand is not enumerable and survives a subclass', () => {
    class Sub extends ObolError<'WALLET_REQUIRED'> {}
    const error = new Sub('WALLET_REQUIRED', 'x');
    expect(isObolError(error)).toBe(true);
    expect(Object.keys(error)).not.toContain('@obolnetwork/obol-sdk.ObolError');
    expect(JSON.parse(JSON.stringify(error))).toEqual({
      name: 'ObolError',
      code: 'WALLET_REQUIRED',
      details: {},
    });
  });

  it('rejects look-alikes and non-errors', () => {
    expect(isObolError(new Error('x'))).toBe(false);
    expect(isObolError({ name: 'ObolError', code: 'PAYLOAD_INVALID' })).toBe(
      false,
    );
    expect(isObolError(null)).toBe(false);
    expect(isObolError('x')).toBe(false);
  });
});
