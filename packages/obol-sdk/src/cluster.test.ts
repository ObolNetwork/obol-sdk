import { ethers } from 'ethers';
import  {Client}  from './index';
import { clusterConfig, clusterLockV1X5 } from './fixtures';

describe('Cluster Client', () => {

    const mockConfigHash = "0x1f6c94e6c070393a68c1aa6073a21cb1fd57f0e14d2a475a2958990ab728c2fd";
    let clusterClientService: Client; 
    const infuraProjectId = 'ca1a29fe66dd40dbbc2b5cc2d7fda17c';
    const provider = ethers.getDefaultProvider("goerli", {
        infura: infuraProjectId,
    });
    const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";
    const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
    const wallet = new ethers.Wallet(privateKey);
    const mockSigner = wallet.connect(provider);


    beforeEach(() => {
        clusterClientService = new Client({}, mockSigner);
    });

    test('createClusterDefinition should return config_hash', async () => {
        clusterClientService.createClusterDefinition = jest.fn().mockResolvedValueOnce(mockConfigHash);

        const config_hash = await clusterClientService.createClusterDefinition(clusterConfig);

        expect(clusterClientService.createClusterDefinition).toHaveBeenCalledTimes(1);
        expect(clusterClientService.createClusterDefinition).toHaveBeenCalledWith(clusterConfig);
        expect(config_hash).toEqual(mockConfigHash);
    });

    test('getClusterLock should return lockFile if exist', async () => {
        clusterClientService.getClusterLock = jest.fn().mockResolvedValueOnce(clusterLockV1X5);

        const clusterLock = await clusterClientService.getClusterLock(mockConfigHash);

        expect(clusterClientService.getClusterLock).toHaveBeenCalledTimes(1);
        expect(clusterClientService.getClusterLock).toHaveBeenCalledWith(mockConfigHash);
        expect(clusterLock).toEqual(clusterLockV1X5);
    });
});
