/**
 * Schemas for cluster files (definition and lock) in their charon / Obol API
 * wire format, and for the cluster operation inputs.
 *
 * The file schemas only check the shape (objects, arrays, strings, numbers):
 * a well-shaped file with wrong values is a verdict of `verifyDefinition` /
 * `verifyLock`, not a PAYLOAD_INVALID. Unknown fields are allowed, since
 * files carry fields of other versions.
 */
import {
  Type,
  type Static,
  type TArray,
  type TNull,
  type TSchema,
  type TUnion,
} from '@sinclair/typebox';
import { T } from '../schema.js';

const Str = Type.String();
const OptStr = Type.Optional(Type.String());
/** A list charon may write as `null` when empty. */
const List = <S extends TSchema>(item: S): TUnion<[TArray<S>, TNull]> =>
  Type.Union([Type.Array(item), Type.Null()]);

export const SUPPORTED_DEFINITION_VERSIONS = [
  'v1.6.0',
  'v1.7.0',
  'v1.8.0',
  'v1.10.0',
  'v1.11.0',
] as const;

export const DEFAULT_DEFINITION_VERSION = 'v1.11.0';

export const OperatorSchema = Type.Object({
  address: OptStr,
  enr: OptStr,
  config_signature: OptStr,
  enr_signature: OptStr,
});

// Charon omits empty strings; the hashing reads an absent one as ''.
export const DefinitionSchema = Type.Object({
  name: OptStr,
  version: Str,
  uuid: OptStr,
  timestamp: OptStr,
  num_validators: T.Uint,
  threshold: T.Uint,
  dkg_algorithm: OptStr,
  fork_version: Type.String({
    pattern: '^0x[0-9a-fA-F]{8}$',
    description: 'fork version (4 bytes)',
  }),
  config_hash: Str,
  definition_hash: OptStr,
  creator: Type.Object({ address: Str, config_signature: OptStr }),
  operators: List(OperatorSchema),
  validators: List(
    Type.Object({ fee_recipient_address: Str, withdrawal_address: Str }),
  ),
  deposit_amounts: Type.Optional(List(Type.Union([Str, T.Uint]))),
  consensus_protocol: OptStr,
  target_gas_limit: Type.Optional(T.Uint),
  compounding: Type.Optional(Type.Boolean()),
});

const DepositDataSchema = Type.Object({
  pubkey: OptStr,
  withdrawal_credentials: OptStr,
  amount: Type.Optional(Type.Union([Str, T.Uint])),
  deposit_data_root: OptStr,
  signature: OptStr,
});

const BuilderRegistrationSchema = Type.Object({
  message: Type.Object({
    fee_recipient: Str,
    gas_limit: T.Uint,
    timestamp: T.Uint,
    pubkey: Str,
  }),
  signature: Str,
});

export const LockSchema = Type.Object({
  cluster_definition: DefinitionSchema,
  distributed_validators: Type.Array(
    Type.Object({
      distributed_public_key: Str,
      public_shares: Type.Array(Str),
      deposit_data: Type.Optional(DepositDataSchema),
      partial_deposit_data: Type.Optional(List(DepositDataSchema)),
      builder_registration: Type.Optional(BuilderRegistrationSchema),
    }),
  ),
  signature_aggregate: Str,
  lock_hash: Str,
  node_signatures: Type.Optional(List(Str)),
});

/** A cluster definition file (wire format: snake_case, gwei amounts as strings). */
export type ClusterDefinition = Static<typeof DefinitionSchema>;
/** A cluster lock file (wire format). */
export type ClusterLock = Static<typeof LockSchema>;
export type ClusterOperator = Static<typeof OperatorSchema>;

export const PrepareDefinitionSchema = Type.Object(
  {
    name: Type.String({ minLength: 1 }),
    operators: Type.Array(
      Type.Object(
        { address: Type.Union([T.Address, Type.Literal('')]) },
        { additionalProperties: false },
      ),
      { minItems: 4 },
    ),
    validators: Type.Array(
      Type.Object(
        { feeRecipientAddress: T.Address, withdrawalAddress: T.Address },
        { additionalProperties: false },
      ),
      { minItems: 1 },
    ),
    depositAmounts: Type.Optional(Type.Array(T.Wei)),
    compounding: Type.Optional(Type.Boolean()),
    targetGasLimit: Type.Optional(Type.Integer({ minimum: 1 })),
    consensusProtocol: Type.Optional(
      Type.Union([Type.Literal(''), Type.Literal('qbft')]),
    ),
    version: Type.Optional(Type.String()),
    creator: T.Address,
    chainId: T.Uint,
    uuid: Type.Optional(Type.String({ minLength: 1, maxLength: 64 })),
    timestamp: Type.Optional(Type.String({ minLength: 1, maxLength: 32 })),
  },
  { additionalProperties: false },
);

export type PrepareDefinitionInput = Static<typeof PrepareDefinitionSchema>;

export interface PreparedDefinition {
  definition: ClusterDefinition;
  configHash: `0x${string}`;
}
