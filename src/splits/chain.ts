/**
 * Chain helpers for the splits, setup and incentives modules: expected-code
 * checks for the factories, and Multicall3 reads pinned to one block.
 */
import {
  keccak256,
  type Address,
  type ContractFunctionParameters,
  type Hex,
} from 'viem';
import { chainReadFailed, latestBlockNumber } from '../chainUtils.js';
import type { Context } from '../context.js';
import { ObolError } from '../errors.js';

/**
 * keccak256 of the runtime code each factory must have (the same bytecodes
 * 2.x compared against, hashed).
 */
const OVM_FACTORY_CODE_HASHES: Record<number, Hex> = {
  1: '0xc920344e81c9c4e795da4bcf1a047199c199aa3c1d1aa877d10566dfac1e889a',
  560048: '0x243f729b247b2e45b41e4ddaabd3bada96415852c472b3c438b5af354475f8d1',
};

export const EXPECTED_CODE_HASHES = {
  pullSplitFactory:
    '0x955c8a47f44d281b6dc816d9f8deede5fa983b0ff7324c40558ecb6d2b5aa066',
  multicall3:
    '0xd5c15df687b16f2ff992fc8d767b4216323184a2bbc6ee2f9c398c318e770891',
  ovmFactory: OVM_FACTORY_CODE_HASHES,
} as const;

/**
 * Checks that `address` holds exactly the expected code (by hash), else
 * CONTRACT_NOT_AVAILABLE. A failed read is CHAIN_READ_FAILED.
 */
export const requireExpectedCode = async (
  ctx: Context,
  address: Address,
  expectedHash: Hex | undefined,
  what: string,
  blockNumber?: bigint,
): Promise<void> => {
  let code: Hex | undefined;
  try {
    code = await ctx.publicClient.getCode({
      address,
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    });
  } catch (cause) {
    throw chainReadFailed(`the code of the ${what}`, cause);
  }
  if (
    expectedHash === undefined ||
    code === undefined ||
    code === '0x' ||
    keccak256(code).toLowerCase() !== expectedHash.toLowerCase()
  ) {
    throw new ObolError(
      'CONTRACT_NOT_AVAILABLE',
      `The ${what} at ${address} does not have the expected code on this chain`,
      {
        hint: 'Check the chain; contact Obol if it persists',
        details: { address },
      },
    );
  }
};

/** The latest block number; CHAIN_READ_FAILED on error. */
export const headBlock = async (ctx: Context): Promise<bigint> => {
  try {
    return await latestBlockNumber(ctx.publicClient);
  } catch (cause) {
    throw chainReadFailed('the block number', cause);
  }
};

/**
 * Runs view calls in one Multicall3 `aggregate3` at `blockNumber`. A call
 * that reverts or cannot be decoded (e.g. a call to an address without code)
 * gives `undefined`; an RPC failure is CHAIN_READ_FAILED.
 */
export const readAll = async (
  ctx: Context,
  multicall3: Address,
  calls: ContractFunctionParameters[],
  blockNumber: bigint,
  what: string,
): Promise<unknown[]> => {
  if (calls.length === 0) return [];
  let results;
  try {
    results = await ctx.publicClient.multicall({
      contracts: calls,
      allowFailure: true,
      multicallAddress: multicall3,
      blockNumber,
      batchSize: 0,
    });
  } catch (cause) {
    throw chainReadFailed(what, cause);
  }
  return results.map(r => (r.status === 'success' ? r.result : undefined));
};
