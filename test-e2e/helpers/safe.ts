/**
 * A 1-of-1 Safe (v1.4.1, from the canonical proxy factory on Hoodi) and a
 * viem WalletClient that behaves like a Safe connected over WalletConnect:
 * `eth_sendTransaction` returns the safeTxHash at once, and the owner
 * executes it on-chain shortly after.
 */
import {
  concat,
  createWalletClient,
  custom,
  decodeEventLog,
  encodeFunctionData,
  pad,
  parseAbi,
  parseEther,
  zeroAddress,
  type Address,
  type Hash,
  type Hex,
  type WalletClient,
} from 'viem';

import {
  ANVIL_URL,
  CHAIN,
  NET,
  publicClient,
  testClient,
  type Signer,
} from './fork.js';

export const safeAbi = parseAbi([
  'function setup(address[] _owners, uint256 _threshold, address to, bytes data, address fallbackHandler, address paymentToken, uint256 payment, address paymentReceiver)',
  'function nonce() view returns (uint256)',
  'function VERSION() view returns (string)',
  'function getTransactionHash(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, uint256 _nonce) view returns (bytes32)',
  'function execTransaction(address to, uint256 value, bytes data, uint8 operation, uint256 safeTxGas, uint256 baseGas, uint256 gasPrice, address gasToken, address refundReceiver, bytes signatures) payable returns (bool)',
  'event ExecutionSuccess(bytes32 indexed txHash, uint256 payment)',
  'event ExecutionFailure(bytes32 indexed txHash, uint256 payment)',
]);

const factoryAbi = parseAbi([
  'function createProxyWithNonce(address _singleton, bytes initializer, uint256 saltNonce) returns (address proxy)',
  'event ProxyCreation(address indexed proxy, address singleton)',
]);

/** Deploys a Safe proxy owned by `owner` alone (threshold 1), funded. */
export const deploySafe = async (owner: Signer): Promise<Address> => {
  const initializer = encodeFunctionData({
    abi: safeAbi,
    functionName: 'setup',
    args: [
      [owner.address],
      1n,
      zeroAddress,
      '0x',
      zeroAddress,
      zeroAddress,
      0n,
      zeroAddress,
    ],
  });
  const hash = await owner.walletClient.writeContract({
    account: owner.account,
    chain: owner.walletClient.chain,
    address: NET.safeProxyFactory,
    abi: factoryAbi,
    functionName: 'createProxyWithNonce',
    args: [NET.safeSingleton, initializer, BigInt(Date.now())],
  });
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  for (const log of receipt.logs) {
    if (log.address.toLowerCase() !== NET.safeProxyFactory.toLowerCase()) {
      continue;
    }
    const { eventName, args } = decodeEventLog({
      abi: factoryAbi,
      data: log.data,
      topics: log.topics,
    });
    if (eventName === 'ProxyCreation') {
      await testClient.setBalance({
        address: args.proxy,
        value: parseEther('1000'),
      });
      return args.proxy;
    }
  }
  throw new Error('no ProxyCreation log');
};

export interface SafeWallet {
  walletClient: WalletClient;
  /** Executions started by eth_sendTransaction, by safeTxHash. */
  executions: Map<Hash, Promise<Hash>>;
}

/**
 * A WalletClient whose account is the Safe. `eth_sendTransaction` computes
 * the safeTxHash, returns it, and has the owner call `execTransaction` with
 * an approved-hash signature (v = 1) after `delayMs`. With `safeTxGas` > 0
 * an inner revert emits ExecutionFailure instead of reverting the outer
 * transaction. Every other method goes to anvil.
 */
export const safeWallet = (
  safe: Address,
  owner: Signer,
  options: { delayMs?: number; safeTxGas?: bigint } = {},
): SafeWallet => {
  const executions = new Map<Hash, Promise<Hash>>();
  const forward = async (method: string, params: unknown): Promise<unknown> => {
    const response = await fetch(ANVIL_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    });
    const body = (await response.json()) as {
      result?: unknown;
      error?: { message: string; code: number };
    };
    if (body.error !== undefined) {
      throw Object.assign(new Error(body.error.message), body.error);
    }
    return body.result;
  };
  const sendSafeTransaction = async (tx: {
    to: Address;
    value?: Hex;
    data?: Hex;
  }): Promise<Hash> => {
    const value = BigInt(tx.value ?? '0x0');
    const data = tx.data ?? '0x';
    const safeTxGas = options.safeTxGas ?? 0n;
    const nonce = await publicClient.readContract({
      address: safe,
      abi: safeAbi,
      functionName: 'nonce',
    });
    const args = [
      tx.to,
      value,
      data,
      0,
      safeTxGas,
      0n,
      0n,
      zeroAddress,
      zeroAddress,
    ] as const;
    const safeTxHash = await publicClient.readContract({
      address: safe,
      abi: safeAbi,
      functionName: 'getTransactionHash',
      args: [...args, nonce],
    });
    // Approved-hash signature: the owner itself sends execTransaction.
    const signature = concat([
      pad(owner.address, { size: 32 }),
      pad('0x00', { size: 32 }),
      '0x01',
    ]);
    const execution = (async () => {
      await new Promise(resolve => setTimeout(resolve, options.delayMs ?? 300));
      return await owner.walletClient.writeContract({
        account: owner.account,
        chain: owner.walletClient.chain,
        address: safe,
        abi: safeAbi,
        functionName: 'execTransaction',
        args: [...args, signature],
        gas: 3_000_000n,
      });
    })();
    execution.catch(() => {});
    executions.set(safeTxHash, execution);
    return safeTxHash;
  };
  const walletClient = createWalletClient({
    account: safe,
    chain: CHAIN,
    transport: custom({
      request: async ({ method, params }) => {
        if (method === 'eth_sendTransaction') {
          const [tx] = params as [{ to: Address; value?: Hex; data?: Hex }];
          return await sendSafeTransaction(tx);
        }
        if (method === 'eth_accounts' || method === 'eth_requestAccounts') {
          return [safe];
        }
        return await forward(method, params);
      },
    }),
  });
  return { walletClient, executions };
};
