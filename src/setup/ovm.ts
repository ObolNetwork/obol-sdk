/** setup.prepareCreateOvm and setup.ovmFromReceipt. */
import { Type } from '@sinclair/typebox';
import {
  decodeEventLog,
  encodeFunctionData,
  type Address,
  type Hex,
} from 'viem';
import { createOvmEvent, ovmFactoryAbi } from '../abi.js';
import {
  codeKind,
  chainReadFailed,
  latestBlockNumber,
  finding,
  prepared,
  refusePublicForwarders,
} from '../chainUtils.js';
import { requireContracts, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import {
  checksum,
  decode,
  invalid,
  sameAddress,
  T,
  ZERO_ADDRESS,
} from '../schema.js';
import type { Finding, Prepared } from '../types.js';
import { ETH, GWEI, weiToGwei } from '../units.js';
import { EXPECTED_CODE_HASHES, requireExpectedCode } from '../splits/chain.js';

export const DEFAULT_PRINCIPAL_THRESHOLD = 16n * ETH;
export const MIN_PRINCIPAL_THRESHOLD = 16n * ETH;
export const MAX_PRINCIPAL_THRESHOLD = 2048n * ETH;

export const CreateOvmInputSchema = Type.Object(
  {
    owner: T.Address,
    principalRecipient: T.Address,
    rewardRecipient: T.Address,
    principalThreshold: Type.Optional(T.Wei),
  },
  { additionalProperties: false },
);

export interface CreateOvmInput {
  owner: string;
  /** Any address: a split, an EOA, a Safe. */
  principalRecipient: string;
  rewardRecipient: string;
  /** wei, whole gwei, 16 to 2048 ETH; default 16 ETH. */
  principalThreshold?: bigint;
}

export interface CheckedOvmInput {
  owner: Address;
  principalRecipient: Address;
  rewardRecipient: Address;
  thresholdGwei: bigint;
}

/**
 * The input checks of `prepareCreateOvm` that need no chain: the three
 * addresses are non-zero, and the threshold is whole gwei within
 * [16 ETH, 2048 ETH].
 */
export const checkOvmInput = (input: CreateOvmInput): CheckedOvmInput => {
  const d = decode(CreateOvmInputSchema, input);
  for (const key of [
    'owner',
    'principalRecipient',
    'rewardRecipient',
  ] as const) {
    if (sameAddress(d[key], ZERO_ADDRESS)) {
      throw invalid(key, 'must not be the zero address', 'zero_address');
    }
  }
  const threshold = d.principalThreshold ?? DEFAULT_PRINCIPAL_THRESHOLD;
  const thresholdGwei = weiToGwei(threshold, 'principalThreshold');
  if (
    threshold < MIN_PRINCIPAL_THRESHOLD ||
    threshold > MAX_PRINCIPAL_THRESHOLD
  ) {
    throw invalid('principalThreshold', 'must be between 16 ETH and 2048 ETH');
  }
  return {
    owner: checksum(d.owner),
    principalRecipient: checksum(d.principalRecipient),
    rewardRecipient: checksum(d.rewardRecipient),
    thresholdGwei,
  };
};

/** Owner and recipients must not be public forwarders. */
export const refuseOvmForwarders = (
  chainId: number,
  checked: CheckedOvmInput,
): void => {
  refusePublicForwarders(chainId, [
    { path: 'owner', address: checked.owner, kind: 'owner' },
    {
      path: 'principalRecipient',
      address: checked.principalRecipient,
      kind: 'recipient',
    },
    {
      path: 'rewardRecipient',
      address: checked.rewardRecipient,
      kind: 'recipient',
    },
  ]);
};

export const encodeCreateOvm = (input: CheckedOvmInput): Hex =>
  encodeFunctionData({
    abi: ovmFactoryAbi,
    functionName: 'createObolValidatorManager',
    args: [
      input.owner,
      input.principalRecipient,
      input.rewardRecipient,
      input.thresholdGwei,
    ],
  });

/** RECIPIENT_NOT_CONTRACT findings for the addresses that have no contract code. */
export const recipientCodeFindings = async (
  ctx: Context,
  addresses: Address[],
  blockNumber: bigint,
): Promise<Finding[]> => {
  const checks: Finding[] = [];
  const seen = new Set<string>();
  for (const address of addresses) {
    if (seen.has(address.toLowerCase())) continue;
    seen.add(address.toLowerCase());
    let code: Hex | undefined;
    try {
      code = await ctx.publicClient.getCode({ address, blockNumber });
    } catch (cause) {
      throw chainReadFailed(`the code at ${address}`, cause);
    }
    if (codeKind(code) !== 'contract') {
      checks.push(
        finding(
          'RECIPIENT_NOT_CONTRACT',
          'info',
          `OVM recipient ${address} has no contract code (an EOA, or a split not created yet)`,
          {
            hint: 'If it should be a split, create it first or use prepareOvmWithSplits',
            subject: { address },
            details: { address },
          },
        ),
      );
    }
  }
  return checks;
};

/**
 * Builds `createObolValidatorManager(owner, principalRecipient,
 * rewardRecipient, thresholdGwei)` on the chain's OVM factory. Checks: the
 * three addresses are non-zero; the threshold is whole gwei in
 * [16 ETH, 2048 ETH] (PAYLOAD_INVALID); the factory has the expected code
 * (CONTRACT_NOT_AVAILABLE). A recipient without contract code gets a
 * RECIPIENT_NOT_CONTRACT finding. The OVM address is known only after mining:
 * read it with `ovmFromReceipt`.
 */
export const prepareCreateOvm = async (
  ctx: Context,
  input: CreateOvmInput,
): Promise<Prepared<'createOvm'>> => {
  const checked = checkOvmInput(input);
  refuseOvmForwarders(ctx.chain.id, checked);
  const { ovmFactory } = requireContracts(
    ctx.chain.id,
    'setup.prepareCreateOvm',
  );
  const blockNumber = await latestBlockNumber(ctx.publicClient);
  await requireExpectedCode(
    ctx,
    ovmFactory.address,
    EXPECTED_CODE_HASHES.ovmFactory[ctx.chain.id],
    'OVM factory',
    blockNumber,
  );
  const checks = await recipientCodeFindings(
    ctx,
    [checked.principalRecipient, checked.rewardRecipient],
    blockNumber,
  );
  return prepared(ctx, 'createOvm', {
    to: ovmFactory.address,
    data: encodeCreateOvm(checked),
    checks,
    preview: { factory: ovmFactory.address },
    blockNumber,
  });
};

/** What `prepareCreateOvm` calls; the OVM address is only known from the receipt (`ovmFromReceipt`). */
export interface CreateOvmPreview {
  factory: Address;
}

export interface OvmCreated {
  ovm: Address;
  owner: Address;
  principalRecipient: Address;
  rewardRecipient: Address;
  /** wei */
  principalThreshold: bigint;
}

/**
 * The OVM created by a mined transaction, from the `CreateObolValidatorManager`
 * log emitted by the chain's OVM factory (logs from other addresses are
 * ignored). None: OVM_CREATE_EVENT_MISSING; more than one:
 * OVM_CREATE_EVENT_AMBIGUOUS.
 */
export const ovmFromReceipt = (
  receipt: {
    logs: ReadonlyArray<{ address: string; topics: readonly Hex[]; data: Hex }>;
  },
  options: { chainId: number },
): OvmCreated => {
  const { ovmFactory } = requireContracts(
    options.chainId,
    'setup.ovmFromReceipt',
  );
  const created: OvmCreated[] = [];
  for (const log of receipt.logs) {
    if (!sameAddress(log.address, ovmFactory.address)) continue;
    try {
      const { args } = decodeEventLog({
        abi: [createOvmEvent],
        data: log.data,
        topics: log.topics as [Hex, ...Hex[]],
      });
      created.push({
        ovm: checksum(args.ovm),
        owner: checksum(args.owner),
        principalRecipient: checksum(args.beneficiary),
        rewardRecipient: checksum(args.rewardRecipient),
        principalThreshold: args.principalThreshold * GWEI,
      });
    } catch {
      // Another factory event.
    }
  }
  if (created.length === 0) {
    throw new ObolError(
      'OVM_CREATE_EVENT_MISSING',
      'No CreateObolValidatorManager event from the OVM factory in the receipt',
      { hint: 'Check the receipt is the create transaction' },
    );
  }
  if (created.length > 1) {
    throw new ObolError(
      'OVM_CREATE_EVENT_AMBIGUOUS',
      `${created.length} CreateObolValidatorManager events in the receipt`,
      {
        hint: 'Read the addresses from the logs yourself',
        details: { ovms: created.map(c => c.ovm) },
      },
    );
  }
  return created[0];
};
