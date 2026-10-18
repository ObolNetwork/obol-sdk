/**
 * Send helper for scripts and simple apps (spec/operations.md "send").
 * Returns as soon as the wallet gives a hash; `wait` follows it to a receipt,
 * or, for a contract wallet (a Safe), to the Safe's execution log.
 */
import {
  isAddress,
  isHex,
  parseAbiItem,
  type Address,
  type Hash,
  type PublicClient,
  type ReplacementReturnType,
  type TransactionReceipt,
  WaitForTransactionReceiptTimeoutError,
  TransactionReceiptNotFoundError,
} from 'viem';
import { getCodeKind } from './chainUtils.js';
import { accountAddress, requireWallet, type Context } from './context.js';
import { ObolError } from './errors.js';
import type { Prepared } from './types.js';

export interface WaitOptions {
  onReplaced?: (replacement: ReplacementReturnType) => void;
  /** Default 180 s for an account, 30 min for a contract wallet. */
  timeoutMs?: number;
  confirmations?: number;
}

export interface Sent {
  hash: Hash;
  contractWallet: boolean;
  wait: (options?: WaitOptions) => Promise<TransactionReceipt>;
}

const SAFE_EXECUTION_SUCCESS = parseAbiItem(
  'event ExecutionSuccess(bytes32 txHash, uint256 payment)',
);
const SAFE_EXECUTION_FAILURE = parseAbiItem(
  'event ExecutionFailure(bytes32 txHash, uint256 payment)',
);

const DEFAULT_TIMEOUT_MS = 180_000;
const DEFAULT_CONTRACT_WALLET_TIMEOUT_MS = 30 * 60_000;
const POLL_MS = 4_000;

const sleep = async (ms: number): Promise<void> => {
  await new Promise(resolve => setTimeout(resolve, ms));
};

/**
 * Waits for a Safe to execute `safeTxHash`: the account's ExecutionSuccess /
 * ExecutionFailure log with that hash, from `fromBlock`. Chain-only.
 */
export const waitForContractWalletExecution = async ({
  publicClient,
  account,
  safeTxHash,
  fromBlock,
  timeoutMs = DEFAULT_CONTRACT_WALLET_TIMEOUT_MS,
  pollMs = POLL_MS,
}: {
  publicClient: PublicClient;
  account: Address;
  safeTxHash: Hash;
  fromBlock: bigint;
  timeoutMs?: number;
  pollMs?: number;
}): Promise<TransactionReceipt> => {
  const deadline = Date.now() + timeoutMs;
  const wanted = safeTxHash.toLowerCase();
  let from = fromBlock;
  for (;;) {
    const head = await publicClient.getBlockNumber();
    if (head >= from) {
      const logs = await publicClient.getLogs({
        address: account,
        events: [SAFE_EXECUTION_SUCCESS, SAFE_EXECUTION_FAILURE],
        fromBlock: from,
        toBlock: head,
      });
      const match = logs.find(
        log => (log.args.txHash ?? '').toLowerCase() === wanted,
      );
      if (match !== undefined) {
        const receipt = await publicClient.getTransactionReceipt({
          hash: match.transactionHash,
        });
        if (match.eventName === 'ExecutionFailure') {
          throw new ObolError(
            'TX_REVERTED',
            `The Safe executed ${safeTxHash} and the inner call failed (transaction ${match.transactionHash})`,
            {
              hint: 'Nothing moved; retrying is safe',
              details: {
                hash: safeTxHash,
                receipt,
                contractWallet: true,
              },
            },
          );
        }
        return receipt;
      }
      from = head + 1n;
    }
    if (Date.now() >= deadline) {
      throw new ObolError(
        'TX_UNCONFIRMED',
        `No Safe execution of ${safeTxHash} seen within ${timeoutMs} ms`,
        {
          hint: 'It may still be executed; check the Safe before proposing again',
          details: { hash: safeTxHash, contractWallet: true },
        },
      );
    }
    await sleep(pollMs);
  }
};

const assertPrepared = (ctx: Context, prepared: Prepared<unknown>): void => {
  const request = (prepared as Partial<Prepared<unknown>>)?.request;
  const ok =
    request !== undefined &&
    typeof request.to === 'string' &&
    isAddress(request.to, { strict: false }) &&
    typeof request.data === 'string' &&
    isHex(request.data) &&
    typeof request.value === 'bigint' &&
    request.value >= 0n &&
    typeof request.chainId === 'number';
  if (!ok) {
    throw new ObolError(
      'PREPARED_INVALID',
      'send expects the value a prepareX operation returned',
    );
  }
  if (request.chainId !== ctx.chain.id) {
    throw new ObolError(
      'CHAIN_MISMATCH',
      `The prepared transaction is for chain ${request.chainId}, the client is on ${ctx.chain.id}`,
      {
        details: {
          expectedChainId: ctx.chain.id,
          actualChainId: request.chainId,
        },
      },
    );
  }
};

export const send = async (
  ctx: Context,
  prepared: Prepared<unknown>,
): Promise<Sent> => {
  assertPrepared(ctx, prepared);
  const { walletClient, account } = await requireWallet(ctx, 'send');
  const from = accountAddress(account);
  const [kind, startBlock] = await Promise.all([
    getCodeKind(ctx.publicClient, from),
    ctx.publicClient.getBlockNumber(),
  ]);
  const contractWallet = kind === 'contract';
  let hash: Hash;
  try {
    hash = await walletClient.sendTransaction({
      account,
      chain: walletClient.chain ?? null,
      to: prepared.request.to,
      data: prepared.request.data,
      value: prepared.request.value,
    });
  } catch (cause) {
    throw new ObolError(
      'TX_REJECTED',
      `The wallet did not send the transaction: ${(cause as Error).message}`,
      { hint: 'Nothing was sent; retry if the user wants', cause },
    );
  }

  const wait = async (
    options: WaitOptions = {},
  ): Promise<TransactionReceipt> => {
    if (contractWallet) {
      return await waitForContractWalletExecution({
        publicClient: ctx.publicClient,
        account: from,
        safeTxHash: hash,
        fromBlock: startBlock,
        timeoutMs: options.timeoutMs,
      });
    }
    let receipt: TransactionReceipt;
    try {
      receipt = await ctx.publicClient.waitForTransactionReceipt({
        hash,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(options.confirmations !== undefined
          ? { confirmations: options.confirmations }
          : {}),
        onReplaced: replacement => {
          options.onReplaced?.(replacement);
          if (replacement.reason !== 'repriced') {
            throw new ObolError(
              'TX_REPLACED',
              `Transaction ${hash} was ${replacement.reason} by ${replacement.transaction.hash}`,
              {
                hint: 'The prepared call did not run; retrying is safe',
                details: { hash, replacement: replacement.transaction.hash },
              },
            );
          }
        },
      });
    } catch (cause) {
      if (cause instanceof ObolError) throw cause;
      if (
        cause instanceof WaitForTransactionReceiptTimeoutError ||
        cause instanceof TransactionReceiptNotFoundError
      ) {
        throw new ObolError(
          'TX_UNCONFIRMED',
          `No receipt for ${hash} yet; it may still be mined`,
          {
            hint: 'Watch the hash before retrying, so nothing is sent twice',
            details: { hash, contractWallet: false },
            cause,
          },
        );
      }
      throw new ObolError(
        'TX_UNCONFIRMED',
        `Waiting for ${hash} failed: ${(cause as Error).message}`,
        {
          hint: 'Watch the hash before retrying, so nothing is sent twice',
          details: { hash, contractWallet: false },
          cause,
        },
      );
    }
    if (receipt.status !== 'success') {
      throw new ObolError('TX_REVERTED', `Transaction ${hash} reverted`, {
        hint: 'Nothing moved; retrying is safe',
        details: { hash, receipt },
      });
    }
    return receipt;
  };

  return { hash, contractWallet, wait };
};
