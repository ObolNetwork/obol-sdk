import { jest } from '@jest/globals';
import {
  AbstractSigner,
  HDNodeWallet,
  JsonRpcProvider,
  JsonRpcSigner,
  NonceManager,
  Wallet,
  type Provider,
  type TransactionRequest,
  type TypedDataDomain,
  type TypedDataField,
} from 'ethers';
import { Client, type SignerType, type ProviderType } from '../../src/index';
import {
  canSendUncheckedTransaction,
  isContractWalletSigner,
  submitViaContractWalletAndWait,
} from '../../src/splits/splitHelpers';
import { TEST_ADDRESSES } from '../fixtures';

const PRIVATE_KEY = `0x${'22'.repeat(32)}`;

// A minimal custom signer (e.g. a hardware-wallet integration) that only
// implements the ethers AbstractSigner contract.
class CustomSigner extends AbstractSigner {
  private readonly wallet = new Wallet(PRIVATE_KEY);

  constructor(provider: Provider | null = null) {
    super(provider);
  }

  async getAddress(): Promise<string> {
    return this.wallet.address;
  }

  connect(provider: Provider | null): CustomSigner {
    return new CustomSigner(provider);
  }

  async signTransaction(tx: TransactionRequest): Promise<string> {
    return await this.wallet.signTransaction(tx);
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return await this.wallet.signMessage(message);
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    return await this.wallet.signTypedData(domain, types, value);
  }
}

describe('Client signer types', () => {
  const provider = new JsonRpcProvider(undefined, 560048, {
    staticNetwork: true,
  });

  afterAll(() => {
    provider.destroy();
  });

  // These are compile-time checks as much as runtime ones: ts-jest type-checks
  // this file, so each constructor call must accept the signer without a cast.
  it.each([
    ['Wallet', () => new Wallet(PRIVATE_KEY, provider)],
    ['HDNodeWallet', () => HDNodeWallet.createRandom().connect(provider)],
    [
      'JsonRpcSigner',
      () => new JsonRpcSigner(provider, TEST_ADDRESSES.OVM_OWNER),
    ],
    ['NonceManager', () => new NonceManager(new Wallet(PRIVATE_KEY, provider))],
    ['custom AbstractSigner', () => new CustomSigner(provider)],
  ])('accepts %s and falls back to its provider', (_name, make) => {
    const signer = make();
    const client = new Client({ chainId: 560048 }, signer);
    expect(client.provider).toBe(provider);
  });

  it('prefers an explicitly passed provider', () => {
    const other: ProviderType = new JsonRpcProvider(undefined, 560048, {
      staticNetwork: true,
    });
    const client = new Client(
      { chainId: 560048 },
      new CustomSigner(provider),
      other,
    );
    expect(client.provider).toBe(other);
    other.destroy();
  });

  it('rejects values that are not ethers signers at compile time', () => {
    // @ts-expect-error a plain object is not a Signer
    const make = (): Client => new Client({ chainId: 560048 }, { foo: 1 });
    expect(typeof make).toBe('function');
  });

  it('signs with a custom AbstractSigner through the Client', async () => {
    const signer = new CustomSigner();
    const client = new Client({ chainId: 560048 }, signer);
    const fetchMock = jest.fn(async () => ({
      ok: true,
      status: 201,
      json: async () => ({ message: 'accepted', success: true }),
    }));
    const originalFetch = global.fetch;
    global.fetch = fetchMock as unknown as typeof fetch;
    try {
      await expect(client.acceptObolLatestTermsAndConditions()).resolves.toBe(
        'accepted',
      );
    } finally {
      global.fetch = originalFetch;
    }
    const [, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      { headers: Record<string, string> },
    ];
    expect(init.headers.Authorization).toMatch(/^Bearer 0x[0-9a-f]{130}$/);
  });
});

describe('contract-wallet detection with generic signers', () => {
  it('treats signers without sendUncheckedTransaction as EOAs', async () => {
    const signer: SignerType = new NonceManager(new CustomSigner());
    expect(canSendUncheckedTransaction(signer)).toBe(false);
    await expect(isContractWalletSigner(signer)).resolves.toBe(false);
  });

  it('requires a read provider for contract-wallet submission', async () => {
    const signer = Object.assign(new CustomSigner(), {
      sendUncheckedTransaction: jest.fn(async () => `0x${'aa'.repeat(32)}`),
    });
    expect(canSendUncheckedTransaction(signer)).toBe(true);
    await expect(
      submitViaContractWalletAndWait({
        signer,
        to: TEST_ADDRESSES.OVM_OWNER,
        data: '0x',
      }),
    ).rejects.toThrow('A provider is required');
    expect(signer.sendUncheckedTransaction).not.toHaveBeenCalled();
  });
});
