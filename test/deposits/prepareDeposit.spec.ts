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
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { depositDataRoot } from '../../src/deposits/assertDepositData.js';
import { createDepositsModule } from '../../src/deposits/index.js';
import {
  computeDepositMsgRoot,
  depositDomainForFork,
  signingRoot,
} from '../../src/internal/verification/common.js';
import { offsetDepositPair } from '../helpers/blsSignatures.js';
import { fakeApi } from '../helpers/fakeChain.js';
import { blsSign, hex, randomScalar } from '../helpers/syntheticLock.js';

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

    it('runs assertDepositData first (check 1)', async () => {
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

    // A top-up needs a validator in the registry, whatever is queued.
    it('throws DEPOSIT_TOP_UP_TARGET_MISSING when only zero-credential deposits are queued (beacon)', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: TOP_UP.pubkey.toLowerCase() as Hex,
            withdrawal_credentials: `0x${'00'.repeat(32)}` as Hex,
            amount: '1000000000',
          },
        ],
        [],
      );
      expect(
        await caught(run({ deposits: [TOP_UP], kind: 'topUp' })),
      ).toMatchObject({
        code: 'DEPOSIT_TOP_UP_TARGET_MISSING',
        details: { index: 0 },
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

    it('does not count a queued Launchpad-style top-up (no valid signature) as a conflict', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: PUBKEY,
            withdrawal_credentials: `0x${'00'.repeat(32)}`,
            amount: '1000000000',
            signature: TOP_UP.signature,
          },
        ],
        [],
      );
      expect((await run({}))[0].checks).toEqual([]);
    });

    it('throws DEPOSIT_CONFLICT for an unchecked queued deposit with all-zero credentials', async () => {
      // No signature in the row: unchecked, so it may create the validator.
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
      expect(await caught(run({}))).toMatchObject({
        code: 'DEPOSIT_CONFLICT',
        details: { existing: 'queued', existingCredentials: `0x${'00'.repeat(32)}` },
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

    it('refuses a top-up to a pubkey only in the queue, even behind a validly signed deposit', async () => {
      restore = mockBeacon(
        [
          {
            pubkey: PUBKEY,
            withdrawal_credentials: credentials('02', OVM),
            amount: '32000000000',
            signature: DEPOSIT.signature,
          },
        ],
        [],
      );
      expect(
        await caught(run({ deposits: [TOP_UP], kind: 'topUp' })),
      ).toMatchObject({ code: 'DEPOSIT_TOP_UP_TARGET_MISSING' });
    });

    // rc.12: kind "deposit" for a pubkey that is already in the registry
    // always throws (rc.11 returned a Prepared with a DEPOSIT_IS_TOP_UP
    // warning, also when the credentials were someone else's).
    it.each([
      ['active_ongoing', credentials('02', OVM)],
      ['active_ongoing', credentials('01', OVM)],
      ['pending_initialized', credentials('02', OVM)],
      ['active_exiting', credentials('02', OVM)],
      ['exited_unslashed', credentials('02', OVM)],
      ['withdrawal_possible', credentials('02', OVM)],
      ['withdrawal_done', credentials('01', OVM)],
    ] as const)(
      'throws DEPOSIT_VALIDATOR_EXISTS for a deposit to an existing validator (%s, own credentials %s)',
      async (status, existing) => {
        restore = mockBeacon([], [registryRow(PUBKEY, status, existing)]);
        const error = await caught(run({}));
        expect(error).toMatchObject({
          code: 'DEPOSIT_VALIDATOR_EXISTS',
          details: {
            index: 0,
            pubkey: PUBKEY,
            status,
            withdrawalCredentials: existing,
          },
        });
      },
    );

    it.each([
      ['active_ongoing', credentials('01', OTHER)],
      ['active_ongoing', credentials('02', OTHER)],
      ['withdrawal_done', credentials('01', OTHER)],
      // BLS (0x00) credentials: nobody's execution address.
      ['active_ongoing', `0x00${'ab'.repeat(31)}` as Hex],
      // Right address, but not a well-formed 0x01 / 0x02 credential.
      [
        'active_ongoing',
        `0x03${'00'.repeat(11)}${OVM.slice(2).toLowerCase()}` as Hex,
      ],
    ] as const)(
      'throws DEPOSIT_CONFLICT for a deposit to a validator that exists with foreign credentials (%s, %s): the front-running case',
      async (status, existing) => {
        restore = mockBeacon([], [registryRow(PUBKEY, status, existing)]);
        const error = await caught(run({}));
        expect(error).toMatchObject({
          code: 'DEPOSIT_CONFLICT',
          details: {
            index: 0,
            pubkey: PUBKEY,
            existingCredentials: existing,
            existing: 'validator',
          },
        });
        expect(error.message).toContain(existing);
      },
    );

    it('via batch: the same two errors, against expectedWithdrawalAddress', async () => {
      const batch = { via: { batch: true }, expectedWithdrawalAddress: OVM };
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY, 'active_ongoing', credentials('01', OTHER))],
      );
      expect((await caught(run(batch))).code).toBe('DEPOSIT_CONFLICT');
      restore();
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY, 'active_ongoing', credentials('02', OVM))],
      );
      expect((await caught(run(batch))).code).toBe('DEPOSIT_VALIDATOR_EXISTS');
    });

    it('marks a queued-deposit conflict as existing: queued', async () => {
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
      expect((await caught(run({}))).details.existing).toBe('queued');
    });

    it('a top-up to an existing validator with own credentials has no finding', async () => {
      restore = mockBeacon(
        [],
        [
          registryRow(
            PUBKEY,
            'active_ongoing',
            credentials('02', OVM),
            32n * ETH,
          ),
        ],
      );
      const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
      expect(result.checks).toEqual([]);
    });

    it('warns TOP_UP_CREDENTIALS_FOREIGN for a top-up to a validator with foreign credentials', async () => {
      const theirs = credentials('02', OTHER);
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY, 'active_ongoing', theirs, 32n * ETH)],
      );
      const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
      expect(result.checks).toEqual([
        expect.objectContaining({
          code: 'TOP_UP_CREDENTIALS_FOREIGN',
          severity: 'warning',
          subject: { pubkey: PUBKEY },
          details: {
            index: 0,
            pubkey: PUBKEY,
            existingCredentials: theirs,
            expectedWithdrawalAddress: OVM,
          },
        }),
      ]);
    });

    it('DEPOSIT_EXISTENCE_UNCHECKED is a warning (send needs it acknowledged)', async () => {
      const [result] = await prepareDeposit(chainWith().context(), {
        deposits: [DEPOSIT],
        via: { ovm: OVM },
        from: OWNER,
      });
      expect(result.checks).toEqual([
        expect.objectContaining({
          code: 'DEPOSIT_EXISTENCE_UNCHECKED',
          severity: 'warning',
        }),
      ]);
    });

    it('warns TOP_UP_EXITED_VALIDATOR', async () => {
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY, 'withdrawal_done', credentials('01', OVM), 0n)],
      );
      const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
      expect(codes(result.checks)).toEqual(['TOP_UP_EXITED_VALIDATOR']);
    });

    it.each(['active_exiting', 'active_slashed'])(
      'warns TOP_UP_EXITED_VALIDATOR for an %s validator (still active until its exit epoch)',
      async beaconStatus => {
        restore = mockBeacon(
          [],
          [
            registryRow(PUBKEY, beaconStatus, credentials('01', OVM), 32n * ETH, {
              exitEpoch: '400000',
            }),
          ],
        );
        const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
        expect(result.checks).toEqual([
          expect.objectContaining({
            code: 'TOP_UP_EXITED_VALIDATOR',
            severity: 'warning',
            message: expect.stringContaining(`is exiting (${beaconStatus})`),
          }),
        ]);
      },
    );

    it('does not warn TOP_UP_EXITED_VALIDATOR for an active_ongoing validator', async () => {
      restore = mockBeacon(
        [],
        [registryRow(PUBKEY, 'active_ongoing', credentials('01', OVM), 31n * ETH)],
      );
      const [result] = await run({ deposits: [TOP_UP], kind: 'topUp' });
      expect(codes(result.checks)).not.toContain('TOP_UP_EXITED_VALIDATOR');
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

  // The beacon chain creates a validator from the first queued deposit with
  // a valid signature, with that deposit's credentials (all-zero ones
  // included); invalidly signed ones are dropped. prepareDeposit checks the
  // signatures of a beacon node's queue; the interim /v1/state route has
  // none to check.
  describe('existence: which queued deposit creates the validator', () => {
    const ZERO = `0x${'00'.repeat(32)}` as Hex;
    const MINE = credentials('02', OVM);
    const domain = depositDomainForFork(CHAINS[560048].forkVersion!);
    /** A validator key and deposits signed with it (or with `signer`). */
    const key = () => {
      const secret = randomScalar();
      const pubkey = hex(
        bls12_381.G1.Point.BASE.multiply(secret).toBytes(),
      ) as Hex;
      const sign = (
        creds: Hex,
        gwei: bigint,
        signer: bigint = secret,
      ): Deposit => {
        const signature = blsSign(
          signingRoot(
            domain,
            computeDepositMsgRoot({
              pubkey,
              withdrawal_credentials: creds,
              amount: gwei.toString(),
            }),
          ),
          signer,
        ) as Hex;
        return {
          pubkey,
          withdrawalCredentials: creds,
          signature,
          depositDataRoot: depositDataRoot({
            pubkey,
            withdrawalCredentials: creds,
            amountGwei: gwei,
            signature,
          }),
          amount: gwei * GWEI,
        };
      };
      const topUp: Deposit = { ...TOP_UP, pubkey };
      topUp.depositDataRoot = depositDataRoot({
        ...topUp,
        amountGwei: ETH / GWEI,
      });
      return { pubkey, sign, topUp };
    };
    const row = (d: Deposit) => ({
      pubkey: d.pubkey,
      withdrawal_credentials: d.withdrawalCredentials,
      amount: (d.amount / GWEI).toString(),
      signature: d.signature,
    });

    describe('beacon node', () => {
      let restore: () => void = () => {};
      afterEach(() => restore());
      const run = async (input: object) =>
        await prepareDeposit(chainWith().context(), {
          via: { ovm: OVM },
          from: OWNER,
          beaconUrl: BEACON_URL,
          ...(input as { deposits: Deposit[] }),
        });

      it('throws DEPOSIT_CONFLICT for a deposit behind a validly signed queued deposit with all-zero credentials', async () => {
        const k = key();
        restore = mockBeacon([row(k.sign(ZERO, 1_000_000_000n))], []);
        expect(
          await caught(run({ deposits: [k.sign(MINE, 32_000_000_000n)] })),
        ).toMatchObject({
          code: 'DEPOSIT_CONFLICT',
          details: { existing: 'queued', existingCredentials: ZERO },
        });
      });

      it.each([
        ['a validly signed deposit with all-zero credentials', 'zero'],
        ['an invalidly signed deposit with own credentials', 'invalid'],
        ['a validly signed deposit with own credentials', 'own'],
      ])(
        'throws DEPOSIT_TOP_UP_TARGET_MISSING for a top-up behind %s',
        async (_name, queued) => {
          const k = key();
          const ahead =
            queued === 'zero'
              ? k.sign(ZERO, 1_000_000_000n)
              : k.sign(
                  MINE,
                  1_000_000_000n,
                  queued === 'invalid' ? randomScalar() : undefined,
                );
          restore = mockBeacon([row(ahead)], []);
          for (const deposit of [k.topUp, k.sign(MINE, 31_000_000_000n)]) {
            expect(
              await caught(run({ deposits: [deposit], kind: 'topUp' })),
            ).toMatchObject({ code: 'DEPOSIT_TOP_UP_TARGET_MISSING' });
          }
        },
      );

      it('leaves an invalidly signed queued deposit out of the conflict check', async () => {
        const k = key();
        const theirs = k.sign(credentials('01', OTHER), 1_000_000_000n);
        restore = mockBeacon(
          [row({ ...theirs, signature: k.sign(ZERO, 1_000_000_000n).signature })],
          [],
        );
        const [result] = await run({ deposits: [k.sign(MINE, 32_000_000_000n)] });
        expect(result.checks).toEqual([]);
      });

      it('notes only DEPOSIT_ALREADY_QUEUED behind a validly signed own deposit', async () => {
        const k = key();
        restore = mockBeacon(
          [
            row(k.sign(MINE, 1_000_000_000n)),
            row({ ...k.topUp, signature: TOP_UP.signature }),
          ],
          [],
        );
        const [result] = await run({ deposits: [k.sign(MINE, 31_000_000_000n)] });
        expect(codes(result.checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
      });

      // spec/operations.md: the first 16 queued deposits per pubkey.
      it('checks the signatures of the first 16 queued deposits per pubkey', async () => {
        const k = key();
        const theirs = credentials('01', OTHER);
        const junk = row(k.sign(MINE, 1_000_000_000n, randomScalar()));
        const invalidTheirs = row(
          k.sign(theirs, 1_000_000_000n, randomScalar()),
        );
        const deposit = k.sign(MINE, 32_000_000_000n);
        // The last deposit checked: found invalid, so left out.
        restore = mockBeacon(
          [
            ...Array.from({ length: 15 }, () => junk),
            invalidTheirs,
          ],
          [],
        );
        expect((await run({ deposits: [deposit] }))[0].checks).toEqual([]);
        restore();
        // The first one past the limit: unchecked, so it may create the
        // validator.
        restore = mockBeacon(
          [
            ...Array.from({ length: 16 }, () => junk),
            invalidTheirs,
          ],
          [],
        );
        expect(await caught(run({ deposits: [deposit] }))).toMatchObject({
          code: 'DEPOSIT_CONFLICT',
          details: { existingCredentials: theirs },
        });
      });

      it('treats a deposit after the first validly signed own one as a top-up, not a conflict', async () => {
        const k = key();
        const theirs = credentials('01', OTHER);
        restore = mockBeacon(
          [
            row(k.sign(MINE, 1_000_000_000n)),
            row(k.sign(ZERO, 1_000_000_000n)),
            row(k.sign(theirs, 1_000_000_000n)),
          ],
          [],
        );
        const [result] = await run({ deposits: [k.sign(MINE, 31_000_000_000n)] });
        expect(codes(result.checks)).toEqual([
          'QUEUED_CREDENTIALS_CONFLICT',
          'DEPOSIT_ALREADY_QUEUED',
        ]);
        restore();
        // Two validly signed deposits, the first not ours: a conflict.
        restore = mockBeacon(
          [
            row(k.sign(theirs, 1_000_000_000n)),
            row(k.sign(MINE, 1_000_000_000n)),
          ],
          [],
        );
        expect(
          await caught(run({ deposits: [k.sign(MINE, 31_000_000_000n)] })),
        ).toMatchObject({
          code: 'DEPOSIT_CONFLICT',
          details: { existingCredentials: theirs },
        });
      });

      it('deposits.status reports which queued deposits are validly signed, and the credentials the first one gives', async () => {
        const k = key();
        const theirs = credentials('01', OTHER);
        restore = mockBeacon(
          [
            row(k.sign(theirs, 1_000_000_000n, randomScalar())),
            row(k.sign(MINE, 1_000_000_000n)),
            row(k.sign(theirs, 1_000_000_000n)),
          ],
          [],
        );
        const [status] = await createDepositsModule(
          chainWith().context(),
        ).status([k.pubkey], { beaconUrl: BEACON_URL });
        expect(status).toMatchObject({
          status: 'queued',
          source: 'chain',
          withdrawalCredentials: MINE,
        });
        expect(status.pendingDeposits.map(p => p.signatureValid)).toEqual([
          false,
          true,
          true,
        ]);
      });

      it('fails closed on a malformed queued deposit signature', async () => {
        const k = key();
        restore = mockBeacon(
          [{ ...row(k.sign(MINE, 1_000_000_000n)), signature: '0x1234' as Hex }],
          [],
        );
        expect(
          (await caught(run({ deposits: [k.sign(MINE, 32_000_000_000n)] })))
            .code,
        ).toBe('STATUS_UNAVAILABLE');
      });
    });

    describe('interim /v1/state (no signatures to check)', () => {
      const LOCK = `0x${'11'.repeat(32)}` as Hex;
      const run = async (pubkey: Hex, reported: Hex, input: object) => {
        const api = fakeApi({
          [`/v1/lock/${LOCK}`]: () => ({
            lock_hash: LOCK,
            distributed_validators: [{ distributed_public_key: pubkey }],
          }),
          [`/v1/state/${LOCK}`]: () => ({
            [pubkey]: {
              index: null,
              status: 'pending_deposit',
              balance: null,
              effective_balance: null,
              withdrawal_credentials: reported,
              pending_partial_withdrawals: null,
              pending_partial_deposits: '1',
            },
          }),
        });
        return await prepareDeposit(chainWith().context(api), {
          via: { ovm: OVM },
          from: OWNER,
          lockHash: LOCK,
          ...(input as { deposits: Deposit[] }),
        });
      };

      it('throws DEPOSIT_CONFLICT for a deposit when the queued credentials are all-zero', async () => {
        const k = key();
        expect(
          await caught(
            run(k.pubkey, ZERO, { deposits: [k.sign(MINE, 32_000_000_000n)] }),
          ),
        ).toMatchObject({
          code: 'DEPOSIT_CONFLICT',
          details: { existing: 'queued', existingCredentials: ZERO },
        });
      });

      it('warns QUEUED_DEPOSIT_UNCHECKED for a deposit behind unchecked queued deposits with own credentials', async () => {
        const k = key();
        const [result] = await run(k.pubkey, MINE, {
          deposits: [k.sign(MINE, 31_000_000_000n)],
        });
        expect(codes(result.checks)).toEqual([
          'QUEUED_DEPOSIT_UNCHECKED',
          'DEPOSIT_ALREADY_QUEUED',
        ]);
        expect(result.checks[0].severity).toBe('warning');
      });

      it('throws DEPOSIT_TOP_UP_TARGET_MISSING for a top-up', async () => {
        const k = key();
        expect(
          await caught(run(k.pubkey, MINE, { deposits: [k.topUp], kind: 'topUp' })),
        ).toMatchObject({ code: 'DEPOSIT_TOP_UP_TARGET_MISSING' });
      });
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
      // A top-up to a queue-only pubkey is refused before the queue is read.
      expect(
        await caught(run([PENDING], { deposits: [TOP_UP], kind: 'topUp' })),
      ).toMatchObject({ code: 'DEPOSIT_TOP_UP_TARGET_MISSING' });
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
      // A later deposit, whatever its credentials, only tops up the
      // validator the first validly signed one creates.
      const later = await run([decided(THEIRS)], { pendingRetry: { tries: 1 } });
      expect(codes(later.result[0].checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
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

    it('treats a validly signed zero-credential deposit after a validly signed own one as a top-up', async () => {
      const { result } = await run([
        entry([
          [MINE, true],
          [ZERO, true],
        ]),
      ]);
      expect(codes(result[0].checks)).toEqual(['DEPOSIT_ALREADY_QUEUED']);
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
    });

    it('refuses a top-up even behind a validly signed queued deposit', async () => {
      expect(
        await caught(
          run(
            [
              entry([
                [MINE, true],
                [ZERO, false],
              ]),
            ],
            { deposits: [TOP_UP], kind: 'topUp' },
          ),
        ),
      ).toMatchObject({ code: 'DEPOSIT_TOP_UP_TARGET_MISSING' });
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
