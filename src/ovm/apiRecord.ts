/**
 * The Obol API OVM record, `GET /v1/ovm/:network/:address` (design "API
 * enrichment"). Every field is checked before use and a malformed one is
 * dropped; money values shown by prepare* are always re-read on chain.
 */
import { getAddress, type Address, type Hash, type Hex } from 'viem';
import { requireApi, type Context } from '../context.js';
import { ObolError } from '../errors.js';
import { sameAddress } from '../schema.js';

export type OvmApiProvenanceStatus = 'obol' | 'notObol' | 'unknown';

export interface OvmApiProvenance {
  status: OvmApiProvenanceStatus;
  factoryAddress?: Address;
  creationTxHash?: Hash;
  creationBlock?: bigint;
  reason: string;
}

export interface OvmApiRoleHolder {
  address: Address;
  /** `rolesOf(address)` at the record's block (the SDK re-reads it on chain). */
  roles: bigint;
  roleNames: string[];
  isOwner: boolean;
}

export interface OvmApiSplit {
  address: Address;
  kind: 'principal' | 'reward';
  splitHash: Hex;
  recipients: Address[];
  allocations: bigint[];
  totalAllocation: bigint;
  distributionIncentive: number;
  source?: 'SplitUpdated' | 'SplitCreated';
}

/**
 * The fields of the API OVM record the SDK reads. Absent means the API did
 * not send the field, sent null, or sent something malformed.
 */
export interface OvmApiRecord {
  address?: Address;
  network?: string;
  blockNumber?: bigint;
  provenance?: OvmApiProvenance;
  owner?: Address;
  principalRecipient?: Address;
  rewardRecipient?: Address;
  /** wei */
  principalThreshold?: bigint;
  amountOfPrincipalStake?: bigint;
  fundsPendingWithdrawal?: bigint;
  balance?: bigint;
  /** null when the API read the state and the contract has no `version()`. */
  version?: string | null;
  pullBalances?: { principalRecipient: bigint; rewardRecipient: bigint };
  /** Owner first, then the other holders; absent if the API could not read the role events. */
  roles?: OvmApiRoleHolder[];
  /** PullSplit recipients whose params hash to their `splitHash()`. */
  splits?: OvmApiSplit[];
  /** Raw entries; `ovm.getValidators` parses them (a malformed entry is STATUS_UNAVAILABLE there). */
  validators?: unknown[];
  /** wei */
  principalOnBeaconChain?: bigint;
  /** What the API reports as partial or unavailable in this answer. */
  notes: string[];
}

type Raw = Record<string, unknown>;

const isObj = (value: unknown): value is Raw =>
  value !== null && typeof value === 'object' && !Array.isArray(value);

export const apiAddress = (value: unknown): Address | undefined =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value)
    ? getAddress(value.toLowerCase())
    : undefined;

/** A non-negative integer sent as a decimal string (or a safe JSON number). */
export const apiUint = (value: unknown): bigint | undefined => {
  if (typeof value === 'string' && /^\d+$/.test(value)) return BigInt(value);
  if (typeof value === 'number' && Number.isSafeInteger(value) && value >= 0) {
    return BigInt(value);
  }
  return undefined;
};

const hash32 = (value: unknown): Hex | undefined =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value)
    ? (value.toLowerCase() as Hex)
    : undefined;

const parseProvenance = (raw: unknown): OvmApiProvenance | undefined => {
  if (!isObj(raw)) return undefined;
  const status = raw.status;
  if (status !== 'obol' && status !== 'notObol' && status !== 'unknown') {
    return undefined;
  }
  const factoryAddress = apiAddress(raw.factoryAddress);
  const creationTxHash = hash32(raw.creationTxHash);
  const creationBlock = apiUint(raw.creationBlock);
  return {
    status,
    ...(factoryAddress !== undefined ? { factoryAddress } : {}),
    ...(creationTxHash !== undefined ? { creationTxHash } : {}),
    ...(creationBlock !== undefined ? { creationBlock } : {}),
    reason: typeof raw.reason === 'string' ? raw.reason : '',
  };
};

const parseRole = (raw: unknown): OvmApiRoleHolder | undefined => {
  if (!isObj(raw)) return undefined;
  const address = apiAddress(raw.address);
  const roles = apiUint(raw.roles);
  if (address === undefined || roles === undefined) return undefined;
  return {
    address,
    roles,
    roleNames: Array.isArray(raw.roleNames)
      ? raw.roleNames.filter((n): n is string => typeof n === 'string')
      : [],
    isOwner: raw.isOwner === true,
  };
};

const parseSplit = (raw: unknown): OvmApiSplit | undefined => {
  if (!isObj(raw)) return undefined;
  const address = apiAddress(raw.address);
  const splitHash = hash32(raw.splitHash);
  const totalAllocation = apiUint(raw.totalAllocation);
  const recipients = Array.isArray(raw.recipients)
    ? raw.recipients.map(apiAddress)
    : [];
  const allocations = Array.isArray(raw.allocations)
    ? raw.allocations.map(apiUint)
    : [];
  const incentive = raw.distributionIncentive;
  if (
    address === undefined ||
    (raw.kind !== 'principal' && raw.kind !== 'reward') ||
    splitHash === undefined ||
    totalAllocation === undefined ||
    !Array.isArray(raw.recipients) ||
    !Array.isArray(raw.allocations) ||
    recipients.length !== allocations.length ||
    recipients.some(r => r === undefined) ||
    allocations.some(a => a === undefined) ||
    typeof incentive !== 'number' ||
    !Number.isSafeInteger(incentive) ||
    incentive < 0
  ) {
    return undefined;
  }
  return {
    address,
    kind: raw.kind,
    splitHash,
    recipients: recipients as Address[],
    allocations: allocations as bigint[],
    totalAllocation,
    distributionIncentive: incentive,
    ...(raw.source === 'SplitUpdated' || raw.source === 'SplitCreated'
      ? { source: raw.source }
      : {}),
  };
};

/** A list of entries; one malformed entry drops the whole list (it is incomplete). */
const parseList = <V>(
  raw: unknown,
  parse: (item: unknown) => V | undefined,
): V[] | undefined => {
  if (!Array.isArray(raw)) return undefined;
  const items = raw.map(parse);
  return items.some(i => i === undefined) ? undefined : (items as V[]);
};

/** Checks and types an API OVM record; malformed fields are left out. */
export const parseOvmApiRecord = (raw: Raw): OvmApiRecord => {
  const record: OvmApiRecord = {
    notes: Array.isArray(raw.notes)
      ? raw.notes.filter((n): n is string => typeof n === 'string')
      : [],
  };
  const set = <K extends keyof OvmApiRecord>(
    key: K,
    value: OvmApiRecord[K] | undefined,
  ): void => {
    if (value !== undefined) record[key] = value;
  };
  set('address', apiAddress(raw.address));
  set('network', typeof raw.network === 'string' ? raw.network : undefined);
  set('blockNumber', apiUint(raw.blockNumber));
  set('provenance', parseProvenance(raw.provenance));
  set('owner', apiAddress(raw.owner));
  set('principalRecipient', apiAddress(raw.principalRecipient));
  set('rewardRecipient', apiAddress(raw.rewardRecipient));
  set('principalThreshold', apiUint(raw.principalThreshold));
  set('amountOfPrincipalStake', apiUint(raw.amountOfPrincipalStake));
  set('fundsPendingWithdrawal', apiUint(raw.fundsPendingWithdrawal));
  set('balance', apiUint(raw.balance));
  if (typeof raw.version === 'string' || raw.version === null) {
    record.version = raw.version;
  }
  if (isObj(raw.pullBalances)) {
    const principalRecipient = apiUint(raw.pullBalances.principalRecipient);
    const rewardRecipient = apiUint(raw.pullBalances.rewardRecipient);
    if (principalRecipient !== undefined && rewardRecipient !== undefined) {
      record.pullBalances = { principalRecipient, rewardRecipient };
    }
  }
  set('roles', parseList(raw.roles, parseRole));
  set('splits', parseList(raw.splits, parseSplit));
  set('validators', Array.isArray(raw.validators) ? raw.validators : undefined);
  set('principalOnBeaconChain', apiUint(raw.principalOnBeaconChain));
  return record;
};

/**
 * Fetches the API OVM record. API_DISABLED without the API; API_* for the
 * HTTP exchange (API_NOT_FOUND where the endpoint is not deployed); a record
 * for another address or network is API_RESPONSE_MISMATCH.
 */
export const fetchOvmApiRecord = async (
  ctx: Context,
  ovm: Address,
): Promise<OvmApiRecord> => {
  const api = requireApi(ctx, 'ovm');
  const raw = await api.request<unknown>(`/v1/ovm/${ctx.chain.network}/${ovm}`);
  if (!isObj(raw)) {
    throw new ObolError(
      'API_RESPONSE_MISMATCH',
      `The Obol API returned no OVM record for ${ovm}`,
      { hint: 'Report it; do not use the answer' },
    );
  }
  if (raw.address !== undefined && raw.address !== null) {
    const address = apiAddress(raw.address);
    if (address === undefined || !sameAddress(address, ovm)) {
      throw new ObolError(
        'API_RESPONSE_MISMATCH',
        `The Obol API returned the record of ${String(raw.address)} for ${ovm}`,
        { hint: 'Report it; do not use the answer' },
      );
    }
  }
  if (typeof raw.network === 'string' && raw.network !== ctx.chain.network) {
    throw new ObolError(
      'API_RESPONSE_MISMATCH',
      `The Obol API returned a ${raw.network} record for ${ovm} on ${ctx.chain.network}`,
      { hint: 'Report it; do not use the answer' },
    );
  }
  return parseOvmApiRecord(raw);
};
