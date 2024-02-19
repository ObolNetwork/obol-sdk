import { Signer } from "ethers";
import { v4 as uuidv4 } from "uuid";
import { Base } from './base.js';
import { CONFLICT_ERROR_MSG, CreatorConfigHashSigningTypes, Domain, dkg_algorithm, config_version, OperatorConfigHashSigningTypes, EnrSigningTypes } from './constants.js';
import { ConflictError } from './errors.js';
import { ClusterDefintion, ClusterLock, ClusterPayload, OperatorPayload } from './types.js';
import { clusterConfigOrDefinitionHash } from './hash.js';
import { validatePayload } from './ajv.js';
import { definitionSchema, operatorPayloadSchema } from './schema.js';
export * from "./types.js";

/**
 * Obol sdk Client can be used for creating, managing and activating distributed validators.
 */
export class Client extends Base {
  private signer: Signer | undefined;

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
  constructor(config: { baseUrl?: string | undefined; chainId?: number | undefined }, signer?: Signer) {

    super(config)
    this.signer = signer
  }

  /**
   * Creates a cluster definition which contains cluster configuration.
   * @param {ClusterPayload} newCluster - The new unique cluster.
   * @returns {Promise<string>} config_hash.
   * @throws On duplicate entries, missing or wrong cluster keys.
   * 
   * An example of how to use createClusterDefinition:
   * [createObolCluster](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts)
   */
  async createClusterDefinition(newCluster: ClusterPayload): Promise<string> {
    if (!this.signer) throw "Signer is required in createClusterDefinition"

    validatePayload(newCluster, definitionSchema);

    const clusterConfig: Partial<ClusterDefintion> = {
      ...newCluster,
      fork_version: this.fork_version,
      dkg_algorithm: dkg_algorithm,
      version: config_version,
      uuid: uuidv4(),
      timestamp: new Date().toISOString(),
      threshold: Math.ceil((2 * newCluster.operators.length) / 3),
      num_validators: newCluster.validators.length
    }

    try {
      const address = await this.signer.getAddress();

      clusterConfig.creator = { address };
      clusterConfig.config_hash = clusterConfigOrDefinitionHash(clusterConfig as ClusterDefintion, true);

      const creatorConfigSignature = await this.signer.signTypedData(Domain(this.chainId), CreatorConfigHashSigningTypes, { creator_config_hash: clusterConfig.config_hash });

      const clusterDefinition: ClusterDefintion = await this.request(`/dv`, {
        method: 'POST',
        body: JSON.stringify(clusterConfig),
        headers: {
          Authorization: `Bearer ${creatorConfigSignature}`,
          "fork-version": this.fork_version,
        }

      });
      return clusterDefinition?.config_hash;
    } catch (err: any) {
      if (err?.message == CONFLICT_ERROR_MSG)
        throw new ConflictError();
      throw err;
    }
  }

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
  async updateClusterDefinition(operatorPayload: OperatorPayload, configHash: string): Promise<ClusterDefintion> {
    if (!this.signer) throw "Signer is required in updateClusterDefinition"

    validatePayload(operatorPayload, operatorPayloadSchema);

    try {
      const address = await this.signer.getAddress();

      const operatorConfigSignature = await this.signer.signTypedData(Domain(this.chainId), OperatorConfigHashSigningTypes, { operator_config_hash: configHash });
      const operatorENRSignature = await this.signer.signTypedData(Domain(this.chainId), EnrSigningTypes, { enr: operatorPayload.enr });

      const operatorData: OperatorPayload = {
        ...operatorPayload,
        address,
        enr_signature: operatorENRSignature,
        fork_version: this.fork_version
      }
      const clusterDefinition: ClusterDefintion = await this.request(`/dv/${configHash}`, {
        method: 'PUT',
        body: JSON.stringify(operatorData),
        headers: {
          Authorization: `Bearer ${operatorConfigSignature}`,
        }

      });
      return clusterDefinition;
    } catch (err: any) {
      throw err;
    }
  }


  /** 
   * @param configHash - The configuration hash returned in createClusterDefinition
   * @returns {Promise<ClusterDefintion>} The  cluster definition for config hash
   * @throws On not found config hash.
   * 
   * An example of how to use getClusterDefinition:
   * [getObolClusterDefinition](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts)
   */
  async getClusterDefinition(configHash: string): Promise<ClusterDefintion> {

    const clusterDefinition: ClusterDefintion = await this.request(`/dv/${configHash}`, {
      method: 'GET',
    })

    return clusterDefinition
  }

  /** 
   * @param configHash - The configuration hash in cluster-definition 
   * @returns {Promise<ClusterLock>} The matched cluster details (lock) from DB
   * @throws On not found cluster definition or lock.
   * 
   * An example of how to use getClusterLock:
   * [getObolClusterLock](https://github.com/ObolNetwork/obol-sdk-examples/blob/main/TS-Example/index.ts)
   */
  async getClusterLock(configHash: string): Promise<ClusterLock> {

    const lock: ClusterLock = await this.request(`/lock/configHash/${configHash}`, {
      method: 'GET',
    })

    return lock
  }
}

