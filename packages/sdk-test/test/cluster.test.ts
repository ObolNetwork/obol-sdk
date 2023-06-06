import { Client } from '@obolnetwork/obol-sdk';
import { ethers } from 'ethers';
import request from 'supertest';
import { clusterConfig, mockGroupClusterLockV1X5 } from './fixtures';
const infuraProjectId = 'ca1a29fe66dd40dbbc2b5cc2d7fda17c';

const provider = ethers.getDefaultProvider("goerli", {
  infura: infuraProjectId,
});

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";

const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;

const wallet = new ethers.Wallet(privateKey);

const signer = wallet.connect(provider);

const client: Client = new Client({}, signer);

jest.setTimeout(10000);

// describe('Create Cluster Definition', () => {
//   it('should post a cluster definition and return lockhash', async () => {
//     const lockHash = await client.createClusterDefinition(clusterConfig);
//     console.log(lockHash, "lockHash")
//     expect(lockHash).toHaveLength(66);
//   })
// });

describe('Poll Cluster Lock', () => {
  const app = client.baseUrl;

  //Test polling getClusterLock through mimicing the whole flow using obol-api endpoints 
  const { definition_hash: _, ...rest } =
    mockGroupClusterLockV1X5.cluster_definition;
  const clusterWithoutDefHash = rest;
  const postAuth =
    mockGroupClusterLockV1X5.cluster_definition.creator.config_signature;
  const operatorsToPOST = clusterWithoutDefHash.operators.map(operator => {
    return { address: operator.address };
  });
  const mockGroupClusterLockOperators =
    mockGroupClusterLockV1X5.cluster_definition.operators;

  const updateClusterDefAndPushLock = async () => {
    for (
      let count = 0;
      count < mockGroupClusterLockOperators.length;
      count++
    ) {
      await request(app)
        .put(`/dv/${mockGroupClusterLockV1X5.cluster_definition.config_hash}`)
        .set('Authorization', `Bearer ${mockGroupClusterLockOperators[count].config_signature}`)


        .send({
          address: mockGroupClusterLockOperators[count].address,
          enr: mockGroupClusterLockOperators[count].enr,
          enr_signature:
            mockGroupClusterLockOperators[count].enr_signature,
          config_signature:
            mockGroupClusterLockOperators[count].config_signature,
          version: mockGroupClusterLockV1X5.cluster_definition.version,
          fork_version:
            mockGroupClusterLockV1X5.cluster_definition.fork_version,
        },
        );
    }

    const postedLockFile = await request(app)
      .post('/lock')
      .send(mockGroupClusterLockV1X5);

    return postedLockFile;
  }

  beforeAll(async () => {

    await request(app)
      .post('/dv')
      .set('Authorization', `Bearer ${postAuth}`)
      .send({ ...clusterWithoutDefHash, operators: operatorsToPOST })
  })


  it('should make a GET request to the API periodically until a lock is returned', async () => {
    //jest.setTimeout(10000);

    //To call two async operations in parallel
    const [lockObject, postedLockFile] = await Promise.all([new Promise((resolve, reject) => {
      var pollReqIntervalId = setInterval(function () {
        client.getClusterLock(mockGroupClusterLockV1X5.cluster_definition.config_hash).then((lockFile: any) => {
          if (lockFile?.lock_hash) {
            console.log(lockFile,"lockFile")
            clearInterval(pollReqIntervalId);
            resolve(lockFile)
          }
        }).catch((err)=>console.log(err))
      }, 1000);

      setTimeout(function () {
        clearInterval(pollReqIntervalId);
        reject("Time out")
      }, 5000)

    }), updateClusterDefAndPushLock()]);
    expect(lockObject).toHaveProperty('lock_hash');
  });

  afterAll(async () => {
    //jest.setTimeout(10000);

    const config_hash = mockGroupClusterLockV1X5.cluster_definition.config_hash;
    const lock_hash = mockGroupClusterLockV1X5.lock_hash;

    return request(app).delete(`/lock/${lock_hash}`).then(() => {
      return request(app)
        .delete(`/dv/${config_hash}`).then(() => {
          console.log("done")
        });
    });
  });
});






