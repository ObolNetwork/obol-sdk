
import request from 'supertest';
import { Client } from '@obolnetwork/obol-sdk';
import { ethers } from 'ethers';

const infuraProjectId = 'ca1a29fe66dd40dbbc2b5cc2d7fda17c';

const provider = ethers.getDefaultProvider("goerli", {
    infura: infuraProjectId,
});

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";

const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;

const wallet = new ethers.Wallet(privateKey);

const signer = wallet.connect(provider);

export const client: Client = new Client({}, signer);

export const app = client.baseUrl;

export const postClusterDef = async (clusterWithoutDefHash: any) => {
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




export const updateClusterDef = async (clusterDef: { name?: string; creator?: { address: string; config_signature: string; }; operators: any; uuid?: string; version: any; timestamp?: string; num_validators?: number; threshold?: number; validators?: { fee_recipient_address: string; withdrawal_address: string; }[]; dkg_algorithm?: string; fork_version: any; config_hash: any; definition_hash?: string; }) => {
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

export const publishLockFile = async (clusterLock: string | object | undefined) => {
    const postedLockFile = await request(app)
        .post('/lock')
        .send(clusterLock);

}