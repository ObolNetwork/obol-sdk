import { Client } from '@obolnetwork/obol-sdk';
import { ethers } from 'ethers';
import request from 'supertest';
import { mockGroupClusterLockV1X5 } from './fixtures';
const infuraProjectId = 'ca1a29fe66dd40dbbc2b5cc2d7fda17c';

const provider = ethers.getDefaultProvider("goerli", {
  infura: infuraProjectId,
});

const mnemonic = ethers.Wallet.createRandom().mnemonic?.phrase || "";

const privateKey = ethers.Wallet.fromPhrase(mnemonic).privateKey;

const wallet = new ethers.Wallet(privateKey);

const signer = wallet.connect(provider);

const client: Client = new Client({}, signer);

// describe('Create Cluster Definition', () => {
//   it('should post a cluster definition and return lockhash', async () => {


//     const lockHash = await client.createClusterDefinition({
//       name: "testSDK",
//       num_validators: 1,
//       operators:
//         [
//           { address: "0xC35CfCd67b9C27345a54EDEcC1033F2284148c81" },
//           { address: "0x33807D6F1DCe44b9C599fFE03640762A6F08C496" },
//           { address: "0xc6e76F72Ea672FAe05C357157CfC37720F0aF26f" },
//           { address: "0x86B8145c98e5BD25BA722645b15eD65f024a87EC" }
//         ],
//       validators: [{
//         fee_recipient_address: "0x3CD4958e76C317abcEA19faDd076348808424F99",
//         withdrawal_address: "0xE0C5ceA4D3869F156717C66E188Ae81C80914a6e"
//       }],
//     })
//     console.log(lockHash, "lockHash")
//     expect(lockHash).toHaveLength(66);
//   });
// });

describe('Poll Cluster Lock', () => {
  const app = "https://3db7-2a01-9700-111d-9f00-35d2-48d4-627-7f86.eu.ngrok.io";
  const { definition_hash: _, ...rest } =
    mockGroupClusterLockV1X5.cluster_definition;
  const cloneDef = rest;
  const postAuth =
    mockGroupClusterLockV1X5.cluster_definition.creator.config_signature;
  const operatorsToPOST = cloneDef.operators.map(operator => {
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

    await request(app)
      .post('/lock')
      .send(mockGroupClusterLockV1X5);
  }

  beforeAll(async () => {
    await request(app)
      .post('/dv')
      .set('Authorization', `Bearer ${postAuth}`)
      .send({ ...cloneDef, operators: operatorsToPOST })
  })
  it('should make a GET request to the API periodically until a lock is returned', async () => {
    //Call them in parallel
    const [lockObject,x] = await Promise.all([client.getClusterLock(mockGroupClusterLockV1X5.cluster_definition.config_hash), updateClusterDefAndPushLock()]);

    console.log(lockObject, "lockObject")
    expect(lockObject).toHaveProperty('lock_hash');
  });

  afterAll(async () => {
    const config_hash = mockGroupClusterLockV1X5.cluster_definition.config_hash;
    const lock_hash = mockGroupClusterLockV1X5.lock_hash;

    return request(app).delete(`/lock/${lock_hash}`).set('Authorization', `Bearer ${postAuth}`).then(() => {
       request(app)
        .delete(`/dv/${config_hash}`)
        .set('Authorization', `Bearer ${postAuth}`).then(()=>{
          console.log("done")
        });
    });
  });
});






