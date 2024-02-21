import request from 'supertest';
import dotenv from 'dotenv';
import { clusterConfig, clusterLockV1X7, enr } from './fixtures';
import { client, updateClusterDef, publishLockFile, app, postClusterDef, signer } from './utils';
import { ClusterDefintion, Client, validateClusterLock } from '@obolnetwork/obol-sdk';


dotenv.config();

const DEL_AUTH = process.env.DEL_AUTH;

jest.setTimeout(10000);

describe('Cluster Definition', () => {
  let configHash: string;
  let clusterDefinition: ClusterDefintion;
  let secondConfigHash: string;
  const clientWithoutAsigner = new Client({ baseUrl: "https://obol-api-dev.gcp.obol.tech", chainId: 17000 });

  beforeAll(async () => {
    configHash = await client.createClusterDefinition(clusterConfig);
  });

  it('should post a cluster definition and return confighash', async () => {
    expect(configHash).toHaveLength(66);
  })

  it('should throw on post a cluster without a signer', async () => {
    try {
      await clientWithoutAsigner.createClusterDefinition(clusterConfig);
    } catch (err: any) {
      expect(err).toEqual('Signer is required in createClusterDefinition');
    }
  })

  it('should fetch the cluster definition for the configHash', async () => {
    clusterDefinition = await client.getClusterDefinition(configHash);
    expect(clusterDefinition.config_hash).toEqual(configHash);
  })

  it('should fetch the cluster definition for the configHash without a signer', async () => {
    clusterDefinition = await clientWithoutAsigner.getClusterDefinition(configHash);
    expect(clusterDefinition.config_hash).toEqual(configHash);
  })

  it('should throw on update a cluster that the operator is not part of', async () => {
    try {
      await client.updateClusterDefinition({ enr: enr, version: clusterDefinition.version }, configHash);
    } catch (err: any) {
      expect(err.message).toEqual('Not Found');
    }
  })

  it('should update the cluster which the operator belongs to', async () => {
    const signerAddress = await signer.getAddress();
    clusterConfig.operators.push({ address: signerAddress });

    secondConfigHash = await client.createClusterDefinition(clusterConfig);

    const definitionData: ClusterDefintion = await client.updateClusterDefinition({ enr: enr, version: clusterDefinition.version }, secondConfigHash);
    expect(definitionData.operators[definitionData.operators.length - 1].enr).toEqual(enr);
  })

  it('should throw on update a cluster without a signer', async () => {
    try {
      await clientWithoutAsigner.updateClusterDefinition({ enr: enr, version: clusterDefinition.version }, configHash);
    } catch (err: any) {
      expect(err).toEqual('Signer is required in updateClusterDefinition');
    }
  })

  afterAll(async () => {
    await request(app).delete(`/dv/${configHash}`).set('Authorization', `Bearer ${DEL_AUTH}`);
    await request(app).delete(`/dv/${secondConfigHash}`).set('Authorization', `Bearer ${DEL_AUTH}`)

  });
});


describe('Poll Cluster Lock', () => {
  //Test polling getClusterLock through mimicing the whole flow using obol-api endpoints 
  const { definition_hash: _, ...rest } =
    clusterLockV1X7.cluster_definition;
  const clusterWithoutDefHash = rest;
  const clientWithoutAsigner = new Client({ baseUrl: "https://obol-api-dev.gcp.obol.tech", chainId: 17000 });

  beforeAll(async () => {

    await postClusterDef(clusterWithoutDefHash)
  })

  it('should make a GET request to the API periodically until a lock is returned', async () => {

    //Call two async operations in parallel, polling to fetch lockFile when exist and the whole process after the creator shares the link with operators
    const [lockObject] = await Promise.all([new Promise((resolve, reject) => {
      const pollReqIntervalId = setInterval(async function () {
        try {
          const lockFile = await client.getClusterLock(clusterLockV1X7.cluster_definition.config_hash);
          if (lockFile?.lock_hash) {
            clearInterval(pollReqIntervalId);
            resolve(lockFile)
          }
        } catch (err: any) {
          //TODO(Hanan) Update this once the errors thrown from obol-api are updated
          console.log(err)
        }
      }, 1000);

      setTimeout(function () {
        clearInterval(pollReqIntervalId);
        reject(new Error("Time out"))
      }, 5000)

    }), (async () => {

      await updateClusterDef(clusterLockV1X7.cluster_definition);
      await publishLockFile(clusterLockV1X7);

    })()]);
    expect(lockObject).toHaveProperty('lock_hash');


  });

  it('fetches a lock successfully without a signer', async () => {

    //Call two async operations in parallel, polling to fetch lockFile when exist and the whole process after the creator shares the link with operators
    const [lockObject] = await Promise.all([new Promise((resolve, reject) => {
      const pollReqIntervalId = setInterval(async function () {
        try {
          const lockFile = await clientWithoutAsigner.getClusterLock(clusterLockV1X7.cluster_definition.config_hash);
          if (lockFile?.lock_hash) {
            clearInterval(pollReqIntervalId);
            resolve(lockFile)
          }
        } catch (err: any) {
          console.log(err)
        }
      }, 1000);

      setTimeout(function () {
        clearInterval(pollReqIntervalId);
        reject(new Error("Time out"))
      }, 5000)

    }), (async () => {

      await updateClusterDef(clusterLockV1X7.cluster_definition);
      await publishLockFile(clusterLockV1X7);

    })()]);
    expect(lockObject).toHaveProperty('lock_hash');
  });

  it('should fetch the cluster definition for the configHash', async () => {
    const clusterDefinition: ClusterDefintion = await client.getClusterDefinition(clusterLockV1X7.cluster_definition.config_hash);
    expect(clusterDefinition.config_hash).toEqual(clusterLockV1X7.cluster_definition.config_hash);
  })

  it('should return true on verified the cluster lock', async () => {
    const isValidLock: boolean = await validateClusterLock(clusterLockV1X7);
    expect(isValidLock).toEqual(true);
  })

  afterAll(async () => {
    const config_hash = clusterLockV1X7.cluster_definition.config_hash;
    const lock_hash = clusterLockV1X7.lock_hash;

    await request(app).delete(`/lock/${lock_hash}`).set('Authorization', `Bearer ${DEL_AUTH}`);
    await request(app).delete(`/dv/${config_hash}`).set('Authorization', `Bearer ${DEL_AUTH}`)

  });
});






