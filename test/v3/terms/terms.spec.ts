import { recoverTypedDataAddress, type Hex } from 'viem';
import {
  TERMS_AND_CONDITIONS_HASH as LEGACY_HASH,
  TERMS_AND_CONDITIONS_VERSION as LEGACY_VERSION,
} from '../../../src/constants.js';
import { ObolApiError, type ObolError } from '../../../src/v3/errors.js';
import {
  createTermsModule,
  TERMS_AND_CONDITIONS_HASH,
  TERMS_AND_CONDITIONS_VERSION,
  termsTypedData,
} from '../../../src/v3/terms/index.js';
import { fakeApi, fakeChain } from '../helpers/fakeChain.js';
import { accountOf, KEYS, localWallet, withWallet } from '../cluster/wallet.js';

const rejection = async (promise: Promise<unknown>): Promise<ObolError> =>
  await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as ObolError,
  );

const account = accountOf(KEYS.operator);
const OTHER = '0x86B8145c98e5BD25BA722645b15eD65f024a87EC';

const setup = (signed: boolean, walletChainId = 560048) => {
  const api = fakeApi({
    [`GET /v1/termsAndConditions/${account.address}`]: () => ({
      isTermsAndConditionsSigned: signed,
    }),
    [`GET /v1/termsAndConditions/${OTHER}`]: () => ({
      isTermsAndConditionsSigned: true,
    }),
    'POST /v1/termsAndConditions': () => ({
      message: 'successful authorization',
    }),
  });
  const ctx = withWallet(
    fakeChain().context(api),
    localWallet(KEYS.operator, walletChainId),
  );
  return { api, terms: createTermsModule(ctx) };
};

describe('terms', () => {
  it('uses the 2.x terms hash and version', () => {
    expect(TERMS_AND_CONDITIONS_HASH).toBe(LEGACY_HASH);
    expect(TERMS_AND_CONDITIONS_VERSION).toBe(LEGACY_VERSION);
  });

  describe('hasAccepted', () => {
    it('reads the wallet account by default, or the given address', async () => {
      const { terms } = setup(false);
      expect(await terms.hasAccepted()).toBe(false);
      expect(await terms.hasAccepted(OTHER.toLowerCase() as Hex)).toBe(true);
    });

    it('needs an address or a wallet (WALLET_REQUIRED)', async () => {
      const terms = createTermsModule(fakeChain().context(fakeApi({})));
      expect((await rejection(terms.hasAccepted())).code).toBe(
        'WALLET_REQUIRED',
      );
    });

    it('rejects a bad address (PAYLOAD_INVALID) and no API (API_DISABLED)', async () => {
      const { terms } = setup(false);
      expect((await rejection(terms.hasAccepted('0x12' as Hex))).code).toBe(
        'PAYLOAD_INVALID',
      );
      const offline = createTermsModule(fakeChain().context(null));
      expect((await rejection(offline.hasAccepted(OTHER))).code).toBe(
        'API_DISABLED',
      );
    });
  });

  describe('accept', () => {
    it('signs TermsAndConditions without chainId and posts it', async () => {
      const { api, terms } = setup(false);
      const posted: any[] = [];
      const request = api.request.bind(api);
      (api as any).request = async (endpoint: string, options: any = {}) => {
        posted.push(options);
        return await request(endpoint, options);
      };
      expect(await terms.accept()).toEqual({ signed: true });
      const { body, headers } = posted[0];
      expect(body).toEqual({
        address: account.address,
        version: 1,
        terms_and_conditions_hash: TERMS_AND_CONDITIONS_HASH,
        fork_version: '0x10000910',
      });
      expect(
        await recoverTypedDataAddress({
          ...termsTypedData(),
          signature: headers.Authorization.replace('Bearer ', ''),
        }),
      ).toBe(account.address);
    });

    it('skips signing when already accepted with ifNotAccepted', async () => {
      const { api, terms } = setup(true);
      expect(await terms.accept({ ifNotAccepted: true })).toEqual({
        signed: false,
      });
      expect(api.calls.map(c => c.method)).toEqual(['GET']);
    });

    it('signs when not accepted yet with ifNotAccepted', async () => {
      const { api, terms } = setup(false);
      expect(await terms.accept({ ifNotAccepted: true })).toEqual({
        signed: true,
      });
      expect(api.calls.map(c => c.method)).toEqual(['GET', 'POST']);
    });

    it('passes API_CONFLICT through', async () => {
      const api = fakeApi({
        'POST /v1/termsAndConditions': () => {
          throw new ObolApiError('API_CONFLICT', 'exists', {
            status: 409,
            endpoint: '/v1/termsAndConditions',
            method: 'POST',
          });
        },
      });
      const ctx = withWallet(
        fakeChain().context(api),
        localWallet(KEYS.operator),
      );
      expect((await rejection(createTermsModule(ctx).accept())).code).toBe(
        'API_CONFLICT',
      );
    });

    it('checks the wallet (WALLET_REQUIRED, CHAIN_MISMATCH)', async () => {
      const noWallet = createTermsModule(fakeChain().context(fakeApi({})));
      expect((await rejection(noWallet.accept())).code).toBe('WALLET_REQUIRED');
      const { terms } = setup(false, 1);
      expect((await rejection(terms.accept())).code).toBe('CHAIN_MISMATCH');
    });

    it('rejects unknown options (PAYLOAD_INVALID)', async () => {
      const { terms } = setup(false);
      expect((await rejection(terms.accept({ force: true } as any))).code).toBe(
        'PAYLOAD_INVALID',
      );
    });
  });
});
