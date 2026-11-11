/**
 * Caller-supplied options and inputs are strict (rc.12): an unknown key is
 * PAYLOAD_INVALID naming the key and the allowed ones, never ignored. Data
 * documents (cluster files, deposits, API wire objects) stay tolerant.
 */
import { createPublicClient, custom } from 'viem';
import { hoodi } from 'viem/chains';
import { createObolClient } from '../../src/index.js';
import { verifyDefinition } from '../../src/cluster/verifyDefinition.js';
import { isValidLock, verifyLock } from '../../src/cluster/verifyLock.js';
import { fromLock } from '../../src/deposits/fromLock.js';
import { getDepositStatus } from '../../src/deposits/status.js';
import { assertDepositData } from '../../src/deposits/assertDepositData.js';
import { blsVerify } from '../../src/exits/bls.js';
import { aggregate } from '../../src/exits/aggregate.js';
import { isClaimed } from '../../src/incentives/incentives.js';
import { prepareWithdraw } from '../../src/ovm/withdraw.js';
import { prepareGrantRoles } from '../../src/ovm/roles.js';
import { prepareDistributeAll } from '../../src/splits/distribution.js';
import { prepareOvmWithSplits } from '../../src/setup/withSplits.js';
import { simulate } from '../../src/simulate/index.js';
import { decode, rejectUnknownKeys } from '../../src/schema.js';
import { Type } from '@sinclair/typebox';
import { clusterLockV1X10 } from '../fixtures.js';
import { fakeChain } from '../helpers/fakeChain.js';
import { syntheticLock } from '../helpers/syntheticLock.js';
import { OVM, ovmChain, OWNER, PUBKEY_A } from '../ovm/ovmFixture.js';

const failure = async (run: () => unknown): Promise<any> => {
  try {
    await run();
  } catch (e) {
    return e;
  }
  throw new Error('expected a rejection');
};

const expectUnknownKey = (error: any, path: string, allowed?: string): void => {
  expect(error.code).toBe('PAYLOAD_INVALID');
  const issue = error.details.issues.find((i: any) => i.path === path);
  expect(issue).toMatchObject({ path, issue: 'unknown_key' });
  expect(issue.message).toContain(`unknown key "${path.split('.').pop()}"`);
  expect(issue.message).toContain('allowed keys: ');
  if (allowed !== undefined) expect(issue.message).toContain(allowed);
  // The message a human or an agent reads names the key too.
  expect(error.message).toContain(path);
};

describe('strict options', () => {
  describe('cluster.verifyLock: a misspelt option must not weaken verification', () => {
    // The review's case: `signature` (for `signatures`) was dropped, so
    // `attested` checked no deposit signature and a lock with a bad one
    // verified.
    const { lock: valid, seal } = syntheticLock(2, 4, 3);
    const badDeposit = (): any => {
      const lock = JSON.parse(JSON.stringify(valid));
      const deposits = lock.distributed_validators[1].partial_deposit_data;
      // Validator 0's signature on validator 1's deposit: well-formed, wrong.
      deposits[0].signature =
        lock.distributed_validators[0].partial_deposit_data[0].signature;
      return seal(lock);
    };

    it('the lock with a bad deposit signature fails when the option is spelt right', async () => {
      expect(
        await verifyLock(badDeposit(), {
          level: 'attested',
          signatures: 'all',
        }),
      ).toMatchObject({
        ok: false,
        step: 'deposit_data_invalid',
        issue: 'signature_invalid',
        validator: 1,
      });
      expect((await verifyLock(badDeposit())).ok).toBe(false);
    });

    it('`signature` instead of `signatures` is rejected, not ignored', async () => {
      const error = await failure(() =>
        verifyLock(badDeposit(), {
          level: 'attested',
          signature: 'all',
        } as any),
      );
      expectUnknownKey(error, 'options.signature', 'signatures');
    });

    it('isValidLock throws for it too (never true, never a quiet false)', async () => {
      const error = await failure(() =>
        isValidLock(badDeposit(), { levle: 'full' } as any),
      );
      expectUnknownKey(error, 'options.levle', 'level');
    });

    it('the bound client rejects it as well', async () => {
      const chain = fakeChain();
      const client = createObolClient({
        chain: hoodi,
        publicClient: chain.context().publicClient,
        api: false,
      });
      const error = await failure(() =>
        client.cluster.verifyLock(badDeposit(), {
          level: 'attested',
          signature: 'all',
        } as any),
      );
      expectUnknownKey(error, 'options.signature');
    });

    it('every documented option is still accepted', async () => {
      expect(
        (
          await verifyLock(valid, {
            level: 'attested',
            signatures: [0, 1],
            yieldMs: 0,
            publicClients: {},
            signal: new AbortController().signal,
          })
        ).ok,
      ).toBe(true);
    });
  });

  it('deposits.fromLock', async () => {
    expectUnknownKey(
      await failure(() => fromLock(clusterLockV1X10, { verfiy: false } as any)),
      'options.verfiy',
      'verify',
    );
  });

  it('deposits.assertDepositData', async () => {
    expectUnknownKey(
      await failure(() =>
        assertDepositData([], {
          chainId: 1,
          expectedWithdrawalAdress: OVM,
        } as any),
      ),
      'options.expectedWithdrawalAdress',
      'expectedWithdrawalAddress',
    );
  });

  it('deposits.status', async () => {
    expectUnknownKey(
      await failure(() =>
        getDepositStatus(fakeChain().context(), [PUBKEY_A], {
          beaconURL: 'http://x',
        } as any),
      ),
      'options.beaconURL',
      'beaconUrl',
    );
  });

  it('cluster.verifyDefinition (input and options)', async () => {
    const definition = clusterLockV1X10.cluster_definition;
    expectUnknownKey(
      await failure(() =>
        verifyDefinition({
          definition,
          chainId: 560048,
          confighash: '0x',
        } as any),
      ),
      'confighash',
      'configHash',
    );
    expectUnknownKey(
      await failure(() =>
        verifyDefinition({ definition, chainId: 560048 }, {
          publicClient: undefined,
          publicclients: {},
        } as any),
      ),
      'options.publicclients',
      'publicClients',
    );
  });

  it('prepare* inputs (ovm, splits, setup)', async () => {
    const ctx = ovmChain().context();
    expectUnknownKey(
      await failure(() =>
        prepareWithdraw(ctx, {
          ovm: OVM,
          requests: [{ pubkey: PUBKEY_A, amount: 1n }],
          from: OWNER,
          acknowledgeFullExits: true,
        } as any),
      ),
      'acknowledgeFullExits',
      'acknowledgeFullExit',
    );
    expectUnknownKey(
      await failure(() =>
        prepareWithdraw(ctx, {
          ovm: OVM,
          requests: [{ pubkey: PUBKEY_A, amount: 1n, ammount: 2n }],
          from: OWNER,
        } as any),
      ),
      'requests[0].ammount',
    );
    expect(
      (
        await failure(() =>
          prepareGrantRoles(ctx, {
            ovm: OVM,
            user: OWNER,
            roles: 1,
            form: OWNER,
          } as any),
        )
      ).code,
    ).toBe('PAYLOAD_INVALID');
    expectUnknownKey(
      await failure(() =>
        prepareDistributeAll(ctx, { ovm: OVM, minwithdraw: 1n } as any),
      ),
      'minwithdraw',
      'minWithdraw',
    );
    expectUnknownKey(
      await failure(() =>
        prepareOvmWithSplits(ctx, {
          owner: OWNER,
          reward: { address: OWNER },
          principal: { address: OWNER },
          principalTreshold: 1n,
        } as any),
      ),
      'principalTreshold',
      'principalThreshold',
    );
  });

  it('incentives.isClaimed, exits.aggregate, exits.blsVerify, simulate', async () => {
    const ctx = ovmChain().context();
    expectUnknownKey(
      await failure(() =>
        isClaimed(ctx, { contractAddress: OVM, index: 0, idx: 1 } as any),
      ),
      'idx',
    );
    expect(
      (
        await failure(() => aggregate({ treshold: 3 } as any))
      ).details.issues.some(
        (i: any) => i.issue === 'unknown_key' && i.path === 'treshold',
      ),
    ).toBe(true);
    expectUnknownKey(
      await failure(() =>
        blsVerify(`0x${'00'.repeat(48)}`, '0x', `0x${'00'.repeat(96)}`, {
          backend: {},
        } as any),
      ),
      'options.backend',
      'bls',
    );
    const prepared = {
      kind: 'role',
      request: { to: OVM, data: '0x', value: 0n, chainId: 560048 },
      checks: [],
      preview: {},
    } as any;
    expectUnknownKey(
      await failure(() => simulate(ctx, prepared, { form: OWNER } as any)),
      'options.form',
      'from',
    );
  });

  it('createObolClient config', () => {
    const publicClient = createPublicClient({
      chain: hoodi,
      transport: custom({ request: async () => null }),
    });
    let error: any;
    try {
      createObolClient({ chain: hoodi, publicClient, apiUrl: 'x' } as any);
    } catch (e) {
      error = e;
    }
    expectUnknownKey(error, 'config.apiUrl', 'api');
    try {
      createObolClient({
        chain: hoodi,
        publicClient,
        api: { baseURL: 'https://api.obol.tech' },
      } as any);
    } catch (e) {
      error = e;
    }
    expectUnknownKey(error, 'api.baseURL', 'baseUrl');
  });

  it('data documents stay tolerant of extra fields', async () => {
    // A lock with fields the SDK does not know (as an API response may have).
    const lock = {
      ...JSON.parse(JSON.stringify(clusterLockV1X10)),
      _id: 'mongo',
      extra: { anything: true },
    };
    lock.cluster_definition.created_at = 'yesterday';
    lock.distributed_validators[0].note = 'x';
    expect((await verifyLock(lock)).ok).toBe(true);
    // A deposit with an extra field.
    const { deposits } = await fromLock(lock, { chainId: 560048 });
    await expect(
      assertDepositData([{ ...deposits[0], validatorIndex: 7 } as any], {
        chainId: 560048,
      }),
    ).resolves.toBeUndefined();
  });

  it('the helpers name the key and the allowed keys', async () => {
    const schema = Type.Object(
      { a: Type.Optional(Type.String()), b: Type.Optional(Type.Number()) },
      { additionalProperties: false },
    );
    const error = await failure(() =>
      decode(schema, { a: 'x', c: 1 }, 'options'),
    );
    expect(error.details.issues).toEqual([
      {
        path: 'options.c',
        message: 'unknown key "c"; allowed keys: a, b',
        issue: 'unknown_key',
      },
    ]);
    expect(() => rejectUnknownKeys({ a: 1 }, ['a'], 'options')).not.toThrow();
    expect(
      (await failure(() => rejectUnknownKeys(null, ['a'], 'options'))).code,
    ).toBe('PAYLOAD_INVALID');
  });
});
