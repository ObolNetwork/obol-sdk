import { ethers, JsonRpcProvider } from 'ethers';
import { Client } from '../src/index';
import { DEFAULT_BASE_URL, DEFAULT_BASE_VERSION } from '../src/constants';

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
const provider = new JsonRpcProvider('https://ethereum-holesky.publicnode.com');
const wallet = new ethers.Wallet(privateKey, provider);
const mockSigner = wallet.connect(provider);
const baseUrl = DEFAULT_BASE_URL;

global.fetch = jest.fn();

describe('Client.migrate', () => {
  let clientInstance: Client;
  const mockMigrateData = {
    target_pubkey: '0x' + '1'.repeat(96),
    lock_hash: '0x' + '2'.repeat(64),
    withdrawal_address: '0x' + '3'.repeat(40),
    network: 'mainnet' as const,
  };

  beforeEach(() => {
    jest.clearAllMocks();
    clientInstance = new Client({ baseUrl, chainId: 17000 }, mockSigner);
    (global.fetch as jest.Mock).mockReset();
  });

  test('createMigrateValidator should throw an error without signer', async () => {
    const clientWithoutSigner = new Client({
      baseUrl,
      chainId: 17000,
    });

    await expect(
      clientWithoutSigner.migrate.createMigrateValidator(mockMigrateData),
    ).rejects.toThrow('Signer is required in createMigrateValidator');
  });

  test('createMigrateValidator should throw an error with invalid input', async () => {
    const invalidData = {
      target_pubkey: 'invalid',
      lock_hash: 'invalid',
      withdrawal_address: 'invalid',
      network: 'mainnet' as const,
    };

    await expect(
      clientInstance.migrate.createMigrateValidator(invalidData),
    ).rejects.toThrow();
  });

  test('createMigrateValidator should return migrate validator on successful creation', async () => {
    const mockResponse = {
      network: 'mainnet',
      target_pubkey: mockMigrateData.target_pubkey,
      lock_hash: mockMigrateData.lock_hash,
      withdrawal_address: mockMigrateData.withdrawal_address,
    };

    (global.fetch as jest.Mock).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => mockResponse,
      headers: new Headers(),
    });

    const result =
      await clientInstance.migrate.createMigrateValidator(mockMigrateData);

    expect(result).toEqual(mockResponse);
    expect(global.fetch).toHaveBeenCalledWith(
      `${baseUrl}/${DEFAULT_BASE_VERSION}/migrate/${mockMigrateData.network}`,
      expect.objectContaining({
        method: 'POST',
        body: JSON.stringify(mockMigrateData),
      }),
    );
  });

  test('createMigrateValidator should handle conflict errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(new Error('This Cluster has been already posted'));

    await expect(
      clientInstance.migrate.createMigrateValidator(mockMigrateData),
    ).rejects.toThrow('This Cluster has been already posted');
  });

  test('createMigrateValidator should handle network errors', async () => {
    (global.fetch as jest.Mock).mockRejectedValueOnce(
      new Error('Network error'),
    );

    await expect(
      clientInstance.migrate.createMigrateValidator(mockMigrateData),
    ).rejects.toThrow('Network error');
  });

  test('createMigrateValidator should work with different networks', async () => {
    const networks = ['mainnet', 'holesky', 'sepolia'] as const;

    for (const network of networks) {
      const mockResponse = {
        network: networks,
        target_pubkey: mockMigrateData.target_pubkey,
        lock_hash: mockMigrateData.lock_hash,
        withdrawal_address: mockMigrateData.withdrawal_address,
      };
      (global.fetch as jest.Mock).mockResolvedValueOnce({
        ok: true,
        status: 200,
        json: async () => {
          mockResponse;
        },
        headers: new Headers(),
      });
      const networkData = { ...mockMigrateData, network };
      await clientInstance.migrate.createMigrateValidator(networkData);
      expect(global.fetch).toHaveBeenCalledWith(
        `${baseUrl}/${DEFAULT_BASE_VERSION}/migrate/${network}`,
        expect.any(Object),
      );
    }
  });
});
