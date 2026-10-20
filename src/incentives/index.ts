/** incentives: Obol incentive claims from Merkle distributors (spec "incentives"). */
import { Type } from '@sinclair/typebox';
import { encodeFunctionData, type Address, type Hex } from 'viem';
import {
  chainReadFailed,
  codeKind,
  finding,
  latestBlockNumber,
  prepared,
} from '../chainUtils.js';
import { requireApi, requireContracts, type Context } from '../context.js';
import { isObolError, ObolApiError, ObolError } from '../errors.js';
import { checksum, decode, isAddressInput, sameAddress, T } from '../schema.js';
import type { Finding, Prepared } from '../types.js';
import { readAll } from '../splits/chain.js';
import {
  maskedDistributorCodeHash,
  merkleDistributorAbi,
  merkleLeaf,
  MERKLE_DISTRIBUTOR_RUNTIME,
  processProof,
} from './merkle.js';

export {
  maskedDistributorCodeHash,
  merkleDistributorAbi,
  merkleLeaf,
  MERKLE_DISTRIBUTOR_RUNTIME,
  processProof,
} from './merkle.js';

export interface Incentives {
  operatorAddress: Address;
  contractAddress: Address;
  index: number;
  /** OBOL base units. */
  amount: bigint;
  merkleProof: Hex[];
}

export interface PreflightResult {
  ok: boolean;
  /** Claim issues (severity `warning`); codes as spec/errors.md "Incentive claim issues". */
  issues: Finding[];
}

interface ApiIncentives {
  operator_address?: unknown;
  contract_address?: unknown;
  index?: unknown;
  amount?: unknown;
  merkle_proof?: unknown;
}

const issue = (code: string, message: string, hint: string): Finding =>
  finding(code, 'warning', message, { hint });

const endpoint = (ctx: Context, address: Address): string =>
  `/v1/address/incentives/${ctx.chain.network}/${address}`;

const isBytes32 = (value: unknown): value is Hex =>
  typeof value === 'string' && /^0x[0-9a-fA-F]{64}$/.test(value);

/**
 * Checks an API record: it is for `address`, and contract address, index,
 * amount and proof are well-formed. Returns the issues, and the record when
 * there are none.
 */
const checkRecord = (
  raw: ApiIncentives,
  address: Address,
): { issues: Finding[]; data?: Incentives } => {
  const issues: Finding[] = [];
  const malformed = (field: string): Finding =>
    issue(
      'INVALID_INCENTIVES_DATA',
      `Incentives data from the API has an invalid ${field}`,
      'Do not claim; report the address to Obol so the incentives data can be checked',
    );
  const {
    operator_address: operator,
    contract_address: contract,
    index,
    amount,
  } = raw;
  const proof = raw.merkle_proof;
  if (
    typeof operator !== 'string' ||
    !isAddressInput(operator) ||
    !sameAddress(operator, address)
  ) {
    issues.push(
      issue(
        'OPERATOR_ADDRESS_MISMATCH',
        `Incentives data is for ${String(operator)}, not the requested address ${address}`,
        'Do not claim; request incentives for the address you intend to claim for',
      ),
    );
  }
  if (typeof contract !== 'string' || !isAddressInput(contract)) {
    issues.push(malformed('contract_address'));
  }
  if (typeof index !== 'number' || !Number.isSafeInteger(index) || index < 0) {
    issues.push(malformed('index'));
  }
  if (typeof amount !== 'string' || !/^[0-9]+$/.test(amount)) {
    issues.push(malformed('amount'));
  }
  if (!Array.isArray(proof) || !proof.every(isBytes32)) {
    issues.push(malformed('merkle_proof'));
  }
  if (issues.length > 0) return { issues };
  return {
    issues,
    data: {
      operatorAddress: checksum(operator as string),
      contractAddress: checksum(contract as string),
      index: index as number,
      amount: BigInt(amount as string),
      merkleProof: (proof as Hex[]).map(p => p.toLowerCase() as Hex),
    },
  };
};

const hasIncentives = (raw: ApiIncentives | undefined): boolean =>
  typeof raw?.contract_address === 'string' && raw.contract_address !== '';

/**
 * The claimable incentives of `address` from the Obol API
 * (`GET /v1/address/incentives/:network/:address`), or null when it has none
 * (`contract_address: ""`). A record for another address is
 * API_RESPONSE_MISMATCH; a malformed one is API_ERROR.
 */
export const getIncentives = async (
  ctx: Context,
  input: Address,
): Promise<Incentives | null> => {
  const api = requireApi(ctx, 'incentives.get');
  const address = checksum(decode(T.Address, input, 'address'));
  const path = endpoint(ctx, address);
  const raw = await api.request<ApiIncentives>(path);
  if (!hasIncentives(raw)) return null;
  const { issues, data } = checkRecord(raw, address);
  if (data === undefined) {
    const http = { status: 200, endpoint: path, method: 'GET', body: raw };
    if (issues.some(i => i.code === 'OPERATOR_ADDRESS_MISMATCH')) {
      throw new ObolApiError(
        'API_RESPONSE_MISMATCH',
        `The incentives record is not for ${address}`,
        http,
        { hint: 'Report it; do not use the answer' },
      );
    }
    throw new ObolApiError(
      'API_ERROR',
      'The incentives record is malformed',
      http,
      {
        hint: 'Retry later; report it if it persists',
      },
    );
  }
  return data;
};

const IsClaimedInput = Type.Object({
  contractAddress: T.Address,
  index: T.Uint,
});

/** `isClaimed(index)` on a Merkle distributor; CHAIN_READ_FAILED if the call fails. */
export const isClaimed = async (
  ctx: Context,
  input: { contractAddress: Address; index: number },
): Promise<boolean> => {
  const d = decode(IsClaimedInput, input);
  requireContracts(ctx.chain.id, 'incentives.isClaimed');
  try {
    return await ctx.publicClient.readContract({
      address: checksum(d.contractAddress),
      abi: merkleDistributorAbi,
      functionName: 'isClaimed',
      args: [BigInt(d.index)],
    });
  } catch (cause) {
    throw chainReadFailed('isClaimed', cause);
  }
};

const readFailed = (what: string): Finding =>
  issue(
    'CHAIN_READ_FAILED',
    `Could not read ${what} from the chain`,
    'Retry, or use another RPC',
  );

/** Runs the claim checks; `data` and `blockNumber` are set when the chain was read. */
const runChecks = async (
  ctx: Context,
  input: Address,
  operation: string,
): Promise<{ issues: Finding[]; data?: Incentives; blockNumber?: bigint }> => {
  const api = requireApi(ctx, operation);
  const address = checksum(decode(T.Address, input, 'address'));
  const { obolToken, multicall3 } = requireContracts(ctx.chain.id, operation);

  // 1. API record.
  let raw: ApiIncentives;
  try {
    raw = await api.request<ApiIncentives>(endpoint(ctx, address));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      issues: [
        isObolError(error, 'API_NOT_FOUND')
          ? issue(
              'INCENTIVES_NOT_FOUND',
              `No incentives found for ${address}: ${message}`,
              'Check the address and the client chain',
            )
          : issue(
              'INCENTIVES_FETCH_FAILED',
              `Could not fetch incentives for ${address}: ${message}`,
              'Retry later; the Obol API or the network may be unavailable',
            ),
      ],
    };
  }
  if (!hasIncentives(raw)) {
    return {
      issues: [
        issue(
          'NO_INCENTIVES',
          `No incentives found for address ${address}`,
          'Check the address and the client chain; nothing to claim otherwise',
        ),
      ],
    };
  }

  // 2. The record is for this address and well-formed.
  const { issues, data } = checkRecord(raw, address);
  if (data === undefined) return { issues };

  // 3. The distributor is the reference build.
  let code: Hex | undefined;
  try {
    code = await ctx.publicClient.getCode({ address: data.contractAddress });
  } catch {
    return { issues: [readFailed('the distributor code')], data };
  }
  if (code === undefined || codeKind(code) !== 'contract') {
    return {
      issues: [
        issue(
          'CONTRACT_NOT_DEPLOYED',
          `Merkle distributor contract is not available at ${data.contractAddress}`,
          'Check that the client chain matches the network of the incentives',
        ),
      ],
      data,
    };
  }
  if (maskedDistributorCodeHash(code) !== MERKLE_DISTRIBUTOR_RUNTIME.codeHash) {
    return {
      issues: [
        issue(
          'UNKNOWN_DISTRIBUTOR',
          `Contract at ${data.contractAddress} is not a recognised Obol Merkle distributor`,
          'Do not claim; report the contract address to Obol',
        ),
      ],
      data,
    };
  }

  // 4–6. Token, proof, claimed and deadline, read at one block.
  let blockNumber: bigint;
  let reads: unknown[];
  try {
    blockNumber = await latestBlockNumber(ctx.publicClient);
    const target = {
      address: data.contractAddress,
      abi: merkleDistributorAbi,
    } as const;
    reads = await readAll(
      ctx,
      multicall3,
      [
        { ...target, functionName: 'token' },
        { ...target, functionName: 'merkleRoot' },
        { ...target, functionName: 'endTime' },
        { ...target, functionName: 'isClaimed', args: [BigInt(data.index)] },
      ],
      blockNumber,
      'the distributor state',
    );
  } catch {
    return { issues: [readFailed('the distributor state')], data };
  }
  const [token, root, endTime, claimed] = reads;
  if (reads.some(r => r === undefined)) {
    return { issues: [readFailed('the distributor state')], data, blockNumber };
  }
  if (!sameAddress(token as string, obolToken)) {
    issues.push(
      issue(
        'UNEXPECTED_TOKEN',
        `Distributor pays out ${String(token)}, not the OBOL token ${obolToken}`,
        'Do not claim; report the contract address to Obol',
      ),
    );
  }
  const folded = processProof(
    merkleLeaf(BigInt(data.index), data.operatorAddress, data.amount),
    data.merkleProof,
  );
  if (folded.toLowerCase() !== (root as string).toLowerCase()) {
    issues.push(
      issue(
        'INVALID_PROOF',
        'The Merkle proof does not match the distributor root for this index, account and amount',
        'Do not claim; the incentives data may be stale. Fetch it again or contact Obol',
      ),
    );
  }
  if (claimed === true) {
    issues.push(
      issue(
        'ALREADY_CLAIMED',
        `Incentives at index ${data.index} have already been claimed`,
        'Nothing to do',
      ),
    );
  }
  try {
    const block = await ctx.publicClient.getBlock({ blockNumber });
    if (block.timestamp > (endTime as bigint)) {
      issues.push(
        issue(
          'CLAIM_WINDOW_CLOSED',
          `The claim window of ${data.contractAddress} ended at ${String(endTime)} (unix time)`,
          'Unclaimed incentives can no longer be claimed from this distributor',
        ),
      );
    }
  } catch {
    issues.push(readFailed('the latest block'));
  }
  return { issues, data, blockNumber };
};

/**
 * The claim checks of `prepareClaim` without throwing: the API record exists,
 * is for `address` and well-formed; the distributor has the reference code
 * (immutables and metadata zeroed); it pays the chain's OBOL token; the proof
 * folds to `merkleRoot()`; the index is not claimed; the window is open.
 */
export const preflight = async (
  ctx: Context,
  address: Address,
): Promise<PreflightResult> => {
  const { issues } = await runChecks(ctx, address, 'incentives.preflight');
  return { ok: issues.length === 0, issues };
};

/**
 * Builds `claim(index, account, amount, merkleProof)` after the `preflight`
 * checks. Only ALREADY_CLAIMED (possibly with CLAIM_WINDOW_CLOSED) throws
 * ALREADY_CLAIMED (nothing to do); any other issue throws
 * INCENTIVES_PREFLIGHT_FAILED with `issues`.
 */
export const prepareClaim = async (
  ctx: Context,
  address: Address,
): Promise<Prepared<{ amount: bigint; contractAddress: Address }>> => {
  const { issues, data, blockNumber } = await runChecks(
    ctx,
    address,
    'incentives.prepareClaim',
  );
  const blocking = issues.filter(
    i => i.code !== 'ALREADY_CLAIMED' && i.code !== 'CLAIM_WINDOW_CLOSED',
  );
  const alreadyClaimed = issues.some(i => i.code === 'ALREADY_CLAIMED');
  if (alreadyClaimed && blocking.length === 0) {
    throw new ObolError(
      'ALREADY_CLAIMED',
      `The incentives of ${address} were already claimed`,
      {
        hint: 'Nothing to do; treat as success',
        details: { index: data?.index },
      },
    );
  }
  if (issues.length > 0 || data === undefined) {
    throw new ObolError(
      'INCENTIVES_PREFLIGHT_FAILED',
      `Incentives claim checks failed: ${issues.map(i => `[${i.code}] ${i.message}`).join('; ')}`,
      { hint: issues[0]?.hint, details: { issues } },
    );
  }
  return prepared(ctx, {
    to: data.contractAddress,
    data: encodeFunctionData({
      abi: merkleDistributorAbi,
      functionName: 'claim',
      args: [
        BigInt(data.index),
        data.operatorAddress,
        data.amount,
        data.merkleProof,
      ],
    }),
    preview: { amount: data.amount, contractAddress: data.contractAddress },
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });
};

/** The incentives module bound to a client context. */
export interface IncentivesModule {
  get: (address: Address) => Promise<Incentives | null>;
  isClaimed: (input: {
    contractAddress: Address;
    index: number;
  }) => Promise<boolean>;
  preflight: (address: Address) => Promise<PreflightResult>;
  prepareClaim: (
    address: Address,
  ) => Promise<Prepared<{ amount: bigint; contractAddress: Address }>>;
}

export const createIncentivesModule = (ctx: Context): IncentivesModule => ({
  get: async address => await getIncentives(ctx, address),
  isClaimed: async input => await isClaimed(ctx, input),
  preflight: async address => await preflight(ctx, address),
  prepareClaim: async address => await prepareClaim(ctx, address),
});
