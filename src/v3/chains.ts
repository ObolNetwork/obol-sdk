import { getAddress, type Address, type Hex } from 'viem';
import { ObolError } from './errors.js';

/** Contracts the SDK calls on a chain with Obol contracts (mainnet, Hoodi). */
export interface ChainContracts {
  ovmFactory: { address: Address; deployBlock: bigint };
  pullSplitFactory: Address;
  warehouse: Address;
  multicall3: Address;
  batchDeposit: Address;
  withdrawalRequest: Address;
  consolidationRequest: Address;
  rafRecipient: Address;
  obolToken: Address;
  splitMain: Address;
  owrFactory: Address;
}

export interface ObolChain {
  id: number;
  name: string;
  /** Network name in Obol API paths. */
  network: string;
  forkVersion: Hex;
  capellaForkVersion: Hex;
  genesisValidatorsRoot?: Hex;
  /** Absent on chains supported for cluster files only. */
  contracts?: ChainContracts;
}

const WAREHOUSE = getAddress('0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8');
const PULL_SPLIT_FACTORY = getAddress(
  '0x5cbA88D55Cec83caD5A105Ad40C8c9aF20bE21d1',
);
const MULTICALL3 = getAddress('0xcA11bde05977b3631167028862bE2a173976CA11');
const WITHDRAWAL_REQUEST = getAddress(
  '0x00000961Ef480Eb55e80D19ad83579A64c007002',
);
const CONSOLIDATION_REQUEST = getAddress(
  '0x0000BBdDc7CE488642fb579F8B00f3a590007251',
);

export const CHAINS: Record<number, ObolChain> = {
  1: {
    id: 1,
    name: 'mainnet',
    network: 'mainnet',
    forkVersion: '0x00000000',
    capellaForkVersion: '0x03000000',
    genesisValidatorsRoot:
      '0x4b363db94e286120d76eb905340fdd4e54bfe9f06bf33ff6cf5ad27f511bfe95',
    contracts: {
      ovmFactory: {
        address: getAddress('0x2c26B5A373294CaccBd3DE817D9B7C6aea7De584'),
        deployBlock: 23919948n,
      },
      pullSplitFactory: PULL_SPLIT_FACTORY,
      warehouse: WAREHOUSE,
      multicall3: MULTICALL3,
      batchDeposit: getAddress('0xcD7a6C118Ac8F6544BC5076F2D8Fb86D2C546756'),
      withdrawalRequest: WITHDRAWAL_REQUEST,
      consolidationRequest: CONSOLIDATION_REQUEST,
      rafRecipient: getAddress('0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d'),
      obolToken: getAddress('0x0B010000b7624eb9B3DfBC279673C76E9D29D5F7'),
      splitMain: getAddress('0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE'),
      owrFactory: getAddress('0x119acd7844cbdd5fc09b1c6a4408f490c8f7f522'),
    },
  },
  560048: {
    id: 560048,
    name: 'hoodi',
    network: 'hoodi',
    forkVersion: '0x10000910',
    capellaForkVersion: '0x40000910',
    genesisValidatorsRoot:
      '0x212f13fc4df078b6cb7db228f1c8307566dcecf900867401a92023d7ba99cb5f',
    contracts: {
      ovmFactory: {
        address: getAddress('0x5754C8665B7e7BF15E83fCdF6d9636684B782b12'),
        deployBlock: 1735335n,
      },
      pullSplitFactory: PULL_SPLIT_FACTORY,
      warehouse: WAREHOUSE,
      multicall3: MULTICALL3,
      batchDeposit: getAddress('0x4c9506eE2fCd962f03022D9d8ebf6f7828abEfaf'),
      withdrawalRequest: WITHDRAWAL_REQUEST,
      consolidationRequest: CONSOLIDATION_REQUEST,
      rafRecipient: getAddress('0x43F641fA70e09f0326ac66b4Ef0C416EaEcBC6f5'),
      obolToken: getAddress('0x6407a4f5cfa1ccb0ef9e6cfb9ee12bf9756262c3'),
      splitMain: getAddress('0xc05ae267291705ac16F75283572294ed2a91CBc7'),
      owrFactory: getAddress('0x9ff0c649d0bf5fe7efa4d72e94bed7302ed5c8d7'),
    },
  },
  100: {
    id: 100,
    name: 'gnosis',
    network: 'gnosis',
    forkVersion: '0x00000064',
    capellaForkVersion: '0x03000064',
  },
  11155111: {
    id: 11155111,
    name: 'sepolia',
    network: 'sepolia',
    forkVersion: '0x90000069',
    capellaForkVersion: '0x90000072',
  },
};

export const getObolChain = (chainId: number): ObolChain => {
  const chain = CHAINS[chainId];
  if (chain === undefined) {
    throw new ObolError(
      'UNSUPPORTED_CHAIN',
      `Chain ${chainId} is not supported`,
      {
        hint: 'Use mainnet (1) or Hoodi (560048)',
        details: { chainId },
      },
    );
  }
  return chain;
};

/** G2: the chain must have Obol contracts for this operation. */
export const requireContracts = (
  chainId: number,
  operation: string,
): ChainContracts => {
  const contracts = getObolChain(chainId).contracts;
  if (contracts === undefined) {
    throw new ObolError(
      'UNSUPPORTED_CHAIN',
      `${operation} is not available on chain ${chainId}`,
      {
        hint: 'Obol contracts are on mainnet (1) and Hoodi (560048)',
        details: { chainId, operation },
      },
    );
  }
  return contracts;
};

export const chainIdForForkVersion = (forkVersion: string): number | null => {
  const lower = forkVersion.toLowerCase();
  const chain = Object.values(CHAINS).find(c => c.forkVersion === lower);
  return chain?.id ?? null;
};

/** Obol API hosts EIP-712 bearer signatures may be sent to. */
export const ALLOWED_API_BASE_URLS = [
  'https://api.obol.tech',
  'https://obol-api-nonprod-dev.dev.obol.tech',
  'https://obol-api-nonprod-qa.dev.obol.tech',
] as const;

export const DEFAULT_API_BASE_URL = 'https://api.obol.tech';
export const DEFAULT_API_TIMEOUT_MS = 30_000;
