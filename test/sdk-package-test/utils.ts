import request from 'supertest'
import { ethers } from 'ethers'
import {
  type ClusterDefinition,
  Client,
  type ClusterLock,
} from '@obolnetwork/obol-sdk'

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? ''

const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey

const wallet = new ethers.Wallet(privateKey)

export const signer = wallet.connect(null)

export const client: Client = new Client(
  { baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech', chainId: 17000 },
  signer as any,
)

export const app = client.baseUrl

export const postClusterDef = async (
  clusterWithoutDefHash: ClusterDefinition,
): Promise<any> => {
  const postAuth = clusterWithoutDefHash.creator.config_signature
  const operatorsToPOST = clusterWithoutDefHash.operators.map(
    (operator: { address: any }) => {
      return { address: operator.address }
    },
  )

  try {
    await request(app)
      .post('/dv')
      .set('Authorization', `Bearer ${postAuth}`)
      .send({ ...clusterWithoutDefHash, operators: operatorsToPOST })
  } catch (error) {
    throw error
  }
}

export const updateClusterDef = async (
  clusterDef: ClusterDefinition,
): Promise<void> => {
  const clusterOperators = clusterDef.operators
  for (const clusterOperator of clusterOperators) {
    try {
      await request(app)
        .put(`/dv/${clusterDef.config_hash}`)
        .set(
          'Authorization',
          `Bearer ${clusterOperator.config_signature}`,
        )
        .send({
          address: clusterOperator.address,
          enr: clusterOperator.enr,
          enr_signature: clusterOperator.enr_signature,
          config_signature: clusterOperator.config_signature,
          version: clusterDef.version,
          fork_version: clusterDef.fork_version,
        })
    } catch (error) {
      throw error
    }
  }
}

export const publishLockFile = async (
  clusterLock: ClusterLock,
): Promise<void> => {
  try {
    await request(app).post('/lock').send(clusterLock)
  } catch (error) {
    throw error
  }
}
