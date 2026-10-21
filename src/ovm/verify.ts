/**
 * ovm.verify: was this address created by the chain's Obol OVM factory?
 * (spec/operations.md "ovm.verify"). Never decided by a bytecode or
 * function-signature probe; "could not check" is always `unknown`.
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
import { ObolError } from '../errors.js';
import { checksum, decode, sameAddress, T } from '../schema.js';
import type { Source } from '../types.js';
import { fetchOvmApiRecord, type OvmApiRecord } from './apiRecord.js';
import { encodeEventTopics } from 'viem';

export interface OvmVerification {
  status: 'obol' | 'notObol' | 'unknown';
  source: Source;
  factoryAddress: Address;
  reason: string;
  creationTxHash?: Hash;
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
 * Step 2: the API OVM record's `provenance`, trusted only when the record is
 * for this address and names this chain's factory (if it names one);
 * `unknown` defers to the chain. Without the endpoint (or on an API error),
 * the interim creation record, trusted only when its `contractAddress` is
 * this address. Anything else: undefined (step 3).
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
      provenance.status === 'unknown' ||
      (provenance.factoryAddress !== undefined &&
        !sameAddress(provenance.factoryAddress, factoryAddress))
    ) {
      return undefined;
    }
    return {
      status: provenance.status,
      reason:
        provenance.reason !== ''
          ? provenance.reason
          : provenance.status === 'obol'
            ? 'Created by the OVM factory'
            : 'Not created by the OVM factory',
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

export const verifyOvm = async (
  ctx: Context,
  input: string,
): Promise<OvmVerification> => {
  const ovm = checksum(decode(T.Address, input, 'ovm'));
  const { ovmFactory } = requireContracts(ctx.chain.id, 'ovm.verify');
  const factoryAddress = ovmFactory.address;
  const result = (
    status: OvmVerification['status'],
    source: Source,
    reason: string,
    creationTxHash?: Hash,
  ): OvmVerification => ({
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
  const fromApi = await provenanceFromApi(ctx, ovm, factoryAddress);
  if (fromApi !== undefined) {
    return result(
      fromApi.status,
      'api',
      fromApi.reason,
      fromApi.creationTxHash,
    );
  }

  // 3. Factory CreateObolValidatorManager logs with topic1 = ovm.
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
): Promise<{ verification: OvmVerification; unknownFinding: boolean }> => {
  const verification = await verifyOvm(ctx, ovm);
  if (verification.status === 'notObol') {
    throw new ObolError(
      'OVM_NOT_OBOL',
      `${ovm} is not an OVM created by the Obol factory: ${verification.reason}`,
      {
        hint: 'Check the address; never deposit to it',
        details: { address: ovm, source: verification.source },
      },
    );
  }
  if (verification.status === 'unknown' && unknownIsError) {
    throw new ObolError(
      'PROVENANCE_UNKNOWN',
      `Could not check that ${ovm} was created by the Obol factory: ${verification.reason}`,
      {
        hint: 'Retry, or use an RPC that serves eth_getLogs over 50,000 blocks',
        details: { address: ovm },
      },
    );
  }
  return { verification, unknownFinding: verification.status === 'unknown' };
};

export const OvmAddressInput = Type.Object({ ovm: T.Address });
