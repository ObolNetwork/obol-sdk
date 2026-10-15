// @ts-nocheck
import { jest, describe, test, expect, afterEach } from '@jest/globals';
import {
  Client,
  ChainMismatchError,
  DefinitionVerificationError,
  NotAnOperatorError,
  UnsupportedChainError,
  SUPPORTED_CHAIN_IDS,
} from '../../src/index';
import { EOA } from '../../src/eoa/eoa.js';
import { clusterConfigOrDefinitionHash } from '../../src/verification/common.js';
import {
  clusterLockV1X10,
  clusterConfigV1X10,
  TEST_ADDRESSES,
} from '../fixtures.js';

const baseUrl = 'https://obol-api-nonprod-dev.dev.obol.tech';
const SIGNER_ADDRESS = clusterLockV1X10.cluster_definition.operators[0].address;
const SIGNER_ENR = clusterLockV1X10.cluster_definition.operators[0].enr;

const mockSigner = (address: string, chainId?: number) => ({
  getAddress: jest.fn().mockResolvedValue(address),
  signTypedData: jest.fn().mockResolvedValue('0xsigned'),
  sendTransaction: jest.fn(),
  provider:
    chainId === undefined
      ? null
      : {
          getNetwork: jest.fn().mockResolvedValue({ chainId: BigInt(chainId) }),
        },
});

/** The fixture Hoodi definition before any operator has accepted. */
const pendingDefinition = () => {
  const def = structuredClone(clusterLockV1X10.cluster_definition);
  def.operators = def.operators.map(o => ({ address: o.address }));
  return def;
};

/** Mocks fetch: GET returns `definition`, PUT echoes it back. */
const mockApi = (definition: any) =>
  jest.spyOn(globalThis, 'fetch').mockImplementation(async (_url, init) => ({
    ok: true,
    json: async () => definition,
    _method: init?.method,
  }));

const putCalls = (fetchSpy: any) =>
  fetchSpy.mock.calls.filter(([, init]) => init?.method === 'PUT');

afterEach(() => {
  jest.restoreAllMocks();
});

describe('Client constructor chainId', () => {
  test.each([1, 560048])('accepts supported chainId %s', chainId => {
    expect(new Client({ baseUrl, chainId }).chainId).toBe(chainId);
  });

  test('defaults to Hoodi', () => {
    expect(new Client({ baseUrl }).chainId).toBe(560048);
  });

  test.each([100, 11155111, 5, 17000, 999])(
    'rejects unsupported chainId %s',
    chainId => {
      expect(() => new Client({ baseUrl, chainId })).toThrow(
        UnsupportedChainError,
      );
      expect(() => new Client({ baseUrl, chainId })).toThrow(
        'Supported chain IDs: 1 (Mainnet), 560048 (Hoodi)',
      );
    },
  );

  test('SUPPORTED_CHAIN_IDS lists mainnet and hoodi', () => {
    expect([...SUPPORTED_CHAIN_IDS].sort()).toEqual([1, 560048]);
  });
});

describe('acceptClusterDefinition verification', () => {
  test('signs and submits for a verified definition, filling version', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const result = await client.acceptClusterDefinition(
      { enr: SIGNER_ENR },
      def.config_hash,
    );

    expect(result).toEqual(def);
    expect(signer.signTypedData).toHaveBeenCalledTimes(2);
    const puts = putCalls(fetchSpy);
    expect(puts).toHaveLength(1);
    const body = JSON.parse(puts[0][1].body);
    expect(body.version).toBe(def.version);
    expect(body.address).toBe(SIGNER_ADDRESS);
    expect(body.fork_version).toBe('0x10000910');
  });

  test('accepts an explicit version equal to the definition version', async () => {
    const def = pendingDefinition();
    mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await expect(
      client.acceptClusterDefinition(
        { enr: SIGNER_ENR, version: def.version },
        def.config_hash,
      ),
    ).resolves.toEqual(def);
  });

  test('throws when the payload version differs from the definition', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await expect(
      client.acceptClusterDefinition(
        { enr: SIGNER_ENR, version: 'v1.11.0' },
        def.config_hash,
      ),
    ).rejects.toThrow(DefinitionVerificationError);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(putCalls(fetchSpy)).toHaveLength(0);
  });

  test('rejects a definition whose contents do not match config_hash', async () => {
    const def = pendingDefinition();
    def.validators[0].withdrawal_address = TEST_ADDRESSES.PRINCIPAL_RECIPIENT_1;
    const fetchSpy = mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await expect(
      client.acceptClusterDefinition({ enr: SIGNER_ENR }, def.config_hash),
    ).rejects.toThrow(/does not match its config_hash/);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(putCalls(fetchSpy)).toHaveLength(0);
  });

  test('rejects a definition returned for a different config_hash', async () => {
    const def = pendingDefinition();
    mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);
    const requested = '0x' + 'ab'.repeat(32);

    await expect(
      client.acceptClusterDefinition({ enr: SIGNER_ENR }, requested),
    ).rejects.toThrow(DefinitionVerificationError);
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  test('rejects when the signer is not an operator', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi(def);
    const outsider = TEST_ADDRESSES.OVM_OWNER;
    const signer = mockSigner(outsider, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const err = await client
      .acceptClusterDefinition({ enr: SIGNER_ENR }, def.config_hash)
      .catch(e => e);
    expect(err).toBeInstanceOf(NotAnOperatorError);
    expect(err.address).toBe(outsider);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(putCalls(fetchSpy)).toHaveLength(0);
  });

  test('matches the operator address case-insensitively', async () => {
    const def = pendingDefinition();
    mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS.toLowerCase(), 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await expect(
      client.acceptClusterDefinition({ enr: SIGNER_ENR }, def.config_hash),
    ).resolves.toEqual(def);
  });

  test('rejects a definition for another network', async () => {
    // Hoodi definition, mainnet client
    const def = pendingDefinition();
    mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS, 1);
    const client = new Client({ baseUrl, chainId: 1 }, signer);

    await expect(
      client.acceptClusterDefinition({ enr: SIGNER_ENR }, def.config_hash),
    ).rejects.toThrow(/fork_version 0x10000910/);
    expect(signer.signTypedData).not.toHaveBeenCalled();
  });

  test('throws ChainMismatchError when the signer is on another chain', async () => {
    const def = pendingDefinition();
    const fetchSpy = mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS, 1);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const err = await client
      .acceptClusterDefinition({ enr: SIGNER_ENR }, def.config_hash)
      .catch(e => e);
    expect(err).toBeInstanceOf(ChainMismatchError);
    expect(err.expectedChainId).toBe(560048);
    expect(err.actualChainId).toBe(1);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('skips the chain check for a signer without a provider', async () => {
    const def = pendingDefinition();
    mockApi(def);
    const signer = mockSigner(SIGNER_ADDRESS);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await expect(
      client.acceptClusterDefinition({ enr: SIGNER_ENR }, def.config_hash),
    ).resolves.toEqual(def);
  });

  test('returns the definition without signing if already accepted with the same ENR', async () => {
    const def = clusterLockV1X10.cluster_definition;
    const fetchSpy = mockApi(def);
    const signer = mockSigner(def.operators[0].address, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    const result = await client.acceptClusterDefinition(
      { enr: def.operators[0].enr },
      def.config_hash,
    );
    expect(result).toEqual(def);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(putCalls(fetchSpy)).toHaveLength(0);
  });

  test('re-submits if already accepted with a different ENR', async () => {
    const def = clusterLockV1X10.cluster_definition;
    const fetchSpy = mockApi(def);
    const signer = mockSigner(def.operators[0].address, 560048);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await client.acceptClusterDefinition(
      { enr: def.operators[1].enr },
      def.config_hash,
    );
    expect(signer.signTypedData).toHaveBeenCalledTimes(2);
    expect(putCalls(fetchSpy)).toHaveLength(1);
  });
});

describe('getAcceptanceSummary', () => {
  test('returns the verified terms without a signer', async () => {
    const def = pendingDefinition();
    def.validators = [
      def.validators[0],
      {
        fee_recipient_address:
          def.validators[0].fee_recipient_address.toLowerCase(),
        withdrawal_address: TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
      },
    ];
    def.num_validators = 2;
    def.deposit_amounts = null;
    def.config_hash = clusterConfigOrDefinitionHash(def, true);
    mockApi(def);
    const client = new Client({ baseUrl, chainId: 560048 });

    const summary = await client.getAcceptanceSummary(def.config_hash);

    expect(summary).toEqual({
      config_hash: def.config_hash,
      name: def.name,
      version: def.version,
      fork_version: def.fork_version,
      creator_address: def.creator.address,
      operators: def.operators.map(o => o.address),
      threshold: def.threshold,
      num_validators: 2,
      validators: def.validators,
      withdrawal_addresses: [
        def.validators[0].withdrawal_address,
        TEST_ADDRESSES.PRINCIPAL_RECIPIENT_2,
      ],
      fee_recipient_addresses: [def.validators[0].fee_recipient_address],
      deposit_amounts: null,
      compounding: def.compounding,
    });
  });

  test('rejects a tampered definition', async () => {
    const def = pendingDefinition();
    def.validators[0].fee_recipient_address = TEST_ADDRESSES.REWARD_RECIPIENT_2;
    mockApi(def);
    const client = new Client({ baseUrl, chainId: 560048 });

    await expect(client.getAcceptanceSummary(def.config_hash)).rejects.toThrow(
      DefinitionVerificationError,
    );
  });
});

describe('signer chain check on other write methods', () => {
  test('createClusterDefinition throws ChainMismatchError before signing', async () => {
    const fetchSpy = mockApi({});
    const signer = mockSigner(SIGNER_ADDRESS, 1);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await expect(
      client.createClusterDefinition(clusterConfigV1X10),
    ).rejects.toThrow(ChainMismatchError);
    expect(signer.signTypedData).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  test('splits.requestWithdrawal throws ChainMismatchError before sending', async () => {
    const signer = mockSigner(SIGNER_ADDRESS, 560048);
    const client = new Client({ baseUrl, chainId: 1 }, signer);

    await expect(
      client.splits.requestWithdrawal({
        ovmAddress: TEST_ADDRESSES.REWARD_RECIPIENT_1,
        pubKeys: ['0x' + 'a'.repeat(96)],
        amounts: ['32000000000'],
        withdrawalFees: '1',
      }),
    ).rejects.toThrow(ChainMismatchError);
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  test('eoa.deposit throws ChainMismatchError before sending', async () => {
    const signer = mockSigner(SIGNER_ADDRESS, 560048);
    const eoa = new EOA(signer, 1, signer.provider);

    await expect(
      eoa.deposit({
        deposits: [
          {
            pubkey: '0x' + 'a'.repeat(96),
            withdrawal_credentials: '0x' + 'b'.repeat(64),
            deposit_data_root: '0x' + 'c'.repeat(64),
            signature: '0x' + 'd'.repeat(192),
            amount: '32000000000',
          },
        ],
      }),
    ).rejects.toThrow(ChainMismatchError);
    expect(signer.sendTransaction).not.toHaveBeenCalled();
  });

  test('incentives.claimIncentives throws ChainMismatchError', async () => {
    const fetchSpy = mockApi({});
    const signer = mockSigner(SIGNER_ADDRESS, 1);
    const client = new Client({ baseUrl, chainId: 560048 }, signer);

    await expect(
      client.incentives.claimIncentives(SIGNER_ADDRESS),
    ).rejects.toThrow(ChainMismatchError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});
