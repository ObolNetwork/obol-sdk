/**
 * Reads right after a mined transaction, through an app's viem client that
 * caches the block number (viem caches it for `cacheTime`, by default the
 * polling interval, 4 s). The SDK pins its reads to a block number, so a
 * cached one would pin them before the transaction. The cache window here is
 * long so the checks do not depend on timing.
 */
import {
  createPublicClient,
  encodeFunctionData,
  http,
  parseAbi,
  parseEther,
} from 'viem';
import { hoodi } from 'viem/chains';
import { createObolClient } from '../src/index.js';
import { OVM_ROLES } from '../src/ovm/index.js';
import {
  ANVIL_URL,
  codes,
  describeFork,
  HOODI,
  impersonate,
  publicClient,
  randomAddress,
  signer,
  type Signer,
} from './helpers/fork.js';
import { deployOvm } from './helpers/ovm.js';

const appClient = () =>
  createPublicClient({
    chain: hoodi,
    transport: http(ANVIL_URL),
    cacheTime: 30_000,
  });

describeFork(
  'reads right after a mined transaction (cached block number)',
  () => {
    let s: Signer;

    beforeAll(async () => {
      s = await signer(14);
    });

    test('ovm.verify sees an OVM created in the latest block', async () => {
      const client = appClient();
      const obol = createObolClient({
        chain: hoodi,
        publicClient: client,
        walletClient: s.walletClient,
        api: false,
      });
      const input = obol.setup.rewardsSplit({
        owner: s.address,
        recipients: [
          { address: randomAddress(), share: 500_000 },
          { address: randomAddress(), share: 490_000 },
        ],
        principalRecipient: randomAddress(),
      });
      const prepared = await obol.setup.prepareOvmWithSplits(input);
      const sent = await obol.send(prepared);
      const receipt = await publicClient.waitForTransactionReceipt({
        hash: sent.hash,
      });
      const { ovm } = obol.setup.ovmFromReceipt(receipt);
      expect(await obol.ovm.verify(ovm)).toMatchObject({
        status: 'obol',
        creationTxHash: receipt.transactionHash,
      });
    });

    test('ovm.getRoleHolders sees a role granted in the latest block', async () => {
      const d = await deployOvm(s);
      const client = appClient();
      const obol = createObolClient({
        chain: hoodi,
        publicClient: client,
        walletClient: s.walletClient,
        api: false,
      });
      const user = randomAddress();
      const prepared = await obol.ovm.prepareGrantRoles({
        ovm: d.ovm,
        user,
        roles: OVM_ROLES.DEPOSIT,
      });
      const sent = await obol.send(prepared);
      await publicClient.waitForTransactionReceipt({ hash: sent.hash });
      const { holders } = await obol.ovm.getRoleHolders(d.ovm);
      expect(holders.map(h => h.address)).toEqual([s.address, user]);
    });

    test('splits.prepareDistribution sees a Warehouse pause set in the latest block', async () => {
      const recipient = randomAddress();
      const d = await deployOvm(s, {
        recipients: [
          { address: recipient, share: 600_000n },
          { address: randomAddress(), share: 390_000n },
        ],
      });
      await s.walletClient
        .sendTransaction({
          account: s.account,
          chain: s.walletClient.chain,
          to: d.ovm,
          value: parseEther('1'),
        })
        .then(
          async hash => await publicClient.waitForTransactionReceipt({ hash }),
        );
      const obol = createObolClient({
        chain: hoodi,
        publicClient: appClient(),
        walletClient: s.walletClient,
        api: false,
      });
      await obol.splits.previewDistribution({ ovm: d.ovm });
      const paused = await impersonate(recipient);
      const hash = await paused.walletClient.sendTransaction({
        account: recipient,
        chain: paused.walletClient.chain,
        to: HOODI.warehouse,
        data: encodeFunctionData({
          abi: parseAbi([
            'function setWithdrawConfig((uint16 incentive, bool paused) config)',
          ]),
          functionName: 'setWithdrawConfig',
          args: [{ incentive: 0, paused: true }],
        }),
      });
      await publicClient.waitForTransactionReceipt({ hash });
      const prepared = await obol.splits.prepareDistribution({ ovm: d.ovm });
      expect(codes(prepared.checks)).toEqual(['RECIPIENT_WITHDRAW_PAUSED']);
    });
  },
);
