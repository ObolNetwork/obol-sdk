import {
  CAPELLA_FORK_MAPPING,
  FORK_VERSION_TO_NETWORK_NAME,
} from '../constants';

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
 * @param fork_version - The base fork version string to determine the network.
 * @param beaconNodeApiUrl - The base URL of the beacon node API (e.g., http://localhost:5052).
 * @param httpService - The HTTP service to make the API call.
 * @returns A promise that resolves to the genesis_validators_root string, or null on error.
 * @throws Will throw an error if the network corresponding to the fork_version is not supported or if the HTTP request fails.
 */
export async function getGenesisValidatorsRoot(
  fork_version: string, // Used to determine network if FORK_VERSION_TO_NETWORK_NAME is populated
  beaconNodeApiUrl: string,
): Promise<string | null> {
  const network = FORK_VERSION_TO_NETWORK_NAME[fork_version]; // Will be used once constants are populated
  if (!network) {
    console.warn(
      `Network for fork_version ${fork_version} not found in FORK_VERSION_TO_NETWORK_NAME. Ensure constants are correctly populated.`,
    );
  }

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
