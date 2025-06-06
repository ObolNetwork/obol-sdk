import {
  getCapellaFork,
  getGenesisValidatorsRoot,
} from '../../src/exits/ethUtils';
import { CAPELLA_FORK_MAPPING } from '../../src/constants';

describe('ethUtils', () => {
  describe('getCapellaFork', () => {
    Object.entries(CAPELLA_FORK_MAPPING).forEach(
      ([baseFork, expectedCapellaFork]) => {
        it(`should return ${expectedCapellaFork} for base fork ${baseFork}`, async () => {
          const result = await getCapellaFork(baseFork);
          expect(result).toBe(expectedCapellaFork);
        });
      },
    );

    it('should return null for an unknown base fork version', async () => {
      const result = await getCapellaFork('0xUNKNOWNFORK');
      expect(result).toBeNull();
    });
  });

  describe('getGenesisValidatorsRoot', () => {
    const mockBeaconApiUrl = 'http://localhost:5052';
    const mockGenesisRoot =
      '0xcf8e0d4e9587369b2301d0790347320302cc0943d5a1884560367e8208d920f2';

    beforeEach(() => {
      // Reset fetch mock
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it('should fetch and return the genesis_validators_root successfully', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({
          data: { genesis_validators_root: mockGenesisRoot },
        }),
      });

      const result = await getGenesisValidatorsRoot(mockBeaconApiUrl);

      expect(result).toBe(mockGenesisRoot);
      expect(global.fetch).toHaveBeenCalledTimes(1);
      expect(global.fetch).toHaveBeenCalledWith(
        `${mockBeaconApiUrl}/eth/v1/beacon/genesis`,
        { method: 'GET' },
      );
    });

    it('should return null if the HTTP request fails (e.g., network error)', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Network error'),
      );

      await expect(getGenesisValidatorsRoot(mockBeaconApiUrl)).rejects.toThrow(
        'Failed to fetch genesis validators root: Network error',
      );
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should return null if the response data structure is invalid (missing genesis_validators_root)', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({
          data: { some_other_field: 'value' },
        }),
      });

      const result = await getGenesisValidatorsRoot(mockBeaconApiUrl);
      expect(result).toBeNull();
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    it('should return null if the response data is missing', async () => {
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        json: async () => ({}),
      });

      const result = await getGenesisValidatorsRoot(mockBeaconApiUrl);
      expect(result).toBeNull();
    });

    it('should throw an error if fetch throws an error with a message', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce(
        new Error('Custom HTTP error'),
      );

      await expect(getGenesisValidatorsRoot(mockBeaconApiUrl)).rejects.toThrow(
        'Failed to fetch genesis validators root: Custom HTTP error',
      );
    });

    it('should throw an error if fetch throws a non-Error object', async () => {
      (global.fetch as jest.Mock).mockRejectedValueOnce('some string error');

      await expect(getGenesisValidatorsRoot(mockBeaconApiUrl)).rejects.toThrow(
        'Failed to fetch genesis validators root: some string error',
      );
    });
  });
});
