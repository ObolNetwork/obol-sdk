import { TransactionSubmissionError } from './errors.js';
import { type WriteOptions } from './types.js';

// ethers v6 `wait()` throws CALL_EXCEPTION with the receipt when a mined
// transaction reverted; any other failure leaves the transaction unconfirmed.
const isMinedRevert = (error: unknown): boolean => {
  const e = error as { code?: unknown; receipt?: { status?: unknown } } | null;
  return (
    e?.code === 'CALL_EXCEPTION' &&
    e.receipt !== undefined &&
    e.receipt !== null &&
    e.receipt.status === 0
  );
};

/**
 * Records the transactions one write call broadcasts, reports each to
 * {@link WriteOptions.onSent}, and turns a later failure into a
 * {@link TransactionSubmissionError} carrying their hashes.
 */
export class SentTransactions {
  private readonly confirmed: string[] = [];
  private pending: string | undefined;
  private count = 0;

  constructor(
    private readonly options: WriteOptions | undefined,
    private readonly contractWallet = false,
  ) {}

  /** Call right after a transaction is broadcast. */
  sent(hash: string): void {
    this.pending = hash;
    const info = {
      hash,
      index: this.count++,
      contractWallet: this.contractWallet,
    };
    try {
      this.options?.onSent?.(info);
    } catch {
      // A failing callback must not stop the wait for a sent transaction.
    }
  }

  /** Call once a sent transaction is mined. */
  mined(hash: string): void {
    this.confirmed.push(hash);
    this.pending = undefined;
  }

  get hashes(): string[] {
    return [...this.confirmed];
  }

  /**
   * The error to throw for `cause`: a {@link TransactionSubmissionError} if
   * anything was broadcast, otherwise `fallback`.
   */
  failure(message: string, cause: unknown, fallback: Error): Error {
    if (this.count === 0) return fallback;
    return new TransactionSubmissionError(message, {
      txHashes: this.hashes,
      pendingTxHash: this.pending,
      pendingStatus: isMinedRevert(cause) ? 'reverted' : 'unconfirmed',
      cause,
    });
  }
}
