import { concat, numberToHex } from 'viem';
import { createWithdrawalsModule } from '../../src/withdrawals/index.js';
import { prepareEoaWithdraw } from '../../src/withdrawals/withdrawals.js';
import {
  BEACON_URL,
  caught,
  credentials,
  ETH,
  GWEI,
  mockBeacon,
  OTHER,
  OWNER,
  ovmChain,
  PUBKEY_A,
  registryRow,
  WITHDRAWAL_PREDEPLOY,
} from '../ovm/ovmFixture.js';

const codes = (checks: Array<{ code: string }>): string[] =>
  checks.map(c => c.code);

describe('withdrawals.prepareEoaWithdraw', () => {
  it('encodes pubkey ‖ uint64_be(gwei) to the predeploy with exactly the current fee', async () => {
    const result = await prepareEoaWithdraw(
      ovmChain({ withdrawalFee: 3n }).context(),
      {
        pubkey: PUBKEY_A,
        amount: 2n * ETH,
      },
    );
    expect(result.request).toEqual({
      to: WITHDRAWAL_PREDEPLOY,
      data: concat([PUBKEY_A, numberToHex(2n * GWEI, { size: 8 })]),
      value: 3n,
      chainId: 560048,
    });
    expect(result.preview).toEqual({
      pubkey: PUBKEY_A,
      amount: 2n * ETH,
      fee: 3n,
    });
    expect(result.kind).toBe('eoaWithdraw');
    expect(codes(result.checks)).toEqual(['VALIDATOR_STATUS_UNCHECKED']);
    expect(result.request.data).toHaveLength(2 + 2 * 56);
  });

  it('requires acknowledgeFullExit for a full exit', async () => {
    const ctx = ovmChain().context();
    expect(
      await caught(prepareEoaWithdraw(ctx, { pubkey: PUBKEY_A, amount: 0n })),
    ).toMatchObject({
      code: 'FULL_EXIT_NOT_ACKNOWLEDGED',
    });
    const ok = await prepareEoaWithdraw(ctx, {
      pubkey: PUBKEY_A,
      amount: 0n,
      acknowledgeFullExit: true,
    });
    expect(ok.request.data.endsWith('0000000000000000')).toBe(true);
  });

  it('checks the fee range and the amount', async () => {
    const ctx = ovmChain({ withdrawalFee: 10n }).context();
    expect(
      (
        await caught(
          prepareEoaWithdraw(ctx, { pubkey: PUBKEY_A, amount: ETH, fee: 9n }),
        )
      ).code,
    ).toBe('FEE_OUT_OF_RANGE');
    expect(
      (await caught(prepareEoaWithdraw(ctx, { pubkey: PUBKEY_A, amount: 1n })))
        .code,
    ).toBe('PAYLOAD_INVALID');
    const broken = ovmChain({
      raw: { [WITHDRAWAL_PREDEPLOY]: () => '0x' },
    }).context();
    expect(
      (
        await caught(
          prepareEoaWithdraw(broken, { pubkey: PUBKEY_A, amount: ETH }),
        )
      ).code,
    ).toBe('FEE_READ_FAILED');
  });

  describe('with a status source', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());

    it('passes when the credentials point at the sender', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(
            PUBKEY_A,
            'active_ongoing',
            credentials('02', OWNER),
            40n * ETH,
          ),
        ],
      );
      const result = await prepareEoaWithdraw(ovmChain().context(), {
        pubkey: PUBKEY_A,
        amount: ETH,
        from: OWNER,
        beaconUrl: BEACON_URL,
      });
      expect(result.checks).toEqual([]);
    });

    it('rejects credentials of another address (CREDENTIALS_NOT_SOURCE)', async () => {
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY_A, 'active_ongoing', credentials('02', OTHER))],
      );
      const error = await caught(
        prepareEoaWithdraw(ovmChain({ walletAccount: OWNER }).context(), {
          pubkey: PUBKEY_A,
          amount: 0n,
          acknowledgeFullExit: true,
          beaconUrl: BEACON_URL,
        }),
      );
      expect(error).toMatchObject({
        code: 'CREDENTIALS_NOT_SOURCE',
        details: { source: OWNER },
      });
    });

    it('applies the partial rules and caps to the excess', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(
            PUBKEY_A,
            'active_ongoing',
            credentials('01', OWNER),
            40n * ETH,
          ),
        ],
      );
      expect(
        (
          await caught(
            prepareEoaWithdraw(ovmChain().context(), {
              pubkey: PUBKEY_A,
              amount: ETH,
              from: OWNER,
              beaconUrl: BEACON_URL,
            }),
          )
        ).code,
      ).toBe('PARTIAL_REQUIRES_COMPOUNDING');
      restore();
      restore = mockBeacon(
        [],
        [
          registryRow(
            PUBKEY_A,
            'active_ongoing',
            credentials('02', OWNER),
            33n * ETH,
          ),
        ],
      );
      const capped = await prepareEoaWithdraw(ovmChain().context(), {
        pubkey: PUBKEY_A,
        amount: 5n * ETH,
        from: OWNER,
        beaconUrl: BEACON_URL,
      });
      expect(capped.preview).toMatchObject({
        amount: ETH,
        requestedAmount: 5n * ETH,
      });
      expect(capped.request.data).toBe(
        concat([PUBKEY_A, numberToHex(GWEI, { size: 8 })]),
      );
      expect(codes(capped.checks)).toEqual(['WITHDRAW_AMOUNT_CAPPED']);
    });

    it('reports the credentials unchecked without a sender', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(
            PUBKEY_A,
            'active_ongoing',
            credentials('02', OTHER),
            40n * ETH,
          ),
        ],
      );
      const result = await prepareEoaWithdraw(ovmChain().context(), {
        pubkey: PUBKEY_A,
        amount: ETH,
        beaconUrl: BEACON_URL,
      });
      expect(result.checks).toEqual([
        expect.objectContaining({
          code: 'VALIDATOR_STATUS_UNCHECKED',
          details: { checks: ['credentials'] },
        }),
      ]);
    });
  });

  it('is bound by createWithdrawalsModule', async () => {
    const module = createWithdrawalsModule(ovmChain().context());
    await expect(
      module.prepareEoaWithdraw({ pubkey: PUBKEY_A, amount: ETH }),
    ).resolves.toBeDefined();
  });
});
