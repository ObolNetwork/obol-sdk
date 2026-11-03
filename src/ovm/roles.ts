/**
 * OVM role and ownership writes (spec/operations.md "ovm role and ownership
 * writes"): thin wrappers that check provenance and the sender's authority
 * on chain, with previews and findings.
 */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address } from 'viem';
import { ovmAbi } from '../abi.js';
import { publicForwarder, requireContracts } from '../chains.js';
import { finding, prepared } from '../chainUtils.js';
import type { Context } from '../context.js';
import { ObolError } from '../errors.js';
import {
  checksum,
  decode,
  invalid,
  sameAddress,
  T,
  ZERO_ADDRESS,
} from '../schema.js';
import type {
  Finding,
  Prepared,
  PreparedKind,
  PreviewByKind,
} from '../types.js';
import { readMany } from '../multicall.js';
import {
  provenanceFindings,
  readOvmCore,
  readPullBalances,
  requireHeldRoles,
  requireOwner,
  requireRole,
  requireSender,
  type OvmCore,
} from './read.js';
import { OVM_ALL_ROLES, OVM_ROLES, roleNames } from './routing.js';
import { getOvmRoleHolders } from './state.js';

const MAX_UINT256 = 2n ** 256n - 1n;

/** What every role / ownership write previews: the call it makes. */
export interface OvmWritePreview {
  function: string;
  args: readonly unknown[];
}

/** ovm.prepareWithdrawPullBalance: the call and the amount it pays out (wei). */
export interface WithdrawPullBalancePreview extends OvmWritePreview {
  amount: bigint;
}

export interface SetPrincipalStakePreview extends OvmWritePreview {
  current: bigint;
  next: bigint;
  /** next − current (signed): a rise is paid out of rewards at the next distribution. */
  delta: bigint;
}

const RolesInput = Type.Union([
  Type.BigInt({ minimum: 0n }),
  Type.Integer({ minimum: 0 }),
]);

const nonZero = (address: string, path: string): Address => {
  const value = checksum(address);
  if (value === ZERO_ADDRESS) {
    throw invalid(path, 'must not be the zero address');
  }
  return value;
};

/** A non-zero combination of OVM_ROLES, else PAYLOAD_INVALID. */
const toRoles = (value: bigint | number): bigint => {
  const roles = BigInt(value);
  if (roles === 0n || (roles & ~OVM_ALL_ROLES) !== 0n) {
    throw invalid('roles', 'must be a non-zero combination of OVM_ROLES');
  }
  return roles;
};

/**
 * A role or ownership given to a public forwarder (a contract that makes
 * calls as itself for any caller, such as Multicall3) is usable by anyone:
 * PUBLIC_FORWARDER_AS_ROLE_HOLDER / PUBLIC_FORWARDER_AS_OWNER.
 */
const refusePublicForwarder = (
  ctx: Context,
  address: Address,
  grant: { roles: bigint } | { owner: true },
): void => {
  const forwarder = publicForwarder(ctx.chain.id, address);
  if (forwarder === undefined) return;
  const reason = `${forwarder.name} makes calls as itself for any caller, so anyone could use what it holds`;
  if ('roles' in grant) {
    throw new ObolError(
      'PUBLIC_FORWARDER_AS_ROLE_HOLDER',
      `Refusing to grant ${roleNames(grant.roles).join(', ')} to ${address}: ${reason}`,
      {
        hint: 'Grant the roles to the account or Safe that will send the calls',
        details: { user: address, roles: grant.roles, reason },
      },
    );
  }
  throw new ObolError(
    'PUBLIC_FORWARDER_AS_OWNER',
    `Refusing to make ${address} the owner: ${reason}`,
    {
      hint: 'Transfer ownership to the account or Safe that will manage the OVM',
      details: { newOwner: address, reason },
    },
  );
};

interface Setup {
  ovm: Address;
  checks: Finding[];
}

const setup = async (
  ctx: Context,
  ovmInput: string,
  operation: string,
): Promise<Setup> => {
  requireContracts(ctx.chain.id, operation);
  const ovm = checksum(ovmInput);
  return { ovm, checks: await provenanceFindings(ctx, ovm) };
};

const build = <K extends PreparedKind>(
  ctx: Context,
  kind: K,
  ovm: Address,
  functionName: string,
  args: readonly unknown[],
  checks: Finding[],
  blockNumber?: bigint,
  extra?: Omit<PreviewByKind[K], keyof OvmWritePreview>,
): Prepared<K> => {
  const call: OvmWritePreview = { function: functionName, args };
  return prepared(ctx, kind, {
    to: ovm,
    data: encodeFunctionData({
      abi: ovmAbi,
      functionName,
      args,
    } as unknown as Parameters<typeof encodeFunctionData>[0]),
    checks,
    preview: Object.assign(call, extra) as unknown as PreviewByKind[K],
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });
};

/** ROLES_SURVIVE_TRANSFER (or ROLE_HOLDERS_UNCHECKED) for a change of owner. */
const rolesSurviveFindings = async (
  ctx: Context,
  ovm: Address,
): Promise<Finding[]> => {
  try {
    const { holders } = await getOvmRoleHolders(ctx, ovm);
    const others = holders.filter(h => !h.isOwner && h.roles !== 0n);
    if (others.length === 0) return [];
    return [
      finding(
        'ROLES_SURVIVE_TRANSFER',
        'warning',
        `A change of owner does not revoke roles: ${others
          .map(h => `${h.address} (${h.roleNames.join(', ')})`)
          .join('; ')} keep theirs`,
        {
          hint: 'Revoke roles that should not survive, before or after',
          details: {
            holders: others.map(h => ({
              address: h.address,
              roles: h.roles,
              roleNames: h.roleNames,
            })),
          },
        },
      ),
    ];
  } catch (error) {
    return [
      finding(
        'ROLE_HOLDERS_UNCHECKED',
        'info',
        `Could not read the role holders, so surviving roles were not checked: ${
          error instanceof Error ? error.message : String(error)
        }`,
        { hint: 'Check ovm.getRoleHolders later', subject: { address: ovm } },
      ),
    ];
  }
};

/** Reads the OVM and the sender's roles for an authority check. */
const withSender = async (
  ctx: Context,
  ovm: Address,
  from: string | undefined,
  operation: string,
): Promise<{ core: OvmCore; from: Address }> => {
  const sender = requireSender(ctx, from, operation);
  const core = await readOvmCore(ctx, ovm, { from: sender, what: operation });
  return { core, from: sender };
};

/* ------------------------------------------------------------------------ */

export const GrantRolesInputSchema = Type.Object(
  {
    ovm: T.Address,
    user: T.Address,
    roles: RolesInput,
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface GrantRolesInput {
  ovm: string;
  user: string;
  /** A non-zero combination of OVM_ROLES. */
  roles: bigint | number;
  from?: string;
}

/**
 * ovm.prepareGrantRoles (`chain`): `grantRoles(user, roles)`, owner only
 * (OVM_OWNER_REQUIRED). `user` non-zero; `roles` a non-zero subset of OVM_ROLES.
 * `user` must not be one of the chain's public forwarders (Multicall3 and
 * the like): anyone could use the roles through it (PUBLIC_FORWARDER_AS_ROLE_HOLDER).
 * Warns ROLE_GRANT_CONSOLIDATION when granting CONSOLIDATION, and
 * ROLE_GRANT_DEPOSIT_TO_PRINCIPAL when granting DEPOSIT to the principal
 * recipient.
 */
export const prepareGrantRoles = async (
  ctx: Context,
  raw: GrantRolesInput,
): Promise<Prepared<'role'>> => {
  const args = decode(GrantRolesInputSchema, raw);
  const user = nonZero(args.user, 'user');
  const roles = toRoles(args.roles);
  refusePublicForwarder(ctx, user, { roles });
  const { ovm, checks } = await setup(ctx, args.ovm, 'ovm.prepareGrantRoles');
  const { core, from } = await withSender(
    ctx,
    ovm,
    args.from,
    'ovm.prepareGrantRoles',
  );
  requireOwner(core, from);
  if ((roles & OVM_ROLES.CONSOLIDATION) !== 0n) {
    checks.push(
      finding(
        'ROLE_GRANT_CONSOLIDATION',
        'warning',
        `${user} could consolidate every validator of this OVM into one it controls, moving the whole stake`,
        {
          hint: 'Grant CONSOLIDATION only to an address you would trust with the stake',
          subject: { address: user },
        },
      ),
    );
  }
  if (
    (roles & OVM_ROLES.DEPOSIT) !== 0n &&
    sameAddress(user, core.principalRecipient)
  ) {
    checks.push(
      finding(
        'ROLE_GRANT_DEPOSIT_TO_PRINCIPAL',
        'warning',
        `${user} is the principal recipient: with DEPOSIT it can raise amountOfPrincipalStake and receive rewards as principal`,
        { hint: 'Grant DEPOSIT to someone else', subject: { address: user } },
      ),
    );
  }
  return build(
    ctx,
    'role',
    ovm,
    'grantRoles',
    [user, roles],
    checks,
    core.blockNumber,
  );
};

export const RevokeRolesInputSchema = GrantRolesInputSchema;
export type RevokeRolesInput = GrantRolesInput;

/** ovm.prepareRevokeRoles (`chain`): `revokeRoles(user, roles)`, owner only. */
export const prepareRevokeRoles = async (
  ctx: Context,
  raw: RevokeRolesInput,
): Promise<Prepared<'role'>> => {
  const args = decode(RevokeRolesInputSchema, raw);
  const user = nonZero(args.user, 'user');
  const roles = toRoles(args.roles);
  const { ovm, checks } = await setup(ctx, args.ovm, 'ovm.prepareRevokeRoles');
  const { core, from } = await withSender(
    ctx,
    ovm,
    args.from,
    'ovm.prepareRevokeRoles',
  );
  requireOwner(core, from);
  return build(
    ctx,
    'role',
    ovm,
    'revokeRoles',
    [user, roles],
    checks,
    core.blockNumber,
  );
};

export const RenounceRolesInputSchema = Type.Object(
  { ovm: T.Address, roles: RolesInput, from: Type.Optional(T.Address) },
  { additionalProperties: false },
);
export interface RenounceRolesInput {
  ovm: string;
  roles: bigint | number;
  from?: string;
}

/** ovm.prepareRenounceRoles (`chain`): `renounceRoles(roles)`; the sender must hold them (OVM_ROLE_MISSING). */
export const prepareRenounceRoles = async (
  ctx: Context,
  raw: RenounceRolesInput,
): Promise<Prepared<'role'>> => {
  const args = decode(RenounceRolesInputSchema, raw);
  const roles = toRoles(args.roles);
  const { ovm, checks } = await setup(
    ctx,
    args.ovm,
    'ovm.prepareRenounceRoles',
  );
  const { core, from } = await withSender(
    ctx,
    ovm,
    args.from,
    'ovm.prepareRenounceRoles',
  );
  requireHeldRoles(core, from, roles);
  return build(
    ctx,
    'role',
    ovm,
    'renounceRoles',
    [roles],
    checks,
    core.blockNumber,
  );
};

export const OvmOnlyInputSchema = Type.Object(
  { ovm: T.Address, from: Type.Optional(T.Address) },
  { additionalProperties: false },
);
export interface OvmOnlyInput {
  ovm: string;
  from?: string;
}

/** ovm.prepareRequestOwnershipHandover (`chain`): `requestOwnershipHandover()`, sent by the new owner (valid 48 h). */
export const prepareRequestOwnershipHandover = async (
  ctx: Context,
  raw: OvmOnlyInput,
): Promise<Prepared<'ownership'>> => {
  const args = decode(OvmOnlyInputSchema, raw);
  const { ovm, checks } = await setup(
    ctx,
    args.ovm,
    'ovm.prepareRequestOwnershipHandover',
  );
  return build(ctx, 'ownership', ovm, 'requestOwnershipHandover', [], checks);
};

/** ovm.prepareCancelOwnershipHandover (`chain`): `cancelOwnershipHandover()`, sent by the requester. */
export const prepareCancelOwnershipHandover = async (
  ctx: Context,
  raw: OvmOnlyInput,
): Promise<Prepared<'ownership'>> => {
  const args = decode(OvmOnlyInputSchema, raw);
  const { ovm, checks } = await setup(
    ctx,
    args.ovm,
    'ovm.prepareCancelOwnershipHandover',
  );
  return build(ctx, 'ownership', ovm, 'cancelOwnershipHandover', [], checks);
};

export const CompleteOwnershipHandoverInputSchema = Type.Object(
  {
    ovm: T.Address,
    pendingOwner: T.Address,
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface CompleteOwnershipHandoverInput {
  ovm: string;
  pendingOwner: string;
  from?: string;
}

/**
 * ovm.prepareCompleteOwnershipHandover (`chain`):
 * `completeOwnershipHandover(pendingOwner)`, owner only. `pendingOwner`
 * non-zero with an unexpired request (`ownershipHandoverExpiresAt` after the
 * block's timestamp), else OWNERSHIP_HANDOVER_NOT_PENDING; not a public
 * forwarder (PUBLIC_FORWARDER_AS_OWNER). Adds
 * ROLES_SURVIVE_TRANSFER / ROLE_HOLDERS_UNCHECKED.
 */
export const prepareCompleteOwnershipHandover = async (
  ctx: Context,
  raw: CompleteOwnershipHandoverInput,
): Promise<Prepared<'ownership'>> => {
  const args = decode(CompleteOwnershipHandoverInputSchema, raw);
  const pendingOwner = nonZero(args.pendingOwner, 'pendingOwner');
  refusePublicForwarder(ctx, pendingOwner, { owner: true });
  const operation = 'ovm.prepareCompleteOwnershipHandover';
  const { ovm, checks } = await setup(ctx, args.ovm, operation);
  const { core, from } = await withSender(ctx, ovm, args.from, operation);
  requireOwner(core, from);
  const [expiry] = await readMany(
    ctx,
    [
      {
        address: ovm,
        abi: ovmAbi,
        functionName: 'ownershipHandoverExpiresAt',
        args: [pendingOwner],
      },
    ],
    operation,
    core.blockNumber,
  );
  if (!expiry.ok) {
    throw new ObolError(
      'OVM_READ_FAILED',
      `${ovm} did not answer ownershipHandoverExpiresAt`,
      {
        hint: 'Check the address and chain; run ovm.verify',
        details: { address: ovm },
      },
    );
  }
  let timestamp: bigint;
  try {
    ({ timestamp } = await ctx.publicClient.getBlock({
      blockNumber: core.blockNumber,
    }));
  } catch (cause) {
    throw new ObolError(
      'CHAIN_READ_FAILED',
      `Could not read block ${core.blockNumber}`,
      { hint: 'Retry, or use another RPC', cause },
    );
  }
  const expiresAt = expiry.value as bigint;
  if (expiresAt <= timestamp) {
    throw new ObolError(
      'OWNERSHIP_HANDOVER_NOT_PENDING',
      `${pendingOwner} has no unexpired ownership handover request on ${ovm}`,
      {
        hint: 'Have the new owner call requestOwnershipHandover (valid 48 h)',
        details: { pendingOwner, expiresAt },
      },
    );
  }
  checks.push(...(await rolesSurviveFindings(ctx, ovm)));
  return build(
    ctx,
    'ownership',
    ovm,
    'completeOwnershipHandover',
    [pendingOwner],
    checks,
    core.blockNumber,
  );
};

export const TransferInputSchema = Type.Object(
  {
    ovm: T.Address,
    newPrincipalRecipient: T.Address,
    newOwner: T.Address,
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface TransferInput {
  ovm: string;
  /** The new principal recipient (the contract's "beneficiary"). */
  newPrincipalRecipient: string;
  newOwner: string;
  from?: string;
}

/**
 * ovm.prepareTransfer (`chain`): `transfer(newPrincipalRecipient, newOwner)`
 * (the contract's `transfer(beneficiary, owner)`), owner only; both non-zero; `newOwner` not a public forwarder
 * (PUBLIC_FORWARDER_AS_OWNER). Adds ROLES_SURVIVE_TRANSFER /
 * ROLE_HOLDERS_UNCHECKED.
 */
export const prepareTransfer = async (
  ctx: Context,
  raw: TransferInput,
): Promise<Prepared<'ownership'>> => {
  const args = decode(TransferInputSchema, raw);
  const newPrincipalRecipient = nonZero(
    args.newPrincipalRecipient,
    'newPrincipalRecipient',
  );
  const newOwner = nonZero(args.newOwner, 'newOwner');
  refusePublicForwarder(ctx, newOwner, { owner: true });
  const { ovm, checks } = await setup(ctx, args.ovm, 'ovm.prepareTransfer');
  const { core, from } = await withSender(
    ctx,
    ovm,
    args.from,
    'ovm.prepareTransfer',
  );
  requireOwner(core, from);
  checks.push(...(await rolesSurviveFindings(ctx, ovm)));
  return build(
    ctx,
    'ownership',
    ovm,
    'transfer',
    [newPrincipalRecipient, newOwner],
    checks,
    core.blockNumber,
  );
};

export const SetPrincipalRecipientInputSchema = Type.Object(
  {
    ovm: T.Address,
    newPrincipalRecipient: T.Address,
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface SetPrincipalRecipientInput {
  ovm: string;
  newPrincipalRecipient: string;
  from?: string;
}

/**
 * ovm.prepareSetPrincipalRecipient (`chain`): sets the OVM's principal
 * recipient, which the contract calls the "beneficiary"
 * (`setBeneficiary(newPrincipalRecipient)`). Owner or SET_BENEFICIARY;
 * non-zero.
 */
export const prepareSetPrincipalRecipient = async (
  ctx: Context,
  raw: SetPrincipalRecipientInput,
): Promise<Prepared<'recipient'>> => {
  const args = decode(SetPrincipalRecipientInputSchema, raw);
  const newPrincipalRecipient = nonZero(
    args.newPrincipalRecipient,
    'newPrincipalRecipient',
  );
  const operation = 'ovm.prepareSetPrincipalRecipient';
  const { ovm, checks } = await setup(ctx, args.ovm, operation);
  const { core, from } = await withSender(ctx, ovm, args.from, operation);
  requireRole(core, from, 'SET_BENEFICIARY');
  return build(
    ctx,
    'recipient',
    ovm,
    'setBeneficiary',
    [newPrincipalRecipient],
    checks,
    core.blockNumber,
  );
};

export const SetRewardRecipientInputSchema = Type.Object(
  {
    ovm: T.Address,
    newRewardRecipient: T.Address,
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface SetRewardRecipientInput {
  ovm: string;
  newRewardRecipient: string;
  from?: string;
}

/** ovm.prepareSetRewardRecipient (`chain`): `setRewardRecipient(newRewardRecipient)`, owner or SET_REWARD; non-zero. */
export const prepareSetRewardRecipient = async (
  ctx: Context,
  raw: SetRewardRecipientInput,
): Promise<Prepared<'recipient'>> => {
  const args = decode(SetRewardRecipientInputSchema, raw);
  const recipient = nonZero(args.newRewardRecipient, 'newRewardRecipient');
  const operation = 'ovm.prepareSetRewardRecipient';
  const { ovm, checks } = await setup(ctx, args.ovm, operation);
  const { core, from } = await withSender(ctx, ovm, args.from, operation);
  requireRole(core, from, 'SET_REWARD');
  return build(
    ctx,
    'recipient',
    ovm,
    'setRewardRecipient',
    [recipient],
    checks,
    core.blockNumber,
  );
};

export const SetAmountOfPrincipalStakeInputSchema = Type.Object(
  {
    ovm: T.Address,
    amount: Type.BigInt({ minimum: 0n, maximum: MAX_UINT256 }),
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface SetAmountOfPrincipalStakeInput {
  ovm: string;
  /** wei */
  amount: bigint;
  from?: string;
}

/**
 * ovm.prepareSetAmountOfPrincipalStake (`chain`):
 * `setAmountOfPrincipalStake(amount)`, owner or SET_BENEFICIARY. Preview
 * `{ current, next, delta }`: raising it by 32 ETH means the reward
 * recipient gets 32 ETH less at the next distribution.
 */
export const prepareSetAmountOfPrincipalStake = async (
  ctx: Context,
  raw: SetAmountOfPrincipalStakeInput,
): Promise<Prepared<'principalStake'>> => {
  const args = decode(SetAmountOfPrincipalStakeInputSchema, raw);
  const operation = 'ovm.prepareSetAmountOfPrincipalStake';
  const { ovm, checks } = await setup(ctx, args.ovm, operation);
  const { core, from } = await withSender(ctx, ovm, args.from, operation);
  requireRole(core, from, 'SET_BENEFICIARY');
  const current = core.amountOfPrincipalStake;
  return build(
    ctx,
    'principalStake',
    ovm,
    'setAmountOfPrincipalStake',
    [args.amount],
    checks,
    core.blockNumber,
    { current, next: args.amount, delta: args.amount - current },
  );
};

export const SweepInputSchema = Type.Object(
  {
    ovm: T.Address,
    to: Type.Optional(T.Address),
    amount: Type.Optional(Type.BigInt({ minimum: 0n, maximum: MAX_UINT256 })),
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface SweepInput {
  ovm: string;
  /**
   * Where the principal recipient's pull balance goes (the contract's
   * `beneficiary` argument). Default: the principal recipient itself; any
   * other address needs the owner.
   */
  to?: string;
  /** wei; default 0 = the whole pull balance. */
  amount?: bigint;
  from?: string;
}

/**
 * ovm.prepareSweep (`chain`): `sweep(to, amount)` of the principal
 * recipient's pull balance (`to` zero: to the principal recipient). Anyone
 * may call; with `to` only the owner (OVM_OWNER_REQUIRED). `amount` (0 = all) must not exceed the
 * pull balance (PAYLOAD_INVALID).
 */
export const prepareSweep = async (
  ctx: Context,
  raw: SweepInput,
): Promise<Prepared<'sweep'>> => {
  const args = decode(SweepInputSchema, raw);
  const operation = 'ovm.prepareSweep';
  const to = args.to !== undefined ? checksum(args.to) : ZERO_ADDRESS;
  const amount = args.amount ?? 0n;
  const { ovm, checks } = await setup(ctx, args.ovm, operation);
  let core: OvmCore;
  if (to !== ZERO_ADDRESS) {
    const read = await withSender(ctx, ovm, args.from, operation);
    requireOwner(read.core, read.from);
    core = read.core;
  } else {
    core = await readOvmCore(ctx, ovm, { what: operation });
  }
  const [pull] = await readPullBalances(
    ctx,
    ovm,
    [core.principalRecipient],
    core.blockNumber,
    operation,
  );
  if (amount > pull) {
    throw invalid(
      'amount',
      `exceeds the principal recipient's pull balance (${pull} wei)`,
      'above_pull_balance',
    );
  }
  return build(
    ctx,
    'sweep',
    ovm,
    'sweep',
    [to, amount],
    checks,
    core.blockNumber,
  );
};

export const WithdrawPullBalanceInputSchema = Type.Object(
  { ovm: T.Address, account: T.Address },
  { additionalProperties: false },
);
export interface WithdrawPullBalanceInput {
  ovm: string;
  account: string;
}

/**
 * ovm.prepareWithdrawPullBalance (`chain`): `withdrawPullBalance(account)`;
 * anyone may call. `account` non-zero; a zero pull balance is
 * NOTHING_TO_DISTRIBUTE.
 */
export const prepareWithdrawPullBalance = async (
  ctx: Context,
  raw: WithdrawPullBalanceInput,
): Promise<Prepared<'withdrawPullBalance'>> => {
  const args = decode(WithdrawPullBalanceInputSchema, raw);
  const account = nonZero(args.account, 'account');
  const operation = 'ovm.prepareWithdrawPullBalance';
  const { ovm, checks } = await setup(ctx, args.ovm, operation);
  const core = await readOvmCore(ctx, ovm, { what: operation });
  const [amount] = await readPullBalances(
    ctx,
    ovm,
    [account],
    core.blockNumber,
    operation,
  );
  if (amount === 0n) {
    throw new ObolError(
      'NOTHING_TO_DISTRIBUTE',
      `${account} has no pull balance on ${ovm}`,
      { hint: 'Prepare again later' },
    );
  }
  return build(
    ctx,
    'withdrawPullBalance',
    ovm,
    'withdrawPullBalance',
    [account],
    checks,
    core.blockNumber,
    { amount },
  );
};

export const RecoverFundsInputSchema = Type.Object(
  {
    ovm: T.Address,
    token: T.Address,
    recipient: T.Address,
    from: Type.Optional(T.Address),
  },
  { additionalProperties: false },
);
export interface RecoverFundsInput {
  ovm: string;
  /** The ERC-20 token sent to the OVM by mistake. */
  token: string;
  recipient: string;
  from?: string;
}

/** ovm.prepareRecoverFunds (`chain`): `recoverFunds(token, recipient)`, owner or RECOVER_FUNDS; both non-zero. */
export const prepareRecoverFunds = async (
  ctx: Context,
  raw: RecoverFundsInput,
): Promise<Prepared<'recoverFunds'>> => {
  const args = decode(RecoverFundsInputSchema, raw);
  const token = nonZero(args.token, 'token');
  const recipient = nonZero(args.recipient, 'recipient');
  const operation = 'ovm.prepareRecoverFunds';
  const { ovm, checks } = await setup(ctx, args.ovm, operation);
  const { core, from } = await withSender(ctx, ovm, args.from, operation);
  requireRole(core, from, 'RECOVER_FUNDS');
  return build(
    ctx,
    'recoverFunds',
    ovm,
    'recoverFunds',
    [token, recipient],
    checks,
    core.blockNumber,
  );
};
