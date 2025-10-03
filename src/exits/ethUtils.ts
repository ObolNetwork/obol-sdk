import { CAPELLA_FORK_MAPPING } from '../constants.js';

/**
 * Retrieves the Capella fork version for a given base fork version.
 * @param fork_version - The base fork version string (e.g., '0x00000000' for mainnet).
 * @returns A promise that resolves to the Capella fork version string, or null if not found.
 */
export async function getCapellaFork(
  fork_version: string,
): Promise<string | null> {
  // Ensure the CAPELLA_FORK_MAPPING uses the base fork_version as key
  if (CAPELLA_FORK_MAPPING[fork_version]) {
    return CAPELLA_FORK_MAPPING[fork_version];
  }
  return null;
}

/**
 * Fetches the genesis validators root from a beacon node.
 * @param beaconNodeApiUrl - The base URL of the beacon node API (e.g., http://localhost:5052).
 * @returns A promise that resolves to the genesis_validators_root string, or null on error.
 * @throws Will throw an error if the network corresponding to the fork_version is not supported or if the HTTP request fails.
 */
export async function getGenesisValidatorsRoot(
  beaconNodeApiUrl: string,
): Promise<string | null> {
  const genesisEndpoint = `${beaconNodeApiUrl}/eth/v1/beacon/genesis`;

  try {
    const response = await fetch(genesisEndpoint, {
      method: 'GET',
    });

    const json = await response.json();

    if (json.data?.genesis_validators_root) {
      return json.data.genesis_validators_root;
    }
    console.error('Invalid response structure from genesis endpoint', json);
    return null;
  } catch (e: any) {
    console.error(
      `Error fetching genesis validators root from ${genesisEndpoint}:`,
      e,
    );
    const errorMessage = e instanceof Error ? e.message : String(e);
    throw new Error(`Failed to fetch genesis validators root: ${errorMessage}`);
  }
}
