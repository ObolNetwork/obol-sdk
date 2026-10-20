/** Builds an OVM with a rewards split on the fork, through the SDK flow. */
import type { Address, Hex, TransactionReceipt } from 'viem';
import type { OvmWithSplitsInput, OvmCreated } from '../../src/setup/index.js';
import type { Prepared, SplitParams } from '../../src/types.js';
import type { OvmWithSplitsPreview } from '../../src/setup/withSplits.js';
import { randomAddress, sendAndWait, type Signer } from './fork.js';

export interface DeployedOvm extends OvmCreated {
  input: OvmWithSplitsInput;
  prepared: Prepared<OvmWithSplitsPreview>;
  receipt: TransactionReceipt;
  rewardSplit: SplitParams;
  recipients: Array<{ address: Address; share: bigint }>;
}

/**
 * `setup.rewardsSplit` (two reward recipients, 60% / 39%, plus the RAF 1%),
 * `prepareOvmWithSplits`, `send`, `ovmFromReceipt`.
 */
export const deployOvm = async (
  s: Signer,
  options: {
    principalRecipient?: Address;
    recipients?: Array<{ address: Address; share: bigint }>;
    principalThreshold?: bigint;
    distributionIncentive?: number;
    salt?: Hex;
  } = {},
): Promise<DeployedOvm> => {
  const recipients = options.recipients ?? [
    { address: randomAddress(), share: 600_000n },
    { address: randomAddress(), share: 390_000n },
  ];
  const input = s.obol.setup.rewardsSplit({
    owner: s.address,
    recipients,
    principalRecipient: options.principalRecipient ?? randomAddress(),
    ...(options.principalThreshold !== undefined
      ? { principalThreshold: options.principalThreshold }
      : {}),
    ...(options.distributionIncentive !== undefined
      ? { distributionIncentive: options.distributionIncentive }
      : {}),
    ...(options.salt !== undefined ? { salt: options.salt } : {}),
  });
  const prepared = await s.obol.setup.prepareOvmWithSplits(input);
  const receipt = await sendAndWait(s.obol, prepared);
  const created = s.obol.setup.ovmFromReceipt(receipt);
  const { rewardSplit } = s.obol.setup.ovmSplitParams({
    kind: 'rewards',
    rewardRecipients: recipients,
    ...(options.distributionIncentive !== undefined
      ? { distributionIncentive: options.distributionIncentive }
      : {}),
  });
  return { ...created, input, prepared, receipt, rewardSplit, recipients };
};
