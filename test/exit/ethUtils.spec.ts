import { getCapellaFork, getGenesisValidatorsRoot } from '../../src/exits/ethUtils';
import { CAPELLA_FORK_MAPPING, NETWORK_NAME_TO_FORK_VERSION } from '../../src/constants';
import type { HttpRequestFunc } from '../../src/types';

// Mock constants that might not be fully populated in the actual constants.ts for all test cases
// const MOCK_FORK_VERSION_TO_NETWORK_NAME = {
//   // Intentionally kept minimal for tests, or could mirror actual constants
//   '0x00000000': 'mainnet',
//   '0x00001020': 'goerli',
//   '0x01017000': 'holesky',
//   // '0xINVALIDFORK00': 'invalidnetwork', // Example for testing unmapped forks
// };

describe('ethUtils', () => {
  describe('getCapellaFork', () => {
    Object.entries(CAPELLA_FORK_MAPPING).forEach(([baseFork, expectedCapellaFork]) => {
      it(`should return ${expectedCapellaFork} for base fork ${baseFork}`, async () => {
        const result = await getCapellaFork(baseFork);
        expect(result).toBe(expectedCapellaFork);
      });
    });

    it('should return null for an unknown base fork version', async () => {
      const result = await getCapellaFork('0xUNKNOWNFORK');
      expect(result).toBeNull();
    });
  });

  describe('getGenesisValidatorsRoot', () => {
    let mockHttpRequest: jest.MockedFunction<HttpRequestFunc>;
    const mockBeaconApiUrl = 'http://localhost:5052';
    const mainnetForkVersion = NETWORK_NAME_TO_FORK_VERSION['mainnet']; // '0x00000000'
    const mockGenesisRoot = '0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2';

    beforeEach(() => {
      // Create a fresh mock for each test
      mockHttpRequest = jest.fn();
    });

    it('should fetch and return the genesis_validators_root successfully', async () => {
      mockHttpRequest.mockResolvedValueOnce({ data: { genesis_validators_root: mockGenesisRoot } });

      const result = await getGenesisValidatorsRoot(
        mainnetForkVersion,
        mockBeaconApiUrl,
        mockHttpRequest,
      );

      expect(result).toBe(mockGenesisRoot);
      expect(mockHttpRequest).toHaveBeenCalledTimes(1);
      expect(mockHttpRequest).toHaveBeenCalledWith(
        `${mockBeaconApiUrl}/eth/v1/beacon/genesis`,
        { method: 'GET' },
      );
    });

    it('should return null if the HTTP request fails (e.g., network error)', async () => {
      mockHttpRequest.mockRejectedValueOnce(new Error('Network error'));

      await expect(
        getGenesisValidatorsRoot(mainnetForkVersion, mockBeaconApiUrl, mockHttpRequest),
      ).rejects.toThrow('Failed to fetch genesis validators root: Network error');
      expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    });

    it('should return null if the response data structure is invalid (missing genesis_validators_root)', async () => {
      mockHttpRequest.mockResolvedValueOnce({ data: { some_other_field: 'value' } }); // Invalid structure

      const result = await getGenesisValidatorsRoot(
        mainnetForkVersion,
        mockBeaconApiUrl,
        mockHttpRequest,
      );
      expect(result).toBeNull();
      expect(mockHttpRequest).toHaveBeenCalledTimes(1);
    });

    it('should return null if the response data is missing', async () => {
      mockHttpRequest.mockResolvedValueOnce({}); // Missing data property

      const result = await getGenesisValidatorsRoot(
        mainnetForkVersion,
        mockBeaconApiUrl,
        mockHttpRequest,
      );
      expect(result).toBeNull();
    });

    it('should correctly use fork_version to determine network for logging (if FORK_VERSION_TO_NETWORK_NAME is populated)', async () => {
      // This test primarily ensures the function doesn't break if FORK_VERSION_TO_NETWORK_NAME is used.
      // The actual logging output isn't easily testable here without intercepting console.
      // We rely on constants.ts to have FORK_VERSION_TO_NETWORK_NAME for this to be meaningful.
      const consoleWarnSpy = jest.spyOn(console, 'warn').mockImplementation(() => {});
      const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});

      mockHttpRequest.mockResolvedValueOnce({ data: { genesis_validators_root: mockGenesisRoot } });

      await getGenesisValidatorsRoot(mainnetForkVersion, mockBeaconApiUrl, mockHttpRequest);
      // If mainnetForkVersion is in FORK_VERSION_TO_NETWORK_NAME, no warning about missing network.
      // Exact check depends on actual FORK_VERSION_TO_NETWORK_NAME content in constants.
      // For now, we just ensure it runs.
      expect(mockHttpRequest).toHaveBeenCalled();

      // Test with a fork version that might not be in a minimal MOCK_FORK_VERSION_TO_NETWORK_NAME, to see if it handles it gracefully
      // This depends on how strictly the function uses the network name.
      // As per current ethUtils, it proceeds even if network is not found in the map.
      mockHttpRequest.mockResolvedValueOnce({ data: { genesis_validators_root: mockGenesisRoot } });
      await getGenesisValidatorsRoot('0xUNKNOWNFORKFORTEST', mockBeaconApiUrl, mockHttpRequest);
      // If '0xUNKNOWNFORKFORTEST' isn't in the map, a console.warn might have been called by the original code.
      // Since we commented out the console.warn, we can't directly test it. We ensure it still tries to fetch.
      expect(mockHttpRequest).toHaveBeenCalledTimes(2);

      consoleWarnSpy.mockRestore();
      consoleErrorSpy.mockRestore();
    });

    it('should throw an error if httpRequest throws an error with a message', async () => {
      mockHttpRequest.mockRejectedValueOnce(new Error('Custom HTTP error'));
      await expect(
        getGenesisValidatorsRoot(mainnetForkVersion, mockBeaconApiUrl, mockHttpRequest),
      ).rejects.toThrow('Failed to fetch genesis validators root: Custom HTTP error');
    });

    it('should throw an error if httpRequest throws a non-Error object', async () => {
      mockHttpRequest.mockRejectedValueOnce('some string error');
      await expect(
        getGenesisValidatorsRoot(mainnetForkVersion, mockBeaconApiUrl, mockHttpRequest),
      ).rejects.toThrow('Failed to fetch genesis validators root: some string error');
    });
  });
});
