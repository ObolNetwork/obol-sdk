import { type TypedMessage } from '@metamask/eth-sig-util';
import { type TypedDataDomain } from 'ethers';
import pjson from '../package.json';
import { FORK_MAPPING } from './types';
import {
  HOLESKY_MULTICALL_BYTECODE,
  HOLESKY_OWR_FACTORY_BYTECODE,
  HOLESKY_SPLITMAIN_BYTECODE,
  HOODI_MULTICALL_BYTECODE,
  HOODI_OVM_FACTORY_BYTECODE,
  HOODI_OWR_FACTORY_BYTECODE,
  HOODI_SPLITMAIN_BYTECODE,
  HOODI_WAREHOUSE_BYTECODE,
  MAINNET_MULTICALL_BYTECODE,
  MAINNET_OVM_FACTORY_BYTECOD,
  MAINNET_OWR_FACTORY_BYTECODE,
  MAINNET_SPLITMAIN_BYTECODE,
  MAINNET_WAREHOUSE_BYTECODE,
} from './bytecodes';

import * as dotenv from 'dotenv';
dotenv.config();

export const CONFLICT_ERROR_MSG = 'Conflict';

export const EIP712_DOMAIN_NAME = 'Obol';
export const EIP712_DOMAIN_VERSION = '1';
export const CreatorConfigHashSigningTypes = {
  CreatorConfigHash: [{ name: 'creator_config_hash', type: 'string' }],
};
export const TermsAndConditionsSigningTypes = {
  TermsAndConditions: [
    { name: 'terms_and_conditions_hash', type: 'string' },
    { name: 'version', type: 'uint256' },
  ],
};

const EIP712Domain = [
  { name: 'name', type: 'string' },
  { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' },
];

export const Domain = (chainId?: number): TypedDataDomain => {
  const typeDataDomain: any = {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
  };
  if (chainId) {
    typeDataDomain.chainId = chainId;
  }
  return typeDataDomain;
};

export const CreatorTypedMessage = {
  EIP712Domain,
  ...CreatorConfigHashSigningTypes,
};

// A conflict once updateDefinition is merged
export const EnrSigningTypes = {
  ENR: [{ name: 'enr', type: 'string' }],
};

export const OperatorConfigHashSigningTypes = {
  OperatorConfigHash: [{ name: 'operator_config_hash', type: 'string' }],
};

export const OperatorTypedMessage = {
  EIP712Domain,
  ...OperatorConfigHashSigningTypes,
};

export const ENRTypedMessage = {
  EIP712Domain,
  ...EnrSigningTypes,
};

export const signCreatorConfigHashPayload = (
  payload: { creator_config_hash: string },
  chainId: number,
): TypedMessage<typeof CreatorTypedMessage> => {
  return {
    types: CreatorTypedMessage,
    primaryType: 'CreatorConfigHash',
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
    },
    message: payload,
  };
};

export const signOperatorConfigHashPayload = (
  payload: { operator_config_hash: string },
  chainId: number,
): TypedMessage<typeof OperatorTypedMessage> => {
  return {
    types: OperatorTypedMessage,
    primaryType: 'OperatorConfigHash',
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
    },
    message: payload,
  };
};

export const signEnrPayload = (
  payload: { enr: string },
  chainId: number,
): TypedMessage<typeof ENRTypedMessage> => {
  return {
    types: ENRTypedMessage,
    primaryType: 'ENR',
    domain: {
      name: EIP712_DOMAIN_NAME,
      version: EIP712_DOMAIN_VERSION,
      chainId,
    },
    message: payload,
  };
};

export const DKG_ALGORITHM = 'default';

export const CONFIG_VERSION = 'v1.10.0';

export const SDK_VERSION = pjson.version;

export const DOMAIN_APPLICATION_BUILDER = '00000001';
export const DOMAIN_DEPOSIT = '03000000';
export const GENESIS_VALIDATOR_ROOT =
  '0000000000000000000000000000000000000000000000000000000000000000';

// Flow used to create definition
export enum DefinitionFlow {
  Group = 'LP-Group',
  Solo = 'LP-Solo',
  Charon = 'Charon-Command',
}

export const DEFAULT_BASE_URL = 'https://api.obol.tech';
export const DEFAULT_BASE_VERSION = 'v1';
export const DEFAULT_CHAIN_ID = 17000;

export const ETHER_TO_GWEI = 10 ** 9;

export const TERMS_AND_CONDITIONS_VERSION = 1;
export const TERMS_AND_CONDITIONS_URL =
  TERMS_AND_CONDITIONS_VERSION === 1
    ? 'https://obol.org/terms.pdf'
    : `https://obol.org/${TERMS_AND_CONDITIONS_VERSION as number}/terms.pdf`;
export const TERMS_AND_CONDITIONS_HASH =
  '0xd33721644e8f3afab1495a74abe3523cec12d48b8da6cb760972492ca3f1a273';

export const AVAILABLE_SPLITTER_CHAINS = [
  FORK_MAPPING['0x00000000'],
  FORK_MAPPING['0x01017000'],
  FORK_MAPPING['0x10000910'],
];

export const CHAIN_CONFIGURATION = {
  [AVAILABLE_SPLITTER_CHAINS[0]]: {
    SPLITMAIN_ADDRESS: {
      address: '0x2ed6c4B5dA6378c7897AC67Ba9e43102Feb694EE',
      bytecode: MAINNET_SPLITMAIN_BYTECODE,
    },
    MULTICALL_ADDRESS: {
      address: '0xeefba1e63905ef1d7acba5a8513c70307c1ce441',
      bytecode: MAINNET_MULTICALL_BYTECODE,
    },
    OWR_FACTORY_ADDRESS: {
      address: '0x119acd7844cbdd5fc09b1c6a4408f490c8f7f522',
      bytecode: MAINNET_OWR_FACTORY_BYTECODE,
    },
    RETROACTIVE_FUNDING_ADDRESS: {
      address: '0xDe5aE4De36c966747Ea7DF13BD9589642e2B1D0d',
      bytecode: '',
    },
    // OVM and SplitV2 Contract Addresses
    OVM_FACTORY_ADDRESS: {
      address: '0xdfe2d8b26806583cf03b3cb623b0752f8670e93e', // TODO: Replace with actual address
      bytecode: MAINNET_OVM_FACTORY_BYTECOD,
    },
    WAREHOUSE_ADDRESS: {
      address: '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8', // TODO: Replace with actual address
      bytecode: MAINNET_WAREHOUSE_BYTECODE,
    },
  },
  [AVAILABLE_SPLITTER_CHAINS[1]]: {
    SPLITMAIN_ADDRESS: {
      address: '0xfC8a305728051367797DADE6Aa0344E0987f5286',
      bytecode: HOLESKY_SPLITMAIN_BYTECODE,
    },
    MULTICALL_ADDRESS: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      bytecode: HOLESKY_MULTICALL_BYTECODE,
    },
    OWR_FACTORY_ADDRESS: {
      address: '0xc0961353fcc43a99e3041db07ac646720e116256',
      bytecode: HOLESKY_OWR_FACTORY_BYTECODE,
    },
    RETROACTIVE_FUNDING_ADDRESS: {
      address: '0x43F641fA70e09f0326ac66b4Ef0C416EaEcBC6f5',
      bytecode: '',
    },
  },
  [AVAILABLE_SPLITTER_CHAINS[2]]: {
      SPLITMAIN_ADDRESS: {
      address: '0xc05ae267291705ac16F75283572294ed2a91CBc7',
      bytecode: HOODI_SPLITMAIN_BYTECODE,
    },
    MULTICALL_ADDRESS: {
      address: '0xcA11bde05977b3631167028862bE2a173976CA11',
      bytecode: HOODI_MULTICALL_BYTECODE,
    },
     OWR_FACTORY_ADDRESS: {
      address: '0x9ff0c649d0bf5fe7efa4d72e94bed7302ed5c8d7',
      bytecode: HOODI_OWR_FACTORY_BYTECODE,
    },
    RETROACTIVE_FUNDING_ADDRESS: {
      address: '0x43F641fA70e09f0326ac66b4Ef0C416EaEcBC6f5', 
      bytecode: '',
    },
    // OVM and SplitV2 Contract Addresses
    OVM_FACTORY_ADDRESS: {
      address: '0x6F13d929C783a420AE4DC71C1dcc27A02038Ed09', 
      bytecode: HOODI_OVM_FACTORY_BYTECODE,
    },
    WAREHOUSE_ADDRESS: {
      address: '0x8fb66F38cF86A3d5e8768f8F1754A24A6c661Fb8', 
      bytecode: HOODI_WAREHOUSE_BYTECODE,
    },
  },
};

export const DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT = 1;

export const DEFAULT_RETROACTIVE_FUNDING_TOTAL_SPLIT = 0.1;

// OVM and SplitV2 Default Constants
export const SPLITS_V2_SALT = '0x2fa740d39f3b04b2c7ef4e9f9e1a6e38f4c72c1a91d8595d5d31a3adf17c6b12';
export const PRINCIPAL_THRESHOLD = 16;

export const OBOL_SDK_EMAIL = 'sdk@dvlabs.tech';

export const PROVIDER_MAP: Record<number, string> = {
  1: `${process.env.RPC_MAINNET}`, // Mainnet
  17000: `${process.env.RPC_HOLESKY}`, // Holesky
  11155111: `${process.env.RPC_SEPOLIA}`, // Sepolia
  100: `${process.env.RPC_GNOSIS}`, // Gnosis
};

/**
 * Maps base fork versions to their corresponding Capella fork versions.
 * Example: Mainnet Capella fork version.
 */
export const CAPELLA_FORK_MAPPING: Record<string, string> = {
  '0x00000000': '0x03000000', // Mainnet
  '0x00001020': '0x03001020', // Goerli
  '0x00000064': '0x03000064', // Gnosis
  '0x90000069': '0x90000072', // Sepolia
  '0x01017000': '0x04017000', // Holesky
  '0x10000910': '0x40000910', // Hoodi
};
