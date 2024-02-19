import { Signer } from 'ethers';
import { Base } from './base.js';
import { ClusterDefintion, ClusterLock, ClusterPayload, OperatorPayload } from './types.js';
export * from "./types.js";
/**
 * Obol sdk Client can be used for creating, managing and activating distributed validators.
 */
export declare class Client extends Base {
    private signer;
    /**
     * @param config - Client configurations
     * @param config.baseUrl - obol-api url
     * @param config.chainId - Blockchain network ID
     * @param signer - ethersJS Signer
     * @returns Obol-SDK Client instance
     *
     * An example of how to instantiate obol-sdk Client:
     * [obolClient](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts#L29)
     */
    constructor(config: {
        baseUrl?: string | undefined;
        chainId?: number | undefined;
    }, signer?: Signer);
    /**
     * Creates a cluster definition which contains cluster configuration.
     * @param {ClusterPayload} newCluster - The new unique cluster.
     * @returns {Promise<string>} config_hash.
     * @throws On duplicate entries, missing or wrong cluster keys.
     *
     * An example of how to use createClusterDefinition:
     * [createObolCluster](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts)
     */
    createClusterDefinition(newCluster: ClusterPayload): Promise<string>;
    /**
    * Approves joining a cluster with specific configuration.
    * @param {OperatorPayload} operatorPayload - The operator data including signatures.
    * @param {string} configHash - The config hash of the cluster which the operator confirms joining to.
    * @returns {Promise<ClusterDefintion>} The cluster definition.
    * @throws On unauthorized, duplicate entries, missing keys, not found cluster or invalid data.
    *
    * An example of how to use updateClusterDefinition:
    * [updateClusterDefinition](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts)
    */
    updateClusterDefinition(operatorPayload: OperatorPayload, configHash: string): Promise<ClusterDefintion>;
    /**
     * @param configHash - The configuration hash returned in createClusterDefinition
     * @returns {Promise<ClusterDefintion>} The  cluster definition for config hash
     * @throws On not found config hash.
     *
     * An example of how to use getClusterDefinition:
     * [getObolClusterDefinition](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts)
     */
    getClusterDefinition(configHash: string): Promise<ClusterDefintion>;
    /**
     * @param configHash - The configuration hash in cluster-definition
     * @returns {Promise<ClusterLock>} The matched cluster details (lock) from DB
     * @throws On not found cluster definition or lock.
     *
     * An example of how to use getClusterLock:
     * [getObolClusterLock](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts)
     */
    getClusterLock(configHash: string): Promise<ClusterLock>;
}
