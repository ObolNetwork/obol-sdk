/**
 * The BLS signature check for deposits queued on the beacon chain, which
 * `deposits.status` runs on a beacon node's `pending_deposits` (spec
 * operations.md "deposits.status"). Kept out of status.ts, so that modules
 * reading status for registered validators carry no BLS code.
 */
import type { Hex } from 'viem';
import { depositDomainForFork } from '../internal/verification/common.js';
import { signatureValidity } from '../internal/verification/signatureBatch.js';
import { createTick } from '../internal/yielder.js';
import { nobleBls } from '../cluster/blsBackend.js';
import { CHAINS } from '../chains.js';
import type { PendingDeposit, QueuedSignatureCheck } from './status.js';
import { signatureItem } from './assertDepositData.js';

/**
 * Queued deposits whose signature is checked per pubkey not yet in the
 * registry, in queue order; later ones stay unchecked (possibly valid).
 */
export const MAX_QUEUED_SIGNATURE_CHECKS = 16;

/**
 * Checks queued deposits as the beacon chain does before one creates a
 * validator: the signature over the deposit message, in the deposit domain
 * of the chain's genesis fork (as `assertDepositData`), each on its own.
 * Sets `signatureValid` on the first `MAX_QUEUED_SIGNATURE_CHECKS` deposits
 * of each pubkey that carry a signature. Undefined for a chain without a
 * known fork version: the deposits stay unchecked.
 */
export const queuedSignatureCheck = (
  chainId: number,
): QueuedSignatureCheck | undefined => {
  const forkVersion = CHAINS[chainId]?.forkVersion;
  if (forkVersion === undefined) return undefined;
  const domain = depositDomainForFork(forkVersion);
  return async queue => {
    const targets: PendingDeposit[] = [];
    const items = [];
    for (const { pubkey, deposits, signatures } of queue) {
      for (const [i, p] of deposits
        .slice(0, MAX_QUEUED_SIGNATURE_CHECKS)
        .entries()) {
        const signature: Hex | undefined = signatures[i];
        if (signature === undefined || p.withdrawalCredentials === undefined) {
          continue;
        }
        targets.push(p);
        items.push(
          signatureItem(
            nobleBls,
            {
              pubkey,
              withdrawalCredentials: p.withdrawalCredentials,
              amount: p.amount,
              signature,
            },
            domain,
          ),
        );
      }
    }
    if (items.length === 0) return;
    const valid = await signatureValidity(
      nobleBls,
      items,
      createTick(50, undefined, 'deposits.status'),
    );
    targets.forEach((p, i) => {
      p.signatureValid = valid[i];
    });
  };
};
