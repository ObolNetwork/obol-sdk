
import { ethers } from 'ethers';
import { Base } from './base';
import { CONFLICT_ERROR_MSG } from './constants';
import { ConflictError } from './errors';
import { Cluster } from './types';

export class Client extends Base {

  private signer: ethers.Wallet;

  constructor(config: any, signer: ethers.Wallet) {
    super(config)
    this.signer = signer
  }

  /**
   * @param cluster The new unique cluster
   * @returns The saved cluster from DB
  */
  async createCluster(newCluster: Cluster, signer: any): Promise<unknown> {
    const data = getCreatorConfigHashMessage({ creator_config_hash: newCluster.config_hash }, 5);
    const creatorConfigSignature = await signer.signTypedData(data.domain, data.types, data.message)
    return this.request(`/dv`, {
      method: 'POST',
      body: JSON.stringify(newCluster),
      headers: {
        Authorization: `Bearer ${creatorConfigSignature}`,
        "fork-version": newCluster.fork_version,
      }
    }).catch(err => {
      if (err.message == CONFLICT_ERROR_MSG)
        throw new ConflictError()
    }
    );
  }

  // /**
  //  * @param configHash The config hash of the requested cluster
  //  * @returns The matched cluster from DB
  // */
  // getCluster(configHash: string): Promise<Cluster> {
  //     return this.request(`/dv/${configHash}`, {
  //         method: 'GET',
  //     });
  // }


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

export const EIP712_DOMAIN_NAME = "Obol";
export const EIP712_DOMAIN_VERSION = "1";
export const CreatorConfigHashSigningTypes = {
  CreatorConfigHash: [{ name: "creator_config_hash", type: "string" }],
};

const getCreatorConfigHashMessage = (
  payload: any,
  chainId: any,
): any => ({
  types: CreatorConfigHashSigningTypes,
  primaryType: "CreatorConfigHash",
  domain: {
    name: EIP712_DOMAIN_NAME,
    version: EIP712_DOMAIN_VERSION,
    chainId,
  },
  message: payload,
});


