/**
 * One Multicall3 `aggregate3` read, so that every value comes from the same
 * block. Used by the OVM, deposit and withdrawal operations.
 */
import {
  decodeFunctionResult,
  encodeFunctionData,
  type Abi,
  type Address,
  type Hex,
} from 'viem';
import { multicall3Abi } from '../abi.js';
import { chainReadFailed } from '../chainUtils.js';
import type { Context } from '../context.js';
import { requireContracts } from '../chains.js';

export interface ReadCall {
  address: Address;
  abi: Abi;
  functionName: string;
  args?: readonly unknown[];
}

/** One result per call; `ok: false` when the call reverted or did not decode. */
export type ReadResult = { ok: true; value: unknown } | { ok: false };

/** A call to Multicall3 itself: the ETH balance of `address`. */
export const ethBalanceCall = (
  multicall3: Address,
  address: Address,
): ReadCall => ({
  address: multicall3,
  abi: multicall3Abi,
  functionName: 'getEthBalance',
  args: [address],
});

/** A call to Multicall3 itself: the block the batch is executed at. */
export const blockNumberCall = (multicall3: Address): ReadCall => ({
  address: multicall3,
  abi: multicall3Abi,
  functionName: 'getBlockNumber',
});

/**
 * Runs `calls` in one `aggregate3` eth_call (every call with
 * `allowFailure: true`). A failing RPC request throws CHAIN_READ_FAILED; a
 * single reverting call only marks its own result `ok: false`.
 */
export const readMany = async (
  ctx: Context,
  calls: ReadCall[],
  what: string,
  blockNumber?: bigint,
): Promise<ReadResult[]> => {
  const { multicall3 } = requireContracts(ctx.chain.id, what);
  const data = encodeFunctionData({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    args: [
      calls.map(call => ({
        target: call.address,
        allowFailure: true,
        callData: encodeFunctionData({
          abi: call.abi,
          functionName: call.functionName,
          args: call.args ?? [],
        } as unknown as Parameters<typeof encodeFunctionData>[0]),
      })),
    ],
  });
  let returned: Hex | undefined;
  try {
    ({ data: returned } = await ctx.publicClient.call({
      to: multicall3,
      data,
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    }));
  } catch (cause) {
    throw chainReadFailed(what, cause);
  }
  if (returned === undefined || returned === '0x') {
    throw chainReadFailed(what, new Error('Multicall3 returned no data'));
  }
  const results = decodeFunctionResult({
    abi: multicall3Abi,
    functionName: 'aggregate3',
    data: returned,
  });
  return results.map((result, i): ReadResult => {
    if (!result.success || result.returnData === '0x') return { ok: false };
    try {
      const value = decodeFunctionResult({
        abi: calls[i].abi,
        functionName: calls[i].functionName,
        data: result.returnData,
      } as unknown as Parameters<typeof decodeFunctionResult>[0]);
      return { ok: true, value };
    } catch {
      return { ok: false };
    }
  });
};
