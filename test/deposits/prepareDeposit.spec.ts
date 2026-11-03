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
import { offsetDepositPair } from '../helpers/blsSignatures.js';
import { fakeApi } from '../helpers/fakeChain.js';

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

    it('requires each deposit signature to be valid on its own', async () => {
      expect(
        await caught(
          prepareDeposit(chainWith().context(), {
            deposits: offsetDepositPair(DEPOSIT),
            via: { ovm: OVM },
            from: OWNER,
          }),
        ),
      ).toMatchObject({
        code: 'DEPOSIT_INVALID',
        details: { index: 0, issue: 'signature_invalid' },
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

    it('does not count a queued zero-credential top-up as a conflict', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: PUBKEY,
            withdrawal_credentials: `0x${'00'.repeat(32)}`,
            amount: '1000000000',
          },
        ],
        [],
      );
      expect(codes((await run({}))[0].checks)).toEqual([
        'DEPOSIT_ALREADY_QUEUED',
      ]);
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

  describe('existence from the Obol API queued deposit signatures', () => {
    const ROUTE = 'POST /v1/validators/hoodi/deposit-status';
    const ZERO = `0x${'00'.repeat(32)}` as Hex;
    const MINE = DEPOSIT.withdrawalCredentials.toLowerCase() as Hex;
    const THEIRS = credentials('01', OTHER);
    type Queued = Array<[Hex, boolean | null]>;
    const entry = (deposits: Queued, extra: object = {}): object => {
      const valid = deposits.filter(([, v]) => v === true);
      const distinct = new Set(valid.map(([c]) => c).filter(c => c !== ZERO));
      return {
        pubkey: PUBKEY,
        status: 'queued',
        beaconStatus: 'pending_deposit',
        index: null,
        balance: null,
        effectiveBalance: null,
        withdrawalCredentials: valid[0]?.[0] ?? null,
        signaturesPending: false,
        credentialsConflict: distinct.size > 1,
        pendingDeposits: deposits.map(([c, signatureValid]) => ({
          amount: (32n * ETH).toString(),
          withdrawalCredentials: c,
          signatureValid,
        })),
        ...extra,
      };
    };
    const PENDING = entry(
      [
        [MINE, null],
        [THEIRS, null],
      ],
      {
        withdrawalCredentials: null,
        signaturesPending: true,
        credentialsConflict: null,
      },
    );
    const run = async (answers: object[], input: object = {}) => {
      let n = 0;
      const api = fakeApi({
        [ROUTE]: () => ({
          validators: [answers[Math.min(n++, answers.length - 1)]],
        }),
      });
      const result = await prepareDeposit(chainWith().context(api), {
        deposits: [DEPOSIT],
        via: { ovm: OVM },
        from: OWNER,
        pendingRetry: { delayMs: 0 },
        ...input,
      });
      return {
        result,
        calls: api.calls.filter(c => c.endpoint.endsWith('/deposit-status'))
          .length,
      };
    };

    it('retries while signatures are pending, then checks the resolved answer', async () => {
      const { result, calls } = await run([
        PENDING,
        entry([
          [THEIRS, false],
          [MINE, true],
        ]),
      ]);
      expect(calls).toBe(2);
      expect(codes(result[0].checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
    });

    it('throws STATUS_UNAVAILABLE (signatures_pending) when they stay pending', async () => {
      const error = await caught(run([PENDING]));
      expect(error).toMatchObject({
        code: 'STATUS_UNAVAILABLE',
        details: { reason: 'signatures_pending', pubkey: PUBKEY },
      });
      expect(error.hint).toMatch(/retry/i);
      // A zero-credential top-up is not let through on a guess either.
      expect(
        await caught(run([PENDING], { deposits: [TOP_UP], kind: 'topUp' })),
      ).toMatchObject({
        code: 'STATUS_UNAVAILABLE',
        details: { reason: 'signatures_pending' },
      });
    });

    it('proceeds while later signatures are pending once the credentials are decided', async () => {
      // Invalid, then valid with ours: decided; an unchecked later deposit
      // with ours too does not matter.
      const decided = (later: Hex): object =>
        entry(
          [
            [THEIRS, false],
            [MINE, true],
            [later, null],
          ],
          {
            withdrawalCredentials: MINE,
            signaturesPending: true,
            credentialsConflict: null,
          },
        );
      const { result, calls } = await run([decided(MINE)], {
        pendingRetry: { tries: 1 },
      });
      expect(calls).toBe(1);
      expect(codes(result[0].checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
      expect(result[0].checks[0].message).toMatch(/^2 deposit/);
      // An unchecked later deposit with other credentials counts as possibly
      // valid: conservative, a conflict.
      expect(
        await caught(run([decided(THEIRS)], { pendingRetry: { tries: 1 } })),
      ).toMatchObject({
        code: 'DEPOSIT_CONFLICT',
        details: { existingCredentials: THEIRS },
      });
      // Decided on other credentials: a conflict, not STATUS_UNAVAILABLE.
      expect(
        await caught(
          run(
            [
              entry(
                [
                  [THEIRS, true],
                  [MINE, null],
                ],
                {
                  withdrawalCredentials: THEIRS,
                  signaturesPending: true,
                  credentialsConflict: null,
                },
              ),
            ],
            { pendingRetry: { tries: 1 } },
          ),
        ),
      ).toMatchObject({ code: 'DEPOSIT_CONFLICT' });
    });

    it('skips a queued deposit with an invalid signature when choosing the credentials', async () => {
      // Invalid first with other credentials, valid second with ours: no conflict.
      const ok = await run([
        entry([
          [THEIRS, false],
          [MINE, true],
        ]),
      ]);
      expect(codes(ok.result[0].checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
      expect(ok.result[0].checks[0].message).toMatch(/^1 deposit/);
      // Invalid first with ours, valid second with other credentials: conflict.
      expect(
        await caught(
          run([
            entry([
              [MINE, false],
              [THEIRS, true],
            ]),
          ]),
        ),
      ).toMatchObject({
        code: 'DEPOSIT_CONFLICT',
        details: { index: 0, pubkey: PUBKEY, existingCredentials: THEIRS },
      });
    });

    it('takes a validly signed zero-credential deposit as the one that applies', async () => {
      expect(await caught(run([entry([[ZERO, true]])]))).toMatchObject({
        code: 'DEPOSIT_CONFLICT',
        details: { existingCredentials: ZERO },
      });
    });

    it('on credentialsConflict: DEPOSIT_CONFLICT unless the deposit has the first valid credentials', async () => {
      const mineFirst = entry([
        [MINE, true],
        [THEIRS, true],
      ]);
      const { result } = await run([mineFirst]);
      expect(codes(result[0].checks)).toEqual([
        'QUEUED_CREDENTIALS_CONFLICT',
        'DEPOSIT_ALREADY_QUEUED',
      ]);
      expect(result[0].checks[0]).toMatchObject({
        severity: 'warning',
        subject: { pubkey: PUBKEY },
      });
      expect(
        await caught(
          run([
            entry([
              [THEIRS, true],
              [MINE, true],
            ]),
          ]),
        ),
      ).toMatchObject({
        code: 'DEPOSIT_CONFLICT',
        details: { existingCredentials: THEIRS },
      });
      // A zero-credential top-up does not care which credentials apply.
      const topUp = await run(
        [
          entry([
            [MINE, true],
            [THEIRS, true],
          ]),
        ],
        { deposits: [TOP_UP], kind: 'topUp' },
      );
      expect(codes(topUp.result[0].checks)).toEqual([
        'QUEUED_CREDENTIALS_CONFLICT',
        'DEPOSIT_ALREADY_QUEUED',
      ]);
    });

    it('lets a zero-credential top-up follow a validly signed queued deposit', async () => {
      const { result } = await run(
        [
          entry([
            [MINE, true],
            [ZERO, false],
          ]),
        ],
        { deposits: [TOP_UP], kind: 'topUp' },
      );
      expect(codes(result[0].checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
    });

    it('treats a pubkey whose queued deposits are all invalid as having no target', async () => {
      const allInvalid = entry([[THEIRS, false]]);
      expect(
        await caught(run([allInvalid], { deposits: [TOP_UP], kind: 'topUp' })),
      ).toMatchObject({ code: 'DEPOSIT_TOP_UP_TARGET_MISSING' });
      const { result } = await run([allInvalid]);
      expect(result[0].checks).toEqual([]);
    });

    it('keeps the 2.16 rule for an older API answer without the signature fields', async () => {
      const older = {
        pubkey: PUBKEY,
        status: 'queued',
        beaconStatus: 'pending_deposit',
        index: null,
        balance: null,
        effectiveBalance: null,
        withdrawalCredentials: MINE,
        pendingDeposits: [
          { amount: (32n * ETH).toString(), withdrawalCredentials: MINE },
          { amount: ETH.toString(), withdrawalCredentials: THEIRS },
        ],
      };
      expect(await caught(run([older]))).toMatchObject({
        code: 'DEPOSIT_CONFLICT',
        details: { existingCredentials: THEIRS },
      });
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
