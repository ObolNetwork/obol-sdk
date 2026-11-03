/**
 * Read-only checks against the public Obol API with the Hoodi fork as the
 * chain: incentives, and ovm.verify from the API's creation record compared
 * with the chain's factory logs. Skipped when the API is unreachable.
 *
 * A full incentives claim needs an address with an unclaimed Hoodi record:
 * set E2E_INCENTIVES_ADDRESS to run it (the claim is sent from that address
 * on the fork through anvil_impersonateAccount).
 */
import { parseAbi, type Address } from 'viem';
import { getAddress } from 'viem';
import {
  codes,
  describeFork,
  expectCode,
  impersonate,
  obolFor,
  publicClient,
  sendAndWait,
  signer,
  SKIP_REASON,
} from './helpers/fork.js';
import { deployOvm } from './helpers/ovm.js';

const API = 'https://api.obol.tech';
// An OVM created on Hoodi by the factory before the fork (its first event).
const HOODI_OVM = getAddress('0xb83a8304c6faa1831ae7e114b154eb33c867e607');

const apiUp =
  SKIP_REASON === undefined &&
  (await fetch(`${API}/v1/eth/contract-creation/hoodi/${HOODI_OVM}`, {
    signal: AbortSignal.timeout(10_000),
  })
    .then(r => r.ok)
    .catch(() => false));
const apiTest = apiUp ? test : test.skip;
const claimAddress = process.env.E2E_INCENTIVES_ADDRESS;
const claimTest = apiUp && claimAddress !== undefined ? test : test.skip;
if (SKIP_REASON === undefined && !apiUp) {
  console.warn(`[e2e] ${API} unreachable: the API suite is skipped`);
}

const erc20Abi = parseAbi([
  'function balanceOf(address) view returns (uint256)',
]);

describeFork('the public Obol API with a Hoodi fork (read-only)', () => {
  const withApi = () => obolFor(undefined, { baseUrl: API });

  apiTest(
    'ovm.verify: the API creation record and the factory logs agree',
    async () => {
      const fromApi = await withApi().ovm.verify(HOODI_OVM);
      const fromChain = await obolFor().ovm.verify(HOODI_OVM);
      expect(fromApi).toMatchObject({ status: 'obol', source: 'api' });
      expect(fromChain).toMatchObject({ status: 'obol', source: 'chain' });
      expect(fromApi.factoryAddress).toBe(fromChain.factoryAddress);
    },
  );

  apiTest(
    'ovm.verify falls back to the chain for an OVM the API has not seen',
    async () => {
      const s = await signer(13);
      const d = await deployOvm(s);
      const verification = await withApi().ovm.verify(d.ovm);
      expect(verification).toMatchObject({
        status: 'obol',
        source: 'chain',
        creationTxHash: d.receipt.transactionHash,
      });
      // getState without the API's OVM endpoint: chain values, no enrichment.
      const state = (await withApi().ovm.getState(d.ovm))!;
      expect(state.source).toBe('chain');
      // Asked, and the API has no record of this OVM: null (absent only with api: false).
      expect(state.principalOnBeaconChain).toBeNull();
    },
  );

  apiTest(
    'incentives for an address without a record: null, NO_INCENTIVES',
    async () => {
      const s = await signer(13);
      const obol = withApi();
      expect(await obol.incentives.get(s.address)).toBeNull();
      const preflight = await obol.incentives.preflight(s.address);
      expect(preflight.ok).toBe(false);
      expect(codes(preflight.issues)).toEqual(['NO_INCENTIVES']);
      await expectCode(
        async () => await obol.incentives.prepareClaim(s.address),
        'INCENTIVES_PREFLIGHT_FAILED',
      );
    },
  );

  claimTest(
    'incentives claim for E2E_INCENTIVES_ADDRESS: the token balance rises by the amount',
    async () => {
      const address = getAddress(claimAddress as string) as Address;
      const claimer = await impersonate(address);
      const obol = obolFor(claimer.walletClient, { baseUrl: API });
      const record = await obol.incentives.get(address);
      expect(record).not.toBeNull();
      let prepared;
      try {
        prepared = await obol.incentives.prepareClaim(address);
      } catch (error) {
        // Already claimed on Hoodi: the read-only checks passed.
        expect((error as { code?: string }).code).toBe('ALREADY_CLAIMED');
        expect(
          await obol.incentives.isClaimed({
            contractAddress: record!.contractAddress,
            index: record!.index,
          }),
        ).toBe(true);
        return;
      }
      const token = obol.chain.contracts!.obolToken;
      const before = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });
      await sendAndWait(obol, prepared);
      const after = await publicClient.readContract({
        address: token,
        abi: erc20Abi,
        functionName: 'balanceOf',
        args: [address],
      });
      const received: bigint = after - before;
      expect(received).toBe(prepared.preview.amount);
      expect(
        await obol.incentives.isClaimed({
          contractAddress: record!.contractAddress,
          index: record!.index,
        }),
      ).toBe(true);
    },
  );
}, 'hoodi');
