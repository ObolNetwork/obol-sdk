/**
 * deposits.prepareDeposit (spec/operations.md "deposits.prepareDeposit"):
 * checked deposit transactions, through the OVM (one per deposit) or the
 * batch deposit contract (one per 500).
 */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import { batchDepositAbi, ovmAbi } from '../abi.js';
import { requireContracts } from '../chains.js';
import {
  contractNotAvailable,
  finding,
  getCodeKind,
  prepared,
  chainReadFailed,
} from '../chainUtils.js';
import type { Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, decode, invalid, sameAddress, T } from '../schema.js';
import type {
  Deposit,
  DepositInput,
  DepositKind,
  Finding,
  Prepared,
  StatusSource,
} from '../types.js';
import { ETH } from '../units.js';
import { credentialsPrefix } from '../ovm/credentials.js';
import { readOvmCore, requireRole, requireSender } from '../ovm/read.js';
import { requireObolOvm, verifyOvm } from '../ovm/verify.js';
import {
  effectiveCredentials,
  possiblyValidDeposits,
  StatusSourceFields,
  statusIfAvailable,
  statusSourceOf,
  type DepositStatus,
} from './status.js';
import { DepositSchema, verifyDepositData } from './verifyDepositData.js';

/** Deposits per batch deposit transaction. */
export const BATCH_DEPOSIT_SIZE = 500;
/** Effective balance cap for 0x00 / 0x01 credentials. */
const EFFECTIVE_CAP_0X01 = 32n * ETH;
const ZERO_CREDENTIALS = `0x${'0'.repeat(64)}`;

export const PrepareDepositInputSchema = Type.Object(
  {
    deposits: Type.Array(DepositSchema, { minItems: 1 }),
    kind: Type.Optional(
      Type.Union([Type.Literal('deposit'), Type.Literal('topUp')]),
    ),
    via: Type.Union([
      Type.Object({ ovm: T.Address }, { additionalProperties: false }),
      Type.Object(
        { batch: Type.Literal(true) },
        { additionalProperties: false },
      ),
    ]),
    expectedWithdrawalAddress: Type.Optional(T.Address),
    from: Type.Optional(T.Address),
    ...StatusSourceFields,
  },
  { additionalProperties: false },
);
export interface PrepareDepositInput extends StatusSource {
  deposits: DepositInput[];
  kind?: DepositKind;
  via: { ovm: string } | { batch: true };
  /** Required with batch; with ovm it is the OVM address. */
  expectedWithdrawalAddress?: string;
  /** Sender for the OVM role check; default the wallet account. */
  from?: string;
}

export interface DepositPreview {
  pubkeys: Hex[];
  total: bigint;
  kind: DepositKind;
}

const sum = (amounts: bigint[]): bigint => amounts.reduce((a, b) => a + b, 0n);

/** What the check 5 helpers share for one deposit. */
interface ExistenceContext {
  deposit: Deposit;
  kind: DepositKind;
  status: DepositStatus;
  pubkey: Hex;
  credentials: string;
  queued: DepositStatus['pendingDeposits'];
  details: { index: number; pubkey: Hex };
  subject: { pubkey: Hex };
  findings: Finding[];
}

const conflictError = (
  c: ExistenceContext,
  existing: Hex | undefined,
): ObolError =>
  new ObolError(
    'DEPOSIT_CONFLICT',
    existing === undefined
      ? `A pending deposit for ${c.pubkey} has unknown withdrawal credentials`
      : `A pending deposit for ${c.pubkey} has different withdrawal credentials (${existing})`,
    {
      hint: 'Do not send; find out who queued the other deposit',
      details: {
        ...c.details,
        ...(existing !== undefined ? { existingCredentials: existing } : {}),
      },
    },
  );

/** Validly signed queued deposits disagree: the first one applies. */
const checkConflictingQueue = (
  c: ExistenceContext,
  checkCredentials: boolean,
): void => {
  const applies = effectiveCredentials(c.status);
  if (
    checkCredentials &&
    (applies === undefined || applies.toLowerCase() !== c.credentials)
  ) {
    throw conflictError(c, applies);
  }
  c.findings.push(
    finding(
      'QUEUED_CREDENTIALS_CONFLICT',
      'warning',
      `Validly signed deposits queued for ${c.pubkey} carry different withdrawal credentials; the first one (${applies ?? 'unknown'}) applies`,
      {
        hint: 'Find out who queued the other deposits before adding to this validator',
        subject: c.subject,
        details: c.details,
      },
    ),
  );
};

/** No queued deposit may carry other (or unknown) credentials. */
const checkAgreeingQueue = (
  c: ExistenceContext,
  checkCredentials: boolean,
): void => {
  const other = c.queued.find(p => {
    if (p.withdrawalCredentials === undefined) return true;
    const existing = p.withdrawalCredentials.toLowerCase();
    return (
      existing !== c.credentials &&
      (existing !== ZERO_CREDENTIALS || p.signatureValid === true)
    );
  });
  if (checkCredentials && other !== undefined) {
    throw conflictError(c, other.withdrawalCredentials);
  }
};

/** Check 5 for a pubkey that is not registered yet but has pending deposits. */
const pendingDepositChecks = (c: ExistenceContext): void => {
  if (
    c.status.signaturesPending === true &&
    effectiveCredentials(c.status) === undefined
  ) {
    // Which queued deposit creates the validator is not known yet. Once
    // every deposit up to the first validly signed one is checked, it is,
    // and the checks below treat the unchecked later ones as possibly valid.
    throw new ObolError(
      'STATUS_UNAVAILABLE',
      `The Obol API is still checking the queued deposit signatures for ${c.pubkey}`,
      {
        hint: 'Retry in a slot or two; the credentials it will get are not known yet',
        details: { reason: 'signatures_pending', pubkey: c.pubkey },
      },
    );
  }
  // The first processed deposit with a valid signature fixes the
  // credentials. A top-up with all-zero credentials does not care which
  // ones they are, and an unchecked queued one (no valid signature for a
  // new validator) does not fix them.
  const checkCredentials =
    c.kind === 'deposit' || c.credentials !== ZERO_CREDENTIALS;
  if (c.status.credentialsConflict === true) {
    checkConflictingQueue(c, checkCredentials);
  } else {
    checkAgreeingQueue(c, checkCredentials);
  }
  if (c.queued.length > 0) {
    c.findings.push(
      finding(
        'DEPOSIT_ALREADY_QUEUED',
        'info',
        `${c.queued.length} deposit(s) for ${c.pubkey} are already queued`,
        {
          hint: 'Make sure this is not a repeat',
          subject: c.subject,
          details: c.details,
        },
      ),
    );
  }
};

/** Check 5: TOP_UP_ABOVE_EFFECTIVE_CAP for 0x00 / 0x01 credentials. */
const effectiveCapCheck = (
  c: ExistenceContext,
  alreadyInInput: bigint,
): void => {
  const prefix = credentialsPrefix(
    (effectiveCredentials(c.status) ?? c.credentials) as Hex,
  );
  if (
    c.status.status === 'exited' ||
    (prefix !== '0x00' && prefix !== '0x01')
  ) {
    return;
  }
  const after =
    (c.status.balance ?? 0n) +
    sum(c.queued.map(p => p.amount)) +
    alreadyInInput +
    c.deposit.amount;
  if (after > EFFECTIVE_CAP_0X01) {
    c.findings.push(
      finding(
        'TOP_UP_ABOVE_EFFECTIVE_CAP',
        'warning',
        `${c.pubkey} has ${prefix} credentials: with this deposit its balance reaches ${after} wei, above 32 ETH; the excess is swept back to the withdrawal address, not staked`,
        {
          hint: 'Deposit at most up to 32 ETH, or consolidate to 0x02 first',
          subject: c.subject,
          details: { ...c.details, balanceAfter: after },
        },
      ),
    );
  }
};

/** Check 5: existence findings and errors for one deposit. */
const existenceChecks = (
  deposit: Deposit,
  index: number,
  kind: DepositKind,
  status: DepositStatus,
  alreadyInInput: bigint,
): Finding[] => {
  const findings: Finding[] = [];
  const pubkey = status.pubkey;
  const registered =
    status.status !== 'new' && status.beaconStatus !== 'pending_deposit';
  const c: ExistenceContext = {
    deposit,
    kind,
    status,
    pubkey,
    credentials: deposit.withdrawalCredentials.toLowerCase(),
    // Queued deposits whose signature the source found invalid never reach
    // the validator; unchecked ones are kept (possibly valid).
    queued: possiblyValidDeposits(status),
    details: { index, pubkey },
    subject: { pubkey },
    findings,
  };
  const { queued, details, subject } = c;

  if (!registered && status.pendingDeposits.length > 0) {
    pendingDepositChecks(c);
  }
  if (
    kind === 'topUp' &&
    (status.status === 'new' || (!registered && queued.length === 0))
  ) {
    throw new ObolError(
      'DEPOSIT_TOP_UP_TARGET_MISSING',
      `Top-up for ${pubkey}, which has no validator and no validly signed pending deposit`,
      {
        hint: 'Check the pubkey; send the full deposit data first',
        details,
      },
    );
  }
  if (kind === 'deposit' && registered) {
    findings.push(
      finding(
        'DEPOSIT_IS_TOP_UP',
        'warning',
        `${pubkey} is already a validator: this deposit tops it up and its withdrawal credentials are ignored`,
        { hint: 'Confirm this is intended', subject, details },
      ),
    );
  }
  if (kind === 'topUp' && status.status === 'exited') {
    findings.push(
      finding(
        'TOP_UP_EXITED_VALIDATOR',
        'warning',
        `${pubkey} has exited: the top-up is swept back to its withdrawal address, not staked`,
        { hint: 'Do not top up', subject, details },
      ),
    );
  }
  effectiveCapCheck(c, alreadyInInput);
  return findings;
};

/**
 * deposits.prepareDeposit (`chain`, uses deposits.status when a source is
 * available). Checks, in order:
 * 1. `verifyDepositData` against the OVM address (via ovm) or
 *    `expectedWithdrawalAddress` (via batch, required);
 * 2. via ovm: `ovm.verify` is `obol` (OVM_NOT_OBOL / PROVENANCE_UNKNOWN);
 * 3. via ovm: the sender is owner or holds DEPOSIT (OVM_ROLE_MISSING);
 * 4. via batch to credentials of an Obol OVM: OVM_STAKE_NOT_TRACKED warning;
 * 5. existence (DEPOSIT_CONFLICT, DEPOSIT_TOP_UP_TARGET_MISSING,
 *    STATUS_UNAVAILABLE `signatures_pending` while the credentials are
 *    undecided, and the findings
 *    DEPOSIT_IS_TOP_UP, DEPOSIT_ALREADY_QUEUED, QUEUED_CREDENTIALS_CONFLICT,
 *    TOP_UP_EXITED_VALIDATOR, TOP_UP_ABOVE_EFFECTIVE_CAP), or
 *    DEPOSIT_EXISTENCE_UNCHECKED without a status source;
 * 6. the target contract has code (CONTRACT_NOT_AVAILABLE).
 *
 * Returns one Prepared per deposit via ovm (`OVM.deposit`, value = amount),
 * or one per 500 deposits via batch (`batchDeposit`, value = sum).
 */
export const prepareDeposit = async (
  ctx: Context,
  input: PrepareDepositInput,
): Promise<Array<Prepared<'deposit'>>> => {
  const args = decode(PrepareDepositInputSchema, input);
  const contracts = requireContracts(ctx.chain.id, 'deposits.prepareDeposit');
  const kind: DepositKind = args.kind ?? 'deposit';
  const deposits = args.deposits as Deposit[];
  const ovm = 'ovm' in args.via ? checksum(args.via.ovm) : null;

  // 1. Pure deposit checks.
  let expected: Address;
  if (ovm !== null) {
    if (
      args.expectedWithdrawalAddress !== undefined &&
      !sameAddress(args.expectedWithdrawalAddress, ovm)
    ) {
      throw invalid(
        'expectedWithdrawalAddress',
        'must be the OVM address when depositing via the OVM (or be omitted)',
      );
    }
    expected = ovm;
  } else {
    if (args.expectedWithdrawalAddress === undefined) {
      throw invalid(
        'expectedWithdrawalAddress',
        'is required when depositing via the batch deposit contract',
      );
    }
    expected = checksum(args.expectedWithdrawalAddress);
  }
  await verifyDepositData(deposits, {
    chainId: ctx.chain.id,
    kind,
    expectedWithdrawalAddress: expected,
  });

  const checks: Finding[] = [];
  let blockNumber: bigint | undefined;
  if (ovm !== null) {
    // 2. Provenance: the principal is at stake, so unknown is an error.
    await requireObolOvm(ctx, ovm, true);
    // 3. Role.
    const from = requireSender(ctx, args.from, 'deposits.prepareDeposit');
    const core = await readOvmCore(ctx, ovm, {
      from,
      what: 'deposits.prepareDeposit',
    });
    requireRole(core, from, 'DEPOSIT');
    blockNumber = core.blockNumber;
  } else if ((await verifyOvm(ctx, expected)).status === 'obol') {
    // 4. Batch deposits do not raise the OVM's amountOfPrincipalStake.
    checks.push(
      finding(
        'OVM_STAKE_NOT_TRACKED',
        'warning',
        `${expected} is an Obol OVM: the batch deposit contract does not raise its amountOfPrincipalStake, so this principal would later be paid out as rewards`,
        {
          hint: 'Deposit via the OVM, or have the owner call setAmountOfPrincipalStake',
          subject: { address: expected },
          details: { address: expected },
        },
      ),
    );
  }

  // 5. Existence. Findings about one deposit go only on its transaction.
  const perDeposit: Finding[][] = deposits.map(() => []);
  const pubkeys = deposits.map(d => d.pubkey.toLowerCase() as Hex);
  const statuses = await statusIfAvailable(ctx, pubkeys, statusSourceOf(args));
  if (statuses === null) {
    checks.push(
      finding(
        'DEPOSIT_EXISTENCE_UNCHECKED',
        'info',
        `No deposit status source, so kind "${kind}" was trusted`,
        {
          hint: 'Enable the API (with lockHash until it serves deposit status by pubkey), or pass beaconUrl',
        },
      ),
    );
  } else {
    const inInput = new Map<string, bigint>();
    deposits.forEach((deposit, index) => {
      const status = statuses.get(pubkeys[index]);
      if (status === undefined) return;
      const earlier = inInput.get(pubkeys[index]) ?? 0n;
      perDeposit[index] = existenceChecks(
        deposit,
        index,
        kind,
        status,
        earlier,
      );
      inInput.set(pubkeys[index], earlier + deposit.amount);
    });
  }

  // 6. The target has code.
  const target = ovm ?? contracts.batchDeposit;
  let code;
  try {
    code = await getCodeKind(ctx.publicClient, target);
  } catch (cause) {
    throw chainReadFailed(`the code at ${target}`, cause);
  }
  if (code !== 'contract') {
    throw contractNotAvailable(
      target,
      ovm !== null ? 'The OVM' : 'The batch deposit contract',
    );
  }

  if (ovm !== null) {
    return deposits.map((deposit, i) =>
      prepared(ctx, 'deposit', {
        to: ovm,
        data: encodeFunctionData({
          abi: ovmAbi,
          functionName: 'deposit',
          args: [
            pubkeys[i],
            deposit.withdrawalCredentials,
            deposit.signature,
            deposit.depositDataRoot,
          ],
        }),
        value: deposit.amount,
        checks: [...checks, ...perDeposit[i]],
        preview: { pubkeys: [pubkeys[i]], total: deposit.amount, kind },
        ...(blockNumber !== undefined ? { blockNumber } : {}),
      }),
    );
  }
  const result: Array<Prepared<'deposit'>> = [];
  for (let i = 0; i < deposits.length; i += BATCH_DEPOSIT_SIZE) {
    const batch = deposits.slice(i, i + BATCH_DEPOSIT_SIZE);
    const total = sum(batch.map(d => d.amount));
    result.push(
      prepared(ctx, 'deposit', {
        to: contracts.batchDeposit,
        data: encodeFunctionData({
          abi: batchDepositAbi,
          functionName: 'batchDeposit',
          args: [
            batch.map(d => ({
              pubKey: d.pubkey,
              withdrawalCredentials: d.withdrawalCredentials,
              signature: d.signature,
              amount: d.amount,
            })),
          ],
        }),
        value: total,
        checks: [
          ...checks,
          ...perDeposit.slice(i, i + BATCH_DEPOSIT_SIZE).flat(),
        ],
        preview: {
          pubkeys: pubkeys.slice(i, i + BATCH_DEPOSIT_SIZE),
          total,
          kind,
        },
      }),
    );
  }
  return result;
};
