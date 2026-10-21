import { Type } from '@sinclair/typebox';
import type { PublicClient } from 'viem';
import { getObolChain } from '../chains.js';
import { isObolError } from '../errors.js';
import { decode, T } from '../schema.js';
import {
  creatorConfigHashTypedData,
  enrTypedData,
  isValidTypedDataSignature,
  operatorConfigHashTypedData,
} from './eip712.js';
import { definitionHash } from './hash.js';
import { DefinitionSchema, type ClusterDefinition } from './schema.js';

export interface DefinitionIssue {
  code:
    | 'config_hash_mismatch'
    | 'fork_version_mismatch'
    | 'version_unsupported'
    | 'signature_invalid';
  message: string;
}

export interface DefinitionVerification {
  ok: boolean;
  issues: DefinitionIssue[];
}

export interface VerifyOptions {
  /** Needed to check signatures of contract wallets (EIP-1271); must be on the definition's chain. */
  publicClient?: PublicClient;
}

export const VerifyDefinitionSchema = Type.Object({
  definition: DefinitionSchema,
  configHash: Type.Optional(T.Hash32),
  chainId: T.Uint,
});

const present = (value: string | undefined): value is string =>
  typeof value === 'string' && value !== '' && value !== '0x';

/**
 * Checks every signature present in a definition (creator config hash,
 * operator config hash and ENR), each over the definition's `config_hash`
 * in the chain-bound EIP-712 domain. Returns the failing signer names.
 */
export const invalidDefinitionSignatures = async (
  definition: ClusterDefinition,
  chainId: number,
  options: VerifyOptions,
  required: { creator: boolean; operators: boolean },
): Promise<string[]> => {
  const failures: string[] = [];
  const check = async (
    name: string,
    address: string | undefined,
    signature: string | undefined,
    data: ReturnType<typeof enrTypedData>,
    isRequired: boolean,
  ): Promise<void> => {
    if (!present(signature)) {
      if (isRequired) failures.push(name);
      return;
    }
    const ok =
      present(address) &&
      (await isValidTypedDataSignature({
        address,
        signature,
        data,
        publicClient: options.publicClient,
      }));
    if (!ok) failures.push(name);
  };

  const configHash = definition.config_hash;
  await check(
    'creator config_signature',
    definition.creator.address,
    definition.creator.config_signature,
    creatorConfigHashTypedData(configHash, chainId),
    required.creator,
  );
  for (const [i, operator] of (definition.operators ?? []).entries()) {
    await check(
      `operators[${i}] config_signature`,
      operator.address,
      operator.config_signature,
      operatorConfigHashTypedData(configHash, chainId),
      required.operators,
    );
    await check(
      `operators[${i}] enr_signature`,
      operator.address,
      operator.enr_signature,
      enrTypedData(operator.enr ?? '', chainId),
      required.operators,
    );
  }
  return failures;
};

/**
 * Verifies a cluster definition before it is signed or used:
 *
 * 1. its `config_hash` equals `configHash` when given (case-insensitive);
 * 2. the config hash recomputed for its `version` equals `config_hash`;
 * 3. `fork_version` is the genesis fork version of `chainId`;
 * 4. every signature it carries (creator, operator config hash, operator
 *    ENR) is valid for its signer in the EIP-712 domain of `chainId`;
 *    contract-wallet signers are checked with EIP-1271 when a
 *    `publicClient` is given.
 *
 * All issues are reported, not only the first.
 *
 * @throws PAYLOAD_INVALID for a malformed input, UNSUPPORTED_CHAIN for an
 *   unknown `chainId`.
 */
export const verifyDefinition = async (
  input: unknown,
  options: VerifyOptions = {},
): Promise<DefinitionVerification> => {
  const { definition, configHash, chainId } = decode(
    VerifyDefinitionSchema,
    input,
  );
  const chain = getObolChain(chainId);
  const issues: DefinitionIssue[] = [];
  const stored = definition.config_hash.toLowerCase();

  if (configHash !== undefined && configHash.toLowerCase() !== stored) {
    issues.push({
      code: 'config_hash_mismatch',
      message: `config_hash ${definition.config_hash} is not the requested ${configHash}`,
    });
  }

  try {
    const computed = definitionHash(definition, true);
    if (computed !== stored) {
      issues.push({
        code: 'config_hash_mismatch',
        message: `config_hash ${definition.config_hash} does not match the definition (computed ${computed})`,
      });
    }
  } catch (error) {
    if (!isObolError(error)) throw error;
    issues.push(
      error.code === 'DEFINITION_INVALID'
        ? {
            code: 'version_unsupported',
            message: `version ${definition.version} is not supported`,
          }
        : { code: 'config_hash_mismatch', message: error.message },
    );
  }

  if (definition.fork_version.toLowerCase() !== chain.forkVersion) {
    issues.push({
      code: 'fork_version_mismatch',
      message: `fork_version ${definition.fork_version} is not ${chain.name} (${chain.forkVersion})`,
    });
  }

  const failures = await invalidDefinitionSignatures(
    definition,
    chainId,
    options,
    { creator: false, operators: false },
  );
  for (const name of failures) {
    issues.push({ code: 'signature_invalid', message: `invalid ${name}` });
  }

  return { ok: issues.length === 0, issues };
};
