import { recoverTypedDataAddress, type Hex } from 'viem';
import {
  createClusterModule,
  creatorConfigHashTypedData,
  enrTypedData,
  operatorConfigHashTypedData,
  prepareDefinition,
} from '../../src/cluster/index.js';
import { ObolApiError, type ObolError } from '../../src/errors.js';
import { clusterLockV1X10, enr } from '../fixtures.js';
import { fakeApi, fakeChain } from '../helpers/fakeChain.js';
import { prepareInput, signedDefinition } from './fixtures.js';
import { accountOf, KEYS, localWallet, withWallet } from './wallet.js';

const copy = <T>(value: T): any => JSON.parse(JSON.stringify(value));
const rejection = async (promise: Promise<unknown>): Promise<ObolError> =>
  await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e as ObolError,
  );

const notFound = (endpoint: string) => () => {
  throw new ObolApiError('API_NOT_FOUND', 'not found', {
    status: 404,
    endpoint,
    method: 'GET',
  });
};

const creator = accountOf(KEYS.creator);
const operator = accountOf(KEYS.operator);
const lock = copy(clusterLockV1X10);
const configHash = lock.cluster_definition.config_hash as Hex;
const lockHash = lock.lock_hash as Hex;

describe('cluster.get / cluster.getLock', () => {
  const api = fakeApi({
    [`/v1/definition/${configHash}`]: () => lock.cluster_definition,
    [`/v1/lock/configHash/${configHash}`]: () => lock,
    [`/v1/lock/${lockHash}`]: () => lock,
    [`/v1/definition/0x${'ab'.repeat(32)}`]: () => lock.cluster_definition,
    [`/v1/lock/0x${'cd'.repeat(32)}`]: () => lock,
    [`/v1/lock/configHash/0x${'ef'.repeat(32)}`]: () => ({ nope: 1 }),
  });
  const cluster = createClusterModule(fakeChain().context(api));

  it('returns the definition and lock asked for', async () => {
    expect(await cluster.get(configHash)).toEqual(lock.cluster_definition);
    expect(await cluster.getLock({ configHash })).toEqual(lock);
    expect(await cluster.getLock({ lockHash })).toEqual(lock);
  });

  it.each<[string, () => Promise<unknown>]>([
    ['get', async () => await cluster.get(`0x${'ab'.repeat(32)}`)],
    [
      'getLock lockHash',
      async () => await cluster.getLock({ lockHash: `0x${'cd'.repeat(32)}` }),
    ],
    [
      'getLock configHash',
      async () => await cluster.getLock({ configHash: `0x${'ef'.repeat(32)}` }),
    ],
  ])('%s: API_RESPONSE_MISMATCH for another file', async (_name, call) => {
    const error = await rejection(call());
    expect(error).toBeInstanceOf(ObolApiError);
    expect(error.code).toBe('API_RESPONSE_MISMATCH');
  });

  it('checks the hash before the request (PAYLOAD_INVALID)', async () => {
    expect((await rejection(cluster.get('0x1234' as Hex))).code).toBe(
      'PAYLOAD_INVALID',
    );
    expect(
      (await rejection(cluster.getLock({ configHash, lockHash } as any))).code,
    ).toBe('PAYLOAD_INVALID');
    expect(api.calls.some(c => c.endpoint.includes('0x1234'))).toBe(false);
  });

  it('throws API_DISABLED without the API', async () => {
    const offline = createClusterModule(fakeChain().context(null));
    expect((await rejection(offline.get(configHash))).code).toBe(
      'API_DISABLED',
    );
    expect((await rejection(offline.getLock({ lockHash }))).code).toBe(
      'API_DISABLED',
    );
  });

  it('passes API errors through', async () => {
    const missing = fakeApi({
      [`/v1/lock/${lockHash}`]: notFound(`/v1/lock/${lockHash}`),
    });
    const error = await rejection(
      createClusterModule(fakeChain().context(missing)).getLock({ lockHash }),
    );
    expect(error.code).toBe('API_NOT_FOUND');
  });
});

describe('cluster.create', () => {
  const setup = (walletKey = KEYS.creator, walletChainId = 560048) => {
    const api = fakeApi({ 'POST /v1/definition': body => body });
    const ctx = withWallet(
      fakeChain().context(api),
      localWallet(walletKey, walletChainId),
    );
    return { api, cluster: createClusterModule(ctx) };
  };

  it('signs the config hash and posts the prepared definition', async () => {
    const { api, cluster } = setup();
    const prepared = prepareDefinition(prepareInput());
    expect(await cluster.create(prepared)).toBe(prepared.configHash);
    const [call] = api.calls;
    expect(call.method).toBe('POST');
    expect(call.endpoint).toBe('/v1/definition');
    expect(call.body).toEqual(prepared.definition);
  });

  it('sends the creator signature as bearer token with the fork version', async () => {
    const posted: any[] = [];
    const api = fakeApi({});
    (api as any).request = async (endpoint: string, options: any) => {
      posted.push({ endpoint, ...options });
      return {};
    };
    const ctx = withWallet(fakeChain().context(api), localWallet(KEYS.creator));
    const hash = await createClusterModule(ctx).create(prepareInput());
    const { headers } = posted[0];
    expect(headers['fork-version']).toBe('0x10000910');
    const signature = headers.Authorization.replace('Bearer ', '') as Hex;
    expect(
      await recoverTypedDataAddress({
        ...(creatorConfigHashTypedData(hash, 560048) as any),
        signature,
      }),
    ).toBe(creator.address);
  });

  it('builds the definition from the prepareDefinition input', async () => {
    const { cluster } = setup();
    const input: any = prepareInput();
    delete input.creator;
    delete input.chainId;
    const hash = await cluster.create(input);
    expect(hash).toBe(prepareDefinition(prepareInput()).configHash);
  });

  it('rejects a wallet that is not the creator (PAYLOAD_INVALID creator)', async () => {
    const { cluster } = setup(KEYS.operator);
    const error = await rejection(
      cluster.create(prepareDefinition(prepareInput())),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
    expect((error.details.issues as any[])[0].path).toBe('creator');
  });

  it('rejects an edited prepared definition (DEFINITION_INVALID)', async () => {
    const { api, cluster } = setup();
    const prepared = prepareDefinition(prepareInput());
    prepared.definition.name = 'edited';
    const error = await rejection(cluster.create(prepared));
    expect(error.code).toBe('DEFINITION_INVALID');
    expect(api.calls).toHaveLength(0);
  });

  it('rejects a definition for another chain (DEFINITION_INVALID)', async () => {
    const { cluster } = setup();
    const prepared = prepareDefinition(prepareInput({ chainId: 1 }));
    const error = await rejection(cluster.create(prepared));
    expect(error.code).toBe('DEFINITION_INVALID');
    expect((error.details.issues as any[])[0].code).toBe(
      'fork_version_mismatch',
    );
  });

  it('checks the wallet (WALLET_REQUIRED, CHAIN_MISMATCH)', async () => {
    const api = fakeApi({});
    const noWallet = createClusterModule(fakeChain().context(api));
    expect((await rejection(noWallet.create(prepareInput()))).code).toBe(
      'WALLET_REQUIRED',
    );
    const { cluster } = setup(KEYS.creator, 1);
    expect((await rejection(cluster.create(prepareInput()))).code).toBe(
      'CHAIN_MISMATCH',
    );
  });

  it('adds a hint to API_CONFLICT', async () => {
    const api = fakeApi({
      'POST /v1/definition': () => {
        throw new ObolApiError('API_CONFLICT', 'exists', {
          status: 409,
          endpoint: '/v1/definition',
          method: 'POST',
        });
      },
    });
    const ctx = withWallet(fakeChain().context(api), localWallet(KEYS.creator));
    const error = await rejection(
      createClusterModule(ctx).create(prepareInput()),
    );
    expect(error.code).toBe('API_CONFLICT');
    expect(error.hint).toMatch(/cluster\.get/);
  });
});

describe('cluster.accept', () => {
  const setup = async (
    options: {
      operatorSigned?: boolean;
      walletKey?: Hex;
      edit?: (d: any) => void;
    } = {},
  ) => {
    const { definition, configHash: hash } = await signedDefinition(options);
    options.edit?.(definition);
    const api = fakeApi({
      [`GET /v1/definition/${hash}`]: () => definition,
      [`PUT /v1/definition/${hash}`]: body => ({ ...definition, put: body }),
    });
    const ctx = withWallet(
      fakeChain().context(api),
      localWallet(options.walletKey ?? KEYS.operator),
    );
    return { api, hash, definition, cluster: createClusterModule(ctx) };
  };

  it('signs the config hash and ENR and puts the operator payload', async () => {
    const { api, hash, cluster } = await setup();
    const result: any = await cluster.accept({ configHash: hash, enr });
    expect(result.put).toEqual({
      address: operator.address,
      enr,
      version: 'v1.11.0',
      enr_signature: expect.stringMatching(/^0x[0-9a-f]{130}$/),
      fork_version: '0x10000910',
    });
    expect(
      await recoverTypedDataAddress({
        ...(enrTypedData(enr, 560048) as any),
        signature: result.put.enr_signature,
      }),
    ).toBe(operator.address);
    expect(api.calls.map(c => c.method)).toEqual(['GET', 'PUT']);
  });

  it('returns the definition without signing when already accepted with the ENR', async () => {
    const { api, hash, definition, cluster } = await setup({
      operatorSigned: true,
    });
    expect(await cluster.accept({ configHash: hash, enr })).toEqual(definition);
    expect(api.calls.map(c => c.method)).toEqual(['GET']);
  });

  it('re-signs with a different ENR', async () => {
    const { api, hash, cluster } = await setup({ operatorSigned: true });
    const other =
      'enr:-Iu4QNbiUUUwT18LynBbVPJhNxvzQsaSpUr40mQTWscnZaqKb6vAlvV8j-eDDR3E0wjMQumGRbGm2IAb5_k4bVWJiVGAgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPOiodUji0ohgJb5sNK1hgv8g6xO5_znZz3NkkBkyYyKIN0Y3CCDhqDdWRwgg4u';
    await cluster.accept({ configHash: hash, enr: other });
    expect(api.calls.map(c => c.method)).toEqual(['GET', 'PUT']);
  });

  it('signs OperatorConfigHash as the bearer token', async () => {
    const { definition, configHash: hash } = await signedDefinition();
    const seen: any[] = [];
    const api = fakeApi({});
    (api as any).request = async (endpoint: string, options: any = {}) => {
      seen.push(options);
      return definition;
    };
    const ctx = withWallet(
      fakeChain().context(api),
      localWallet(KEYS.operator),
    );
    await createClusterModule(ctx).accept({ configHash: hash, enr });
    const signature = seen[1].headers.Authorization.replace('Bearer ', '');
    expect(
      await recoverTypedDataAddress({
        ...(operatorConfigHashTypedData(hash, 560048) as any),
        signature,
      }),
    ).toBe(operator.address);
  });

  it('rejects a wallet that is not an operator (NOT_AN_OPERATOR)', async () => {
    const { hash, cluster } = await setup({ walletKey: KEYS.other });
    const error = await rejection(cluster.accept({ configHash: hash, enr }));
    expect(error.code).toBe('NOT_AN_OPERATOR');
    expect(error.details).toEqual({
      address: accountOf(KEYS.other).address,
      configHash: hash,
    });
  });

  it.each<[string, (d: any) => void, string]>([
    ['an edited definition', d => (d.name = 'edited'), 'config_hash_mismatch'],
    [
      'another chain',
      d => (d.fork_version = '0x00000000'),
      'fork_version_mismatch',
    ],
    [
      'a bad creator signature',
      d => (d.creator.config_signature = `0x${'11'.repeat(65)}`),
      'signature_invalid',
    ],
  ])('rejects %s (DEFINITION_INVALID)', async (_name, edit, code) => {
    const { api, hash, cluster } = await setup({ edit });
    const error = await rejection(cluster.accept({ configHash: hash, enr }));
    expect(error.code).toBe('DEFINITION_INVALID');
    expect((error.details.issues as any[]).map(i => i.code)).toContain(code);
    expect(api.calls.map(c => c.method)).toEqual(['GET']);
  });

  it('rejects a conflicting version (DEFINITION_INVALID)', async () => {
    const { hash, cluster } = await setup();
    const error = await rejection(
      cluster.accept({ configHash: hash, enr, version: 'v1.10.0' }),
    );
    expect(error.code).toBe('DEFINITION_INVALID');
  });

  it('rejects an invalid ENR (PAYLOAD_INVALID)', async () => {
    const { hash, cluster } = await setup();
    const error = await rejection(
      cluster.accept({ configHash: hash, enr: 'enr:-not-an-enr' }),
    );
    expect(error.code).toBe('PAYLOAD_INVALID');
  });

  it('rejects an answer for another config hash (API_RESPONSE_MISMATCH)', async () => {
    const { definition } = await signedDefinition();
    const other = `0x${'ab'.repeat(32)}` as Hex;
    const api = fakeApi({ [`/v1/definition/${other}`]: () => definition });
    const ctx = withWallet(
      fakeChain().context(api),
      localWallet(KEYS.operator),
    );
    const error = await rejection(
      createClusterModule(ctx).accept({ configHash: other, enr }),
    );
    expect(error.code).toBe('API_RESPONSE_MISMATCH');
  });

  it('checks the wallet before fetching (WALLET_REQUIRED)', async () => {
    const api = fakeApi({});
    const error = await rejection(
      createClusterModule(fakeChain().context(api)).accept({ configHash, enr }),
    );
    expect(error.code).toBe('WALLET_REQUIRED');
    expect(api.calls).toHaveLength(0);
  });
});
