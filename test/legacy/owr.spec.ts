import { getAddress } from 'viem';
import { owrAbi } from '../../src/abi.js';
import { getObolChain } from '../../src/chains.js';
import { createLegacyModule } from '../../src/legacy/index.js';
import { getOwrTranches } from '../../src/legacy/legacy.js';
import { fakeChain } from '../helpers/fakeChain.js';
import { caught, ETH, PRINCIPAL, REWARD } from '../ovm/ovmFixture.js';

const OWR = getAddress('0x6000000000000000000000000000000000000006');

describe('legacy.getOwrTranches', () => {
  it('reads getTranches', async () => {
    const chain = fakeChain({
      contracts: {
        [OWR]: {
          abi: owrAbi,
          read: { getTranches: () => [PRINCIPAL, REWARD, 32n * ETH] },
        },
      },
    });
    await expect(
      getOwrTranches(chain.context(), OWR.toLowerCase() as any),
    ).resolves.toEqual({
      principalRecipient: PRINCIPAL,
      rewardRecipient: REWARD,
      amountOfPrincipalStake: 32n * ETH,
    });
    await expect(
      createLegacyModule(chain.context()).getOwrTranches(OWR),
    ).resolves.toBeDefined();
  });

  it('throws CONTRACT_NOT_AVAILABLE without code and CHAIN_READ_FAILED on revert', async () => {
    expect(
      (await caught(getOwrTranches(fakeChain().context(), OWR))).code,
    ).toBe('CONTRACT_NOT_AVAILABLE');
    const reverting = fakeChain({
      contracts: { [OWR]: { abi: owrAbi, read: {} } },
    });
    expect((await caught(getOwrTranches(reverting.context(), OWR))).code).toBe(
      'CHAIN_READ_FAILED',
    );
  });

  it('validates the address', async () => {
    expect(
      (await caught(getOwrTranches(fakeChain().context(), '0x1' as any))).code,
    ).toBe('PAYLOAD_INVALID');
  });

  it('works on any client chain, not only those with Obol contracts', async () => {
    const contracts = {
      [OWR]: {
        abi: owrAbi,
        read: { getTranches: () => [PRINCIPAL, REWARD, 32n * ETH] },
      },
    };
    for (const id of [100, 11155111]) {
      const ctx = fakeChain({ chainId: id, contracts }).context();
      await expect(
        getOwrTranches({ ...ctx, chain: getObolChain(id) }, OWR),
      ).resolves.toMatchObject({ amountOfPrincipalStake: 32n * ETH });
    }
  });
});
