import { readFileSync } from 'node:fs';
import { parseAbi, type Address, type Hex } from 'viem';
import { Type } from '@sinclair/typebox';
import { ObolError } from '../../src/v3/errors.js';
import { decode, isAddressInput, T } from '../../src/v3/schema.js';
import {
  codeKind,
  readRequestFee,
  resolveRequestFee,
} from '../../src/v3/chainUtils.js';
import { send } from '../../src/v3/send.js';
import { fakeChain, MULTICALL3 } from './helpers/fakeChain.js';

const caught = (fn: () => unknown): ObolError => {
  try {
    fn();
  } catch (e) {
    return e as ObolError;
  }
  throw new Error('expected a throw');
};

describe('v3 core', () => {
  describe('address input rule', () => {
    const checksummed = '0x86B8145c98e5BD25BA722645b15eD65f024a87EC';
    it.each([
      [checksummed, true],
      [checksummed.toLowerCase(), true],
      [`0x${checksummed.slice(2).toUpperCase()}`, true],
      ['0x86b8145C98e5BD25BA722645b15eD65f024a87EC', false],
      ['0x1234', false],
      ['86B8145c98e5BD25BA722645b15eD65f024a87EC', false],
    ])('%s → %s', (input, ok) => {
      expect(isAddressInput(input)).toBe(ok);
    });

    it('decode reports PAYLOAD_INVALID with paths', () => {
      const schema = Type.Object({
        owner: T.Address,
        amounts: Type.Array(T.Wei),
      });
      const error = caught(() =>
        decode(schema, { owner: '0xnope', amounts: [1n, -1n] }),
      );
      expect(error.code).toBe('PAYLOAD_INVALID');
      const paths = (error.details.issues as Array<{ path: string }>).map(
        i => i.path,
      );
      expect(paths).toEqual(expect.arrayContaining(['owner', 'amounts[1]']));
    });
  });

  describe('request fees (vectors request_fees.json)', () => {
    const suite = JSON.parse(
      readFileSync('spec/vectors/request_fees.json', 'utf8'),
    );
    it.each<[string, any]>(suite.cases.map((c: any) => [c.name, c]))(
      '%s',
      (_name, c) => {
        const run = () =>
          resolveRequestFee({
            currentFee: BigInt(c.input.currentFee),
            requestedFee:
              c.input.requestedFee === null
                ? undefined
                : BigInt(c.input.requestedFee),
            count: c.input.requestCount,
            multiplier: BigInt(c.input.defaultMultiplier ?? '2'),
          });
        if (c.accepted) {
          expect(run().toString()).toBe(c.value);
        } else {
          expect(caught(run).code).toBe(c.reason);
        }
      },
    );

    it('reads the predeploy fee and reports an empty answer', async () => {
      const predeploy = '0x00000961Ef480Eb55e80D19ad83579A64c007002';
      const ok = fakeChain({ raw: { [predeploy]: () => '0x05' } });
      await expect(readRequestFee(ok.publicClient, predeploy)).resolves.toBe(
        5n,
      );
      const empty = fakeChain({ raw: { [predeploy]: () => '0x' } });
      await expect(
        readRequestFee(empty.publicClient, predeploy),
      ).rejects.toMatchObject({ code: 'FEE_READ_FAILED' });
    });
  });

  describe('codeKind', () => {
    it('tells EOAs, delegations and contracts apart', () => {
      expect(codeKind('0x')).toBe('none');
      expect(codeKind(`0xef0100${'11'.repeat(20)}` as Hex)).toBe('delegated');
      expect(codeKind('0x6080604052')).toBe('contract');
    });
  });

  describe('fakeChain multicall', () => {
    it('dispatches aggregate3 to contract handlers', async () => {
      const target = '0x1111111111111111111111111111111111111111' as Address;
      const abi = parseAbi(['function owner() view returns (address)']);
      const chain = fakeChain({
        contracts: { [target]: { abi, read: { owner: () => MULTICALL3 } } },
        balances: { [target]: 7n },
      });
      const [owner, balance] = await chain.publicClient.multicall({
        contracts: [
          { address: target, abi, functionName: 'owner' },
          {
            address: MULTICALL3,
            abi: parseAbi([
              'function getEthBalance(address) view returns (uint256)',
            ]),
            functionName: 'getEthBalance',
            args: [target],
          },
        ],
        allowFailure: false,
      });
      expect(owner).toBe(MULTICALL3);
      expect(balance).toBe(7n);
    });
  });

  describe('send', () => {
    const account = '0x2222222222222222222222222222222222222222' as Address;
    const prepared = {
      request: {
        to: account,
        data: '0x' as Hex,
        value: 1n,
        chainId: 560048,
      },
      checks: [],
      preview: undefined,
    };

    it('returns the hash before waiting and flags EOAs', async () => {
      const chain = fakeChain({ walletAccount: account });
      const sent = await send(chain.context(), prepared);
      expect(sent.hash).toMatch(/^0x(ee){32}$/);
      expect(sent.contractWallet).toBe(false);
      expect(chain.sent).toHaveLength(1);
    });

    it('flags a contract-wallet account', async () => {
      const chain = fakeChain({
        walletAccount: account,
        code: { [account]: '0x6080604052' },
      });
      const sent = await send(chain.context(), prepared);
      expect(sent.contractWallet).toBe(true);
    });

    it('refuses a prepared value for another chain', async () => {
      const chain = fakeChain({ walletAccount: account });
      await expect(
        send(chain.context(), {
          ...prepared,
          request: { ...prepared.request, chainId: 1 },
        }),
      ).rejects.toMatchObject({ code: 'CHAIN_MISMATCH' });
    });

    it('refuses when the wallet is on another chain', async () => {
      const chain = fakeChain({ walletAccount: account, walletChainId: 1 });
      await expect(send(chain.context(), prepared)).rejects.toMatchObject({
        code: 'CHAIN_MISMATCH',
      });
    });
  });
});
