// options.signal on verifyLock, isValidLock and verifyDepositData: checked at
// the yield points, an abort is ABORTED with the signal's reason as cause.
import { jest } from '@jest/globals';
import { isValidLock, verifyLock } from '../../src/cluster/index.js';
import { nobleBls, type BlsBackend } from '../../src/cluster/blsBackend.js';
import { verifyDepositData } from '../../src/deposits/verifyDepositData.js';
import { isObolError } from '../../src/errors.js';
import { hoodiCompoundingDepositPayload } from '../fixtures.js';
import { syntheticLock } from '../helpers/syntheticLock.js';

jest.setTimeout(60_000);

const caught = async (promise: Promise<unknown>): Promise<any> =>
  await promise.then(
    () => {
      throw new Error('expected a rejection');
    },
    (e: unknown) => e,
  );

/** The default backend, aborting `controller` on the `after`-th BLS call. */
const abortingBackend = (
  controller: AbortController,
  reason: unknown,
  after = 1,
): BlsBackend & { calls: () => number } => {
  let calls = 0;
  const count = (): void => {
    calls++;
    if (calls === after) controller.abort(reason);
  };
  return {
    ...nobleBls,
    decodePublicKey: (bytes, subgroupCheck) => {
      count();
      return nobleBls.decodePublicKey(bytes, subgroupCheck);
    },
    verify: (publicKey, message, signature) => {
      count();
      return nobleBls.verify(publicKey, message, signature);
    },
    calls: () => calls,
  };
};

describe('options.signal', () => {
  const { lock } = syntheticLock(2, 4, 3);

  it('verifyLock: an already aborted signal throws ABORTED before any work', async () => {
    const reason = new Error('deadline');
    const controller = new AbortController();
    controller.abort(reason);
    const bls = abortingBackend(new AbortController(), null, -1);
    const error = await caught(
      verifyLock(lock, { signal: controller.signal, bls }),
    );
    expect(isObolError(error, 'ABORTED')).toBe(true);
    expect(error.details).toEqual({ operation: 'cluster.verifyLock' });
    expect(error.cause).toBe(reason);
    expect(bls.calls()).toBe(0);
  });

  it('verifyLock and isValidLock stop at the next yield point after an abort', async () => {
    const full = abortingBackend(new AbortController(), null, -1);
    await verifyLock(lock, { bls: full, yieldMs: 0 });
    for (const run of [verifyLock, isValidLock]) {
      const controller = new AbortController();
      const reason = new Error('request closed');
      const bls = abortingBackend(controller, reason);
      // yieldMs 0: nothing yields, but every yield point still checks.
      const error = await caught(
        run(lock, { signal: controller.signal, bls, yieldMs: 0 }),
      );
      expect(isObolError(error, 'ABORTED')).toBe(true);
      expect(error.cause).toBe(reason);
      // Stopped within the unit of work that aborted (one validator's
      // shares), well before the end of a full run.
      expect(bls.calls()).toBeLessThan(full.calls() / 2);
    }
  });

  it('a timeout signal fires during a yielding run', async () => {
    const signal = AbortSignal.timeout(1);
    const error = await caught(verifyLock(lock, { signal, yieldMs: 2 }));
    expect(isObolError(error, 'ABORTED')).toBe(true);
    expect((error.cause as DOMException).name).toBe('TimeoutError');
  });

  it('an unaborted signal changes nothing', async () => {
    const signal = new AbortController().signal;
    expect(await verifyLock(lock, { signal })).toEqual({
      ok: true,
      level: 'full',
    });
    expect(await isValidLock(lock, { signal })).toBe(true);
  });

  it('a signal that is not an AbortSignal is PAYLOAD_INVALID', async () => {
    for (const signal of [true, {}, null]) {
      expect(
        await caught(verifyLock(lock, { signal: signal as never })),
      ).toMatchObject({ code: 'PAYLOAD_INVALID' });
      // Options errors are thrown by isValidLock too, not false.
      expect(
        await caught(isValidLock(lock, { signal: signal as never })),
      ).toMatchObject({ code: 'PAYLOAD_INVALID' });
    }
  });

  describe('verifyDepositData', () => {
    const d = hoodiCompoundingDepositPayload.deposit;
    const deposit = {
      pubkey: d.pubkey,
      withdrawalCredentials: d.withdrawal_credentials,
      signature: d.signature,
      depositDataRoot: d.deposit_data_root,
      amount: BigInt(d.amount),
    };

    it('throws ABORTED for an aborted signal, at the signature checks', async () => {
      const controller = new AbortController();
      controller.abort('gone');
      const error = await caught(
        verifyDepositData([deposit], {
          chainId: 560048,
          signal: controller.signal,
        }),
      );
      expect(error).toMatchObject({
        code: 'ABORTED',
        details: { operation: 'deposits.verifyDepositData' },
        cause: 'gone',
      });
    });

    it('stops between signatures once aborted', async () => {
      const controller = new AbortController();
      const bls = abortingBackend(controller, 'deadline', 1);
      const error = await caught(
        verifyDepositData(Array(40).fill(deposit), {
          chainId: 560048,
          signal: controller.signal,
          bls,
          yieldMs: 0,
        }),
      );
      expect(error).toMatchObject({ code: 'ABORTED', cause: 'deadline' });
    });

    it('rejects a signal that is not an AbortSignal', async () => {
      expect(
        await caught(
          verifyDepositData([deposit], {
            chainId: 560048,
            signal: 'soon' as never,
          }),
        ),
      ).toMatchObject({ code: 'PAYLOAD_INVALID' });
    });
  });
});
