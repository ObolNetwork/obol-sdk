// Deposit field lengths (2.x #253): SSZ zero-pads a short byte vector and
// drops bytes past its end, so a wrong-length field could hash like a
// different, valid one. v3 rejects them on every path that hashes a deposit.
import { computeDepositMsgRoot } from '../../src/internal/verification/common.js';
import { verifyDepositData } from '../../src/deposits/verifyDepositData.js';
import { verifyLock } from '../../src/cluster/verifyLock.js';
import { mainnetDepositPayload } from '../fixtures.js';
import { syntheticLock } from '../helpers/syntheticLock.js';

const d = mainnetDepositPayload.deposit;
// The deposit message hashes the amount in gwei.
const message = { ...d, amount: '32000000000' };
const credentials20 = `0x${d.withdrawal_credentials.slice(2, 42)}`;
const credentials33 = `${d.withdrawal_credentials}00`;

describe('deposit field lengths', () => {
  it('computeDepositMsgRoot refuses a short or long field instead of padding it', () => {
    expect(() => computeDepositMsgRoot(message)).not.toThrow();
    for (const withdrawal_credentials of [credentials20, credentials33]) {
      expect(() =>
        computeDepositMsgRoot({ ...message, withdrawal_credentials }),
      ).toThrow(/32 bytes/);
    }
    expect(() =>
      computeDepositMsgRoot({ ...message, pubkey: d.pubkey.slice(0, -2) }),
    ).toThrow(/48 bytes/);
  });

  it('verifyDepositData rejects them as PAYLOAD_INVALID before any hashing', async () => {
    const deposit = {
      pubkey: d.pubkey,
      withdrawalCredentials: d.withdrawal_credentials,
      signature: d.signature,
      depositDataRoot: d.deposit_data_root,
      amount: BigInt(d.amount),
    };
    for (const bad of [
      { withdrawalCredentials: credentials20 },
      { withdrawalCredentials: credentials33 },
      { pubkey: d.pubkey.slice(0, -2) },
      { signature: `${d.signature}00` },
      { depositDataRoot: d.deposit_data_root.slice(0, -2) },
    ]) {
      await expect(
        verifyDepositData([{ ...deposit, ...bad }], { chainId: 1 }),
      ).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
    }
  });

  it('verifyLock rejects a lock whose deposit credentials are not 32 bytes', async () => {
    const { lock, seal } = syntheticLock(2, 4, 3, ['32000000000']);
    for (const toLength of [
      (c: string) => `0x${c.slice(2, 42)}`,
      (c: string) => `${c}00`,
    ]) {
      const edited = structuredClone(lock);
      const deposit = edited.distributed_validators[0].partial_deposit_data[0];
      deposit.withdrawal_credentials = toLength(deposit.withdrawal_credentials);
      const result = await verifyLock(seal(edited), { yieldMs: 0 });
      expect(result).toMatchObject({ ok: false, validator: 0 });
    }
  });
});
