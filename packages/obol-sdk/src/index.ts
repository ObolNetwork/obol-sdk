
import { ethers } from 'ethers';
import { v4 as uuidv4 } from "uuid";
import { Base } from './base';
import { CONFLICT_ERROR_MSG, CreatorConfigHashSigningTypes, Domain, dkg_algorithm, config_version } from './constants';
import { ConflictError } from './errors';
import { ClusterDefintion, ClusterLock, ClusterPayload } from './types';
import { clusterConfigOrDefinitionHash } from './hash';
import { validateDefinition } from './ajv';


export class Client extends Base {
  private signer: ethers.Wallet;

  constructor(config: { baseUrl?: string | undefined; chainId?: number | undefined }, signer: ethers.Wallet) {

    super(config)
    this.signer = signer
  }

  /**
   * @param cluster The new unique cluster
   * @returns Invite Link with config_hash
  */
  async createClusterDefinition(newCluster: ClusterPayload): Promise<string> {

    const isValid = validateDefinition(newCluster);
    if (isValid !== null) throw new Error(`An error occurred: ${JSON.stringify(isValid)}`);

    const clusterConfig: any = {
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
      clusterConfig.config_hash = clusterConfigOrDefinitionHash(clusterConfig, true);

      const creatorConfigSignature = await this.signer.signTypedData(Domain, CreatorConfigHashSigningTypes, { creator_config_hash: clusterConfig.config_hash });

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
      throw err?.message;
    }
  }

  /**
   * @param configHash The config hash of the requested cluster
   * @returns The matched cluster details (lock) from DB
  */
  async getClusterLock(configHash: string): Promise<ClusterLock> {
    try {
      const lock: ClusterLock = await this.request(`/lock/configHash/${configHash}`, {
        method: 'GET',
      });
      return lock;
    } catch (err: any) {
      throw err.message;
    }
  }


  //To be used only in testing
  /**
   * @param configHash The config hash of the cluster to be deleted
   * @returns The deleted cluster data
  */
  async deleteCluster(configHash: string): Promise<ClusterDefintion> {
    return (await this.request(`/dv/${configHash}`, {
      method: 'DELETE',
    }));
  }
}

