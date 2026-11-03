import { Type } from '@sinclair/typebox';
import type { PublicClient } from 'viem';
import { getObolChain } from '../chains.js';
import { isObolError } from '../errors.js';
import { decode, T } from '../schema.js';
import {
  assertSignatureClients,
  checkTypedDataSignature,
  creatorConfigHashTypedData,
  enrTypedData,
  operatorConfigHashTypedData,
  type SignatureClients,
} from './eip712.js';
import { definitionHash } from './hash.js';
import { DefinitionSchema, type ClusterDefinition } from './schema.js';

export interface DefinitionIssue {
  code:
    | 'config_hash_mismatch'
    | 'fork_version_mismatch'
    | 'version_unsupported'
    | 'signature_invalid'
    | 'signature_unverifiable';
  message: string;
}

export interface DefinitionVerification {
  ok: boolean;
  issues: DefinitionIssue[];
}

/**
 * Clients for contract-wallet (EIP-1271) definition signatures, such as a
 * Safe creator. The SDK has no RPCs of its own (2.x had built-in ones): pass
 * `publicClients` by chain id (a server that verifies several chains), or a
 * `publicClient` on the definition's chain. Without a client for that chain,
 * a signature that does not recover to its signer is reported as
 * unverifiable (`signature_unverifiable`, `definition_signature_unverifiable`)
 * rather than checked.
 */
export interface VerifyOptions extends SignatureClients {
  /** For signatures on its own chain only; one on another chain is ignored. */
  publicClient?: PublicClient;
}

export const VerifyDefinitionSchema = Type.Object({
  definition: DefinitionSchema,
  configHash: Type.Optional(T.Hash32),
  chainId: T.Uint,
});

const present = (value: string | undefined): value is string =>
  typeof value === 'string' && value !== '' && value !== '0x';

export interface SignatureFailure {
  /** The signer and signature, e.g. `operators[1] config_signature`. */
  name: string;
  /** `unverifiable`: not an ECDSA signature of the signer, and no client for the chain to ask a contract wallet. */
  reason: 'invalid' | 'unverifiable';
}

/**
 * Checks every signature present in a definition (creator config hash,
 * operator config hash and ENR), each over the definition's `config_hash`
 * in the chain-bound EIP-712 domain. Returns the failing signatures in file
 * order. Since every signature is over `config_hash`, these checks pass for
 * an edited definition whose `config_hash` was not recomputed: the hash
 * check (`config_hash_mismatch`, `hash_mismatch`) catches that one.
 */
export const invalidDefinitionSignatures = async (
  definition: ClusterDefinition,
  chainId: number,
  options: SignatureClients,
  required: { creator: boolean; operators: boolean },
): Promise<SignatureFailure[]> => {
  const failures: SignatureFailure[] = [];
  const check = async (
    name: string,
    address: string | undefined,
    signature: string | undefined,
    data: ReturnType<typeof enrTypedData>,
    isRequired: boolean,
  ): Promise<void> => {
    if (!present(signature)) {
      if (isRequired) failures.push({ name, reason: 'invalid' });
      return;
    }
    const result = present(address)
      ? await checkTypedDataSignature({
          address,
          signature,
          data,
          chainId,
          ...(options.publicClient !== undefined
            ? { publicClient: options.publicClient }
            : {}),
          ...(options.publicClients !== undefined
            ? { publicClients: options.publicClients }
            : {}),
        })
      : 'invalid';
    if (result !== 'valid') failures.push({ name, reason: result });
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
 *    contract-wallet signers (a Safe) are checked with EIP-1271, which needs
 *    a client for `chainId` (`publicClients`, or `publicClient` on that
 *    chain): without one, a signature that does not recover to its signer
 *    is `signature_unverifiable`.
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
  assertSignatureClients(options, 'options');
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
  for (const { name, reason } of failures) {
    issues.push(
      reason === 'invalid'
        ? { code: 'signature_invalid', message: `invalid ${name}` }
        : {
            code: 'signature_unverifiable',
            message: `${name} is not an ECDSA signature of its signer, and no public client for chain ${chainId} was given to check it as a contract wallet's (EIP-1271)`,
          },
    );
  }

  return { ok: issues.length === 0, issues };
};
