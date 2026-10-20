/**
 * Shared helpers for the Hoodi fork suites: viem clients on the anvil that
 * globalSetup.cjs started, funded signers, an SDK client per signer, and
 * small chain readers used to compare SDK previews with what was mined.
 */
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { bytesToHex } from '@noble/curves/utils.js';
import {
  createPublicClient,
  createTestClient,
  createWalletClient,
  http,
  type EIP1193RequestFn,
  type Transport,
  parseAbi,
  parseEther,
  type Address,
  type Hex,
  type PublicClient,
  type TransactionReceipt,
  type WalletClient,
} from 'viem';
import {
  generatePrivateKey,
  mnemonicToAccount,
  privateKeyToAccount,
  type Account,
} from 'viem/accounts';
import { hoodi } from 'viem/chains';
import { createObolClient, type ObolClient } from '../../src/index.js';
import type { Deposit, Finding, Prepared } from '../../src/types.js';
import {
  depositDomainForFork,
  depositSigningRoot,
} from '../../src/internal/verification/common.js';
import { depositDataRoot } from '../../src/deposits/verifyDepositData.js';
import { GWEI } from '../../src/units.js';

export const SKIP_REASON =
  process.env.E2E_SKIP_REASON ??
  (process.env.E2E_ANVIL_URL === undefined
    ? 'no anvil (run through yarn test:e2e)'
    : undefined);
export const ANVIL_URL = process.env.E2E_ANVIL_URL ?? 'http://127.0.0.1:0';
export const FORK_BLOCK = BigInt(process.env.E2E_FORK_BLOCK ?? '0');

/** `describe`, or `describe.skip` with the reason when there is no fork. */
export const describeFork = (name: string, fn: () => void): void => {
  if (SKIP_REASON !== undefined) {
    describe.skip(`${name} (skipped: ${SKIP_REASON})`, fn);
  } else {
    describe(name, fn);
  }
};

const rawTransport = http(ANVIL_URL, { timeout: 120_000, retryCount: 2 });

/**
 * eth_getLogs answers for ranges that end before the fork block are
 * immutable, so identical requests are answered from memory: the SDK
 * re-scans the factory and split logs from the OVM factory's deployment
 * block on every OVM operation, and a public RPC rate-limits the repeats.
 * The first request of each range still goes through anvil to the RPC.
 * E2E_LOG_CACHE=0 turns this off.
 */
const logCache = new Map<string, unknown>();
let upstreamLogRequests = 0;
export const logRequestStats = (): { upstream: number; cached: number } => ({
  upstream: upstreamLogRequests,
  cached: logCache.size,
});

const transport = (): Transport => {
  if (process.env.E2E_LOG_CACHE === '0') return rawTransport;
  return (config => {
    const inner = rawTransport(config);
    const request = (async ({ method, params }) => {
      if (method !== 'eth_getLogs') {
        return await inner.request({ method, params } as never);
      }
      const [filter] = params as [{ toBlock?: string }];
      const cacheable =
        typeof filter?.toBlock === 'string' &&
        filter.toBlock.startsWith('0x') &&
        BigInt(filter.toBlock) < FORK_BLOCK;
      const key = JSON.stringify(params);
      if (cacheable && logCache.has(key)) return logCache.get(key);
      upstreamLogRequests++;
      const result = await inner.request({ method, params } as never);
      if (cacheable) logCache.set(key, result);
      return result;
    }) as EIP1193RequestFn;
    return { ...inner, request };
  }) as Transport;
};

export const publicClient: PublicClient = createPublicClient({
  chain: hoodi,
  transport: transport(),
  pollingInterval: 100,
});

export const testClient = createTestClient({
  mode: 'anvil',
  chain: hoodi,
  transport: transport(),
});

export const HOODI = {
  ovmFactory: '0x5754C8665B7e7BF15E83fCdF6d9636684B782b12',
  pullSplitFactory: '0x5cbA88D55Cec83caD5A105Ad40C8c9aF20bE21d1',
  warehouse: '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8',
  multicall3: '0xcA11bde05977b3631167028862bE2a173976CA11',
  withdrawalRequest: '0x00000961Ef480Eb55e80D19ad83579A64c007002',
  consolidationRequest: '0x0000BBdDc7CE488642fb579F8B00f3a590007251',
  batchDeposit: '0x4c9506eE2fCd962f03022D9d8ebf6f7828abEfaf',
  depositContract: '0x00000000219ab540356cBB839Cbe05303d7705Fa',
  rafRecipient: '0x43F641fA70e09f0326ac66b4Ef0C416EaEcBC6f5',
  safeProxyFactory: '0x4e1DCf7AD4e460CfD30791CCC4F9c8a4f820ec67',
  safeSingleton: '0x41675C099F32341bf84BFc5382aF534df5C7461a',
} as const satisfies Record<string, Address>;

export const FORK_VERSION_HOODI = '0x10000910';

const MNEMONIC = 'test test test test test test test test test test test junk';

export interface Signer {
  account: Account;
  address: Address;
  walletClient: WalletClient;
  obol: ObolClient;
}

export const obolFor = (
  walletClient?: WalletClient,
  api: Parameters<typeof createObolClient>[0]['api'] = false,
): ObolClient =>
  createObolClient({
    chain: hoodi,
    publicClient,
    ...(walletClient !== undefined ? { walletClient } : {}),
    api,
  });

/**
 * Anvil dev account `index` as a funded plain EOA. On Hoodi most of these
 * well-known accounts carry an EIP-7702 delegation set by third parties;
 * clearing the code keeps transfers to them plain ETH transfers.
 */
export const signer = async (index: number): Promise<Signer> => {
  const account = mnemonicToAccount(MNEMONIC, { addressIndex: index });
  await testClient.setCode({ address: account.address, bytecode: '0x' });
  await testClient.setBalance({
    address: account.address,
    value: parseEther('10000'),
  });
  const walletClient = createWalletClient({
    account,
    chain: hoodi,
    transport: transport(),
  });
  return {
    account,
    address: account.address,
    walletClient,
    obol: obolFor(walletClient),
  };
};

/** A wallet that sends as `address` through anvil_impersonateAccount. */
export const impersonate = async (address: Address): Promise<Signer> => {
  await testClient.impersonateAccount({ address });
  await testClient.setBalance({ address, value: parseEther('10000') });
  const walletClient = createWalletClient({
    account: address,
    chain: hoodi,
    transport: transport(),
  });
  return {
    account: { address, type: 'json-rpc' } as unknown as Account,
    address,
    walletClient,
    obol: obolFor(walletClient),
  };
};

/** A fresh address with no code and no balance. */
export const randomAddress = (): Address =>
  privateKeyToAccount(generatePrivateKey()).address;

export const codes = (checks: Finding[]): string[] => checks.map(c => c.code);

export const balanceOf = async (
  address: Address,
  blockNumber?: bigint,
): Promise<bigint> =>
  await publicClient.getBalance({
    address,
    ...(blockNumber !== undefined ? { blockNumber } : {}),
  });

export const gasCost = (receipt: TransactionReceipt): bigint =>
  receipt.gasUsed * receipt.effectiveGasPrice;

/** `obol.send` then `wait`; returns the receipt (wait throws on revert). */
export const sendAndWait = async (
  obol: ObolClient,
  prepared: Prepared<unknown>,
): Promise<TransactionReceipt> => {
  const sent = await obol.send(prepared);
  return await sent.wait({ timeoutMs: 120_000 });
};

/** Runs `fn`, expecting an ObolError with `code`; returns the error. */
export const expectCode = async (
  fn: () => Promise<unknown>,
  code: string,
): Promise<{
  code: string;
  message: string;
  details?: Record<string, unknown>;
}> => {
  let caught: unknown;
  try {
    await fn();
  } catch (error) {
    caught = error;
  }
  expect((caught as { code?: string } | undefined)?.code).toBe(code);
  return caught as {
    code: string;
    message: string;
    details?: Record<string, unknown>;
  };
};

/* ------------------------------------------------------------------------ */
/* Deposits with a fresh BLS key                                             */
/* ------------------------------------------------------------------------ */

const DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const ls = bls12_381.longSignatures;
const { Fr } = bls12_381.fields;

const hex = (bytes: Uint8Array): Hex => `0x${bytesToHex(bytes)}`;

export const randomBlsSecret = (): bigint =>
  Fr.create(BigInt(hex(crypto.getRandomValues(new Uint8Array(48)))));

export const blsPubkey = (secret: bigint): Hex =>
  hex(bls12_381.G1.Point.BASE.multiply(secret).toBytes());

/**
 * A deposit for a fresh validator key, signed in the Hoodi deposit domain:
 * credentials `prefix ‖ 11 zero bytes ‖ withdrawalAddress`.
 */
export const makeDeposit = (args: {
  withdrawalAddress: Address;
  prefix?: '0x01' | '0x02';
  amount?: bigint;
  secret?: bigint;
}): Deposit & { secret: bigint } => {
  const secret = args.secret ?? randomBlsSecret();
  const pubkey = blsPubkey(secret);
  const amount = args.amount ?? parseEther('32');
  const withdrawalCredentials =
    `${args.prefix ?? '0x01'}${'0'.repeat(22)}${args.withdrawalAddress.slice(2).toLowerCase()}` as Hex;
  const amountGwei = amount / GWEI;
  const root = depositSigningRoot(
    {
      pubkey,
      withdrawal_credentials: withdrawalCredentials,
      amount: amountGwei.toString(),
    },
    depositDomainForFork(FORK_VERSION_HOODI),
  );
  const signature = hex(
    ls.Signature.toBytes(ls.hash(root, DST).multiply(secret)),
  );
  return {
    pubkey,
    withdrawalCredentials,
    signature,
    depositDataRoot: depositDataRoot({
      pubkey,
      withdrawalCredentials,
      amountGwei,
      signature,
    }),
    amount,
    secret,
  };
};

/* ------------------------------------------------------------------------ */
/* Chain readers for after-the-fact checks                                   */
/* ------------------------------------------------------------------------ */

export const depositContractAbi = parseAbi([
  'event DepositEvent(bytes pubkey, bytes withdrawal_credentials, bytes amount, bytes signature, bytes index)',
  'function get_deposit_count() view returns (bytes)',
]);

/** Little-endian uint64 bytes (deposit contract encoding) to bigint. */
export const littleEndian = (bytes: Hex): bigint => {
  const raw = bytes.slice(2);
  let value = 0n;
  for (let i = raw.length - 2; i >= 0; i -= 2) {
    value = (value << 8n) | BigInt(`0x${raw.slice(i, i + 2)}`);
  }
  return value;
};

export const depositCount = async (blockNumber?: bigint): Promise<bigint> =>
  littleEndian(
    await publicClient.readContract({
      address: HOODI.depositContract,
      abi: depositContractAbi,
      functionName: 'get_deposit_count',
      ...(blockNumber !== undefined ? { blockNumber } : {}),
    }),
  );
