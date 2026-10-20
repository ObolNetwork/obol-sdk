import type { Address } from 'viem';
import { refusePublicForwarders } from '../../src/chainUtils.js';
import { refuseOvmForwarders } from '../../src/setup/ovm.js';
import { refuseSplitForwarders } from '../../src/splits/create.js';

const MULTICALL3 = '0xcA11bde05977b3631167028862bE2a173976CA11' as Address;
const EOA = '0x1234567890123456789012345678901234567890' as Address;

describe('public forwarders in setup', () => {
  it('refuses a forwarder as OVM owner or recipient', () => {
    expect(() =>
      refuseOvmForwarders(560048, {
        owner: MULTICALL3,
        principalRecipient: EOA,
        rewardRecipient: EOA,
        thresholdGwei: 16_000_000_000n,
      }),
    ).toThrow(expect.objectContaining({ code: 'OWNER_TO_PUBLIC_FORWARDER' }));
    expect(() =>
      refuseOvmForwarders(560048, {
        owner: EOA,
        principalRecipient: EOA,
        rewardRecipient: MULTICALL3,
        thresholdGwei: 16_000_000_000n,
      }),
    ).toThrow(
      expect.objectContaining({ code: 'RECIPIENT_IS_PUBLIC_FORWARDER' }),
    );
  });

  it('refuses a forwarder as split owner or recipient', () => {
    const params = {
      recipients: [EOA, MULTICALL3],
      allocations: [1n, 1n],
      totalAllocation: 2n,
      distributionIncentive: 0,
    };
    expect(() => refuseSplitForwarders(1, params, EOA)).toThrow(
      expect.objectContaining({
        code: 'RECIPIENT_IS_PUBLIC_FORWARDER',
        details: expect.objectContaining({ path: 'recipients[1]' }),
      }),
    );
    expect(() =>
      refuseSplitForwarders(1, { ...params, recipients: [EOA] }, MULTICALL3),
    ).toThrow(expect.objectContaining({ code: 'OWNER_TO_PUBLIC_FORWARDER' }));
  });

  it('allows ordinary addresses', () => {
    expect(() =>
      refusePublicForwarders(560048, [
        { path: 'owner', address: EOA, kind: 'owner' },
      ]),
    ).not.toThrow();
  });
});
