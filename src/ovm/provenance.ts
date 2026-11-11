/**
 * ovm.getProvenance: was this address created by the chain's Obol OVM factory?
 * (spec/operations.md "ovm.getProvenance"). Never decided `obol` by a bytecode or
 * function-signature probe (missing OVM getters only prove `notObol`);
 * "could not check" is always `unknown`. An `obol` answer from the Obol API
 * is confirmed against the creation receipt; one that could not be
 * confirmed is marked `source: 'api'`, and `deposits.prepareDeposit` does
 * not accept it (`requireChain`).
 */
import { Type } from '@sinclair/typebox';
import type { Address, Hash } from 'viem';
import { createOvmEvent } from '../abi.js';
import {
  addressTopic,
  codeKind,
  latestBlockNumber,
  scanLogs,
} from '../chainUtils.js';
import { requireContracts, type Context } from '../context.js';
import { isObolError, ObolError } from '../errors.js';
import {
  checksum,
  decode,
  rejectUnknownKeys,
  sameAddress,
  T,
} from '../schema.js';
import type { Source } from '../types.js';
import { fetchOvmApiRecord, type OvmApiRecord } from './apiRecord.js';
import { readOvmCore } from './read.js';
import { encodeEventTopics } from 'viem';

export interface OvmProvenance {
  status: 'obol' | 'notObol' | 'unknown';
  /**
   * Where the verdict comes from. `chain`: read from the caller's RPC (for
   * `obol`: the factory's `CreateObolValidatorManager` log for this address,
   * found in the creation receipt or by scanning the factory's logs). `api`:
   * the Obol API said so and no chain read confirmed it (only possible for
   * `obol`, without `requireChain`): fine for display, not for moving funds.
   */
  source: Source;
  factoryAddress: Address;
  reason: string;
  creationTxHash?: Hash;
}

export interface OvmProvenanceOptions {
  /**
   * Accept `obol` only from the chain: when the Obol API says `obol` and its
   * creation transaction does not confirm it, scan the factory's logs
   * instead of returning the API's answer. `deposits.prepareDeposit` sets
   * it. Default false (the API's answer is returned as `source: 'api'`).
   */
  requireChain?: boolean;
}

interface ContractCreationRecord {
  contractAddress?: string;
  contractCreator?: string;
  contractFactory?: string;
}

interface ApiProvenance {
  status: 'obol' | 'notObol';
  reason: string;
  creationTxHash?: Hash;
}

/**
 * Step 2: the API OVM record's `provenance` when it is `obol`, for this
 * address and names this chain's factory (if it names one); `notObol` and
 * `unknown` defer to the chain. Without the endpoint (or on an API error),
 * the interim creation record, trusted only when its `contractAddress` is
 * this address. Anything else: undefined (steps 3 and 4).
 */
const provenanceFromApi = async (
  ctx: Context,
  ovm: Address,
  factoryAddress: Address,
): Promise<ApiProvenance | undefined> => {
  const api = ctx.api;
  if (api === null) return undefined;
  let record: OvmApiRecord | undefined;
  try {
    record = await fetchOvmApiRecord(ctx, ovm);
  } catch {
    // Not deployed yet (404) or unavailable: the interim record below.
  }
  if (record !== undefined) {
    const provenance = record.provenance;
    if (
      record.address === undefined ||
      !sameAddress(record.address, ovm) ||
      provenance === undefined ||
      // Only `obol` is taken from the record: its `notObol` can be stale (an
      // answer cached before the OVM was deployed or indexed), and step 1
      // already saw code here, so the chain decides.
      provenance.status !== 'obol' ||
      (provenance.factoryAddress !== undefined &&
        !sameAddress(provenance.factoryAddress, factoryAddress))
    ) {
      return undefined;
    }
    const defaultReason =
      provenance.status === 'obol'
        ? 'Created by the OVM factory'
        : 'Not created by the OVM factory';
    return {
      status: provenance.status,
      reason: provenance.reason !== '' ? provenance.reason : defaultReason,
      ...(provenance.status === 'obol' &&
      provenance.creationTxHash !== undefined
        ? { creationTxHash: provenance.creationTxHash }
        : {}),
    };
  }
  try {
    const creation = await api.request<ContractCreationRecord>(
      `/v1/eth/contract-creation/${ctx.chain.network}/${ovm}`,
    );
    if (
      typeof creation?.contractAddress !== 'string' ||
      !sameAddress(creation.contractAddress, ovm) ||
      typeof creation.contractFactory !== 'string' ||
      creation.contractFactory === ''
    ) {
      return undefined;
    }
    return sameAddress(creation.contractFactory, factoryAddress)
      ? { status: 'obol', reason: 'Created by the OVM factory' }
      : {
          status: 'notObol',
          reason: `Created by another factory (${creation.contractFactory})`,
        };
  } catch {
    // No record, or the API is unavailable: the factory logs.
    return undefined;
  }
};

const errorText = (error: unknown): string =>
  error instanceof Error ? error.message : String(error);

/**
 * Whether the receipt of `hash` holds the factory's
 * `CreateObolValidatorManager` log for `ovm` (emitted by the chain table's
 * factory, topic 1 = the OVM): one RPC request that proves on chain what the
 * API claims. `false` when the receipt has no such log; `undefined` when it
 * could not be read.
 */
const createdInTransaction = async (
  ctx: Context,
  ovm: Address,
  factoryAddress: Address,
  hash: Hash,
): Promise<boolean | undefined> => {
  const [topic0] = encodeEventTopics({
    abi: [createOvmEvent],
    eventName: 'CreateObolValidatorManager',
  });
  try {
    const receipt = await ctx.publicClient.getTransactionReceipt({ hash });
    return (
      receipt.status === 'success' &&
      receipt.logs.some(
        log =>
          sameAddress(log.address, factoryAddress) &&
          log.topics[0]?.toLowerCase() === topic0.toLowerCase() &&
          log.topics[1]?.toLowerCase() === addressTopic(ovm).toLowerCase(),
      )
    );
  } catch {
    return undefined;
  }
};

export const getOvmProvenance = async (
  ctx: Context,
  input: string,
  options: OvmProvenanceOptions = {},
): Promise<OvmProvenance> => {
  const ovm = checksum(decode(T.Address, input, 'ovm'));
  rejectUnknownKeys(options, ['requireChain'], 'options');
  const requireChain = options.requireChain === true;
  const { ovmFactory } = requireContracts(ctx.chain.id, 'ovm.getProvenance');
  const factoryAddress = ovmFactory.address;
  const result = (
    status: OvmProvenance['status'],
    source: Source,
    reason: string,
    creationTxHash?: Hash,
  ): OvmProvenance => ({
    status,
    source,
    factoryAddress,
    reason,
    ...(creationTxHash !== undefined ? { creationTxHash } : {}),
  });

  // 1. Code at the address.
  let kind;
  try {
    kind = codeKind(await ctx.publicClient.getCode({ address: ovm }));
  } catch (error) {
    return result(
      'unknown',
      'chain',
      `Could not read the code at the address: ${errorText(error)}`,
    );
  }
  if (kind === 'none') {
    return result('notObol', 'chain', 'No contract code at the address');
  }
  if (kind === 'delegated') {
    return result(
      'notObol',
      'chain',
      'The address is an EIP-7702 delegated account, not a contract',
    );
  }

  // 2. API: the OVM record's provenance, else the interim creation record.
  // An `obol` answer is confirmed on chain when the API names the creation
  // transaction: its receipt must hold the factory's log for this address.
  // Confirmed: `obol` / chain. Not confirmed (no hash, the receipt has no
  // such log or could not be read): the API's word alone, returned as
  // `source: 'api'`, unless `requireChain`, which goes on to the log scan.
  // A `notObol` from the interim record is the API's word too, and only
  // ever refuses; it is returned as it was.
  /** Step 2's answer; undefined when the chain decides (steps 3 and 4). */
  const byApi = async (): Promise<OvmProvenance | undefined> => {
    const fromApi = await provenanceFromApi(ctx, ovm, factoryAddress);
    if (fromApi === undefined) return undefined;
    if (fromApi.status !== 'obol') {
      return result(fromApi.status, 'api', fromApi.reason);
    }
    const confirmed =
      fromApi.creationTxHash !== undefined
        ? await createdInTransaction(
            ctx,
            ovm,
            factoryAddress,
            fromApi.creationTxHash,
          )
        : undefined;
    if (confirmed === true) {
      return result(
        'obol',
        'chain',
        'CreateObolValidatorManager event found in the creation transaction',
        fromApi.creationTxHash,
      );
    }
    // The API named a transaction that did not create this OVM: its answer
    // is wrong, so the chain decides (steps 3 and 4), also without
    // `requireChain`.
    if (confirmed !== false && !requireChain) {
      return result(
        'obol',
        'api',
        `${fromApi.reason} (the Obol API's answer; not confirmed on chain)`,
        fromApi.creationTxHash,
      );
    }
    return undefined;
  };
  const answered = await byApi();
  if (answered !== undefined) return answered;

  // 3. The OVM getters: a contract that does not answer them is not one the
  // factory created (it never proves `obol`). A failed read goes on to 4.
  try {
    await readOvmCore(ctx, ovm, { what: 'ovm.getProvenance' });
  } catch (error) {
    if (isObolError(error, 'OVM_READ_FAILED')) {
      return result(
        'notObol',
        'chain',
        'The contract does not answer the OVM getters',
      );
    }
  }

  // 4. Factory CreateObolValidatorManager logs with topic1 = ovm.
  try {
    const head = await latestBlockNumber(ctx.publicClient);
    const [topic0] = encodeEventTopics({
      abi: [createOvmEvent],
      eventName: 'CreateObolValidatorManager',
    });
    const logs = await scanLogs(
      ctx.publicClient,
      { address: factoryAddress, topics: [topic0, addressTopic(ovm)] },
      ovmFactory.deployBlock,
      head,
      true,
    );
    const created = logs.find(log => sameAddress(log.address, factoryAddress));
    return created !== undefined
      ? result(
          'obol',
          'chain',
          'CreateObolValidatorManager event found',
          created.transactionHash ?? undefined,
        )
      : result(
          'notObol',
          'chain',
          'No CreateObolValidatorManager event for this address',
        );
  } catch (error) {
    return result(
      'unknown',
      'chain',
      `Could not search the factory events: ${errorText(error)}`,
    );
  }
};

/**
 * Provenance as a gate (spec "prepareWithdraw" 3, "prepareDeposit" 2):
 * notObol → OVM_NOT_OBOL; unknown → error when `unknownIsError`, else a
 * PROVENANCE_UNKNOWN finding is returned for the caller to add.
 */
export const requireObolOvm = async (
  ctx: Context,
  ovm: Address,
  unknownIsError: boolean,
): Promise<{ provenance: OvmProvenance; unknownFinding: boolean }> => {
  // Where `unknown` is an error the principal is at stake (deposits), so
  // `obol` must come from the chain, not from the API's word.
  const provenance = await getOvmProvenance(ctx, ovm, {
    requireChain: unknownIsError,
  });
  if (provenance.status === 'notObol') {
    throw new ObolError(
      'OVM_NOT_OBOL',
      `${ovm} is not an OVM created by the Obol factory: ${provenance.reason}`,
      {
        hint: 'Check the address; never deposit to it',
        details: { address: ovm, source: provenance.source },
      },
    );
  }
  if (provenance.status === 'unknown' && unknownIsError) {
    throw new ObolError(
      'PROVENANCE_UNKNOWN',
      `Could not check that ${ovm} was created by the Obol factory: ${provenance.reason}`,
      {
        hint: 'Retry, or use an RPC that serves eth_getLogs over at least 1,000 blocks',
        details: { address: ovm },
      },
    );
  }
  return { provenance, unknownFinding: provenance.status === 'unknown' };
};

export const OvmAddressInput = Type.Object(
  { ovm: T.Address },
  { additionalProperties: false },
);
