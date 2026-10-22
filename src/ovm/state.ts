/**
 * OVM reads: ovm.getState, ovm.getRoleHolders, ovm.getValidators
 * (spec/operations.md "ovm"). Money values always come from the chain.
 */
import { encodeEventTopics, getAddress, type Address, type Hex } from 'viem';
import { ovmAbi, rolesUpdatedEvent } from '../abi.js';
import { publicForwarder, requireContracts } from '../chains.js';
import {
  finding,
  latestBlockNumber,
  LOG_CHUNK_SIZE,
  scanLogs,
} from '../chainUtils.js';
import { requireApi, type Context } from '../context.js';
import { isObolError, ObolError } from '../errors.js';
import { checksum, decode, sameAddress, T } from '../schema.js';
import type { Finding, Source } from '../types.js';
import { ETH } from '../units.js';
import {
  statusFromBeacon,
  type DepositStatusName,
} from '../deposits/status.js';
import { fetchOvmApiRecord, type OvmApiRecord } from './apiRecord.js';
import { readMany, type ReadCall } from '../multicall.js';
import { ovmReadFailed, readOvmCore } from './read.js';
import { ovmRouting, roleNames, type OvmRoleName } from './routing.js';

export type {
  OvmApiProvenance,
  OvmApiProvenanceStatus,
  OvmApiRecord,
  OvmApiRoleHolder,
  OvmApiSplit,
} from './apiRecord.js';

const weiString = (value: unknown): bigint | undefined =>
  typeof value === 'string' && /^\d+$/.test(value) ? BigInt(value) : undefined;

/* ------------------------------------------------------------------------ */
/* Public forwarders                                                         */
/* ------------------------------------------------------------------------ */

/**
 * PUBLIC_FORWARDER_HOLDS_ROLE (warning) when the owner or a role holder is
 * one of the chain's public forwarders (Multicall3 and the like): anyone can
 * call the role-gated functions through it.
 */
export const publicForwarderFindings = (
  chainId: number,
  holders: ReadonlyArray<{ address: Address; roles: bigint; isOwner: boolean }>,
): Finding[] => {
  const exposed = holders.flatMap(h => {
    const forwarder = publicForwarder(chainId, h.address);
    if (forwarder === undefined || (!h.isOwner && h.roles === 0n)) return [];
    return [{ ...h, name: forwarder.name, roleNames: roleNames(h.roles) }];
  });
  if (exposed.length === 0) return [];
  const describe = (h: (typeof exposed)[number]): string =>
    `${h.name} ${h.address} (${[
      ...(h.isOwner ? ['owner'] : []),
      ...h.roleNames,
    ].join(', ')})`;
  return [
    finding(
      'PUBLIC_FORWARDER_HOLDS_ROLE',
      'warning',
      `${exposed.map(describe).join('; ')}: anyone can call the role-gated functions through it`,
      {
        hint: 'Revoke the roles (or transfer ownership) from the forwarder now',
        ...(exposed.length === 1
          ? { subject: { address: exposed[0].address } }
          : {}),
        details: {
          holders: exposed.map(h => ({
            address: h.address,
            name: h.name,
            roles: h.roles,
            roleNames: h.roleNames,
            isOwner: h.isOwner,
          })),
        },
      },
    ),
  ];
};

/* ------------------------------------------------------------------------ */
/* getState                                                                  */
/* ------------------------------------------------------------------------ */

export interface OvmState {
  address: Address;
  blockNumber: bigint;
  owner: Address;
  principalRecipient: Address;
  rewardRecipient: Address;
  amountOfPrincipalStake: bigint;
  fundsPendingWithdrawal: bigint;
  /** wei */
  principalThreshold: bigint;
  version: string | null;
  balance: bigint;
  pullBalances: { principalRecipient: bigint; rewardRecipient: bigint };
  /** What distributeFunds() would pay now. */
  distributable: bigint;
  principalPayout: bigint;
  rewardPayout: bigint;
  /**
   * ETH the beacon chain credited to this OVM's validators minus principal
   * paid out (wei), from the Obol API. `null` when the API was asked and had
   * no value (or failed); absent with `api: false`.
   */
  principalOnBeaconChain?: bigint | null;
  findings: Finding[];
  /** `api` when the API supplied `principalOnBeaconChain`; every other value is read on chain. */
  source: Source;
}

const MISMATCH_TOLERANCE = ETH;

/**
 * ovm.getState (`api+chain`): null when the address is not an OVM (no code,
 * or the OVM getters revert); it checks the shape of the contract, never
 * its origin: a look-alike passes, so provenance is only `ovm.verify`. A
 * failed read throws (CHAIN_READ_FAILED). Otherwise the OVM getters, balance
 * and block number in
 * one Multicall3 read, the recipients' pull balances (and the chain's public
 * forwarders' `rolesOf`) at that block, and the routing `distributeFunds()`
 * would apply now. PUBLIC_FORWARDER_HOLDS_ROLE when a public forwarder is
 * the owner or holds a role. With the API, compares
 * `amountOfPrincipalStake` with the API's `principalOnBeaconChain` and adds
 * `PRINCIPAL_STAKE_MISMATCH` when they differ by more than 1 ETH.
 */
export const getOvmState = async (
  ctx: Context,
  input: string,
): Promise<OvmState | null> => {
  const ovm = checksum(decode(T.Address, input, 'ovm'));
  const { publicForwarders } = requireContracts(ctx.chain.id, 'ovm.getState');
  let core;
  try {
    core = await readOvmCore(ctx, ovm);
  } catch (error) {
    // The batch was read and the getters reverted: not an OVM.
    if (isObolError(error, 'OVM_READ_FAILED')) return null;
    throw error;
  }
  // Pull balances and the public forwarders' roles in one read at that block.
  const read = (functionName: string, account: Address): ReadCall => ({
    address: ovm,
    abi: ovmAbi,
    functionName,
    args: [account],
  });
  const results = await readMany(
    ctx,
    [
      read('getPullBalance', core.principalRecipient),
      read('getPullBalance', core.rewardRecipient),
      ...publicForwarders.map(f => read('rolesOf', f.address)),
    ],
    'ovm.getState',
    core.blockNumber,
  );
  const [principalPull, rewardPull] = results.slice(0, 2).map(r => {
    if (!r.ok) throw ovmReadFailed(ovm, 'getPullBalance');
    return r.value as bigint;
  });
  const routing = ovmRouting(core);

  let principalOnBeaconChain: bigint | null | undefined;
  if (ctx.api !== null) {
    try {
      principalOnBeaconChain =
        (await fetchOvmApiRecord(ctx, ovm)).principalOnBeaconChain ?? null;
    } catch {
      // Display enrichment only: asked, no answer.
      principalOnBeaconChain = null;
    }
  }
  const findings: Finding[] = publicForwarderFindings(
    ctx.chain.id,
    publicForwarders.map((f, i) => {
      const r = results[i + 2];
      return {
        address: f.address,
        roles: r.ok ? (r.value as bigint) : 0n,
        isOwner: sameAddress(f.address, core.owner),
      };
    }),
  );
  if (typeof principalOnBeaconChain === 'bigint') {
    const diff = core.amountOfPrincipalStake - principalOnBeaconChain;
    if (diff > MISMATCH_TOLERANCE || -diff > MISMATCH_TOLERANCE) {
      findings.push(
        finding(
          'PRINCIPAL_STAKE_MISMATCH',
          'warning',
          `amountOfPrincipalStake (${core.amountOfPrincipalStake} wei) differs by more than 1 ETH from the principal the beacon chain credited to this OVM's validators (${principalOnBeaconChain} wei)`,
          {
            hint: 'Review deposits made via OVM.deposit; the owner can correct it with prepareSetAmountOfPrincipalStake',
            subject: { address: ovm },
            details: {
              amountOfPrincipalStake: core.amountOfPrincipalStake,
              principalOnBeaconChain,
            },
          },
        ),
      );
    }
  }

  return {
    address: ovm,
    blockNumber: core.blockNumber,
    owner: core.owner,
    principalRecipient: core.principalRecipient,
    rewardRecipient: core.rewardRecipient,
    amountOfPrincipalStake: core.amountOfPrincipalStake,
    fundsPendingWithdrawal: core.fundsPendingWithdrawal,
    principalThreshold: core.principalThreshold,
    version: core.version,
    balance: core.balance,
    pullBalances: {
      principalRecipient: principalPull,
      rewardRecipient: rewardPull,
    },
    ...routing,
    ...(principalOnBeaconChain !== undefined ? { principalOnBeaconChain } : {}),
    findings,
    source: typeof principalOnBeaconChain === 'bigint' ? 'api' : 'chain',
  };
};

/* ------------------------------------------------------------------------ */
/* getRoleHolders                                                            */
/* ------------------------------------------------------------------------ */

export interface OvmRoleHolder {
  address: Address;
  roles: bigint;
  roleNames: OvmRoleName[];
  isOwner: boolean;
}

export interface OvmRoleHolders {
  owner: Address;
  holders: OvmRoleHolder[];
  source: Source;
  blockNumber: bigint;
  /** PUBLIC_FORWARDER_HOLDS_ROLE when the owner or a holder is a public forwarder. */
  findings: Finding[];
}

/** obol-api `GET /v1/eth/logs/:network` (Etherscan proxy). */
interface EthLogsResponse {
  status?: unknown;
  logs?: unknown;
  truncated?: unknown;
}

const [ROLES_UPDATED_TOPIC] = encodeEventTopics({
  abi: [rolesUpdatedEvent],
  eventName: 'RolesUpdated',
});

/**
 * ovm.getRoleHolders (`api+chain`): candidates from the API OVM record's
 * `roles`, else the OVM's `RolesUpdated` events (the API's log index), plus
 * an RPC scan of the last 50,000 blocks; a full chunked RPC scan when the API
 * has no complete answer. The chain's public forwarders are always
 * candidates. Then
 * `owner()` and `rolesOf` of each candidate in one Multicall3 read. The
 * owner is always first; other candidates without roles are dropped. Roles
 * come from `rolesOf`, never from the events. OVM_ROLE_EVENTS_UNAVAILABLE
 * if no source served the events; OVM_READ_FAILED if `owner()` fails.
 * `findings`: PUBLIC_FORWARDER_HOLDS_ROLE when the owner or a holder is a
 * public forwarder.
 */
export const getOvmRoleHolders = async (
  ctx: Context,
  input: string,
): Promise<OvmRoleHolders> => {
  const ovm = checksum(decode(T.Address, input, 'ovm'));
  const { ovmFactory, publicForwarders } = requireContracts(
    ctx.chain.id,
    'ovm.getRoleHolders',
  );
  const deployBlock = ovmFactory.deployBlock;
  const head = await latestBlockNumber(ctx.publicClient);

  const candidates = new Map<string, Address>();
  const addFromLogs = (logs: unknown[]): void => {
    for (const raw of logs) {
      const log = raw as { address?: unknown; topics?: unknown } | null;
      const topics = Array.isArray(log?.topics) ? log.topics : [];
      const user = topics[1];
      if (
        typeof log?.address === 'string' &&
        sameAddress(log.address, ovm) &&
        typeof topics[0] === 'string' &&
        topics[0].toLowerCase() === ROLES_UPDATED_TOPIC &&
        typeof user === 'string' &&
        /^0x[0-9a-fA-F]{64}$/.test(user)
      ) {
        const address = getAddress(`0x${user.slice(-40)}`);
        candidates.set(address.toLowerCase(), address);
      }
    }
  };
  const filter = { address: ovm, topics: [ROLES_UPDATED_TOPIC] };

  let source: Source = 'chain';
  if (ctx.api !== null) {
    // The API OVM record lists the holders it found; its roles are re-read.
    let record: OvmApiRecord | undefined;
    try {
      record = await fetchOvmApiRecord(ctx, ovm);
    } catch {
      // Not deployed or unavailable: the interim log index below.
    }
    if (record?.roles !== undefined) {
      for (const { address } of record.roles) {
        candidates.set(address.toLowerCase(), address);
      }
      source = 'api';
    }
  }
  if (ctx.api !== null && source === 'chain') {
    try {
      const response = await ctx.api.request<EthLogsResponse>(
        `/v1/eth/logs/${ctx.chain.network}?address=${ovm}&topic0=${ROLES_UPDATED_TOPIC}&fromBlock=${deployBlock}`,
      );
      // status "0" ("no records") is not conclusive, and a truncated list is
      // incomplete: both fall back to the full RPC scan.
      if (
        response?.status === '1' &&
        Array.isArray(response.logs) &&
        response.truncated !== true
      ) {
        addFromLogs(response.logs);
        source = 'api';
      }
    } catch {
      // API unavailable: full RPC scan below.
    }
  }
  if (source === 'api') {
    const recent = head - LOG_CHUNK_SIZE + 1n;
    try {
      addFromLogs(
        await scanLogs(
          ctx.publicClient,
          filter,
          recent > deployBlock ? recent : deployBlock,
          head,
        ),
      );
    } catch {
      // Recent blocks only add events the API has not indexed yet.
    }
  } else {
    try {
      addFromLogs(await scanLogs(ctx.publicClient, filter, deployBlock, head));
    } catch (cause) {
      throw new ObolError(
        'OVM_ROLE_EVENTS_UNAVAILABLE',
        `Could not read the RolesUpdated events of ${ovm}`,
        {
          hint: 'Retry later, or use an RPC that serves eth_getLogs over at least 1,000 blocks',
          cause,
          details: { address: ovm },
        },
      );
    }
  }

  // The public forwarders are always checked, whatever the event sources saw.
  for (const { address } of publicForwarders) {
    candidates.set(address.toLowerCase(), address);
  }
  const accounts = [...candidates.values()];
  const calls: ReadCall[] = [
    { address: ovm, abi: ovmAbi, functionName: 'owner' },
    ...accounts.map(account => ({
      address: ovm,
      abi: ovmAbi,
      functionName: 'rolesOf',
      args: [account],
    })),
  ];
  const results = await readMany(ctx, calls, 'ovm.getRoleHolders', head);
  if (!results[0].ok) throw ovmReadFailed(ovm, 'owner()');
  const owner = checksum(results[0].value as string);
  const rolesAt = (i: number): bigint => {
    const result = results[i + 1];
    if (!result.ok) throw ovmReadFailed(ovm, 'rolesOf');
    return result.value as bigint;
  };
  const holder = (address: Address, roles: bigint): OvmRoleHolder => ({
    address,
    roles,
    roleNames: roleNames(roles),
    isOwner: sameAddress(address, owner),
  });
  const ownerIndex = accounts.findIndex(a => sameAddress(a, owner));
  const holders: OvmRoleHolder[] = [
    holder(owner, ownerIndex >= 0 ? rolesAt(ownerIndex) : 0n),
  ];
  accounts.forEach((account, i) => {
    if (i === ownerIndex) return;
    const roles = rolesAt(i);
    if (roles !== 0n) holders.push(holder(account, roles));
  });
  return {
    owner,
    holders,
    source,
    blockNumber: head,
    findings: publicForwarderFindings(ctx.chain.id, holders),
  };
};

/* ------------------------------------------------------------------------ */
/* getValidators                                                             */
/* ------------------------------------------------------------------------ */

export interface OvmValidator {
  pubkey: Hex;
  /** The lock it belongs to; null when the API knows no lock for it. */
  lockHash: Hex | null;
  status: DepositStatusName;
  /** The raw beacon status; null for `new` (in a lock, no deposit seen). */
  beaconStatus: string | null;
  /** wei; null when the API has no balance for it. */
  balance: bigint | null;
  withdrawalCredentials: Hex;
}

export interface OvmValidators {
  validators: OvmValidator[];
  /** The block the API record was read at; null when the API does not say. */
  blockNumber: bigint | null;
}

const statusUnavailable = (message: string): ObolError =>
  new ObolError('STATUS_UNAVAILABLE', message, {
    hint: 'Retry; do not assume the validators are new',
  });

const parseValidator = (raw: unknown, index: number): OvmValidator => {
  const v = (raw ?? {}) as Record<string, unknown>;
  const pubkey = typeof v.pubkey === 'string' ? v.pubkey.toLowerCase() : '';
  const credentials =
    typeof v.withdrawalCredentials === 'string'
      ? v.withdrawalCredentials.toLowerCase()
      : '';
  const beaconStatus =
    typeof v.beaconStatus === 'string' ? v.beaconStatus : undefined;
  const status =
    beaconStatus !== undefined
      ? statusFromBeacon(beaconStatus)
      : v.status === 'new' ||
          v.status === 'queued' ||
          v.status === 'active' ||
          v.status === 'exited'
        ? v.status
        : null;
  const lockHash =
    typeof v.lockHash === 'string' ? v.lockHash.toLowerCase() : undefined;
  const balance = weiString(v.balance);
  if (
    !/^0x[0-9a-f]{96}$/.test(pubkey) ||
    !/^0x[0-9a-f]{64}$/.test(credentials) ||
    status === null ||
    (lockHash !== undefined && !/^0x[0-9a-f]{64}$/.test(lockHash)) ||
    (v.balance !== undefined && v.balance !== null && balance === undefined)
  ) {
    throw statusUnavailable(
      `The Obol API returned a malformed validator at index ${index}`,
    );
  }
  return {
    pubkey: pubkey as Hex,
    lockHash: (lockHash ?? null) as Hex | null,
    status,
    beaconStatus: beaconStatus ?? null,
    balance: balance ?? null,
    withdrawalCredentials: credentials as Hex,
  };
};

/**
 * ovm.getValidators (`api`): every validator, in any cluster, whose
 * credentials (or queued deposit's credentials) point at the OVM, from the
 * Obol API OVM endpoint. API_DISABLED with `api: false`; a malformed answer
 * is STATUS_UNAVAILABLE.
 */
export const getOvmValidators = async (
  ctx: Context,
  input: string,
): Promise<OvmValidators> => {
  const ovm = checksum(decode(T.Address, input, 'ovm'));
  requireApi(ctx, 'ovm.getValidators');
  requireContracts(ctx.chain.id, 'ovm.getValidators');
  const record = await fetchOvmApiRecord(ctx, ovm);
  if (record.validators === undefined) {
    throw statusUnavailable('The Obol API OVM record has no validators list');
  }
  const validators = record.validators.map(parseValidator);
  return { validators, blockNumber: record.blockNumber ?? null };
};
