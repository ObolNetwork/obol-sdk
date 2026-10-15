/**
 * Adapters from viem clients to the ethers v6 `Signer` / `Provider` the SDK
 * expects. Import from `@obolnetwork/obol-sdk/viem`; the root package does not
 * load this module. viem is only referenced for types, so it is an optional
 * peer dependency.
 *
 * @example
 * ```typescript
 * import { Client } from '@obolnetwork/obol-sdk';
 * import { walletClientToSigner } from '@obolnetwork/obol-sdk/viem';
 *
 * const client = new Client({ chainId: 560048 }, walletClientToSigner(walletClient));
 * ```
 *
 * @module
 */
import {
  AbstractSigner,
  BrowserProvider,
  TypedDataEncoder,
  accessListify,
  getAddress,
  getBigInt,
  hexlify,
  resolveAddress,
  type Eip1193Provider,
  type Provider,
  type TransactionRequest,
  type TransactionResponse,
  type TypedDataDomain,
  type TypedDataField,
} from 'ethers';
import type {
  Account,
  Chain,
  PublicClient,
  Transport,
  WalletClient,
} from 'viem';

type ViemWalletClient = WalletClient<
  Transport,
  Chain | undefined,
  Account | undefined
>;
type ViemPublicClient = PublicClient<Transport, Chain | undefined>;

type Hex = `0x${string}`;

// The subset of the viem client surface this adapter calls, without viem's
// per-call generics (the typed-data and transaction shapes are built at
// runtime from ethers values).
interface ViemRequestClient {
  chain?: { id: number; name: string } | undefined;
  request: (args: { method: string; params?: unknown }) => Promise<unknown>;
}
interface ViemSigningClient extends ViemRequestClient {
  account?: { address: string } | undefined;
  getAddresses: () => Promise<readonly string[]>;
  getChainId: () => Promise<number>;
  signMessage: (args: Record<string, unknown>) => Promise<Hex>;
  signTypedData: (args: Record<string, unknown>) => Promise<Hex>;
  sendTransaction: (args: Record<string, unknown>) => Promise<Hex>;
}

const toEip1193 = (client: ViemRequestClient): Eip1193Provider => ({
  request: async ({ method, params }) =>
    await client.request({ method, params }),
});

const toBrowserProvider = (client: ViemRequestClient): BrowserProvider =>
  new BrowserProvider(
    toEip1193(client),
    client.chain
      ? { chainId: client.chain.id, name: client.chain.name }
      : undefined,
  );

/**
 * An ethers v6 `Signer` backed by a viem `WalletClient`. Address lookup,
 * message and EIP-712 signing and transaction submission are delegated to the
 * WalletClient, so both JSON-RPC (browser wallet) and local accounts work.
 * Reads go through `provider`, which defaults to an ethers provider over the
 * WalletClient's transport.
 */
export class ViemWalletSigner extends AbstractSigner {
  readonly walletClient: ViemWalletClient;

  constructor(walletClient: ViemWalletClient, provider?: Provider | null) {
    super(
      provider === undefined
        ? toBrowserProvider(walletClient as unknown as ViemRequestClient)
        : provider,
    );
    this.walletClient = walletClient;
  }

  private get client(): ViemSigningClient {
    return this.walletClient as unknown as ViemSigningClient;
  }

  // Passed as `account` to viem actions: the client's account object (which
  // may be a local account that signs in-process) or the selected address.
  private async account(): Promise<unknown> {
    return this.client.account ?? (await this.getAddress());
  }

  async getAddress(): Promise<string> {
    const address =
      this.client.account?.address ?? (await this.client.getAddresses())[0];
    if (!address) {
      throw new Error('The viem WalletClient has no account');
    }
    return getAddress(address);
  }

  connect(provider: Provider | null): ViemWalletSigner {
    return new ViemWalletSigner(this.walletClient, provider);
  }

  async signTransaction(_tx: TransactionRequest): Promise<string> {
    throw new Error(
      'signTransaction is not supported by the viem adapter; use sendTransaction',
    );
  }

  async signMessage(message: string | Uint8Array): Promise<string> {
    return await this.client.signMessage({
      account: await this.account(),
      message: typeof message === 'string' ? message : { raw: message },
    });
  }

  async signTypedData(
    domain: TypedDataDomain,
    types: Record<string, TypedDataField[]>,
    value: Record<string, unknown>,
  ): Promise<string> {
    const resolved = await TypedDataEncoder.resolveNames(
      domain,
      types,
      value,
      async (name: string) => {
        const address = await this.resolveName(name);
        if (address == null) {
          throw new Error(`Unable to resolve ENS name ${name}`);
        }
        return address;
      },
    );
    const encoder = TypedDataEncoder.from(types);
    // Integers as bigint and bytes as hex, which viem accepts for both local
    // hashing and eth_signTypedData_v4.
    const resolvedValue = resolved.value as Record<string, unknown>;
    const message = encoder.visit(resolvedValue, (type, v) => {
      if (/^u?int/.test(type)) return getBigInt(v as string);
      if (/^bytes/.test(type)) return hexlify(v as string);
      return v;
    });
    const { chainId, verifyingContract, salt, name, version } = resolved.domain;
    return await this.client.signTypedData({
      account: await this.account(),
      domain: {
        ...(name != null ? { name } : {}),
        ...(version != null ? { version } : {}),
        ...(chainId != null ? { chainId: Number(getBigInt(chainId)) } : {}),
        ...(verifyingContract != null ? { verifyingContract } : {}),
        ...(salt != null ? { salt: hexlify(salt) } : {}),
      },
      types,
      primaryType: encoder.primaryType,
      message,
    });
  }

  /**
   * Submits the transaction through the WalletClient and returns its hash
   * without waiting for it to appear on-chain. Smart-contract wallets (e.g. a
   * Safe) return an internal hash here; the SDK's contract-wallet flows use
   * this method and resolve the executed transaction themselves.
   */
  async sendUncheckedTransaction(tx: TransactionRequest): Promise<string> {
    const from = await this.getAddress();
    if (tx.from != null) {
      const txFrom = await resolveAddress(tx.from, this.provider);
      if (txFrom.toLowerCase() !== from.toLowerCase()) {
        throw new Error('Transaction from address does not match the signer');
      }
    }
    if (tx.chainId != null) {
      const walletChainId = await this.client.getChainId();
      if (getBigInt(tx.chainId) !== BigInt(walletChainId)) {
        throw new Error(
          `Transaction chainId ${String(tx.chainId)} does not match the wallet chainId ${walletChainId}`,
        );
      }
    }
    const request: Record<string, unknown> = {
      account: await this.account(),
    };
    if (tx.to != null) request.to = await resolveAddress(tx.to, this.provider);
    if (tx.data != null) request.data = hexlify(tx.data);
    if (tx.value != null) request.value = getBigInt(tx.value);
    if (tx.gasLimit != null) request.gas = getBigInt(tx.gasLimit);
    if (tx.nonce != null) request.nonce = tx.nonce;
    if (tx.gasPrice != null) request.gasPrice = getBigInt(tx.gasPrice);
    if (tx.maxFeePerGas != null) {
      request.maxFeePerGas = getBigInt(tx.maxFeePerGas);
    }
    if (tx.maxPriorityFeePerGas != null) {
      request.maxPriorityFeePerGas = getBigInt(tx.maxPriorityFeePerGas);
    }
    if (tx.accessList != null) {
      request.accessList = accessListify(tx.accessList);
    }
    return await this.client.sendTransaction(request);
  }

  async sendTransaction(tx: TransactionRequest): Promise<TransactionResponse> {
    const provider = this.provider;
    if (!provider) {
      throw new Error('A provider is required to track the transaction');
    }
    const blockNumber = await provider.getBlockNumber();
    const hash = await this.sendUncheckedTransaction(tx);
    // The wallet only returns a hash; poll until the node knows the
    // transaction (as ethers' JsonRpcSigner does).
    for (let delay = 100; ; delay = 1000) {
      const response = await provider.getTransaction(hash);
      if (response != null) return response.replaceableTransaction(blockNumber);
      await new Promise(resolve => setTimeout(resolve, delay));
    }
  }
}

/**
 * Wraps a viem `WalletClient` as an ethers v6 `Signer` for `new Client(...)`.
 *
 * @param walletClient - A viem WalletClient with an account (JSON-RPC or local).
 * @param provider - Optional ethers provider for reads. Defaults to a provider
 *   over the WalletClient's transport.
 * @returns An ethers `Signer` delegating signing and submission to viem.
 */
export const walletClientToSigner = (
  walletClient: ViemWalletClient,
  provider?: Provider | null,
): ViemWalletSigner => new ViemWalletSigner(walletClient, provider);

/**
 * Wraps a viem `PublicClient` as an ethers v6 `Provider`, for the third
 * argument of `new Client(config, signer, provider)`.
 *
 * @param publicClient - A viem PublicClient.
 * @returns An ethers provider sending JSON-RPC requests through the client.
 */
export const publicClientToProvider = (
  publicClient: ViemPublicClient,
): Provider => toBrowserProvider(publicClient as unknown as ViemRequestClient);
