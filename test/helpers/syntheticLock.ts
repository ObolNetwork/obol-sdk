// A valid v1.10.0 Charon-flow lock with real keys: shares, deposit and
// builder signatures, node signatures and signature_aggregate. `seal`
// recomputes lock_hash, node signatures and signature_aggregate after an
// edit, so only the edited check fails.
import { randomUUID } from 'node:crypto';
import { fromHexString } from '@chainsafe/ssz';
import { SignableENR } from '@chainsafe/enr';
import { bls12_381 } from '@noble/curves/bls12-381.js';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, numberToBytesBE } from '@noble/curves/utils.js';
import {
  builderDomainForFork,
  builderSigningRoot,
  clusterConfigOrDefinitionHash,
  clusterLockHash,
  depositDomainForFork,
  depositSigningRoot,
} from '../../src/internal/verification/common.js';

const DST = 'BLS_SIG_BLS12381G2_XMD:SHA-256_SSWU_RO_POP_';
const ls = bls12_381.longSignatures;
const { Fr, Fp } = bls12_381.fields;
const G1 = bls12_381.G1.Point;
export const FORK_HOODI = '0x10000910';

export const hex = (bytes: Uint8Array): string => '0x' + bytesToHex(bytes);
const address = (): string => hex(crypto.getRandomValues(new Uint8Array(20)));
export const randomScalar = (): bigint =>
  Fr.create(bytesToNumber(crypto.getRandomValues(new Uint8Array(48))));
const bytesToNumber = (bytes: Uint8Array): bigint =>
  BigInt('0x' + bytesToHex(bytes));

export const blsSign = (message: Uint8Array, secret: bigint): string =>
  hex(ls.Signature.toBytes(ls.hash(message, DST).multiply(secret)));

export interface SyntheticLock {
  lock: any;
  /** Recompute lock_hash, node signatures and signature_aggregate. */
  seal: (lock: any) => any;
}

/** Polynomial evaluation in Fr (coefficients low to high). */
const evaluate = (coefficients: bigint[], x: bigint): bigint =>
  coefficients.reduceRight((acc, c) => Fr.add(Fr.mul(acc, x), c), 0n);

export const syntheticLock = (
  validators: number,
  operators: number,
  threshold: number,
  amountsGwei: string[] = ['32000000000'],
): SyntheticLock => {
  const nodeKeys = Array.from({ length: operators }, () =>
    secp256k1.utils.randomSecretKey(),
  );
  const definition: any = {
    name: `synthetic-${validators}`,
    uuid: randomUUID().toUpperCase(),
    creator: { address: '', config_signature: '' },
    version: 'v1.10.0',
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
    deposit_amounts: amountsGwei,
    consensus_protocol: '',
    target_gas_limit: 60000000,
    compounding: false,
  };
  definition.config_hash = clusterConfigOrDefinitionHash(definition, true);
  definition.definition_hash = clusterConfigOrDefinitionHash(definition, false);

  const depositDomain = depositDomainForFork(FORK_HOODI);
  const builderDomain = builderDomainForFork(FORK_HOODI);
  // Σ of every share secret: signature_aggregate's key.
  let shareSecrets = 0n;
  const dvs = definition.validators.map((v: any) => {
    const coefficients = Array.from({ length: threshold }, randomScalar);
    const secret = coefficients[0];
    const shares = Array.from({ length: operators }, (_, j) =>
      evaluate(coefficients, BigInt(j + 1)),
    );
    for (const share of shares) shareSecrets = Fr.add(shareSecrets, share);
    const pubkey = hex(G1.BASE.multiply(secret).toBytes());
    const partial_deposit_data = amountsGwei.map(amount => {
      const deposit: any = {
        pubkey,
        withdrawal_credentials:
          '0x01' + '0'.repeat(22) + v.withdrawal_address.toLowerCase().slice(2),
        amount,
      };
      deposit.signature = blsSign(
        depositSigningRoot(deposit, depositDomain),
        secret,
      );
      return deposit;
    });
    const message = {
      fee_recipient: v.fee_recipient_address,
      gas_limit: 60000000,
      timestamp: 1700000000,
      pubkey,
    };
    return {
      distributed_public_key: pubkey,
      public_shares: shares.map(s => hex(G1.BASE.multiply(s).toBytes())),
      partial_deposit_data,
      builder_registration: {
        message,
        signature: blsSign(builderSigningRoot(message, builderDomain), secret),
      },
    };
  });

  const seal = (lock: any): any => {
    lock.lock_hash = clusterLockHash(lock);
    const digest = fromHexString(lock.lock_hash);
    lock.signature_aggregate = blsSign(digest, shareSecrets);
    // As Charon signs: 65 bytes, r || s || v (noble's 'recovered' is v || r || s).
    lock.node_signatures = nodeKeys.map(key => {
      const recovered = secp256k1.sign(digest, key, {
        prehash: false,
        format: 'recovered',
      }) as Uint8Array;
      return hex(new Uint8Array([...recovered.slice(1), recovered[0]]));
    });
    return lock;
  };
  return {
    lock: seal({
      cluster_definition: definition,
      distributed_validators: dvs,
    }),
    seal,
  };
};

/** A G1 point on the curve but outside the prime-order subgroup (compressed). */
export const g1OutsideSubgroup = (): string => {
  for (let x = 5n; ; x++) {
    let y: bigint;
    try {
      y = Fp.sqrt(Fp.add(Fp.mul(Fp.sqr(x), x), 4n));
    } catch {
      continue;
    }
    const point = G1.fromAffine({ x, y });
    if (point.isTorsionFree()) continue;
    // noble will not encode it, so encode by hand (ZCash compressed format).
    const bytes = numberToBytesBE(x, 48);
    bytes[0] |= 0x80 | (y > (Fp.ORDER - 1n) / 2n ? 0x20 : 0);
    return hex(bytes);
  }
};

/** The compressed G1 identity. */
export const G1_IDENTITY = '0xc0' + '00'.repeat(47);
