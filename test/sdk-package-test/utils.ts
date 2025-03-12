import request from 'supertest';
import { ethers, JsonRpcProvider } from 'ethers';
import {
  type ClusterDefinition,
  Client,
  type ClusterLock,
} from '@obolnetwork/obol-sdk';
import dotenv from 'dotenv';

dotenv.config();

// known signer
const privateKey = process.env.PRIVATE_KEY as string;
const provider = new JsonRpcProvider('https://ethereum-sepolia-rpc.publicnode.com');
const wallet = new ethers.Wallet(privateKey, provider);
export const signer = wallet.connect(provider);
/* eslint-disable */
export const client: Client = new Client(
  { baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech', chainId: 11155111 },
  signer as any,
);

const randomMnemonic = ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const randomprivateKey = ethers.Wallet.fromPhrase(randomMnemonic).privateKey;
const randomWallet = new ethers.Wallet(randomprivateKey);
export const randomSigner = randomWallet.connect(null);
export const randomClient: Client = new Client(
  { baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech', chainId: 17000 },
  randomSigner as any,
);

//second random signer
const secondRandomMnemonic =
  ethers.Wallet.createRandom().mnemonic?.phrase ?? '';
const secondRandomprivateKey =
  ethers.Wallet.fromPhrase(randomMnemonic).privateKey;
const secondRandomWallet = new ethers.Wallet(randomprivateKey);
export const secondRandomSigner = randomWallet.connect(null);
export const secondRandomClient: Client = new Client(
  { baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech', chainId: 17000 },
  secondRandomSigner as any,
);

export const app = client.baseUrl;

export const DEL_AUTH = process.env.DEL_AUTH;

export const postClusterDef = async (
  clusterWithoutDefHash: ClusterDefinition,
): Promise<any> => {
  const postAuth = clusterWithoutDefHash.creator.config_signature;
  const operatorsToPOST = clusterWithoutDefHash.operators.map(
    (operator: { address: any }) => {
      return { address: operator.address };
    },
  );

  try {
    await request(app)
      .post('/v1/definition')
      .set('Authorization', `Bearer ${postAuth}`)
      .send({ ...clusterWithoutDefHash, operators: operatorsToPOST });
  } catch (error) {
    throw error;
  }
};

export const updateClusterDef = async (
  clusterDef: ClusterDefinition,
): Promise<void> => {
  const clusterOperators = clusterDef.operators;
  for (const clusterOperator of clusterOperators) {
    try {
      await request(app)
        .put(`/v1/definition/${clusterDef.config_hash}`)
        .set('Authorization', `Bearer ${clusterOperator.config_signature}`)
        .send({
          address: clusterOperator.address,
          enr: clusterOperator.enr,
          enr_signature: clusterOperator.enr_signature,
          config_signature: clusterOperator.config_signature,
          version: clusterDef.version,
          fork_version: clusterDef.fork_version,
        });
    } catch (error) {
      throw error;
    }
  }
};

export const publishLockFile = async (
  clusterLock: ClusterLock,
): Promise<void> => {
  try {
    await request(app).post('/lock').send(clusterLock);
  } catch (error) {
    throw error;
  }
};
