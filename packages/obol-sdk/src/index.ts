
import { ethers } from 'ethers';
import { v4 as uuidv4 } from "uuid";
import { Base } from './base';
import { CONFLICT_ERROR_MSG, CreatorConfigHashSigningTypes, Domain, dkg_algorithm, config_version } from './constants';
import { ConflictError } from './errors';
import { Cluster, ClusterPayload } from './types';
import { clusterConfigOrDefinitionHash } from './hash';


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
  createClusterDefinition(newCluster: ClusterPayload): Promise<string> {
    let clusterConfig: any = {
      ...newCluster,
      fork_version: this.fork_version,
      dkg_algorithm: dkg_algorithm,
      version: config_version,
      uuid: uuidv4(),
      timestamp: new Date().toISOString(),
      threshold: Math.ceil((2 * newCluster.operators.length) / 3)
    }

    return this.signer.getAddress().then((address: string) => {
      clusterConfig.creator = { address: address };
      clusterConfig.config_hash = clusterConfigOrDefinitionHash(clusterConfig, true)
    }).then(() => {
      return this.signer.signTypedData(Domain, CreatorConfigHashSigningTypes, { creator_config_hash: clusterConfig.config_hash })
    }).then((creatorConfigSignature: string): Promise<Cluster> => {
      return this.request(`/dv`, {
        method: 'POST',
        body: JSON.stringify(clusterConfig),
        headers: {
          Authorization: `Bearer ${creatorConfigSignature}`,
          "fork-version": this.fork_version,
        }
      })
    }).then((cluster: Cluster) => { return cluster?.config_hash })
      .catch((err: { message: string; }) => {
        if (err.message == CONFLICT_ERROR_MSG)
          throw new ConflictError()
        throw err.message
      });
  }

  /**
   * @param configHash The config hash of the requested cluster
   * @returns The matched cluster details (lock) from DB
  */
  getClusterLock(configHash: string): Promise<Cluster> {
    return this.pollRequest(`/lock/configHash/${configHash}`, {
      method: 'GET',
    });
  }


  //To be used only in testing
  /**
   * @param configHash The config hash of the cluster to be deleted
   * @returns The deleted cluster data
  */
  deleteCluster(configHash: string): Promise<Cluster> {
    return this.request(`/dv/${configHash}`, {
      method: 'DELETE',
    });
  }
}



