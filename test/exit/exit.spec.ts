import { Exit } from '../../src/exits/exit';
import * as ethUtils from '../../src/exits/ethUtils';
import * as bls from '@chainsafe/bls';
import { ENR } from '@chainsafe/discv5';
import * as elliptic from 'elliptic';
import { CAPELLA_FORK_MAPPING } from '../../src/constants';
import type {
  ExitClusterConfig,
  ExitValidationPayload,
  ExitValidationBlob,
  ExistingExitValidationBlobData,
  SignedExitValidationMessage,
  ExitValidationMessage,
} from '../../src/types';
import { fromHexString, ContainerType, UintNumberType, ByteVectorType } from '@chainsafe/ssz';
import * as verificationHelpers from '../../src/exits/verificationHelpers';
import { aggregateSignatures } from '@chainsafe/bls';

// Add SSZ type definitions for exit aggregation test
const VoluntaryExit = new ContainerType({
  epoch: new UintNumberType(8),
  validator_index: new UintNumberType(8)
});

const SignedVoluntaryExit = new ContainerType({
  message: VoluntaryExit,
  signature: new ByteVectorType(96),
});

// Helper functions for exit aggregation test
function makeSignedVoluntaryExit(epoch: number, validatorIndex: number, signature: string): { message: { epoch: number; validator_index: number }; signature: Uint8Array } {
  return {
    message: {
      epoch: epoch,
      validator_index: validatorIndex,
    },
    signature: fromHexString(signature.startsWith('0x') ? signature.substring(2) : signature),
  };
}

function aggregate(signatures: string[]): Uint8Array {
  const sigBytes = signatures.map(sig =>
    fromHexString(sig.startsWith('0x') ? sig.substring(2) : sig)
  );
  return aggregateSignatures(sigBytes);
}

// --- Mocks ---
jest.mock('../../src/exits/ethUtils');
jest.mock('@chainsafe/bls', () => {
  const actual = jest.requireActual('@chainsafe/bls');
  return {
    __esModule: true,
    ...actual,
    init: jest.fn(),
    verify: jest.fn(),
  };
});
// ENR and elliptic will be spied on, not fully mocked at module level for more flexibility

const mockedEthUtils = ethUtils as jest.Mocked<typeof ethUtils>;
const mockedBls = bls as jest.Mocked<typeof bls>;

// --- Test Data ---
const MAINNET_BASE_FORK_VERSION = '0x00000000';
const MAINNET_CAPELLA_FORK_VERSION =
  CAPELLA_FORK_MAPPING[MAINNET_BASE_FORK_VERSION];
const MOCK_GENESIS_ROOT =
  '0x0000000000000000000000000000000000000000000000000000000000000001';
const MOCK_BEACON_API_URL = 'http://localhost:5052';

const mockOperatorEnr =
  'enr:-LK4QFo_n0dUm4PKejSOXf8JkSWq5EINV0XhG1zY00d22QpYdyxSAyQNsGkYQyKR5Ohe2kEkmS0nS31tuqVfXDNf_vEAhGV0aAgQD___2iXChwcEChAgAAAAADg__________g2V0aMfLCGgohEAcNlBpLdCgAAAQAdIaENsZS0CAAAABAAAAAAAAAAAAAAAAAAAAACAAAAAAAAAAIAAAAAAAAAAIAAAAAAAAAYAAAAAAAAAAAAAAAAAAAIQA___________gmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPKwrO7sVJzX4B2vW1bTqWCpGA93R2aZqa2ZCrqSrh8CYN1ZHCCIyg';
const mockOperatorPublicKeyHex =
  '03ca0aceeec549cd7f8076bd6d5b4ea582a4603ddd1d9a66a6b6642aeaa4ae1f09';

const mockExitMessage: ExitValidationMessage = {
  epoch: '1',
  validator_index: '10',
};

const mockSignedExitMessage: SignedExitValidationMessage = {
  message: mockExitMessage,
  signature: '0x' + 'ab'.repeat(96),
};

const mockExitBlob: ExitValidationBlob = {
  public_key: '0x' + 'cd'.repeat(48),
  signed_exit_message: mockSignedExitMessage,
};

const mockExitPayload: ExitValidationPayload = {
  partial_exits: [mockExitBlob],
  share_idx: 1,
  signature: '0x' + 'ef'.repeat(65),
};

// Make mockClusterConfig directly ExitClusterConfig for easier use in tests
const mockClusterConfig: ExitClusterConfig = {
  definition: {
    operators: [{ enr: mockOperatorEnr }],
    fork_version: MAINNET_BASE_FORK_VERSION,
    threshold: 1,
  },
  distributed_validators: [
    {
      distributed_public_key: mockExitBlob.public_key,
      public_shares: ['0x' + 'aa'.repeat(48)],
    },
  ],
};

const mockExistingBlobData: ExistingExitValidationBlobData = {
  public_key: mockExitBlob.public_key,
  epoch: mockExitMessage.epoch,
  validator_index: mockExitMessage.validator_index,
  shares_exit_data: [],
};

describe('exit', () => {
  let enrDecodeTxtSpy: jest.SpyInstance;
  let ecVerifySpy: jest.SpyInstance;
  let keyFromPublicSpy: jest.SpyInstance;
  let exit: Exit;

  beforeEach(() => {
    jest.resetAllMocks();

    exit = new Exit(1, null);

    (mockedBls.init as jest.Mock).mockResolvedValue(undefined);
    (mockedBls.verify as jest.Mock).mockReturnValue(true);

    mockedEthUtils.getCapellaFork.mockResolvedValue(
      MAINNET_CAPELLA_FORK_VERSION,
    );
    mockedEthUtils.getGenesisValidatorsRoot.mockResolvedValue(
      MOCK_GENESIS_ROOT,
    );

    const mockDecodedENR: Partial<ENR> = {
      publicKey: Buffer.from(mockOperatorPublicKeyHex, 'hex'),
    };
    enrDecodeTxtSpy = jest
      .spyOn(ENR, 'decodeTxt')
      .mockReturnValue(mockDecodedENR as ENR);

    ecVerifySpy = jest.fn().mockReturnValue(true);
    keyFromPublicSpy = jest.spyOn(elliptic.ec.prototype, 'keyFromPublic');
    keyFromPublicSpy.mockImplementation(function () {
      return { verify: ecVerifySpy };
    });
  });

  afterEach(() => {
    if (enrDecodeTxtSpy) enrDecodeTxtSpy.mockRestore();
    jest.restoreAllMocks();
  });

  describe('verifyPartialExitSignature', () => {
    const publicShareKey =
      mockClusterConfig.distributed_validators[0].public_shares[0];

    it('should return true for a valid signature', async () => {
      const isValid = await exit.verifyPartialExitSignature(
        publicShareKey,
        mockSignedExitMessage,
        MAINNET_BASE_FORK_VERSION,
        MOCK_GENESIS_ROOT,
      );
      expect(isValid).toBe(true);
      expect(mockedBls.init).toHaveBeenCalledWith('herumi');
      expect(mockedBls.verify).toHaveBeenCalled();
      expect(mockedEthUtils.getCapellaFork).toHaveBeenCalledWith(
        MAINNET_BASE_FORK_VERSION,
      );
    });

    it('should return false if BLS verification fails', async () => {
      mockedBls.verify.mockReturnValue(false);
      const isValid = await exit.verifyPartialExitSignature(
        publicShareKey,
        mockSignedExitMessage,
        MAINNET_BASE_FORK_VERSION,
        MOCK_GENESIS_ROOT,
      );
      expect(isValid).toBe(false);
    });

    it('should throw if getCapellaFork returns null', async () => {
      mockedEthUtils.getCapellaFork.mockResolvedValue(null);
      await expect(
        exit.verifyPartialExitSignature(
          publicShareKey,
          mockSignedExitMessage,
          MAINNET_BASE_FORK_VERSION,
          MOCK_GENESIS_ROOT,
        ),
      ).rejects.toThrow('Could not determine Capella fork version');
    });

    it('should call computeDomain and signingRoot with correct parameters', async () => {
      const computeDomainSpy = jest.spyOn(verificationHelpers, 'computeDomain');
      const signingRootSpy = jest.spyOn(verificationHelpers, 'signingRoot');

      await exit.verifyPartialExitSignature(
        publicShareKey,
        mockSignedExitMessage,
        MAINNET_BASE_FORK_VERSION,
        MOCK_GENESIS_ROOT,
      );

      expect(computeDomainSpy).toHaveBeenCalledWith(
        fromHexString('04000000'),
        MAINNET_CAPELLA_FORK_VERSION,
        fromHexString(MOCK_GENESIS_ROOT.substring(2)),
      );
      expect(signingRootSpy).toHaveBeenCalled();

      computeDomainSpy.mockRestore();
      signingRootSpy.mockRestore();
    });
  });

  describe('verifyExitPayloadSignature', () => {
    it('should return true for a valid ECDSA signature', async () => {
      const isValid = await exit.verifyExitPayloadSignature(
        mockOperatorEnr,
        mockExitPayload,
      );
      expect(isValid).toBe(true);
      expect(enrDecodeTxtSpy).toHaveBeenCalledWith(mockOperatorEnr);
      expect(ecVerifySpy).toHaveBeenCalled();
    });

    it('should return false if ECDSA verification fails', async () => {
      ecVerifySpy.mockReturnValue(false);
      const isValid = await exit.verifyExitPayloadSignature(
        mockOperatorEnr,
        mockExitPayload,
      );
      expect(isValid).toBe(false);
    });

    it('should throw if ENR is invalid', async () => {
      enrDecodeTxtSpy.mockImplementation(() => {
        throw new Error('Invalid ENR');
      });
      await expect(
        exit.verifyExitPayloadSignature('invalid-enr', mockExitPayload),
      ).rejects.toThrow('Invalid ENR string');
    });

    it('should throw if signature hex is not 128 characters (excluding 0x)', async () => {
      const payloadWithInvalidSig = {
        ...mockExitPayload,
        signature: '0x123456',
      };
      await expect(
        exit.verifyExitPayloadSignature(mockOperatorEnr, payloadWithInvalidSig),
      ).rejects.toThrow('Invalid signature length');
    });
  });

  describe('validateExitBlobs', () => {
    it('should successfully validate a new, valid exit blob', async () => {
      const result = await exit.validateExitBlobs(
        mockClusterConfig,
        mockExitPayload,
        MOCK_BEACON_API_URL,
        null, // No existing blob data
      );
      expect(result).toEqual([mockExitBlob]);
      expect(ecVerifySpy).toHaveBeenCalled(); // Called by internal verifyExitPayloadSignature
      expect(mockedBls.verify).toHaveBeenCalled(); // Called by internal verifyPartialExitSignature
    });

    it('should throw if operatorIndex (from share_idx) is out of bounds', async () => {
      const invalidPayload = { ...mockExitPayload, share_idx: 0 };
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          invalidPayload,
          MOCK_BEACON_API_URL,
          mockExistingBlobData,
        ),
      ).rejects.toThrow('Invalid share_idx');

      const invalidPayload2 = {
        ...mockExitPayload,
        share_idx: mockClusterConfig.definition.operators.length + 1,
      };
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          invalidPayload2,
          MOCK_BEACON_API_URL,
          mockExistingBlobData,
        ),
      ).rejects.toThrow('Invalid share_idx');
    });

    it('should throw if payload signature is invalid', async () => {
      ecVerifySpy.mockReturnValue(false);
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          mockExistingBlobData,
        ),
      ).rejects.toThrow('Incorrect payload signature');
    });

    it('should throw if getGenesisValidatorsRoot returns null', async () => {
      mockedEthUtils.getGenesisValidatorsRoot.mockResolvedValue(null);
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          mockExistingBlobData,
        ),
      ).rejects.toThrow('Could not retrieve genesis validators root');
    });

    it('should throw if getCapellaFork returns null (unsupported network)', async () => {
      mockedEthUtils.getCapellaFork.mockResolvedValue(null);
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          mockExistingBlobData,
        ),
      ).rejects.toThrow(
        'Unsupported network: Could not determine Capella fork',
      );
    });

    it('should throw if a public key in an exit blob is not found in cluster config', async () => {
      const blobWithUnknownKey: ExitValidationBlob = {
        ...mockExitBlob,
        public_key: '0x' + 'deadbeef'.repeat(12),
      };
      const payloadWithUnknownKey = {
        ...mockExitPayload,
        partial_exits: [blobWithUnknownKey],
      };
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          payloadWithUnknownKey,
          MOCK_BEACON_API_URL,
          null, // No existing blob data
        ),
      ).rejects.toThrow(
        "Public key 0xdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeefdeadbeef not found in the cluster's distributed validators.",
      );
    });

    it('should throw if a partial exit signature is invalid', async () => {
      mockedBls.verify.mockReturnValue(false);
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          null, // No existing blob data
        ),
      ).rejects.toThrow(
        'Invalid partial exit signature for validator 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd by operator index 0.',
      );
    });

    it('should return an empty array if an exit blob has already been processed (epoch match)', async () => {
      const result = await exit.validateExitBlobs(
        mockClusterConfig,
        mockExitPayload,
        MOCK_BEACON_API_URL,
        mockExistingBlobData,
      );
      expect(result).toEqual([]);
    });

    it('should throw if an exit blob has been processed with a different validator index', async () => {
      const existingBlobWithDifferentIndex: ExistingExitValidationBlobData = {
        public_key: mockExitBlob.public_key,
        epoch: mockExitMessage.epoch,
        validator_index: (
          parseInt(mockExitMessage.validator_index, 10) + 1
        ).toString(), // Different index
        shares_exit_data: [],
      };

      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          existingBlobWithDifferentIndex,
        ),
      ).rejects.toThrow(
        'Validator index mismatch for already processed exit for public key 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd. Expected 11, got 10.',
      );
    });

    it('should throw if an exit blob has been processed with a higher epoch', async () => {
      const existingBlobWithHigherEpoch: ExistingExitValidationBlobData = {
        public_key: mockExitBlob.public_key,
        epoch: (parseInt(mockExitMessage.epoch, 10) + 1).toString(), // Existing epoch is HIGHER (e.g. 2)
        validator_index: mockExitMessage.validator_index,
        shares_exit_data: [],
      };

      // currentExitBlob (from mockExitPayload) has mockExitMessage.epoch (e.g. '1')
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          existingBlobWithHigherEpoch,
        ),
      ).rejects.toThrow(
        'New exit epoch 1 is not greater than existing exit epoch 2 for validator 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd.',
      );
    });

    it('should successfully validate if an exit blob has been processed with a lower epoch', async () => {
      const existingBlobWithLowerEpoch: ExistingExitValidationBlobData = {
        public_key: mockExitBlob.public_key,
        epoch: (parseInt(mockExitMessage.epoch, 10) - 1).toString(),
        validator_index: mockExitMessage.validator_index,
        shares_exit_data: [],
      };

      const result = await exit.validateExitBlobs(
        mockClusterConfig,
        mockExitPayload,
        MOCK_BEACON_API_URL,
        existingBlobWithLowerEpoch,
      );
      expect(result).toEqual([mockExitBlob]);
    });

    it('should throw on signature mismatch for existing blob with same epoch', async () => {
      const operatorIndex = 0;
      const operatorShareIndexString = String(operatorIndex);

      const existingBlobWithDifferentSignature: ExistingExitValidationBlobData =
        {
          public_key: mockExitBlob.public_key,
          epoch: mockExitMessage.epoch,
          validator_index: mockExitMessage.validator_index,
          shares_exit_data: [
            {
              [operatorShareIndexString]: {
                partial_exit_signature: '0x' + 'different'.repeat(16),
              },
            },
          ],
        };

      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          existingBlobWithDifferentSignature,
        ),
      ).rejects.toThrow(
        'Signature mismatch for validator 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd, operator index 0 at epoch 1.',
      );
    });

    it('should handle multiple blobs, some new, some already processed', async () => {
      const anotherMockExitBlob: ExitValidationBlob = {
        public_key: '0x' + '11'.repeat(48),
        signed_exit_message: {
          message: { epoch: '2', validator_index: '20' },
          signature: '0x' + 'bb'.repeat(96),
        },
      };
      const payloadWithTwoBlobs = {
        ...mockExitPayload,
        partial_exits: [mockExitBlob, anotherMockExitBlob],
      };
      const clusterConfigWithTwoValidators: ExitClusterConfig = {
        ...mockClusterConfig,
        distributed_validators: [
          ...mockClusterConfig.distributed_validators,
          {
            distributed_public_key: anotherMockExitBlob.public_key,
            public_shares: ['0x' + 'cc'.repeat(48)],
          },
        ],
      };

      // Only the first blob has existing data, second is new
      const existingBlobDataForFirstOnly: ExistingExitValidationBlobData = {
        public_key: mockExitBlob.public_key,
        epoch: mockExitMessage.epoch,
        validator_index: mockExitMessage.validator_index,
        shares_exit_data: [],
      };

      const result = await exit.validateExitBlobs(
        clusterConfigWithTwoValidators,
        payloadWithTwoBlobs,
        MOCK_BEACON_API_URL,
        existingBlobDataForFirstOnly,
      );

      expect(result.length).toBe(1);
      expect(result[0]).toEqual(anotherMockExitBlob);
    });

    it('should throw if getGenesisValidatorsRoot itself throws an error', async () => {
      mockedEthUtils.getGenesisValidatorsRoot.mockRejectedValue(
        new Error('Beacon node unavailable'),
      );
      await expect(
        exit.validateExitBlobs(
          mockClusterConfig,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          mockExistingBlobData,
        ),
      ).rejects.toThrow('Beacon node unavailable');
    });

    // Additional test cases to match API service coverage

    it('should handle public key format differences (with and without 0x prefix)', async () => {
      const blobWithoutPrefix: ExitValidationBlob = {
        ...mockExitBlob,
        public_key: 'cd'.repeat(48), // Without 0x prefix
      };
      const payloadWithoutPrefix = {
        ...mockExitPayload,
        partial_exits: [blobWithoutPrefix],
      };
      const clusterConfigWithoutPrefix: ExitClusterConfig = {
        ...mockClusterConfig,
        distributed_validators: [
          {
            distributed_public_key: '0x' + 'cd'.repeat(48), // With 0x prefix
            public_shares: ['0x' + 'aa'.repeat(48)],
          },
        ],
      };

      const result = await exit.validateExitBlobs(
        clusterConfigWithoutPrefix,
        payloadWithoutPrefix,
        MOCK_BEACON_API_URL,
        null, // No existing blob data
      );
      expect(result).toEqual([blobWithoutPrefix]);
    });

    it('should handle public key case differences', async () => {
      const blobWithUppercase: ExitValidationBlob = {
        ...mockExitBlob,
        public_key: '0x' + 'CD'.repeat(48), // Uppercase
      };
      const payloadWithUppercase = {
        ...mockExitPayload,
        partial_exits: [blobWithUppercase],
      };
      const clusterConfigWithLowercase: ExitClusterConfig = {
        ...mockClusterConfig,
        distributed_validators: [
          {
            distributed_public_key: '0x' + 'cd'.repeat(48), // Lowercase
            public_shares: ['0x' + 'aa'.repeat(48)],
          },
        ],
      };

      const result = await exit.validateExitBlobs(
        clusterConfigWithLowercase,
        payloadWithUppercase,
        MOCK_BEACON_API_URL,
        null, // No existing blob data
      );
      expect(result).toEqual([blobWithUppercase]);
    });

    it('should throw if public share for operator index is not found', async () => {
      const clusterConfigWithMissingShare: ExitClusterConfig = {
        ...mockClusterConfig,
        distributed_validators: [
          {
            distributed_public_key: mockExitBlob.public_key,
            public_shares: [], // Empty public shares array
          },
        ],
      };

      await expect(
        exit.validateExitBlobs(
          clusterConfigWithMissingShare,
          mockExitPayload,
          MOCK_BEACON_API_URL,
          mockExistingBlobData,
        ),
      ).rejects.toThrow(
        'Public share for operator index 0 not found for validator 0xcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcdcd',
      );
    });
  });

  // Add other tests for different scenarios: epoch mismatch, already exited, etc.

  // Consider testing the case where getExistingBlobData throws an error

  describe('exit aggregation', () => {
    // Test values based on Charon's test at:
    // https://github.com/ObolNetwork/charon/blob/main/app/obolapi/exit_test.go#L194-L207
    const EPOCH = 162304;
    const VALIDATOR_INDEX = 123456;

    // Three partial BLS signatures (96 bytes each) from Charon test
    const PARTIAL_SIGNATURES = [
      '0x8d3cf5c14a2a42b5b6b3f1c7e9a2f8b5d6c7e4f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3',
      '0x9e4cf5c14a2a42b5b6b3f1c7e9a2f8b5d6c7e4f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f4',
      '0xaf5cf5c14a2a42b5b6b3f1c7e9a2f8b5d6c7e4f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f5'
    ];

    // Expected aggregated signature from Charon test
    const EXPECTED_AGGREGATED_SIGNATURE = '0xb06cf5c14a2a42b5b6b3f1c7e9a2f8b5d6c7e4f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f6';

    // Expected SSZ serialized hex from Charon test
    const EXPECTED_SSZ_HEX = '0x00900200000000000040e20100000000b06cf5c14a2a42b5b6b3f1c7e9a2f8b5d6c7e4f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b1c2d3e4f5a6b7c8d9e0f1a2b3c4d5e6f7a8b9c0d1e2f6';

    beforeEach(async () => {
      await mockedBls.init('herumi');
    });

    it('should aggregate partial signatures correctly', async () => {
      // Aggregate the partial signatures
      const aggSig = aggregate(PARTIAL_SIGNATURES);

      // Convert to hex string for comparison
      const aggSigHex = '0x' + Buffer.from(aggSig).toString('hex');

      // Assert the aggregated signature matches expected
      expect(aggSigHex).toBe(EXPECTED_AGGREGATED_SIGNATURE);
    });

    it('should create and serialize SignedVoluntaryExit correctly', async () => {
      // Aggregate partial signatures
      const aggSig = aggregate(PARTIAL_SIGNATURES);
      const aggSigHex = '0x' + Buffer.from(aggSig).toString('hex');

      // Create SignedVoluntaryExit using helper function
      const signedExit = makeSignedVoluntaryExit(EPOCH, VALIDATOR_INDEX, aggSigHex);

      // SSZ serialize the SignedVoluntaryExit
      const serialized = SignedVoluntaryExit.serialize(signedExit);
      const serializedHex = '0x' + Buffer.from(serialized).toString('hex');

      // Assert the serialized hex matches expected from Charon
      expect(serializedHex).toBe(EXPECTED_SSZ_HEX);
    });

    it('should roundtrip SSZ serialization correctly', async () => {
      // Create SignedVoluntaryExit
      const aggSig = aggregate(PARTIAL_SIGNATURES);
      const aggSigHex = '0x' + Buffer.from(aggSig).toString('hex');
      const signedExit = makeSignedVoluntaryExit(EPOCH, VALIDATOR_INDEX, aggSigHex);

      // Serialize and deserialize
      const serialized = SignedVoluntaryExit.serialize(signedExit);
      const deserialized = SignedVoluntaryExit.deserialize(serialized);

      // Assert values are preserved
      expect(deserialized.message.epoch).toBe(BigInt(EPOCH));
      expect(deserialized.message.validator_index).toBe(BigInt(VALIDATOR_INDEX));
      expect(Buffer.from(deserialized.signature).toString('hex')).toBe(aggSigHex.substring(2));
    });

    it('should handle signature aggregation with different input formats', async () => {
      // Test with signatures without 0x prefix
      const signaturesWithoutPrefix = PARTIAL_SIGNATURES.map(sig => sig.substring(2));
      const aggSig1 = aggregate(PARTIAL_SIGNATURES);
      const aggSig2 = aggregate(signaturesWithoutPrefix);

      // Both should produce the same result
      expect(Buffer.from(aggSig1).toString('hex')).toBe(Buffer.from(aggSig2).toString('hex'));
    });
  });
});
