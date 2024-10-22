import request from 'supertest';
import {
  clusterConfigV1X8,
  clusterLockV1X6,
  clusterLockV1X7,
  clusterLockV1X8,
  enr,
  nullDepositAmountsClusterLockV1X8,
} from '../fixtures';
import {
  client,
  updateClusterDef,
  publishLockFile,
  app,
  postClusterDef,
  randomClient,
  randomSigner,
  signer,
  secondRandomSigner,
} from './utils';
import {
  type ClusterDefinition,
  Client,
  validateClusterLock,
} from '@obolnetwork/obol-sdk';

const DEL_AUTH = process.env.DEL_AUTH;

jest.setTimeout(50000);

/* eslint @typescript-eslint/no-misused-promises: 0 */ // --> OFF
describe('Cluster Definition', () => {
  let configHash: string;
  let clusterDefinition: ClusterDefinition;
  let randomConfigHash: string;
  const clientWithoutAsigner = new Client({
    baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech',
    chainId: 17000,
  });

  const unauthorisedClient = randomClient;

  it('should post latest terms and conditions acceptance signature', async () => {
    const isAuthorised = await client.acceptObolLatestTermsAndConditions();
    expect(isAuthorised).toEqual('successful authorization');
  });

  it('should post a cluster definition and return confighash for an authorised user', async () => {
    configHash = await client.createClusterDefinition(clusterConfigV1X8);
    expect(configHash).toHaveLength(66);
  });

  it('should throw on post a cluster without a signer', async () => {
    try {
      await clientWithoutAsigner.createClusterDefinition(clusterConfigV1X8);
    } catch (err: any) {
      expect(err.message).toEqual(
        'Signer is required in createClusterDefinition',
      );
    }
  });

  it('should throw on post a cluster if the user did not sign latest terms and conditions', async () => {
    try {
      await unauthorisedClient.createClusterDefinition(clusterConfigV1X8);
    } catch (err: any) {
      expect(err.message).toEqual('Missing t&c signature');
      expect(err.statusCode).toEqual(401);
    }
  });

  it('should fetch the cluster definition for the configHash', async () => {
    clusterDefinition = await client.getClusterDefinition(configHash);
    expect(clusterDefinition.config_hash).toEqual(configHash);
  });

  it('should fetch the cluster definition for the configHash without a signer', async () => {
    clusterDefinition =
      await clientWithoutAsigner.getClusterDefinition(configHash);
    expect(clusterDefinition.config_hash).toEqual(configHash);
  });

  it('should throw on update a cluster that the operator is not part of', async () => {
    try {
      await client.acceptClusterDefinition(
        { enr, version: clusterDefinition.version },
        configHash,
      );
    } catch (err: any) {
      expect(err.message).toEqual('Data not found');
    }
  });

  it('should throw on accept a cluster if the user did not sign latest terms and conditions', async () => {
    try {
      await unauthorisedClient.acceptClusterDefinition(
        { enr, version: clusterDefinition.version },
        configHash,
      );
    } catch (err: any) {
      expect(err.message).toEqual('Missing t&c signature');
      expect(err.statusCode).toEqual(401);
    }
  });

  it('should update the cluster which the operator belongs to for an authorised user', async () => {
    const signerAddress = await signer.getAddress();
    clusterConfigV1X8.operators.push({ address: signerAddress });

    randomConfigHash = await client.createClusterDefinition(clusterConfigV1X8);

    const definitionData: ClusterDefinition =
      await client.acceptClusterDefinition(
        { enr, version: clusterDefinition.version },
        randomConfigHash,
      );
    expect(
      definitionData.operators[definitionData.operators.length - 1].enr,
    ).toEqual(enr);
  });

  it('should throw on update a cluster without a signer', async () => {
    try {
      await clientWithoutAsigner.acceptClusterDefinition(
        { enr, version: clusterDefinition.version },
        configHash,
      );
    } catch (err: any) {
      expect(err.message).toEqual(
        'Signer is required in acceptClusterDefinition',
      );
    }
  });

  it('should deploy OWR and Splitter', async () => {
    const secondRandomSignerAddress = await secondRandomSigner.getAddress();
    // new splitter
    const { withdrawal_address, fee_recipient_address } =
      await client.createObolTotalSplit({
        splitRecipients: [
          { account: secondRandomSignerAddress, percentAllocation: 39.9 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
      });

    // same splitter
    const contractsWithSameFeeRecipientAddress =
      await client.createObolTotalSplit({
        splitRecipients: [
          { account: secondRandomSignerAddress, percentAllocation: 39.9 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
      });

    expect(withdrawal_address.length).toEqual(42);

    expect(fee_recipient_address.toLowerCase()).toEqual(
      withdrawal_address.toLowerCase(),
    );

    expect(fee_recipient_address.toLowerCase()).toEqual(
      contractsWithSameFeeRecipientAddress.fee_recipient_address.toLowerCase(),
    );
  });

  it('should deploy OWR and splitter and get tranches', async () => {
    const secondRandomSignerAddress = await secondRandomSigner.getAddress();
    const principalRecipient = '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966';

    // new splitter
    const { withdrawal_address, fee_recipient_address } =
      await client.createObolRewardsSplit({
        splitRecipients: [
          { account: secondRandomSignerAddress, percentAllocation: 39 },
          {
            account: principalRecipient,
            percentAllocation: 60,
          },
        ],
        principalRecipient: principalRecipient,
        etherAmount: 2,
        distributorFee: 2,
        controllerAddress: principalRecipient,
      });

    const res = await client.getOWRTranches(withdrawal_address);

    expect(res.principalRecipient.toLowerCase()).toEqual(
      principalRecipient.toLowerCase(),
    );
    expect(res.rewardRecipient.toLowerCase()).toEqual(
      fee_recipient_address.toLowerCase(),
    );
    expect(res.amountOfPrincipalStake).toEqual(BigInt(32000000000000000000));
  });

  it('should deploy OWR and Splitter with a controller address and a distributorFee', async () => {
    const signerAddress = await randomSigner.getAddress();
    // new splitter
    const { withdrawal_address, fee_recipient_address } =
      await client.createObolRewardsSplit({
        splitRecipients: [
          { account: signerAddress, percentAllocation: 39 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
        principalRecipient: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
        etherAmount: 2,
        distributorFee: 2,
        controllerAddress: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
      });

    // same splitter
    const contractsWithDifferentFeeRecipient =
      await client.createObolRewardsSplit({
        splitRecipients: [
          { account: signerAddress, percentAllocation: 39 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
        principalRecipient: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
        etherAmount: 2,
        distributorFee: 2,
        controllerAddress: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
      });

    expect(withdrawal_address.length).toEqual(42);
    expect(fee_recipient_address.length).toEqual(42);
    expect(
      contractsWithDifferentFeeRecipient.withdrawal_address.length,
    ).toEqual(42);
    expect(
      contractsWithDifferentFeeRecipient.fee_recipient_address.length,
    ).toEqual(42);
    expect(fee_recipient_address.toLowerCase()).not.toEqual(
      contractsWithDifferentFeeRecipient.fee_recipient_address.toLowerCase(),
    );
  });

  it('should deploy Splitter', async () => {
    const secondRandomSignerAddress = await secondRandomSigner.getAddress();
    // new splitter
    const { withdrawal_address, fee_recipient_address } =
      await client.createObolTotalSplit({
        splitRecipients: [
          { account: secondRandomSignerAddress, percentAllocation: 39.9 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
      });

    // same splitter
    const contractsWithSameFeeRecipientAddress =
      await client.createObolTotalSplit({
        splitRecipients: [
          { account: secondRandomSignerAddress, percentAllocation: 39.9 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
      });

    expect(withdrawal_address.length).toEqual(42);

    expect(fee_recipient_address.toLowerCase()).toEqual(
      withdrawal_address.toLowerCase(),
    );

    expect(fee_recipient_address.toLowerCase()).toEqual(
      contractsWithSameFeeRecipientAddress.fee_recipient_address.toLowerCase(),
    );
  });

  it('should deploy Splitter with distributorFee and controller address', async () => {
    const secondRandomSignerAddress = await secondRandomSigner.getAddress();
    // new splitter
    const { withdrawal_address, fee_recipient_address } =
      await client.createObolTotalSplit({
        splitRecipients: [
          { account: secondRandomSignerAddress, percentAllocation: 39.9 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
        distributorFee: 2,
        controllerAddress: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
      });

    // same splitter
    const contractsWithDifferentFeeRecipient =
      await client.createObolTotalSplit({
        splitRecipients: [
          { account: secondRandomSignerAddress, percentAllocation: 39.9 },
          {
            account: '0xf6fF1a7A14D01e86a175bA958d3B6C75f2213966',
            percentAllocation: 60,
          },
        ],
      });

    expect(withdrawal_address.length).toEqual(42);
    expect(fee_recipient_address.toLowerCase()).toEqual(
      withdrawal_address.toLowerCase(),
    );
    expect(
      contractsWithDifferentFeeRecipient.withdrawal_address.length,
    ).toEqual(42);
    expect(
      contractsWithDifferentFeeRecipient.fee_recipient_address.toLowerCase(),
    ).toEqual(
      contractsWithDifferentFeeRecipient.withdrawal_address.toLowerCase(),
    );
    expect(fee_recipient_address.toLowerCase()).not.toEqual(
      contractsWithDifferentFeeRecipient.fee_recipient_address.toLowerCase(),
    );
  });

  afterAll(async () => {
    await request(app)
      .delete(`/v1/definition/${configHash}`)
      .set('Authorization', `Bearer ${DEL_AUTH}`);
    await request(app)
      .delete(`/v1/definition/${randomConfigHash}`)
      .set('Authorization', `Bearer ${DEL_AUTH}`);
  });
});

describe('Poll Cluster Lock', () => {
  // Test polling getClusterLock through mimicing the whole flow using obol-api endpoints
  const { definition_hash: _, ...rest } = clusterLockV1X8.cluster_definition;
  const clusterWithoutDefHash = rest;
  const clientWithoutAsigner = new Client({
    baseUrl: 'https://obol-api-nonprod-dev.dev.obol.tech',
    chainId: 17000,
  });

  beforeAll(async () => {
    await postClusterDef(clusterWithoutDefHash);
  });

  it('should make a GET request to the API periodically until a lock is returned', async () => {
    // Call two async operations in parallel, polling to fetch lockFile when exist and the whole process after the creator shares the link with operators
    const [lockObject] = await Promise.all([
      new Promise((resolve, reject) => {
        const pollReqIntervalId = setInterval(async function () {
          try {
            const lockFile = await client.getClusterLock(
              clusterLockV1X8.cluster_definition.config_hash,
            );
            if (lockFile?.lock_hash) {
              clearInterval(pollReqIntervalId);
              resolve(lockFile);
            }
          } catch (err: any) {
            // TODO(Hanan) Update this once the errors thrown from obol-api are updated
            console.log(err);
          }
        }, 1000);

        setTimeout(function () {
          clearInterval(pollReqIntervalId);
          reject(new Error('Time out'));
        }, 5000);
      }),
      (async () => {
        await updateClusterDef(clusterLockV1X8.cluster_definition);
        await publishLockFile(clusterLockV1X8);
      })(),
    ]);
    expect(lockObject).toHaveProperty('lock_hash');
  });

  it('fetches a lock successfully without a signer', async () => {
    // Call two async operations in parallel, polling to fetch lockFile when exist and the whole process after the creator shares the link with operators
    const [lockObject] = await Promise.all([
      new Promise((resolve, reject) => {
        const pollReqIntervalId = setInterval(async function () {
          try {
            const lockFile = await clientWithoutAsigner.getClusterLock(
              clusterLockV1X8.cluster_definition.config_hash,
            );
            if (lockFile?.lock_hash) {
              clearInterval(pollReqIntervalId);
              resolve(lockFile);
            }
          } catch (err: any) {
            console.log(err);
          }
        }, 1000);

        setTimeout(function () {
          clearInterval(pollReqIntervalId);
          reject(new Error('Time out'));
        }, 5000);
      }),
      (async () => {
        await updateClusterDef(clusterLockV1X8.cluster_definition);
        await publishLockFile(clusterLockV1X8);
      })(),
    ]);
    expect(lockObject).toHaveProperty('lock_hash');
  });

  it('should fetch the cluster definition for the configHash', async () => {
    const clusterDefinition: ClusterDefinition =
      await client.getClusterDefinition(
        clusterLockV1X8.cluster_definition.config_hash,
      );
    expect(clusterDefinition.deposit_amounts?.length).toEqual(
      clusterLockV1X8.cluster_definition.deposit_amounts.length,
    );
    expect(clusterDefinition.config_hash).toEqual(
      clusterLockV1X8.cluster_definition.config_hash,
    );
  });

  test.each([
    { version: 'v1.6.0', clusterLock: clusterLockV1X6 },
    { version: 'v1.7.0', clusterLock: clusterLockV1X7 },
    { version: 'v1.8.0', clusterLock: clusterLockV1X8 },
    {
      version: 'null deposit_amounts v1.8.0',
      clusterLock: nullDepositAmountsClusterLockV1X8,
    },
  ])(
    "$version: 'should return true on verified cluster lock'",
    async ({ clusterLock }) => {
      const isValidLock: boolean = await validateClusterLock(clusterLock);
      expect(isValidLock).toEqual(true);
    },
  );

  afterAll(async () => {
    const configHash = clusterLockV1X8.cluster_definition.config_hash;
    const lockHash = clusterLockV1X8.lock_hash;

    await request(app)
      .delete(`/v1/lock/${lockHash}`)
      .set('Authorization', `Bearer ${DEL_AUTH}`);
    await request(app)
      .delete(`/v1/definition/${configHash}`)
      .set('Authorization', `Bearer ${DEL_AUTH}`);
  });
});
