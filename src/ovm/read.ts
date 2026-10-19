/**
 * Chain reads shared by the OVM operations: the OVM getters, the sender's
 * authority, and the pull balances, each in one Multicall3 call.
 */
import type { Address } from 'viem';
import { ovmAbi } from '../abi.js';
import { requireContracts } from '../chains.js';
import { senderOf, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { checksum, invalid, sameAddress } from '../schema.js';
import { gweiToWei } from '../units.js';
import {
  blockNumberCall,
  ethBalanceCall,
  readMany,
  type ReadCall,
} from './multicall.js';
import { OVM_ROLES, roleNames, type OvmRoleName } from './routing.js';
import { requireObolOvm } from './verify.js';
import { finding } from '../chainUtils.js';
import type { Finding } from '../types.js';

export interface OvmCore {
  address: Address;
  blockNumber: bigint;
  owner: Address;
  principalRecipient: Address;
  rewardRecipient: Address;
  amountOfPrincipalStake: bigint;
  fundsPendingWithdrawal: bigint;
  /** wei (the contract stores gwei) */
  principalThreshold: bigint;
  version: string | null;
  balance: bigint;
  /** `rolesOf(from)`, when a sender was given. */
  roles?: bigint;
}

export const ovmReadFailed = (ovm: Address, what: string): ObolError =>
  new ObolError('OVM_READ_FAILED', `${ovm} did not answer ${what}`, {
    hint: 'Check the address and chain; run ovm.verify',
    details: { address: ovm },
  });

const GETTERS = [
  'owner',
  'principalRecipient',
  'rewardRecipient',
  'amountOfPrincipalStake',
  'fundsPendingWithdrawal',
  'principalThreshold',
] as const;

/**
 * Reads the OVM getters, `version` (may fail), the OVM's ETH balance, the
 * block number and, with `from`, `rolesOf(from)`, in one `aggregate3`.
 * A required getter failing is OVM_READ_FAILED.
 */
export const readOvmCore = async (
  ctx: Context,
  ovm: Address,
  options: { from?: Address; what?: string } = {},
): Promise<OvmCore> => {
  const what = options.what ?? 'ovm.getState';
  const { multicall3 } = requireContracts(ctx.chain.id, what);
  const call = (functionName: string, args?: unknown[]): ReadCall => ({
    address: ovm,
    abi: ovmAbi,
    functionName,
    ...(args !== undefined ? { args } : {}),
  });
  const calls: ReadCall[] = [
    ...GETTERS.map(name => call(name)),
    call('version'),
    ethBalanceCall(multicall3, ovm),
    blockNumberCall(multicall3),
  ];
  if (options.from !== undefined) calls.push(call('rolesOf', [options.from]));
  const results = await readMany(ctx, calls, what);
  const values = results.map(r => (r.ok ? r.value : undefined));
  const failed = GETTERS.filter((_, i) => values[i] === undefined);
  if (failed.length > 0) throw ovmReadFailed(ovm, failed.join(', '));
  if (values[7] === undefined || values[8] === undefined) {
    throw ovmReadFailed(ovm, 'the balance and block number reads');
  }
  const core: OvmCore = {
    address: ovm,
    owner: checksum(values[0] as string),
    principalRecipient: checksum(values[1] as string),
    rewardRecipient: checksum(values[2] as string),
    amountOfPrincipalStake: values[3] as bigint,
    fundsPendingWithdrawal: values[4] as bigint,
    principalThreshold: gweiToWei(values[5] as bigint),
    version: (values[6] as string | undefined) ?? null,
    balance: values[7] as bigint,
    blockNumber: values[8] as bigint,
  };
  if (options.from !== undefined) {
    if (values[9] === undefined) throw ovmReadFailed(ovm, 'rolesOf');
    core.roles = values[9] as bigint;
  }
  return core;
};

/** `getPullBalance` of each account at `blockNumber`; OVM_READ_FAILED on failure. */
export const readPullBalances = async (
  ctx: Context,
  ovm: Address,
  accounts: Address[],
  blockNumber: bigint,
  what: string,
): Promise<bigint[]> => {
  const results = await readMany(
    ctx,
    accounts.map(account => ({
      address: ovm,
      abi: ovmAbi,
      functionName: 'getPullBalance',
      args: [account],
    })),
    what,
    blockNumber,
  );
  return results.map(r => {
    if (!r.ok) throw ovmReadFailed(ovm, 'getPullBalance');
    return r.value as bigint;
  });
};

/** The sender for an authority check: `from`, else the wallet account. */
export const requireSender = (
  ctx: Context,
  from: Address | undefined,
  operation: string,
): Address => {
  const sender = senderOf(ctx, from);
  if (sender === null) {
    throw invalid(
      'from',
      `${operation} checks the sender's authority: pass from, or a walletClient with an account`,
    );
  }
  return checksum(sender);
};

/** Owner-only call: NOT_OVM_OWNER otherwise. */
export const requireOwner = (core: OvmCore, from: Address): void => {
  if (!sameAddress(core.owner, from)) {
    throw new ObolError(
      'NOT_OVM_OWNER',
      `${from} is not the owner of ${core.address} (owner: ${core.owner})`,
      {
        hint: 'Send from the owner',
        details: { from, owner: core.owner },
      },
    );
  }
};

/** Owner or holder of `role`: OVM_ROLE_MISSING otherwise. */
export const requireRole = (
  core: OvmCore,
  from: Address,
  role: OvmRoleName,
): void => {
  if (sameAddress(core.owner, from)) return;
  if (((core.roles ?? 0n) & OVM_ROLES[role]) !== 0n) return;
  throw new ObolError(
    'OVM_ROLE_MISSING',
    `${from} is neither the owner of ${core.address} nor holds ${role}; the call would revert`,
    {
      hint: 'Send from the owner or a role holder, or grant the role first (prepareGrantRoles)',
      details: { from, role },
    },
  );
};

/** The sender holds every bit of `roles` (renounceRoles): OVM_ROLE_MISSING otherwise. */
export const requireHeldRoles = (
  core: OvmCore,
  from: Address,
  roles: bigint,
): void => {
  const missing = roles & ~(core.roles ?? 0n);
  if (missing === 0n) return;
  const names = roleNames(missing);
  throw new ObolError(
    'OVM_ROLE_MISSING',
    `${from} does not hold ${names.join(', ')} on ${core.address}`,
    {
      hint: 'Renounce only roles the sender holds (ovm.getRoleHolders)',
      details: { from, role: names.join('|') },
    },
  );
};

/**
 * Provenance gate for OVM writes (spec "prepareWithdraw" 3): `notObol` →
 * OVM_NOT_OBOL; `unknown` → a PROVENANCE_UNKNOWN warning, returned.
 */
export const provenanceFindings = async (
  ctx: Context,
  ovm: Address,
): Promise<Finding[]> => {
  const { verification, unknownFinding } = await requireObolOvm(
    ctx,
    ovm,
    false,
  );
  if (!unknownFinding) return [];
  return [
    finding(
      'PROVENANCE_UNKNOWN',
      'warning',
      `Could not check that ${ovm} was created by the Obol OVM factory: ${verification.reason}`,
      {
        hint: 'Retry ovm.verify before relying on the contract',
        details: { address: ovm },
      },
    ),
  ];
};
