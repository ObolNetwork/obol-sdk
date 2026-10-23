// Versioned real-key lock generator for the differential fuzz harness.
//
// Built on the helpers of test/helpers/syntheticLock.ts (blsSign, hex,
// randomScalar, FORK_HOODI): same construction (random degree t-1 polynomial
// per validator, shares at x = 1..n, deposit + builder signatures by the
// group secret, node signatures by the ENR keys, signature_aggregate by the
// sum of all share secrets). Differences from syntheticLock, needed to run
// the same lock through Charon:
//   - any of v1.6.0, v1.7.0, v1.8.0, v1.10.0, v1.11.0 (the versions both the
//     SDK and Charon support);
//   - node signatures are 65-byte r || s || v, the format Charon writes and
//     requires (k1util.Verify65); syntheticLock writes 64-byte compact ones;
//   - the secrets are kept (`Secrets`), so a mutation can re-sign deposits,
//     builder registrations, node signatures and the aggregate after an edit,
//     and `reseal` recomputes config_hash and definition_hash as well.
import { randomUUID } from 'node:crypto';
import { fromHexString } from '@chainsafe/ssz';
import { SignableENR } from '@chainsafe/enr';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex } from '@noble/curves/utils.js';
import {
  builderDomainForFork,
  builderSigningRoot,
  clusterConfigOrDefinitionHash,
  clusterLockHash,
  depositDomainForFork,
  depositSigningRoot,
} from '../../src/internal/verification/common.js';
import {
  FORK_HOODI,
  blsSign,
  hex,
  randomScalar,
} from '../helpers/syntheticLock.js';

const { Fr } = bls12_381.fields;
const G1 = bls12_381.G1.Point;

export const VERSIONS = [
  'v1.6.0',
  'v1.7.0',
  'v1.8.0',
  'v1.10.0',
  'v1.11.0',
] as const;
export type Version = (typeof VERSIONS)[number];

export interface GenOptions {
  version: Version;
  validators: number;
  operators: number;
  threshold: number;
  /** Gwei strings; v1.8+ only (v1.6 / v1.7 always deposit 32 ETH). */
  amounts?: string[];
  /** v1.10+ only: 0x02 credentials. */
  compounding?: boolean;
}

/** Everything needed to re-sign a lock after an edit (scalars as hex). */
export interface Secrets {
  nodeKeys: string[];
  /** Public point (lowercase hex) -> discrete log (hex), for every share and group key generated. */
  dlog: Record<string, string>;
}

export interface Base {
  options: GenOptions;
  lock: any;
  secrets: Secrets;
}

const evaluate = (coefficients: bigint[], x: bigint): bigint =>
  coefficients.reduceRight((acc, c) => Fr.add(Fr.mul(acc, x), c), 0n);

const address = (): string => hex(crypto.getRandomValues(new Uint8Array(20)));

export const layoutOf = (version: string): 'v1.6' | 'v1.7' | 'v1.8+' =>
  version === 'v1.6.0' ? 'v1.6' : version === 'v1.7.0' ? 'v1.7' : 'v1.8+';

export const credentials = (withdrawal: string, compounding: boolean): string =>
  (compounding ? '0x02' : '0x01') +
  '0'.repeat(22) +
  withdrawal.toLowerCase().slice(2);

export const secretOf = (secrets: Secrets, point: string): bigint | null => {
  const s = secrets.dlog[point.toLowerCase()];
  return s === undefined ? null : BigInt(s);
};

/** The deposits of validator `i` (v1.6 / v1.7: the single `deposit_data`). */
export const depositsOf = (lock: any, i: number): any[] => {
  const v = lock.distributed_validators[i];
  if (layoutOf(lock.cluster_definition.version) === 'v1.8+') {
    return v.partial_deposit_data ?? [];
  }
  return v.deposit_data !== undefined ? [v.deposit_data] : [];
};

/** Re-signs deposit `deposit` with the secret of `pubkey` (unchanged if unknown). */
export const signDeposit = (
  lock: any,
  secrets: Secrets,
  deposit: any,
): void => {
  const secret = secretOf(secrets, deposit.pubkey);
  if (secret === null) return;
  deposit.signature = blsSign(
    depositSigningRoot(
      deposit,
      depositDomainForFork(lock.cluster_definition.fork_version),
    ),
    secret,
  );
};

export const signBuilder = (lock: any, secrets: Secrets, i: number): void => {
  const r = lock.distributed_validators[i].builder_registration;
  if (r === undefined) return;
  const secret = secretOf(secrets, r.message.pubkey);
  if (secret === null) return;
  r.signature = blsSign(
    builderSigningRoot(
      r.message,
      builderDomainForFork(lock.cluster_definition.fork_version),
    ),
    secret,
  );
};

/** 65-byte r || s || v node signature (Charon's format). */
export const nodeSign = (digest: Uint8Array, key: Uint8Array): string => {
  const sig = secp256k1.sign(digest, key, {
    prehash: false,
    lowS: true,
    format: 'recovered',
  } as any) as Uint8Array;
  // noble's 'recovered' format is v || r || s.
  const out = new Uint8Array(65);
  out.set(sig.subarray(1), 0);
  out[64] = sig[0];
  return hex(out);
};

export interface ResealOptions {
  /** Recompute config_hash / definition_hash (default true). */
  definition?: boolean;
  /** Re-sign node signatures (default true). */
  nodes?: boolean;
  /** Re-sign signature_aggregate (default true). */
  aggregate?: boolean;
}

/**
 * Recomputes the hashes of an edited lock and re-signs lock_hash: node
 * signatures by the generated ENR keys (operator order) and
 * signature_aggregate by the sum of the discrete logs of the public shares
 * now in the lock (shares with unknown discrete log are skipped, so the
 * aggregate is then invalid, as it should be). Deposits and builder
 * registrations are NOT re-signed: an edit of a signed field leaves them
 * invalid unless the mutation re-signs them on purpose.
 */
export const reseal = (
  lock: any,
  secrets: Secrets,
  options: ResealOptions = {},
): any => {
  const def = lock.cluster_definition;
  if (options.definition !== false) {
    try {
      def.config_hash = clusterConfigOrDefinitionHash(def, true);
      def.definition_hash = clusterConfigOrDefinitionHash(def, false);
    } catch {
      // A malformed edit the SDK hashing cannot encode: leave the hashes.
    }
  }
  try {
    lock.lock_hash = clusterLockHash(lock);
  } catch {
    return lock;
  }
  const digest = fromHexString(lock.lock_hash);
  if (options.aggregate !== false) {
    let sum = 0n;
    for (const v of lock.distributed_validators ?? []) {
      for (const share of v.public_shares ?? []) {
        const s = typeof share === 'string' ? secretOf(secrets, share) : null;
        if (s !== null) sum = Fr.add(sum, s);
      }
    }
    if (sum !== 0n) lock.signature_aggregate = blsSign(digest, sum);
  }
  if (options.nodes !== false && layoutOf(def.version) !== 'v1.6') {
    lock.node_signatures = secrets.nodeKeys.map(k =>
      nodeSign(digest, fromHexString(k)),
    );
  }
  return lock;
};

export const generate = (options: GenOptions): Base => {
  const { version, validators, operators, threshold } = options;
  const layout = layoutOf(version);
  const amounts =
    layout === 'v1.8+' ? (options.amounts ?? ['32000000000']) : ['32000000000'];
  const compounding =
    (version === 'v1.10.0' || version === 'v1.11.0') &&
    options.compounding === true;
  const nodeKeys = Array.from({ length: operators }, () =>
    secp256k1.utils.randomSecretKey(),
  );
  const secrets: Secrets = {
    nodeKeys: nodeKeys.map(k => '0x' + bytesToHex(k)),
    dlog: {},
  };
  const definition: any = {
    name: `fuzz-${version}-${validators}-${threshold}of${operators}`,
    uuid: randomUUID().toUpperCase(),
    creator: { address: '', config_signature: '' },
    version,
    num_validators: validators,
    threshold,
    dkg_algorithm: 'default',
    fork_version: FORK_HOODI,
    timestamp: '2026-10-19T00:00:00Z',
    operators: nodeKeys.map(key => ({
      address: '',
      enr: SignableENR.createV4(key).encodeTxt(),
      config_signature: '',
      enr_signature: '',
    })),
    validators: Array.from({ length: validators }, () => ({
      fee_recipient_address: address(),
      withdrawal_address: address(),
    })),
  };
  if (layout === 'v1.8+') definition.deposit_amounts = amounts;
  if (version === 'v1.10.0' || version === 'v1.11.0') {
    definition.consensus_protocol = '';
    definition.target_gas_limit = 60000000;
    definition.compounding = compounding;
  }

  const depositDomain = depositDomainForFork(FORK_HOODI);
  const builderDomain = builderDomainForFork(FORK_HOODI);
  const dvs = definition.validators.map((v: any) => {
    const coefficients = Array.from({ length: threshold }, randomScalar);
    const secret = coefficients[0];
    const pubkey = hex(G1.BASE.multiply(secret).toBytes());
    secrets.dlog[pubkey] = '0x' + secret.toString(16);
    const public_shares = Array.from({ length: operators }, (_, j) => {
      const s = evaluate(coefficients, BigInt(j + 1));
      const p = hex(G1.BASE.multiply(s).toBytes());
      secrets.dlog[p] = '0x' + s.toString(16);
      return p;
    });
    const deposits = amounts.map(amount => {
      const deposit: any = {
        pubkey,
        withdrawal_credentials: credentials(v.withdrawal_address, compounding),
        amount,
      };
      deposit.signature = blsSign(
        depositSigningRoot(deposit, depositDomain),
        secret,
      );
      return deposit;
    });
    const dv: any = { distributed_public_key: pubkey, public_shares };
    if (layout === 'v1.8+') dv.partial_deposit_data = deposits;
    else dv.deposit_data = deposits[0];
    if (layout !== 'v1.6') {
      const message = {
        fee_recipient: v.fee_recipient_address,
        gas_limit: 60000000,
        timestamp: 1700000000,
        pubkey,
      };
      dv.builder_registration = {
        message,
        signature: blsSign(builderSigningRoot(message, builderDomain), secret),
      };
    }
    return dv;
  });
  const lock: any = {
    cluster_definition: definition,
    distributed_validators: dvs,
    signature_aggregate: '',
    lock_hash: '',
  };
  if (layout !== 'v1.6') lock.node_signatures = [];
  reseal(lock, secrets);
  return { options, lock, secrets };
};

export const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
