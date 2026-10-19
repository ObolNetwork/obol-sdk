import { readFileSync } from 'node:fs';
import { decodeFunctionData, type Hex } from 'viem';
import { batchDepositAbi, ovmAbi } from '../../src/abi.js';
import { CHAINS } from '../../src/chains.js';
import { prepareDeposit } from '../../src/deposits/prepareDeposit.js';
import type { Deposit } from '../../src/types.js';
import {
  BEACON_URL,
  caught,
  credentials,
  ETH,
  GWEI,
  HOLDER,
  mockBeacon,
  OTHER,
  OVM,
  ovmChain,
  OWNER,
  registryRow,
  type OvmChainOptions,
} from '../ovm/ovmFixture.js';

const vectors = JSON.parse(
  readFileSync('spec/vectors/deposit_checks.json', 'utf8'),
).cases as any[];
const vectorDeposit = (name: string): Deposit => {
  const d = vectors.find(c => c.name === name).input.deposits[0];
  return {
    pubkey: d.pubkey,
    withdrawalCredentials: d.withdrawal_credentials,
    signature: d.signature,
    depositDataRoot: d.deposit_data_root,
    amount: BigInt(d.amount),
  };
};

/** Valid 32 ETH deposit with 0x02 credentials for OVM (Hoodi). */
const DEPOSIT = vectorDeposit('lock_deposit_valid');
/** Launchpad-style 1 ETH top-up: zero credentials and signature. */
const TOP_UP = vectorDeposit('launchpad_topup_1_eth');
const PUBKEY = DEPOSIT.pubkey.toLowerCase() as Hex;
const BATCH = CHAINS[560048].contracts!.batchDeposit;

const chainWith = (options: OvmChainOptions = {}) =>
  ovmChain({ code: { [BATCH]: '0x6080604052' }, ...options });
const codes = (checks: Array<{ code: string }>): string[] =>
  checks.map(c => c.code);

describe('deposits.prepareDeposit', () => {
  describe('via the OVM', () => {
    it('returns one OVM.deposit per deposit, value = amount', async () => {
      const result = await prepareDeposit(chainWith().context(), {
        deposits: [DEPOSIT, { ...TOP_UP }],
        kind: 'topUp',
        via: { ovm: OVM },
        from: OWNER,
      });
      expect(result).toHaveLength(2);
      expect(result[0].request).toMatchObject({ to: OVM, value: 32n * ETH });
      expect(result[1].request.value).toBe(ETH);
      expect(result[0].blockNumber).toBe(2_000_000n);
      expect(result[0].preview).toEqual({
        pubkeys: [PUBKEY],
        total: 32n * ETH,
        kind: 'topUp',
      });
      const { functionName, args } = decodeFunctionData({
        abi: ovmAbi,
        data: result[0].request.data,
      });
      expect(functionName).toBe('deposit');
      expect(args).toEqual([
        PUBKEY,
        DEPOSIT.withdrawalCredentials,
        DEPOSIT.signature,
        DEPOSIT.depositDataRoot,
      ]);
      expect(codes(result[0].checks)).toEqual(['DEPOSIT_EXISTENCE_UNCHECKED']);
    });

    it('verifies BLS signatures for kind deposit', async () => {
      const result = await prepareDeposit(chainWith().context(), {
        deposits: [DEPOSIT],
        via: { ovm: OVM },
        from: OWNER,
      });
      expect(result[0].preview.kind).toBe('deposit');
    });

    it('runs verifyDepositData first (check 1)', async () => {
      expect(
        await caught(
          prepareDeposit(chainWith().context(), {
            deposits: [TOP_UP],
            via: { ovm: OVM },
            from: OWNER,
          }),
        ),
      ).toMatchObject({ code: 'DEPOSIT_LOOKS_LIKE_TOP_UP' });
      expect(
        await caught(
          prepareDeposit(chainWith().context(), {
            deposits: [{ ...DEPOSIT, depositDataRoot: `0x${'00'.repeat(32)}` }],
            kind: 'topUp',
            via: { ovm: OVM },
            from: OWNER,
          }),
        ),
      ).toMatchObject({
        code: 'DEPOSIT_INVALID',
        details: { issue: 'root_mismatch' },
      });
    });

    it('checks credentials against the OVM address', async () => {
      const error = await caught(
        prepareDeposit(chainWith().context(), {
          deposits: [DEPOSIT],
          via: { ovm: OVM },
          expectedWithdrawalAddress: OTHER,
          from: OWNER,
        }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
      expect(error.details.issues[0].path).toBe('expectedWithdrawalAddress');
    });

    it('needs an Obol OVM: OVM_NOT_OBOL and PROVENANCE_UNKNOWN are errors', async () => {
      const input = { deposits: [DEPOSIT], via: { ovm: OVM }, from: OWNER };
      expect(
        (
          await caught(
            prepareDeposit(
              chainWith({ provenance: 'notObol' }).context(),
              input,
            ),
          )
        ).code,
      ).toBe('OVM_NOT_OBOL');
      expect(
        (
          await caught(
            prepareDeposit(
              chainWith({ provenance: 'unknown' }).context(),
              input,
            ),
          )
        ).code,
      ).toBe('PROVENANCE_UNKNOWN');
    });

    it('needs the owner or DEPOSIT', async () => {
      const chain = chainWith({
        state: { roles: { [HOLDER]: 0x20n, [OTHER]: 0x01n } },
      });
      const input = { deposits: [DEPOSIT], via: { ovm: OVM } };
      expect(
        await caught(
          prepareDeposit(chain.context(), { ...input, from: OTHER }),
        ),
      ).toMatchObject({
        code: 'OVM_ROLE_MISSING',
        details: { role: 'DEPOSIT' },
      });
      await expect(
        prepareDeposit(chain.context(), { ...input, from: HOLDER }),
      ).resolves.toHaveLength(1);
      expect((await caught(prepareDeposit(chain.context(), input))).code).toBe(
        'PAYLOAD_INVALID',
      );
    });
  });

  describe('via the batch deposit contract', () => {
    it('needs expectedWithdrawalAddress', async () => {
      const error = await caught(
        prepareDeposit(chainWith().context(), {
          deposits: [DEPOSIT],
          via: { batch: true },
        }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
      expect(error.details.issues[0].path).toBe('expectedWithdrawalAddress');
    });

    it('splits into transactions of 500 with value = sum', async () => {
      const result = await prepareDeposit(
        chainWith({ provenance: 'notObol' }).context(),
        {
          deposits: Array.from({ length: 501 }, () => TOP_UP),
          kind: 'topUp',
          via: { batch: true },
          expectedWithdrawalAddress: OVM,
        },
      );
      expect(result).toHaveLength(2);
      expect(result[0].request).toMatchObject({ to: BATCH, value: 500n * ETH });
      expect(result[1].request.value).toBe(ETH);
      expect(result[0].preview.pubkeys).toHaveLength(500);
      const { functionName, args } = decodeFunctionData({
        abi: batchDepositAbi,
        data: result[1].request.data,
      });
      expect(functionName).toBe('batchDeposit');
      expect(args[0]).toEqual([
        {
          pubKey: TOP_UP.pubkey,
          withdrawalCredentials: TOP_UP.withdrawalCredentials,
          signature: TOP_UP.signature,
          amount: ETH,
        },
      ]);
      expect(codes(result[0].checks)).toEqual(['DEPOSIT_EXISTENCE_UNCHECKED']);
    });

    it('warns OVM_STAKE_NOT_TRACKED for credentials of an Obol OVM', async () => {
      const [result] = await prepareDeposit(chainWith().context(), {
        deposits: [DEPOSIT],
        via: { batch: true },
        expectedWithdrawalAddress: OVM,
      });
      expect(codes(result.checks)).toEqual([
        'OVM_STAKE_NOT_TRACKED',
        'DEPOSIT_EXISTENCE_UNCHECKED',
      ]);
    });

    it('throws CONTRACT_NOT_AVAILABLE without batch contract code', async () => {
      const error = await caught(
        prepareDeposit(ovmChain({ provenance: 'notObol' }).context(), {
          deposits: [DEPOSIT],
          via: { batch: true },
          expectedWithdrawalAddress: OVM,
        }),
      );
      expect(error).toMatchObject({
        code: 'CONTRACT_NOT_AVAILABLE',
        details: { address: BATCH },
      });
    });
  });

  describe('existence (check 5)', () => {
    let restore: () => void = () => {};
    afterEach(() => restore());
    const run = async (input: object) =>
      await prepareDeposit(chainWith().context(), {
        deposits: [DEPOSIT],
        via: { ovm: OVM },
        from: OWNER,
        beaconUrl: BEACON_URL,
        ...input,
      });

    it('passes a new deposit without findings', async () => {
      restore = mockBeacon([], []);
      expect((await run({}))[0].checks).toEqual([]);
    });

    it('throws DEPOSIT_TOP_UP_TARGET_MISSING for a top-up to a new pubkey', async () => {
      restore = mockBeacon([], []);
      expect(
        await caught(run({ deposits: [TOP_UP], kind: 'topUp' })),
      ).toMatchObject({
        code: 'DEPOSIT_TOP_UP_TARGET_MISSING',
        details: { index: 0, pubkey: PUBKEY },
      });
    });

    it('throws DEPOSIT_CONFLICT for a queued deposit with other credentials', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: PUBKEY,
            withdrawal_credentials: credentials('01', OTHER),
            amount: '32000000000',
          },
        ],
        [],
      );
      expect(await caught(run({}))).toMatchObject({
        code: 'DEPOSIT_CONFLICT',
        details: {
          index: 0,
          pubkey: PUBKEY,
          existingCredentials: credentials('01', OTHER),
        },
      });
    });

    it('notes DEPOSIT_ALREADY_QUEUED for same-credential queued deposits', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: PUBKEY,
            withdrawal_credentials: DEPOSIT.withdrawalCredentials,
            amount: '1000000000',
          },
        ],
        [],
      );
      expect(codes((await run({}))[0].checks)).toEqual([
        'DEPOSIT_ALREADY_QUEUED',
      ]);
    });

    it('lets a zero-credential top-up follow a queued deposit', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: PUBKEY,
            withdrawal_credentials: credentials('02', OVM),
            amount: '32000000000',
          },
        ],
        [],
      );
      const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
      expect(codes(result.checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
    });

    it('warns DEPOSIT_IS_TOP_UP for a deposit to an existing validator', async () => {
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY, 'active_ongoing', credentials('02', OVM))],
      );
      expect(codes((await run({}))[0].checks)).toEqual(['DEPOSIT_IS_TOP_UP']);
    });

    it('warns TOP_UP_EXITED_VALIDATOR', async () => {
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY, 'withdrawal_done', credentials('01', OVM), 0n)],
      );
      const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
      expect(codes(result.checks)).toEqual(['TOP_UP_EXITED_VALIDATOR']);
    });

    it('warns TOP_UP_ABOVE_EFFECTIVE_CAP for a 0x01 validator going over 32 ETH', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: PUBKEY,
            withdrawal_credentials: credentials('01', OVM),
            amount: GWEI.toString(),
          },
        ],
        [
          registryRow(
            PUBKEY,
            'active_ongoing',
            credentials('01', OVM),
            30n * ETH,
          ),
        ],
      );
      // 30 ETH balance + 1 ETH queued + 1 ETH + 1 ETH: the second top-up goes over.
      const result = await run({ deposits: [TOP_UP, TOP_UP], kind: 'topUp' });
      expect(result[0].checks).toEqual([]);
      expect(result[1].checks).toEqual([
        expect.objectContaining({
          code: 'TOP_UP_ABOVE_EFFECTIVE_CAP',
          details: { index: 1, pubkey: PUBKEY, balanceAfter: 33n * ETH },
        }),
      ]);
    });

    it('does not cap a 0x02 validator', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(
            PUBKEY,
            'active_ongoing',
            credentials('02', OVM),
            100n * ETH,
          ),
        ],
      );
      const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
      expect(result.checks).toEqual([]);
    });

    it('fails closed when the status source is malformed', async () => {
      restore = mockBeacon([], [{ nope: true }]);
      expect((await caught(run({}))).code).toBe('STATUS_UNAVAILABLE');
    });
  });

  it('rejects an empty deposit list and unknown fields', async () => {
    expect(
      (
        await caught(
          prepareDeposit(chainWith().context(), {
            deposits: [],
            via: { ovm: OVM },
          }),
        )
      ).code,
    ).toBe('PAYLOAD_INVALID');
    expect(
      (
        await caught(
          prepareDeposit(chainWith().context(), {
            deposits: [DEPOSIT],
            via: { ovm: OVM },
            extra: 1,
          } as any),
        )
      ).code,
    ).toBe('PAYLOAD_INVALID');
  });
});
