/**
 * cluster.verifyLock: distributed-validator-specs "Verifying a Lock Before
 * Use", plus the Obol definition and deposit rules, as numbered steps; the
 * first failing step is reported.
 *
 * Everything runs on the calling thread and yields to the event loop every
 * `yieldMs`. The BLS work goes through a {@link BlsBackend} (pure JS by
 * default): every point is decoded once, share binding uses finite
 * differences, and signatures are checked in randomised batches.
 */
import { fromHexString } from '@chainsafe/ssz';
import { Type } from '@sinclair/typebox';
import type { PublicClient } from 'viem';
import type {
  ClusterDefinition as LegacyDefinition,
  ClusterLock as LegacyLock,
  DepositData,
  DistributedValidator,
} from '../internal/types.js';
import { DefinitionFlow, definitionFlow } from '../internal/definitionFlow.js';
import {
  builderDomainForFork,
  builderFieldsMatch,
  builderSigningRoot,
  clusterConfigOrDefinitionHashSliced,
  clusterLockHashSliced,
  depositDomainForFork,
  depositFieldsMatch,
  depositSigningRoot,
  verifyNodeSignatures,
} from '../internal/verification/common.js';
import { bindShares } from '../internal/verification/shareBinding.js';
import {
  firstInvalidSignature,
  type SignatureItem,
} from '../internal/verification/signatureBatch.js';
import { toUint64 } from '../internal/verification/sszTypes.js';
import { createTick, type Tick } from '../internal/yielder.js';
import { chainIdForForkVersion } from '../chains.js';
import { decode, invalid, T } from '../schema.js';
import { nobleBls, type BlsBackend } from './blsBackend.js';
import { isSupportedVersion } from './hash.js';
import { LockSchema, type ClusterLock } from './schema.js';
import { invalidDefinitionSignatures } from './verifyDefinition.js';

export type LockStep =
  | 'definition_flow_unknown'
  | 'definition_invalid'
  | 'definition_signature_invalid'
  | 'hash_mismatch'
  | 'share_layout_invalid'
  | 'share_reconstruction_failed'
  | 'deposit_data_invalid'
  | 'builder_registration_invalid'
  | 'lock_signature_invalid';

/**
 * - `full`: every step, every BLS check.
 * - `attested`: the checks that need no BLS work: definition flow and
 *   signatures, hashes, share layout, deposit and builder registration
 *   fields, node signatures; plus the BLS signatures of the deposits and
 *   builder registrations of the validators in `signatures`. Charon verifies
 *   every BLS signature during the DKG before each node signs `lock_hash`, so
 *   valid node signatures over a matching `lock_hash` attest to them.
 */
export type LockVerificationLevel = 'attested' | 'full';

export interface LockVerification {
  ok: boolean;
  /** The level that was run. */
  level: LockVerificationLevel;
  /** The first failing step. */
  step?: LockStep;
  /** Detail of the failure within the step. */
  issue?: string;
  /** Index of the failing validator, for a per-validator failure. */
  validator?: number;
}

export interface VerifyLockOptions {
  /** Needed to check contract-wallet (EIP-1271) definition signatures; must be on the lock's chain. */
  publicClient?: PublicClient;
  /** Default `full`. */
  level?: LockVerificationLevel;
  /**
   * Validators (indexes in the lock) whose deposit and builder registration
   * BLS signatures `attested` checks: `all`, `none` (default) or a list.
   * `full` checks all of them (only `all` is accepted with it).
   */
  signatures?: 'all' | 'none' | number[];
  /**
   * Longest stretch of work, in ms, between yields to the event loop
   * (default 50; 0 = never yield). A stretch can overrun it by one unit of
   * work (one signature, about 25 ms with the default backend).
   */
  yieldMs?: number;
  /** BLS backend (default {@link nobleBls}, pure JavaScript). */
  bls?: BlsBackend;
}

const DEFAULT_YIELD_MS = 50;

export const VerifyLockOptionsSchema = Type.Object({
  level: Type.Optional(
    Type.Union([Type.Literal('attested'), Type.Literal('full')]),
  ),
  signatures: Type.Optional(
    Type.Union([Type.Literal('all'), Type.Literal('none'), Type.Array(T.Uint)]),
  ),
  yieldMs: Type.Optional(T.Uint),
});

const BACKEND_METHODS = [
  'decodePublicKey',
  'aggregatePublicKeys',
  'onPolynomial',
  'verify',
  'createBatch',
] as const;

class StepFailed extends Error {
  constructor(
    readonly step: LockStep,
    readonly issue: string,
    readonly validator?: number,
  ) {
    super(`${step}: ${issue}`);
  }
}

const fail = (step: LockStep, issue: string, validator?: number): never => {
  throw new StepFailed(step, issue, validator);
};

/** Runs `fn`; any error other than a step failure fails `step` with `issue`. */
const guarded = async <R>(
  step: LockStep,
  issue: string,
  fn: () => R | Promise<R>,
): Promise<R> => {
  try {
    return await fn();
  } catch (error) {
    if (error instanceof StepFailed) throw error;
    return fail(step, issue);
  }
};

type Layout = 'v1.6' | 'v1.7' | 'v1.8+';
const layoutOf = (version: string): Layout =>
  version === 'v1.6.0' ? 'v1.6' : version === 'v1.7.0' ? 'v1.7' : 'v1.8+';

interface Run {
  lock: ClusterLock;
  layout: Layout;
  level: LockVerificationLevel;
  /** Validators whose deposit and builder signatures are checked, ascending. */
  selected: number[];
  bls: BlsBackend;
  tick: Tick;
  publicClient?: PublicClient;
  /** Step 5 (full): decoded group keys, and the sum of every public share. */
  groupKeys?: unknown[];
  sharesSum?: unknown;
}

const checkFlow = (lock: ClusterLock): DefinitionFlow => {
  const flow = definitionFlow(
    lock.cluster_definition as unknown as LegacyDefinition,
  );
  return flow ?? fail('definition_flow_unknown', 'definition_flow_unknown');
};

const GWEI_PER_ETH = 1_000_000_000n;
const MIN_DEPOSIT_GWEI = GWEI_PER_ETH;
const DEFAULT_DEPOSIT_GWEI = 32n * GWEI_PER_ETH;
const MAX_COMPOUNDING_DEPOSIT_GWEI = 2048n * GWEI_PER_ETH;

/** `compounding` is a definition field from v1.10.0 on (not read before). */
export const compoundingOf = (
  definition: ClusterLock['cluster_definition'],
): boolean =>
  definition.version !== 'v1.6.0' &&
  definition.version !== 'v1.7.0' &&
  definition.version !== 'v1.8.0' &&
  definition.compounding === true;

/**
 * The deposit amounts (gwei) a lock's deposits may have, as Charon's DKG
 * makes them: the definition's `deposit_amounts`, deduplicated; when empty,
 * Charon's defaults (1 and 32 ETH; with compounding 1, 8, 32 and 256 ETH),
 * none of them required;
 * 32 ETH only for v1.6.0 / v1.7.0 (no partial deposits).
 */
export const allowedDepositAmounts = (
  definition: ClusterLock['cluster_definition'],
  layout: Layout,
): { allowed: Set<string>; required: Set<string> } => {
  if (layout !== 'v1.8+') {
    const only = new Set([DEFAULT_DEPOSIT_GWEI.toString()]);
    return { allowed: only, required: only };
  }
  const given = (definition.deposit_amounts ?? []).map(a =>
    toUint64(a).toString(),
  );
  if (given.length > 0) {
    const set = new Set(given);
    return { allowed: set, required: set };
  }
  const defaults = compoundingOf(definition) ? [1n, 8n, 32n, 256n] : [1n, 32n];
  // Not required: locks made by earlier Charon releases with empty
  // `deposit_amounts` have the 32 ETH deposit only.
  return {
    allowed: new Set(defaults.map(e => (e * GWEI_PER_ETH).toString())),
    required: new Set(),
  };
};

/**
 * Step 2: what Charon refuses when it loads the definition: a fork version
 * of no known chain, `num_validators` other than the number of validators,
 * and `deposit_amounts` outside its rules (each at least 1 ETH and at most
 * 32 ETH, or 2048 ETH with compounding; together at least 32 ETH).
 */
const checkDefinition = (run: Run): void => {
  const definition = run.lock.cluster_definition;
  if (chainIdForForkVersion(definition.fork_version) === null) {
    fail('definition_invalid', 'fork_version_unknown');
  }
  if (definition.num_validators !== (definition.validators ?? []).length) {
    fail('definition_invalid', 'num_validators_mismatch');
  }
  if (run.layout === 'v1.8+') {
    const amounts = (definition.deposit_amounts ?? []).map(a => {
      try {
        return toUint64(a);
      } catch {
        return fail('definition_invalid', 'deposit_amounts_invalid');
      }
    });
    if (amounts.length > 0) {
      const max = compoundingOf(definition)
        ? MAX_COMPOUNDING_DEPOSIT_GWEI
        : DEFAULT_DEPOSIT_GWEI;
      const sum = amounts.reduce((a, b) => a + b, 0n);
      if (
        amounts.some(a => a < MIN_DEPOSIT_GWEI || a > max) ||
        sum < DEFAULT_DEPOSIT_GWEI
      ) {
        fail('definition_invalid', 'deposit_amounts_invalid');
      }
    }
  }
};

const checkDefinitionSignatures = async (
  run: Run,
  flow: DefinitionFlow,
): Promise<void> => {
  if (flow === DefinitionFlow.Charon) return;
  const definition = run.lock.cluster_definition;
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
  const failures = await invalidDefinitionSignatures(
    signed,
    chainId,
    run.publicClient !== undefined ? { publicClient: run.publicClient } : {},
    { creator: true, operators: true },
  );
  if (failures.length > 0) {
    fail('definition_signature_invalid', failures[0]);
  }
};

const checkHashes = async (run: Run): Promise<void> => {
  const { lock } = run;
  const definition = lock.cluster_definition;
  if (!isSupportedVersion(definition.version)) {
    fail('hash_mismatch', 'version_unsupported');
  }
  const same = (a: string, b: string | undefined): boolean =>
    a.toLowerCase() === (b ?? '').toLowerCase();
  const computed = async (
    what: string,
    fn: () => string | Promise<string>,
  ): Promise<string> => {
    try {
      return await fn();
    } catch {
      return fail('hash_mismatch', what);
    }
  };
  const configHash = await computed(
    'config_hash',
    async () =>
      await clusterConfigOrDefinitionHashSliced(
        definition as unknown as LegacyDefinition,
        true,
        run.tick,
      ),
  );
  if (!same(configHash, definition.config_hash)) {
    fail('hash_mismatch', 'config_hash');
  }
  const definitionRoot = await computed(
    'definition_hash',
    async () =>
      await clusterConfigOrDefinitionHashSliced(
        definition as unknown as LegacyDefinition,
        false,
        run.tick,
      ),
  );
  if (!same(definitionRoot, definition.definition_hash)) {
    fail('hash_mismatch', 'definition_hash');
  }
  // The lock hashes the definition by its root, checked just above.
  const lockRoot = await computed(
    'lock_hash',
    async () =>
      await clusterLockHashSliced(
        lock as unknown as LegacyLock,
        fromHexString(definitionRoot),
        run.tick,
      ),
  );
  if (!same(lockRoot, lock.lock_hash)) fail('hash_mismatch', 'lock_hash');
};

const checkShareLayout = async (run: Run): Promise<void> => {
  const { lock } = run;
  const operators = (lock.cluster_definition.operators ?? []).length;
  const validators = lock.distributed_validators;
  if (validators.length === 0) fail('share_layout_invalid', 'no_validators');
  if (validators.length !== (lock.cluster_definition.validators ?? []).length) {
    fail('share_layout_invalid', 'validator_count');
  }
  const keys = new Set<string>();
  for (const [i, validator] of validators.entries()) {
    const key = validator.distributed_public_key.toLowerCase();
    if (keys.has(key)) fail('share_layout_invalid', 'duplicate_group_key', i);
    keys.add(key);
    if (validator.public_shares.length !== operators) {
      fail('share_layout_invalid', 'share_count', i);
    }
    const shares = new Set(validator.public_shares.map(s => s.toLowerCase()));
    if (shares.size !== validator.public_shares.length) {
      fail('share_layout_invalid', 'duplicate_share', i);
    }
    await run.tick();
  }
};

/** Step 5 for every validator (see `bindShares`). */
const checkShareReconstruction = async (run: Run): Promise<void> => {
  const { bls, lock } = run;
  const threshold = lock.cluster_definition.threshold;
  const groupKeys: unknown[] = [];
  let sharesSum: unknown;
  for (const [i, validator] of lock.distributed_validators.entries()) {
    const binding = await guarded(
      'share_reconstruction_failed',
      'malformed_share',
      () =>
        bindShares(
          bls,
          fromHexString(validator.distributed_public_key),
          validator.public_shares.map(s => fromHexString(s)),
          threshold,
        ),
    );
    if (!binding.ok) fail('share_reconstruction_failed', binding.issue, i);
    else {
      groupKeys.push(binding.groupKey);
      sharesSum = bls.aggregatePublicKeys(
        sharesSum === undefined
          ? binding.shares
          : [sharesSum, ...binding.shares],
      );
    }
    await run.tick();
  }
  run.groupKeys = groupKeys;
  run.sharesSum = sharesSum;
};

/** A selected validator's group key: decoded in step 5, or now. */
const groupKey = (run: Run, i: number): unknown => {
  if (run.groupKeys !== undefined) return run.groupKeys[i];
  try {
    return run.bls.decodePublicKey(
      fromHexString(run.lock.distributed_validators[i].distributed_public_key),
      true,
    );
  } catch {
    return null;
  }
};

const checkSignatures = async (
  run: Run,
  step: LockStep,
  items: Array<SignatureItem<unknown> & { validator: number }>,
): Promise<void> => {
  const first = await guarded(
    step,
    'signature_invalid',
    async () => await firstInvalidSignature(run.bls, items, run.tick),
  );
  if (first !== -1) fail(step, 'signature_invalid', items[first].validator);
};

const depositsOf = (
  run: Run,
  i: number,
): Array<Partial<DepositData>> | undefined => {
  const validator = run.lock.distributed_validators[i];
  const deposits =
    run.layout === 'v1.8+'
      ? validator.partial_deposit_data
      : validator.deposit_data !== undefined
        ? [validator.deposit_data]
        : undefined;
  return deposits === null || deposits === undefined
    ? undefined
    : (deposits as Array<Partial<DepositData>>);
};

const checkDeposits = async (run: Run): Promise<void> => {
  const step = 'deposit_data_invalid';
  const { lock, layout } = run;
  const definition = lock.cluster_definition;
  const compounding = compoundingOf(definition);
  await guarded(step, 'malformed', async () => {
    const { allowed, required } = allowedDepositAmounts(definition, layout);
    for (const [i, validator] of lock.distributed_validators.entries()) {
      const deposits = depositsOf(run, i);
      if (deposits === undefined || deposits.length === 0) {
        fail(step, 'deposit_data_missing', i);
      }
      const withdrawal = (definition.validators ?? [])[i].withdrawal_address;
      const present = new Set(
        (deposits ?? []).map(d => toUint64(d.amount ?? '').toString()),
      );
      if (![...required].every(a => present.has(a))) {
        fail(step, 'deposit_amount_missing', i);
      }
      if (![...present].every(a => allowed.has(a))) {
        fail(step, 'deposit_amount_unexpected', i);
      }
      for (const deposit of deposits ?? []) {
        const matches = depositFieldsMatch(
          validator.distributed_public_key,
          deposit,
          withdrawal,
          compounding,
        );
        if (!matches) fail(step, 'deposit_fields', i);
      }
      await run.tick();
    }
  });
  const items = await guarded(step, 'malformed', async () => {
    const domain = depositDomainForFork(definition.fork_version);
    const result: Array<SignatureItem<unknown> & { validator: number }> = [];
    for (const i of run.selected) {
      const publicKey = groupKey(run, i);
      for (const deposit of depositsOf(run, i) ?? []) {
        result.push({
          validator: i,
          publicKey,
          message: depositSigningRoot(deposit, domain),
          signature: fromHexString(deposit.signature ?? ''),
        });
      }
      await run.tick();
    }
    return result;
  });
  await checkSignatures(run, step, items);
};

const checkBuilderRegistrations = async (run: Run): Promise<void> => {
  const step = 'builder_registration_invalid';
  const definition = run.lock.cluster_definition;
  const validators = run.lock.distributed_validators;
  await guarded(step, 'malformed', async () => {
    for (const [i, validator] of validators.entries()) {
      const matches = builderFieldsMatch(
        validator as unknown as DistributedValidator,
        (definition.validators ?? [])[i].fee_recipient_address,
      );
      if (!matches) fail(step, 'builder_registration_fields', i);
      await run.tick();
    }
  });
  const items = await guarded(step, 'malformed', async () => {
    const domain = builderDomainForFork(definition.fork_version);
    const result: Array<SignatureItem<unknown> & { validator: number }> = [];
    for (const i of run.selected) {
      // Present: checked by builderFieldsMatch above.
      const registration = validators[i].builder_registration as NonNullable<
        ClusterLock['distributed_validators'][number]['builder_registration']
      >;
      result.push({
        validator: i,
        publicKey: groupKey(run, i),
        message: builderSigningRoot(registration.message, domain),
        signature: fromHexString(registration.signature),
      });
      await run.tick();
    }
    return result;
  });
  await checkSignatures(run, step, items);
};

const checkLockSignatures = async (run: Run): Promise<void> => {
  const step = 'lock_signature_invalid';
  const { lock } = run;
  if (run.layout !== 'v1.6') {
    const nodeOk = await guarded(
      step,
      'node_signature_invalid',
      async () =>
        await verifyNodeSignatures(lock as unknown as LegacyLock, run.tick),
    );
    if (!nodeOk) fail(step, 'node_signature_invalid');
  }
  if (run.level !== 'full') return;
  const aggregateOk = await guarded(step, 'signature_aggregate_invalid', () =>
    run.bls.verify(
      run.sharesSum,
      fromHexString(lock.lock_hash),
      fromHexString(lock.signature_aggregate),
    ),
  );
  if (!aggregateOk) fail(step, 'signature_aggregate_invalid');
};

const runSteps = async (run: Run): Promise<LockVerification> => {
  const { level } = run;
  try {
    const flow = checkFlow(run.lock);
    checkDefinition(run);
    await checkDefinitionSignatures(run, flow);
    await checkHashes(run);
    await checkShareLayout(run);
    if (level === 'full') await checkShareReconstruction(run);
    await checkDeposits(run);
    if (run.layout !== 'v1.6') await checkBuilderRegistrations(run);
    await checkLockSignatures(run);
    return { ok: true, level };
  } catch (error) {
    if (error instanceof StepFailed) {
      return {
        ok: false,
        level,
        step: error.step,
        issue: error.issue,
        ...(error.validator !== undefined
          ? { validator: error.validator }
          : {}),
      };
    }
    throw error;
  }
};

const selectedValidators = (
  signatures: 'all' | 'none' | number[],
  count: number,
): number[] => {
  if (signatures === 'all') return [...Array(count).keys()];
  if (signatures === 'none') return [];
  signatures.forEach((index, i) => {
    if (index >= count) {
      throw invalid(
        `options.signatures[${i}]`,
        `is not a validator index of the lock (${count} validators)`,
      );
    }
  });
  return [...new Set(signatures)].sort((a, b) => a - b);
};

/**
 * Verifies a cluster lock before use. Steps, in order (the first failure is
 * reported as `step`, with `validator` for a per-validator one):
 *
 * 1. the definition flow is group, solo or Charon (`definition_flow_unknown`);
 * 2. the definition signatures the flow needs are valid
 *    (`definition_signature_invalid`; contract wallets via EIP-1271 with
 *    `publicClient`);
 * 3. recomputed config, definition and lock hashes equal the stored ones
 *    (`hash_mismatch`);
 * 4. one public share per operator, unique group keys, no repeated share
 *    (`share_layout_invalid`);
 * 5. `full`: the shares and group key of each validator lie on one
 *    polynomial of degree below the threshold, every share checked
 *    (`share_reconstruction_failed`);
 * 6. deposit data: amounts, group pubkey, `0x01` / `0x02` credentials to the
 *    withdrawal address; BLS signatures for the checked validators
 *    (`deposit_data_invalid`);
 * 7. builder registrations: group pubkey, fee recipient; BLS signatures for
 *    the checked validators (`builder_registration_invalid`; from v1.7.0);
 * 8. node signatures by each operator's ENR key over `lock_hash` (from
 *    v1.7.0) and, `full`, `signature_aggregate` over `lock_hash` against all
 *    public shares (`lock_signature_invalid`).
 *
 * `level: 'attested'` skips the BLS work of steps 5 and 8 and checks the
 * step 6 / 7 signatures of the validators in `signatures` only (a 10k
 * validator lock: a few seconds, plus about 25 ms per checked signature with
 * the default backend). `full` (default) checks everything.
 *
 * @throws PAYLOAD_INVALID for a malformed lock or options.
 */
export const verifyLock = async (
  input: unknown,
  options: VerifyLockOptions = {},
): Promise<LockVerification> => {
  const lock = decode(LockSchema, input, 'lock');
  const scalars = decode(
    VerifyLockOptionsSchema,
    {
      ...(options.level !== undefined ? { level: options.level } : {}),
      ...(options.signatures !== undefined
        ? { signatures: options.signatures }
        : {}),
      ...(options.yieldMs !== undefined ? { yieldMs: options.yieldMs } : {}),
    },
    'options',
  );
  const level = scalars.level ?? 'full';
  const signatures = scalars.signatures ?? (level === 'full' ? 'all' : 'none');
  if (level === 'full' && signatures !== 'all') {
    throw invalid(
      'options.signatures',
      "level 'full' checks every signature; pass level 'attested' to choose validators",
    );
  }
  const bls = options.bls ?? nobleBls;
  for (const method of BACKEND_METHODS) {
    if (typeof bls[method] !== 'function') {
      throw invalid(`options.bls.${method}`, 'must be a function');
    }
  }
  return await runSteps({
    lock,
    layout: layoutOf(lock.cluster_definition.version),
    level,
    selected: selectedValidators(
      signatures as 'all' | 'none' | number[],
      lock.distributed_validators.length,
    ),
    bls,
    tick: createTick(scalars.yieldMs ?? DEFAULT_YIELD_MS),
    ...(options.publicClient !== undefined
      ? { publicClient: options.publicClient }
      : {}),
  });
};
