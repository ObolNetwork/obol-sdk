
import request from 'supertest';
import { Client } from '@obolnetwork/obol-sdk';
import { ethers } from 'ethers';
import { ClusterDefintion, ClusterLock } from '@obolnetwork/obol-sdk/dist/types'; //Should be fixed when "exports": "./types": "./dist/types.js" is added to obol-sdk package.json

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";

const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;

const wallet = new ethers.Wallet(privateKey);

const signer = wallet.connect(null);

export const client: Client = new Client({}, signer);

export const app = client.baseUrl;

export const postClusterDef = async (clusterWithoutDefHash: ClusterDefintion) => {
    const postAuth =
        clusterWithoutDefHash.creator.config_signature;
    const operatorsToPOST = clusterWithoutDefHash.operators.map((operator: { address: any; }) => {
        return { address: operator.address };
    });

    await request(app)
        .post('/dv')
        .set('Authorization', `Bearer ${postAuth}`)
        .send({ ...clusterWithoutDefHash, operators: operatorsToPOST })
}




export const updateClusterDef = async (clusterDef: ClusterDefintion ) => {
    const cluserOperators = clusterDef.operators;
    for (
        let count = 0;
        count < cluserOperators.length;
        count++
    ) {
        await request(app)
            .put(`/dv/${clusterDef.config_hash}`)
            .set('Authorization', `Bearer ${cluserOperators[count].config_signature}`)


            .send({
                address: cluserOperators[count].address,
                enr: cluserOperators[count].enr,
                enr_signature:
                    cluserOperators[count].enr_signature,
                config_signature:
                    cluserOperators[count].config_signature,
                version: clusterDef.version,
                fork_version:
                    clusterDef.fork_version,
            },
            );
    }
}

export const publishLockFile = async (clusterLock:ClusterLock ) => {
    const postedLockFile = await request(app)
        .post('/lock')
        .send(clusterLock);

}