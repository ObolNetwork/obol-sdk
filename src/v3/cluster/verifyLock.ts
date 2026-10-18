/**
 * cluster.verifyLock: distributed-validator-specs "Verifying a Lock Before
 * Use", plus the Obol definition and deposit rules, as numbered steps; the
 * first failing step is reported.
 *
 * The BLS work runs through the 2.x parallel helpers, which use worker
 * threads for large locks in the CommonJS Node build and run inline
 * elsewhere.
 */
import { fromHexString } from '@chainsafe/ssz';
import { type PublicClient } from 'viem';
import type {
  BlsSignatureCheck,
  ClusterDefinition as LegacyDefinition,
  ClusterLock as LegacyLock,
  DepositData,
  DistributedValidator,
} from '../../types.js';
import { DefinitionFlow } from '../../constants.js';
import { definitionFlow } from '../../utils.js';
import {
  builderBlsCheck,
  builderDomainForFork,
  depositBlsCheck,
  depositDomainForFork,
  verifyNodeSignatures,
} from '../../verification/common.js';
import {
  verifyAggregateParallel,
  verifyBlsChecksParallel,
  verifySharesBinding,
} from '../../verification/parallelPool.js';
import { toUint64 } from '../../verification/sszTypes.js';
import { withLockValidationConcurrency } from '../../verification/validationConcurrency.js';
import {
  ClusterLockValidationBusyError,
  ClusterLockValidationTimeoutError,
} from '../../errors.js';
import { chainIdForForkVersion } from '../chains.js';
import { ObolError } from '../errors.js';
import { decode } from '../schema.js';
import { definitionHash, isSupportedVersion, lockHash } from './hash.js';
import { LockSchema, type ClusterLock } from './schema.js';
import { invalidDefinitionSignatures } from './verifyDefinition.js';

export type LockStep =
  | 'definition_flow_unknown'
  | 'definition_signature_invalid'
  | 'hash_mismatch'
  | 'share_layout_invalid'
  | 'share_reconstruction_failed'
  | 'deposit_data_invalid'
  | 'builder_registration_invalid'
  | 'lock_signature_invalid';

export interface LockVerification {
  ok: boolean;
  /** The first failing step. */
  step?: LockStep;
  /** Detail of the failure within the step. */
  issue?: string;
}

export interface VerifyLockOptions {
  /** Needed to check contract-wallet (EIP-1271) definition signatures; must be on the lock's chain. */
  publicClient?: PublicClient;
}

class StepFailed extends Error {
  constructor(
    readonly step: LockStep,
    readonly issue: string,
  ) {
    super(`${step}: ${issue}`);
  }
}

const fail = (step: LockStep, issue: string): never => {
  throw new StepFailed(step, issue);
};

/** Runs `fn`; any error other than a worker timeout fails `step`. */
const guarded = async <R>(
  step: LockStep,
  issue: string,
  fn: () => R | Promise<R>,
): Promise<R> => {
  try {
    return await fn();
  } catch (error) {
    if (
      error instanceof StepFailed ||
      error instanceof ClusterLockValidationTimeoutError
    ) {
      throw error;
    }
    return fail(step, issue);
  }
};

type Layout = 'v1.6' | 'v1.7' | 'v1.8+';
const layoutOf = (version: string): Layout =>
  version === 'v1.6.0' ? 'v1.6' : version === 'v1.7.0' ? 'v1.7' : 'v1.8+';

const checkFlow = (lock: ClusterLock): DefinitionFlow => {
  const flow = definitionFlow(
    lock.cluster_definition as unknown as LegacyDefinition,
  );
  return flow ?? fail('definition_flow_unknown', 'definition_flow_unknown');
};

const checkDefinitionSignatures = async (
  lock: ClusterLock,
  flow: DefinitionFlow,
  options: VerifyLockOptions,
): Promise<void> => {
  if (flow === DefinitionFlow.Charon) return;
  const definition = lock.cluster_definition;
  const chainId = chainIdForForkVersion(definition.fork_version);
  if (chainId === null) {
    fail('definition_signature_invalid', 'fork_version_unknown');
    return;
  }
  // Solo definitions are signed by the creator only.
  const signed =
    flow === DefinitionFlow.Solo
      ? { ...definition, operators: [] }
      : definition;
  const failures = await invalidDefinitionSignatures(signed, chainId, options, {
    creator: true,
    operators: true,
  });
  if (failures.length > 0) {
    fail('definition_signature_invalid', failures[0]);
  }
};

const checkHashes = (lock: ClusterLock): void => {
  const definition = lock.cluster_definition;
  if (!isSupportedVersion(definition.version)) {
    fail('hash_mismatch', 'version_unsupported');
  }
  const same = (a: string, b: string | undefined): boolean =>
    a === (b ?? '').toLowerCase();
  const computed = (what: string, fn: () => string): string => {
    try {
      return fn();
    } catch {
      return fail('hash_mismatch', what);
    }
  };
  if (
    !same(
      computed('config_hash', () => definitionHash(definition, true)),
      definition.config_hash,
    )
  ) {
    fail('hash_mismatch', 'config_hash');
  }
  if (
    !same(
      computed('definition_hash', () => definitionHash(definition, false)),
      definition.definition_hash,
    )
  ) {
    fail('hash_mismatch', 'definition_hash');
  }
  if (
    !same(
      computed('lock_hash', () => lockHash(lock)),
      lock.lock_hash,
    )
  ) {
    fail('hash_mismatch', 'lock_hash');
  }
};

const checkShareLayout = (lock: ClusterLock): void => {
  const operators = (lock.cluster_definition.operators ?? []).length;
  const validators = lock.distributed_validators;
  if (validators.length === 0) fail('share_layout_invalid', 'no_validators');
  if (validators.length !== (lock.cluster_definition.validators ?? []).length) {
    fail('share_layout_invalid', 'validator_count');
  }
  const keys = new Set(
    validators.map(v => v.distributed_public_key.toLowerCase()),
  );
  if (keys.size !== validators.length) {
    fail('share_layout_invalid', 'duplicate_group_key');
  }
  for (const validator of validators) {
    if (validator.public_shares.length !== operators) {
      fail('share_layout_invalid', 'share_count');
    }
    const shares = new Set(validator.public_shares.map(s => s.toLowerCase()));
    if (shares.size !== validator.public_shares.length) {
      fail('share_layout_invalid', 'duplicate_share');
    }
  }
};

const checkShareReconstruction = async (lock: ClusterLock): Promise<void> => {
  const ok = await guarded(
    'share_reconstruction_failed',
    'malformed_share',
    async () =>
      await verifySharesBinding(
        lock.distributed_validators.map(v => v.public_shares),
        lock.distributed_validators.map(v => v.distributed_public_key),
        lock.cluster_definition.threshold,
      ),
  );
  if (!ok) fail('share_reconstruction_failed', 'share_reconstruction_failed');
};

const checkDeposits = async (
  lock: ClusterLock,
  layout: Layout,
): Promise<void> => {
  const definition = lock.cluster_definition;
  const forkVersion = definition.fork_version;
  const checks = await guarded('deposit_data_invalid', 'malformed', () => {
    const domain = depositDomainForFork(forkVersion);
    const amounts = [
      ...new Set(
        (definition.deposit_amounts ?? []).map(a => toUint64(a).toString()),
      ),
    ];
    const result: BlsSignatureCheck[] = [];
    lock.distributed_validators.forEach((validator, i) => {
      const withdrawal = (definition.validators ?? [])[i].withdrawal_address;
      const deposits =
        layout === 'v1.8+'
          ? validator.partial_deposit_data
          : validator.deposit_data !== undefined
            ? [validator.deposit_data]
            : undefined;
      if (deposits === undefined || deposits === null) {
        fail('deposit_data_invalid', 'deposit_data_missing');
        return;
      }
      if (layout === 'v1.8+') {
        const present = new Set(
          deposits.map(d => toUint64(d.amount ?? '').toString()),
        );
        if (!amounts.every(a => present.has(a))) {
          fail('deposit_data_invalid', 'deposit_amount_missing');
        }
      }
      for (const deposit of deposits) {
        const check = depositBlsCheck(
          validator.distributed_public_key,
          deposit as Partial<DepositData>,
          withdrawal,
          forkVersion,
          layout === 'v1.8+' ? definition.compounding : undefined,
          domain,
        );
        if (check === null) fail('deposit_data_invalid', 'deposit_fields');
        else result.push(check);
      }
    });
    return result;
  });
  const ok = await guarded(
    'deposit_data_invalid',
    'signature_invalid',
    async () => await verifyBlsChecksParallel(checks),
  );
  if (!ok) fail('deposit_data_invalid', 'signature_invalid');
};

const checkBuilderRegistrations = async (lock: ClusterLock): Promise<void> => {
  const definition = lock.cluster_definition;
  const checks = await guarded(
    'builder_registration_invalid',
    'malformed',
    () => {
      const domain = builderDomainForFork(definition.fork_version);
      return lock.distributed_validators.map((validator, i) => {
        const check = builderBlsCheck(
          validator as unknown as DistributedValidator,
          (definition.validators ?? [])[i].fee_recipient_address,
          definition.fork_version,
          domain,
        );
        return (
          check ??
          fail('builder_registration_invalid', 'builder_registration_fields')
        );
      });
    },
  );
  const ok = await guarded(
    'builder_registration_invalid',
    'signature_invalid',
    async () => await verifyBlsChecksParallel(checks),
  );
  if (!ok) fail('builder_registration_invalid', 'signature_invalid');
};

const checkLockSignatures = async (
  lock: ClusterLock,
  layout: Layout,
): Promise<void> => {
  if (layout !== 'v1.6') {
    const nodeOk = await guarded(
      'lock_signature_invalid',
      'node_signature_invalid',
      () => verifyNodeSignatures(lock as unknown as LegacyLock),
    );
    if (!nodeOk) fail('lock_signature_invalid', 'node_signature_invalid');
  }
  const aggregateOk = await guarded(
    'lock_signature_invalid',
    'signature_aggregate_invalid',
    async () =>
      await verifyAggregateParallel(
        lock.distributed_validators.flatMap(v =>
          v.public_shares.map(s => fromHexString(s)),
        ),
        fromHexString(lock.lock_hash),
        fromHexString(lock.signature_aggregate),
      ),
  );
  if (!aggregateOk) {
    fail('lock_signature_invalid', 'signature_aggregate_invalid');
  }
};

const runSteps = async (
  lock: ClusterLock,
  options: VerifyLockOptions,
): Promise<LockVerification> => {
  try {
    const layout = layoutOf(lock.cluster_definition.version);
    const flow = checkFlow(lock);
    await checkDefinitionSignatures(lock, flow, options);
    checkHashes(lock);
    checkShareLayout(lock);
    await checkShareReconstruction(lock);
    await checkDeposits(lock, layout);
    if (layout !== 'v1.6') await checkBuilderRegistrations(lock);
    await checkLockSignatures(lock, layout);
    return { ok: true };
  } catch (error) {
    if (error instanceof StepFailed) {
      return { ok: false, step: error.step, issue: error.issue };
    }
    throw error;
  }
};

/**
 * Verifies a cluster lock before use. Steps, in order (the first failure is
 * reported as `step`):
 *
 * 1. the definition flow is group, solo or Charon (`definition_flow_unknown`);
 * 2. the definition signatures the flow needs are valid
 *    (`definition_signature_invalid`; contract wallets via EIP-1271 with
 *    `publicClient`);
 * 3. recomputed config, definition and lock hashes equal the stored ones
 *    (`hash_mismatch`);
 * 4. one public share per operator, unique group keys, no repeated share
 *    (`share_layout_invalid`);
 * 5. the shares reconstruct each group key, every share checked
 *    (`share_reconstruction_failed`);
 * 6. deposit data: amounts, group pubkey, `0x01` / `0x02` credentials to the
 *    withdrawal address, BLS signatures (`deposit_data_invalid`);
 * 7. builder registrations: group pubkey, fee recipient, BLS signatures
 *    (`builder_registration_invalid`; from v1.7.0);
 * 8. node signatures by each operator's ENR key over `lock_hash` (from
 *    v1.7.0) and `signature_aggregate` over `lock_hash` against all public
 *    shares (`lock_signature_invalid`).
 *
 * @throws PAYLOAD_INVALID for a malformed lock; LOCK_VERIFICATION_TIMEOUT
 *   when a verification worker exceeds its time limit (not a verdict);
 *   LOCK_VERIFICATION_BUSY when too many verifications run at once
 *   (`OBOL_SDK_MAX_CONCURRENT_LOCK_VALIDATIONS`, default 2, `0` = no limit).
 */
export const verifyLock = async (
  input: unknown,
  options: VerifyLockOptions = {},
): Promise<LockVerification> => {
  const lock = decode(LockSchema, input, 'lock');
  try {
    return await withLockValidationConcurrency(
      async () => await runSteps(lock, options),
    );
  } catch (error) {
    if (error instanceof ClusterLockValidationTimeoutError) {
      throw new ObolError(
        'LOCK_VERIFICATION_TIMEOUT',
        `Lock verification exceeded its time limit (${error.timeoutMs} ms)`,
        {
          hint: 'Retry later; this is not a verdict on the lock',
          cause: error,
          details: { timeoutMs: error.timeoutMs },
        },
      );
    }
    if (error instanceof ClusterLockValidationBusyError) {
      throw new ObolError(
        'LOCK_VERIFICATION_BUSY',
        `Too many lock verifications in progress (limit ${error.maxConcurrent})`,
        {
          hint: 'Retry with backoff',
          cause: error,
          details: { maxConcurrent: error.maxConcurrent },
        },
      );
    }
    throw error;
  }
};
