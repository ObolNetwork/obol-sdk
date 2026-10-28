import { ETH, GWEI } from '../units.js';
import { getObolChain } from '../chains.js';
import {
  checksum,
  decode,
  invalid,
  ZERO_ADDRESS,
  sameAddress,
} from '../schema.js';
import { definitionHash } from './hash.js';
import {
  DEFAULT_DEFINITION_VERSION,
  PrepareDefinitionSchema,
  CREATABLE_DEFINITION_VERSIONS,
  type ClusterDefinition,
  type PreparedDefinition,
} from './schema.js';

export const DKG_ALGORITHM = 'default';
export const DEFAULT_TARGET_GAS_LIMIT = 200_000_000;

const DEPOSIT_AMOUNTS = [1n * ETH, 32n * ETH];
const COMPOUNDING_DEPOSIT_AMOUNTS = [1n * ETH, 8n * ETH, 32n * ETH, 256n * ETH];

const randomUuid = (): string => globalThis.crypto.randomUUID();

/** Threshold for `n` operators: ceil(2n / 3). */
export const thresholdFor = (operators: number): number =>
  Math.ceil((2 * operators) / 3);

/**
 * Builds an unsigned cluster definition and its config hash. Nothing is
 * signed or sent.
 *
 * Checks: `version` v1.10.0 or later; at least 4 operators whose addresses are
 * unique (case-insensitive) and either all set or all empty (solo and Charon
 * flows); at least 1 validator with non-zero fee recipient and withdrawal
 * addresses; deposit amounts that are whole gwei and one of 1 or 32 ETH (1,
 * 8, 32 or 256 ETH with `compounding`); no unknown fields.
 *
 * @throws PAYLOAD_INVALID, UNSUPPORTED_CHAIN for an unknown `chainId`.
 */
export const prepareDefinition = (input: unknown): PreparedDefinition => {
  const args = decode(PrepareDefinitionSchema, input);
  const version = args.version ?? DEFAULT_DEFINITION_VERSION;
  if (!(CREATABLE_DEFINITION_VERSIONS as readonly string[]).includes(version)) {
    throw invalid(
      'version',
      `must be one of ${CREATABLE_DEFINITION_VERSIONS.join(', ')}`,
    );
  }

  const addresses = args.operators.map(o => o.address);
  const empty = addresses.filter(a => a === '').length;
  if (empty !== 0 && empty !== addresses.length) {
    throw invalid('operators', 'addresses must be all set or all empty');
  }
  addresses.forEach((address, i) => {
    if (address === '') return;
    if (addresses.findIndex(a => sameAddress(a, address)) !== i) {
      throw invalid(`operators[${i}].address`, 'duplicate operator address');
    }
  });

  args.validators.forEach((v, i) => {
    if (sameAddress(v.feeRecipientAddress, ZERO_ADDRESS)) {
      throw invalid(`validators[${i}].feeRecipientAddress`, 'must not be zero');
    }
    if (sameAddress(v.withdrawalAddress, ZERO_ADDRESS)) {
      throw invalid(`validators[${i}].withdrawalAddress`, 'must not be zero');
    }
  });

  const compounding = args.compounding ?? false;
  const allowed = compounding ? COMPOUNDING_DEPOSIT_AMOUNTS : DEPOSIT_AMOUNTS;
  args.depositAmounts?.forEach((amount, i) => {
    if (amount % GWEI !== 0n) {
      throw invalid(`depositAmounts[${i}]`, 'must be a whole number of gwei');
    }
    if (!allowed.includes(amount)) {
      throw invalid(
        `depositAmounts[${i}]`,
        `must be one of ${allowed.map(a => `${a / ETH} ETH`).join(', ')}`,
      );
    }
  });

  const chain = getObolChain(args.chainId);
  const definition: ClusterDefinition = {
    name: args.name,
    creator: { address: checksum(args.creator) },
    operators: addresses.map(a => ({ address: a === '' ? '' : checksum(a) })),
    validators: args.validators.map(v => ({
      fee_recipient_address: checksum(v.feeRecipientAddress),
      withdrawal_address: checksum(v.withdrawalAddress),
    })),
    deposit_amounts:
      args.depositAmounts?.map(amount => (amount / GWEI).toString()) ?? null,
    compounding,
    target_gas_limit: args.targetGasLimit ?? DEFAULT_TARGET_GAS_LIMIT,
    consensus_protocol: args.consensusProtocol ?? '',
    fork_version: chain.forkVersion,
    dkg_algorithm: DKG_ALGORITHM,
    version,
    uuid: args.uuid ?? randomUuid(),
    timestamp: args.timestamp ?? new Date().toISOString(),
    threshold: thresholdFor(addresses.length),
    num_validators: args.validators.length,
    config_hash: '',
  };
  const configHash = definitionHash(definition, true);
  definition.config_hash = configHash;
  return { definition, configHash };
};
