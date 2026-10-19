import { parseEther } from 'viem';
import {
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  prepareDefinition,
  verifyDefinition,
} from '../../src/cluster/index.js';
import { clusterConfigOrDefinitionHash } from '../../src/internal/verification/common.js';
import { ObolError } from '../../src/errors.js';
import { clusterLockV1X10 } from '../fixtures.js';
import { OPS, prepareInput, signedDefinition, VALIDATOR } from './fixtures.js';
import { accountOf, KEYS } from './wallet.js';

const copy = <T>(value: T): any => JSON.parse(JSON.stringify(value));

const caught = (fn: () => unknown): ObolError => {
  try {
    fn();
  } catch (e) {
    return e as ObolError;
  }
  throw new Error('expected a throw');
};

const creator = accountOf(KEYS.creator);

describe('cluster hashes', () => {
  it('match the 2.x hashing of the fixture lock', () => {
    const lock = copy(clusterLockV1X10);
    expect(computeConfigHash(lock.cluster_definition)).toBe(
      lock.cluster_definition.config_hash,
    );
    expect(computeDefinitionHash(lock.cluster_definition)).toBe(
      lock.cluster_definition.definition_hash,
    );
    expect(computeLockHash(lock)).toBe(lock.lock_hash);
  });

  it('report an unsupported version as DEFINITION_INVALID', () => {
    const definition = copy(clusterLockV1X10.cluster_definition);
    definition.version = 'v1.9.0';
    const error = caught(() => computeConfigHash(definition));
    expect(error.code).toBe('DEFINITION_INVALID');
    expect(error.details.issues).toEqual([
      expect.objectContaining({ code: 'version_unsupported' }),
    ]);
  });

  it('report a malformed definition as PAYLOAD_INVALID', () => {
    expect(caught(() => computeConfigHash({ version: 'v1.10.0' })).code).toBe(
      'PAYLOAD_INVALID',
    );
    const definition = copy(clusterLockV1X10.cluster_definition);
    definition.fork_version = '0xzz';
    expect(caught(() => computeConfigHash(definition)).code).toBe(
      'PAYLOAD_INVALID',
    );
  });
});

describe('cluster.prepareDefinition', () => {
  it('builds the definition 2.x would post, with its config hash', () => {
    const { definition, configHash } = prepareDefinition(
      prepareInput({
        depositAmounts: [parseEther('32')],
        compounding: false,
      }),
    );
    expect(definition).toMatchObject({
      name: 'v3 test',
      creator: { address: creator.address },
      operators: OPS.map(address => ({ address })),
      validators: [
        {
          fee_recipient_address: VALIDATOR.feeRecipientAddress,
          withdrawal_address: VALIDATOR.withdrawalAddress,
        },
      ],
      deposit_amounts: ['32000000000'],
      compounding: false,
      target_gas_limit: 36_000_000,
      consensus_protocol: '',
      fork_version: '0x10000910',
      dkg_algorithm: 'default',
      version: 'v1.11.0',
      threshold: 3,
      num_validators: 1,
      config_hash: configHash,
    });
    expect(configHash).toBe(
      clusterConfigOrDefinitionHash(definition as any, true),
    );
  });

  it('generates uuid and timestamp when absent', () => {
    const input: any = prepareInput();
    delete input.uuid;
    delete input.timestamp;
    const { definition } = prepareDefinition(input);
    expect(definition.uuid).toMatch(/^[0-9a-f-]{36}$/);
    expect(Number.isNaN(Date.parse(definition.timestamp ?? ''))).toBe(false);
  });

  it('accepts the solo flow (all operator addresses empty)', () => {
    const { definition } = prepareDefinition(
      prepareInput({ operators: OPS.map(() => ({ address: '' })) }),
    );
    expect(definition.operators).toEqual(OPS.map(() => ({ address: '' })));
  });

  it.each<[string, Record<string, unknown>, string]>([
    ['unsupported version', { version: 'v1.9.0' }, 'version'],
    [
      '3 operators',
      { operators: OPS.slice(1).map(a => ({ address: a })) },
      'operators',
    ],
    [
      'duplicate operator (case-insensitive)',
      {
        operators: [...OPS.slice(0, 3), OPS[0].toLowerCase()].map(address => ({
          address,
        })),
      },
      'operators[3].address',
    ],
    [
      'mixed empty and set operators',
      { operators: [...OPS.slice(0, 3), ''].map(address => ({ address })) },
      'operators',
    ],
    ['no validators', { validators: [] }, 'validators'],
    [
      'zero withdrawal address',
      {
        validators: [
          { ...VALIDATOR, withdrawalAddress: `0x${'00'.repeat(20)}` },
        ],
      },
      'validators[0].withdrawalAddress',
    ],
    [
      '8 ETH without compounding',
      { depositAmounts: [parseEther('8')] },
      'depositAmounts[0]',
    ],
    [
      'not whole gwei',
      { depositAmounts: [parseEther('32') + 1n] },
      'depositAmounts[0]',
    ],
    ['unknown field', { extra: true }, 'extra'],
    [
      'bad address checksum',
      { creator: '0x86b8145C98e5BD25BA722645b15eD65f024a87EC' },
      'creator',
    ],
  ])('rejects %s', (_name, extra, path) => {
    const error = caught(() => prepareDefinition(prepareInput(extra)));
    expect(error.code).toBe('PAYLOAD_INVALID');
    const paths = (error.details.issues as Array<{ path: string }>).map(
      i => i.path,
    );
    expect(paths).toContain(path);
  });

  it('accepts 8 and 256 ETH with compounding', () => {
    const { definition } = prepareDefinition(
      prepareInput({
        compounding: true,
        depositAmounts: [parseEther('8'), parseEther('256')],
      }),
    );
    expect(definition.deposit_amounts).toEqual(['8000000000', '256000000000']);
  });

  it('rejects an unknown chain with UNSUPPORTED_CHAIN', () => {
    expect(
      caught(() => prepareDefinition(prepareInput({ chainId: 5 }))).code,
    ).toBe('UNSUPPORTED_CHAIN');
  });
});

describe('cluster.verifyDefinition', () => {
  it('passes a signed fixture definition', async () => {
    const definition = copy(clusterLockV1X10.cluster_definition);
    expect(
      await verifyDefinition({
        definition,
        configHash: definition.config_hash.toUpperCase().replace('0X', '0x'),
        chainId: 560048,
      }),
    ).toEqual({ ok: true, issues: [] });
  });

  it('passes a partly signed definition (creator and one operator)', async () => {
    const { definition, configHash } = await signedDefinition({
      operatorSigned: true,
    });
    expect(
      await verifyDefinition({ definition, configHash, chainId: 560048 }),
    ).toEqual({ ok: true, issues: [] });
  });

  it('reports every issue', async () => {
    const definition = copy(clusterLockV1X10.cluster_definition);
    definition.name = 'renamed';
    definition.operators[2].enr_signature =
      definition.operators[1].enr_signature;
    const result = await verifyDefinition({
      definition,
      configHash: `0x${'ab'.repeat(32)}`,
      chainId: 1,
    });
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.code)).toEqual([
      'config_hash_mismatch',
      'config_hash_mismatch',
      'fork_version_mismatch',
      // Signatures are bound to the chain id, so all of them fail on mainnet.
      'signature_invalid',
      'signature_invalid',
      'signature_invalid',
      'signature_invalid',
      'signature_invalid',
      'signature_invalid',
      'signature_invalid',
      'signature_invalid',
      'signature_invalid',
    ]);
  });

  it('reports an unsupported version', async () => {
    const definition = copy(clusterLockV1X10.cluster_definition);
    definition.version = 'v1.5.0';
    const result = await verifyDefinition({ definition, chainId: 560048 });
    expect(result.issues.map(i => i.code)).toEqual(['version_unsupported']);
  });

  it('reports a signature by another account', async () => {
    const definition = copy(clusterLockV1X10.cluster_definition);
    definition.operators[2].enr_signature =
      definition.operators[1].enr_signature;
    const result = await verifyDefinition({ definition, chainId: 560048 });
    expect(result.issues).toEqual([
      {
        code: 'signature_invalid',
        message: 'invalid operators[2] enr_signature',
      },
    ]);
  });
});
