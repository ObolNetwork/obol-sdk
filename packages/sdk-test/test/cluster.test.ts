import request from 'supertest';
import { clusterConfig, mockGroupClusterLockV1X5 } from './fixtures';
import { client, updateClusterDef, publishLockFile, app, postClusterDef } from './utils';


jest.setTimeout(10000);

describe('Create Cluster Definition', () => {
  it('should post a cluster definition and return lockhash', async () => {
    const lockHash = await client.createClusterDefinition(clusterConfig);
    console.log(lockHash, "lockHash")
    expect(lockHash).toHaveLength(66);
  })
});

describe('Poll Cluster Lock', () => {
  //Test polling getClusterLock through mimicing the whole flow using obol-api endpoints 
  const { definition_hash: _, ...rest } =
    mockGroupClusterLockV1X5.cluster_definition;
  const clusterWithoutDefHash = rest;

  beforeAll(async () => {
    await postClusterDef(clusterWithoutDefHash);
  })

  it('should make a GET request to the API periodically until a lock is returned', async () => {
    //Call two async operations in parallel, polling to fetch lockFile when exist and the whole process after the creator shares the link with operators
    const [lockObject] = await Promise.all([new Promise((resolve, reject) => {
      var pollReqIntervalId = setInterval(function () {
        client.getClusterLock(mockGroupClusterLockV1X5.cluster_definition.config_hash).then((lockFile: any) => {
          if (lockFile?.lock_hash) {
            console.log(lockFile, "lockFile")
            clearInterval(pollReqIntervalId);
            resolve(lockFile)
          }
        }).catch((err: any) => {
          //TODO(Hanan) Update this once the errors thrown from obol-api are updated
          console.log(err)
        })
      }, 1000);

      setTimeout(function () {
        clearInterval(pollReqIntervalId);
        reject("Time out")
      }, 5000)

    }), (async () => {
      await updateClusterDef(mockGroupClusterLockV1X5.cluster_definition);
      await publishLockFile(mockGroupClusterLockV1X5)
    })()]);
    expect(lockObject).toHaveProperty('lock_hash');
  });

  afterAll(async () => {
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






