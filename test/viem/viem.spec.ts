import { jest } from '@jest/globals';
import { Wallet, type Provider, type TransactionRequest } from 'ethers';
import { createWalletClient, custom, type WalletClient } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { hoodi } from 'viem/chains';
import { walletClientToSigner, publicClientToProvider } from '../../src/viem';
import { Client } from '../../src/index';
import {
  Domain,
  TermsAndConditionsSigningTypes,
  OperatorConfigHashSigningTypes,
  TERMS_AND_CONDITIONS_HASH,
  TERMS_AND_CONDITIONS_VERSION,
} from '../../src/constants';
import { canSendUncheckedTransaction } from '../../src/splits/splitHelpers';
import { TEST_ADDRESSES } from '../fixtures';

const PRIVATE_KEY = `0x${'11'.repeat(32)}` as const;
const ACCOUNT = privateKeyToAccount(PRIVATE_KEY);
const TX_HASH = `0x${'ab'.repeat(32)}`;
const HOODI_CHAIN_ID_HEX = '0x88bb0';

// A mocked viem WalletClient with a JSON-RPC (browser wallet) account.
const makeMockClient = (
  overrides: Record<string, unknown> = {},
): WalletClient =>
  ({
    account: { address: ACCOUNT.address, type: 'json-rpc' },
    chain: { id: 560048, name: 'Hoodi' },
    request: jest.fn(async ({ method }: { method: string }) => {
      if (method === 'eth_chainId') return HOODI_CHAIN_ID_HEX;
      throw new Error(`unexpected ${method}`);
    }),
    getAddresses: jest.fn(async () => [ACCOUNT.address]),
    getChainId: jest.fn(async () => 560048),
    signMessage: jest.fn(async () => '0xsigned-message'),
    signTypedData: jest.fn(async () => '0xsigned-typed-data'),
    sendTransaction: jest.fn(async () => TX_HASH),
    ...overrides,
  }) as unknown as WalletClient;

const firstCallArg = (fn: unknown): Record<string, any> =>
  (fn as jest.Mock).mock.calls[0][0] as Record<string, any>;

const makeMockProvider = (): Provider & Record<string, jest.Mock> => {
  const response = { hash: TX_HASH, wait: jest.fn() };
  return {
    getBlockNumber: jest.fn(async () => 100),
    getTransaction: jest
      .fn()
      .mockResolvedValueOnce(null as never)
      .mockResolvedValue({
        ...response,
        replaceableTransaction: jest.fn(() => response),
      } as never),
  } as unknown as Provider & Record<string, jest.Mock>;
};

describe('viem adapter', () => {
  describe('walletClientToSigner (mocked WalletClient)', () => {
    it('returns the checksummed account address', async () => {
      const client = makeMockClient({
        account: { address: ACCOUNT.address.toLowerCase() },
      });
      const signer = walletClientToSigner(client);
      await expect(signer.getAddress()).resolves.toBe(ACCOUNT.address);
      expect(client.getAddresses).not.toHaveBeenCalled();
    });

    it('falls back to getAddresses when the client has no account', async () => {
      const client = makeMockClient({ account: undefined });
      const signer = walletClientToSigner(client);
      await expect(signer.getAddress()).resolves.toBe(ACCOUNT.address);
      expect(client.getAddresses).toHaveBeenCalled();
    });

    it('throws when the client exposes no address', async () => {
      const client = makeMockClient({
        account: undefined,
        getAddresses: jest.fn(async () => []),
      });
      await expect(walletClientToSigner(client).getAddress()).rejects.toThrow(
        'no account',
      );
    });

    it('defaults its provider to the client transport on the client chain', async () => {
      const client = makeMockClient();
      const signer = walletClientToSigner(client);
      const network = await signer.provider!.getNetwork();
      expect(network.chainId).toBe(560048n);
      expect(client.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'eth_chainId' }),
      );
      signer.provider!.destroy();
    });

    it('keeps an explicitly passed provider, including via connect()', () => {
      const provider = makeMockProvider();
      const signer = walletClientToSigner(makeMockClient(), provider);
      expect(signer.provider).toBe(provider);
      const other = makeMockProvider();
      expect(signer.connect(other).provider).toBe(other);
    });

    it('delegates signMessage, passing bytes as raw', async () => {
      const client = makeMockClient();
      const signer = walletClientToSigner(client, null);
      await expect(signer.signMessage('hello')).resolves.toBe(
        '0xsigned-message',
      );
      expect(client.signMessage).toHaveBeenLastCalledWith({
        account: client.account,
        message: 'hello',
      });
      const bytes = new Uint8Array([1, 2, 3]);
      await signer.signMessage(bytes);
      expect(client.signMessage).toHaveBeenLastCalledWith({
        account: client.account,
        message: { raw: bytes },
      });
    });

    it('delegates signTypedData with primaryType and viem-native values', async () => {
      const client = makeMockClient();
      const signer = walletClientToSigner(client, null);
      await expect(
        signer.signTypedData(Domain(560048), OperatorConfigHashSigningTypes, {
          operator_config_hash: `0x${'cd'.repeat(32)}`,
        }),
      ).resolves.toBe('0xsigned-typed-data');
      const args = firstCallArg(client.signTypedData);
      expect(args.primaryType).toBe('OperatorConfigHash');
      expect(args.domain).toEqual({
        name: 'Obol',
        version: '1',
        chainId: 560048,
      });
      expect(args.types).not.toHaveProperty('EIP712Domain');
      expect(args.message).toEqual({
        operator_config_hash: `0x${'cd'.repeat(32)}`,
      });
    });

    it('encodes integer fields as bigint and bytes as hex', async () => {
      const client = makeMockClient();
      const signer = walletClientToSigner(client, null);
      await signer.signTypedData(
        { name: 'Test', chainId: '1' },
        {
          Mail: [
            { name: 'amount', type: 'uint256' },
            { name: 'data', type: 'bytes' },
          ],
        },
        { amount: 42, data: new Uint8Array([1, 2]) },
      );
      const args = firstCallArg(client.signTypedData);
      expect(args.domain).toEqual({ name: 'Test', chainId: 1 });
      expect(args.message).toEqual({ amount: 42n, data: '0x0102' });
    });

    it('rejects an unresolvable ENS name in typed data', async () => {
      const signer = walletClientToSigner(makeMockClient(), null);
      await expect(
        signer.signTypedData(
          {},
          { Mail: [{ name: 'to', type: 'address' }] },
          { to: 'someone.eth' },
        ),
      ).rejects.toThrow();
    });

    it('sendUncheckedTransaction maps the request and returns the hash', async () => {
      const client = makeMockClient();
      const signer = walletClientToSigner(client, null);
      const tx: TransactionRequest = {
        to: TEST_ADDRESSES.OVM_OWNER,
        data: '0x1234',
        value: 5n,
        gasLimit: 21000,
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 1n,
        chainId: 560048,
      };
      await expect(signer.sendUncheckedTransaction(tx)).resolves.toBe(TX_HASH);
      expect(client.sendTransaction).toHaveBeenCalledWith({
        account: client.account,
        to: TEST_ADDRESSES.OVM_OWNER,
        data: '0x1234',
        value: 5n,
        gas: 21000n,
        maxFeePerGas: 10n,
        maxPriorityFeePerGas: 1n,
      });
    });

    it('rejects a transaction for another chain', async () => {
      const client = makeMockClient();
      const signer = walletClientToSigner(client, null);
      await expect(
        signer.sendUncheckedTransaction({
          to: TEST_ADDRESSES.OVM_OWNER,
          chainId: 1,
        }),
      ).rejects.toThrow('does not match the wallet chainId');
      expect(client.sendTransaction).not.toHaveBeenCalled();
    });

    it('rejects a transaction from another address', async () => {
      const client = makeMockClient();
      const signer = walletClientToSigner(client, null);
      await expect(
        signer.sendUncheckedTransaction({
          to: TEST_ADDRESSES.OVM_OWNER,
          from: TEST_ADDRESSES.SPLIT_OWNER,
        }),
      ).rejects.toThrow('does not match the signer');
      expect(client.sendTransaction).not.toHaveBeenCalled();
    });

    it('sendTransaction submits via the client and resolves the response', async () => {
      const client = makeMockClient();
      const provider = makeMockProvider();
      const signer = walletClientToSigner(client, provider);
      const response = await signer.sendTransaction({
        to: TEST_ADDRESSES.OVM_OWNER,
        value: 1n,
      });
      expect(response.hash).toBe(TX_HASH);
      expect(client.sendTransaction).toHaveBeenCalledTimes(1);
      expect(provider.getTransaction).toHaveBeenCalledWith(TX_HASH);
    });

    it('sendTransaction requires a provider', async () => {
      const signer = walletClientToSigner(makeMockClient(), null);
      await expect(
        signer.sendTransaction({ to: TEST_ADDRESSES.OVM_OWNER }),
      ).rejects.toThrow('provider is required');
    });

    it('does not support signTransaction', async () => {
      const signer = walletClientToSigner(makeMockClient(), null);
      await expect(signer.signTransaction({})).rejects.toThrow('not supported');
    });

    it('is recognised by the contract-wallet flows', () => {
      const signer = walletClientToSigner(makeMockClient(), null);
      expect(canSendUncheckedTransaction(signer)).toBe(true);
    });

    it('is accepted by Client, which falls back to its provider', () => {
      const signer = walletClientToSigner(makeMockClient());
      const client = new Client({ chainId: 560048 }, signer);
      expect(client.provider).toBe(signer.provider);
      signer.provider!.destroy();
    });
  });

  describe('walletClientToSigner (real viem local account)', () => {
    const viemClient = createWalletClient({
      account: ACCOUNT,
      chain: hoodi,
      transport: custom({
        request: async () => {
          throw new Error('no network in tests');
        },
      }),
    });
    const signer = walletClientToSigner(viemClient, null);
    const wallet = new Wallet(PRIVATE_KEY);

    it('produces the same message signature as an ethers Wallet', async () => {
      await expect(signer.signMessage('obol')).resolves.toBe(
        await wallet.signMessage('obol'),
      );
    });

    it('produces the same EIP-712 signature as an ethers Wallet', async () => {
      for (const domain of [Domain(), Domain(560048)]) {
        const value = {
          terms_and_conditions_hash: TERMS_AND_CONDITIONS_HASH,
          version: TERMS_AND_CONDITIONS_VERSION,
        };
        await expect(
          signer.signTypedData(domain, TermsAndConditionsSigningTypes, value),
        ).resolves.toBe(
          await wallet.signTypedData(
            domain,
            TermsAndConditionsSigningTypes,
            value,
          ),
        );
      }
    });
  });

  describe('publicClientToProvider', () => {
    it('sends JSON-RPC requests through the client', async () => {
      const publicClient = {
        chain: { id: 560048, name: 'Hoodi' },
        request: jest.fn(async ({ method }: { method: string }) => {
          if (method === 'eth_chainId') return HOODI_CHAIN_ID_HEX;
          if (method === 'eth_blockNumber') return '0x10';
          throw new Error(`unexpected ${method}`);
        }),
      };
      const provider = publicClientToProvider(publicClient as any);
      await expect(provider.getBlockNumber()).resolves.toBe(16);
      expect(publicClient.request).toHaveBeenCalledWith(
        expect.objectContaining({ method: 'eth_blockNumber' }),
      );
      provider.destroy();
    });
  });
});
