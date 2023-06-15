import request from 'supertest';
import { clusterConfig, clusterLockV1X5 } from './fixtures';
import { client, updateClusterDef, publishLockFile, app, postClusterDef } from './utils';


jest.setTimeout(10000);

describe('Create Cluster Definition', () => {
  it('should post a cluster definition and return lockhash', async () => {
    const lockHash = await client.createClusterDefinition(clusterConfig);
    expect(lockHash).toHaveLength(66);
  })
});

describe('Poll Cluster Lock', () => {
  //Test polling getClusterLock through mimicing the whole flow using obol-api endpoints 
  const { definition_hash: _, ...rest } =
    clusterLockV1X5.cluster_definition;
  const clusterWithoutDefHash = rest;

  beforeAll(async () => {
    try {
      await postClusterDef(clusterWithoutDefHash)
    } catch (error) {
      console.error('Setup error:', error);
      throw error;
    }
  })

  it('should make a GET request to the API periodically until a lock is returned', async () => {
    try {
      //Call two async operations in parallel, polling to fetch lockFile when exist and the whole process after the creator shares the link with operators
      const [lockObject] = await Promise.all([new Promise((resolve, reject) => {
        var pollReqIntervalId = setInterval(async function () {
          try {
            const lockFile = await client.getClusterLock(clusterLockV1X5.cluster_definition.config_hash);
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
          reject("Time out")
        }, 5000)

      }), (async () => {
        try {
          await updateClusterDef(clusterLockV1X5.cluster_definition);
          await publishLockFile(clusterLockV1X5);
        } catch (error) {
          fail(error);
        }

      })()]);
      expect(lockObject).toHaveProperty('lock_hash');

    } catch (error) {
      fail(error);
    }
  });

  afterAll(async () => {
    const config_hash = clusterLockV1X5.cluster_definition.config_hash;
    const lock_hash = clusterLockV1X5.lock_hash;
    try {
      await request(app).delete(`/lock/${lock_hash}`);
      await request(app).delete(`/dv/${config_hash}`);
    } catch (error) {
      throw error;
    }
  });
});






