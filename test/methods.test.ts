import { ethers } from 'ethers';
import { Client } from '../src/index.js';
import { clusterConfig, clusterLockV1X7 } from './fixtures.js';
// import { SDK_VERSION } from '../src/constants.js';
// import fetchMock from 'fetch-mock';
// import { Base } from '../src/base.js';
import { validatePayload } from '../src/ajv.js';


describe('Cluster Client', () => {

    const mockConfigHash = "0x1f6c94e6c070393a68c1aa6073a21cb1fd57f0e14d2a475a2958990ab728c2fd";
    const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";
    const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;
    const wallet = new ethers.Wallet(privateKey);
    const mockSigner = wallet.connect(null);

    const clientInstance = new Client({ baseUrl: "https://obol-api-dev.gcp.obol.tech", chainId: 5 }, mockSigner);


    test('throws invalid ChainId when it is equal to 1', async () => {
        try {
            new Client({ chainId: 1 }, mockSigner);
        } catch (error: any) {
            expect(error.message).toBe("Invalid ChainId");
        }
    })

    test('createClusterDefinition should return config_hash', async () => {
        clientInstance['request'] = jest.fn().mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }));

        const config_hash = await clientInstance.createClusterDefinition(clusterConfig);
        expect(config_hash).toEqual(mockConfigHash);
    });

    test('updateClusterDefinition should return cluster definition', async () => {
        clientInstance['request'] = jest.fn().mockReturnValue(Promise.resolve(clusterLockV1X7.cluster_definition));

        const clusterDefinition = await clientInstance.updateClusterDefinition({ enr: clusterLockV1X7.cluster_definition.operators[0].enr, version: clusterLockV1X7.cluster_definition.version }, clusterLockV1X7.cluster_definition.config_hash);
        expect(clusterDefinition).toEqual(clusterLockV1X7.cluster_definition);
    });

    test('createClusterDefinition should throw an error on invalid operators', async () => {
        clientInstance['request'] = jest.fn().mockReturnValue(Promise.resolve({ config_hash: mockConfigHash }));
        try {
            await clientInstance.createClusterDefinition({ ...clusterConfig, operators: [] });
        } catch (error: any) {
            expect(error.message).toEqual("Schema compilation errors', must NOT have fewer than 4 items");
        }
    });

    test('validatePayload should throw an error on empty schema', async () => {
        try {
            validatePayload({ ...clusterConfig, operators: [] }, "");
        } catch (error: any) {
            expect(error.message).toEqual("schema must be object or boolean");
        }
    });

    test('getClusterdefinition should return cluster definition if config hash exist', async () => {
        clientInstance['request'] = jest.fn().mockReturnValue(Promise.resolve(clusterLockV1X7.cluster_definition));

        const clusterDefinition = await clientInstance.getClusterDefinition(clusterLockV1X7.cluster_definition.config_hash);
        expect(clusterDefinition.config_hash).toEqual(clusterLockV1X7.cluster_definition.config_hash);
    });

    test('getClusterLock should return lockFile if exist', async () => {
        clientInstance['request'] = jest.fn().mockReturnValue(Promise.resolve(clusterLockV1X7));

        const clusterLock = await clientInstance.getClusterLock(clusterLockV1X7.cluster_definition.config_hash);
        expect(clusterLock.lock_hash).toEqual(clusterLockV1X7.lock_hash);

    });

    // test('request method should set user agent header', async () => {

    //     const expectedHeaders = {
    //         'User-Agent': `Obol-SDK/${SDK_VERSION}`,
    //     };

    //     fetchMock.mock('http://testexample.com/test', {
    //         status: 200,
    //         body: { message: 'user-agent header exist' },
    //         headers: expectedHeaders
    //     });
        
    //     class TestBase extends Base {
    //         async callProtectedRequest<T>(endpoint: string, options?: RequestInit): Promise<T> {
    //             return (await this.request(endpoint, options));
    //         }
    //     }
    //     const testBaseInstance = new TestBase({ baseUrl: "http://testExample.com" });

    //     const result: { message: string } = await testBaseInstance.callProtectedRequest('/test', {
    //         method: 'GET',
    //     });
    //     expect(result?.message).toEqual("user-agent header exist")
    // })
});

describe('Cluster Client without a signer', () => {
    const clientInstance = new Client({ baseUrl: "https://obol-api-dev.gcp.obol.tech", chainId: 5 });

    test('createClusterDefinition should throw an error without signer', async () => {
        try {
            await clientInstance.createClusterDefinition(clusterConfig);

        } catch (err) {
            expect(err).toEqual(
                "Signer is required in createClusterDefinition"
            );
        }
    });

    test('updateClusterDefinition should throw an error without signer', async () => {
        try {
            await clientInstance.updateClusterDefinition({ enr: clusterLockV1X7.cluster_definition.operators[0].enr, version: clusterLockV1X7.cluster_definition.version }, clusterLockV1X7.cluster_definition.config_hash);
        } catch (err) {
            expect(err).toEqual(
                "Signer is required in updateClusterDefinition"
            );
        }
    });

    test('getClusterdefinition should return cluster definition if config hash exist', async () => {
        clientInstance['request'] = jest.fn().mockReturnValue(Promise.resolve(clusterLockV1X7.cluster_definition));

        const clusterDefinition = await clientInstance.getClusterDefinition(clusterLockV1X7.cluster_definition.config_hash);
        expect(clusterDefinition.config_hash).toEqual(clusterLockV1X7.cluster_definition.config_hash);
    });

    test('getClusterLock should return lockFile if exist', async () => {
        clientInstance['request'] = jest.fn().mockReturnValue(Promise.resolve(clusterLockV1X7));

        const clusterLock = await clientInstance.getClusterLock(clusterLockV1X7.cluster_definition.config_hash);
        expect(clusterLock.lock_hash).toEqual(clusterLockV1X7.lock_hash);
    });
});


