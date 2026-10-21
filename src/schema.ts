/**
 * Input schemas (TypeBox) and decoding. Every operation decodes its input
 * with `decode` first (spec check G1); failures throw PAYLOAD_INVALID with
 * one issue per failing path.
 */
import {
  FormatRegistry,
  Type,
  type Static,
  type TSchema,
  type TString,
} from '@sinclair/typebox';
import { Value } from '@sinclair/typebox/value';
import { getAddress, type Address } from 'viem';
import { payloadInvalid, type Issue, type ObolError } from './errors.js';

/**
 * Address input rule (spec/README.md "Encodings"): all-lowercase,
 * all-uppercase or a valid EIP-55 checksum. Mixed case with a wrong checksum
 * is rejected, since it usually means a typo.
 */
export const isAddressInput = (value: string): boolean => {
  if (!/^0x[0-9a-fA-F]{40}$/.test(value)) return false;
  const body = value.slice(2);
  if (body === body.toLowerCase() || body === body.toUpperCase()) return true;
  try {
    return getAddress(value) === value;
  } catch {
    return false;
  }
};

FormatRegistry.Set('obol-address', isAddressInput);

export const ZERO_ADDRESS: Address =
  '0x0000000000000000000000000000000000000000';

const hexBytes = (bytes: number, description: string): TString =>
  Type.String({
    pattern: `^0x[0-9a-fA-F]{${bytes * 2}}$`,
    description,
  });

export const T = {
  Address: Type.String({
    format: 'obol-address',
    description:
      'Address: all-lowercase, all-uppercase or valid EIP-55 checksum',
  }),
  Hash32: hexBytes(32, '32-byte hex'),
  Pubkey: hexBytes(48, 'BLS public key (48 bytes)'),
  BlsSignature: hexBytes(96, 'BLS signature (96 bytes)'),
  Credentials: hexBytes(32, 'withdrawal credentials (32 bytes)'),
  Hex: Type.String({ pattern: '^0x([0-9a-fA-F]{2})*$', description: 'hex' }),
  /** wei, non-negative */
  Wei: Type.BigInt({ minimum: 0n, description: 'wei' }),
  Uint: Type.Integer({ minimum: 0 }),
  /** A non-negative integer as a bigint or a safe integer number (converted with BigInt). */
  UintLike: Type.Union([
    Type.BigInt({ minimum: 0n }),
    Type.Integer({ minimum: 0, maximum: Number.MAX_SAFE_INTEGER }),
  ]),
};

const messageFor = (error: { message: string; schema: TSchema }): string => {
  if (error.schema.format === 'obol-address') {
    return 'must be a hex address (all-lowercase, all-uppercase or a valid EIP-55 checksum)';
  }
  if (typeof error.schema.description === 'string' && error.schema.pattern) {
    return `must be ${error.schema.description}`;
  }
  return error.message;
};

const toPath = (pointer: string, base: string): string => {
  const parts = pointer
    .split('/')
    .filter(p => p !== '')
    .map(p => (/^\d+$/.test(p) ? `[${p}]` : `.${p}`))
    .join('');
  const joined = `${base}${parts}`;
  return joined.startsWith('.') ? joined.slice(1) : joined;
};

/** Validates `value` against `schema`; throws PAYLOAD_INVALID otherwise. */
export const decode = <S extends TSchema>(
  schema: S,
  value: unknown,
  basePath = '',
): Static<S> => {
  if (Value.Check(schema, value)) return value;
  const issues: Issue[] = [];
  const seen = new Set<string>();
  for (const error of Value.Errors(schema, value)) {
    const path = toPath(error.path, basePath);
    if (seen.has(path)) continue;
    seen.add(path);
    issues.push({ path, message: messageFor(error) });
  }
  throw payloadInvalid(issues);
};

/** Checksummed form of an address that passed `T.Address`. */
export const checksum = (address: string): Address =>
  getAddress(address.toLowerCase());

export const sameAddress = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/** Hex strings (hashes, pubkeys, signatures) compared case-insensitively. */
export const sameHex = (a: string, b: string): boolean =>
  a.toLowerCase() === b.toLowerCase();

/** One-issue PAYLOAD_INVALID, for checks a schema cannot express. */
export const invalid = (
  path: string,
  message: string,
  issue?: string,
): ObolError =>
  payloadInvalid([{ path, message, ...(issue ? { issue } : {}) }]);

/** `value` without trailing `/` characters (a linear scan, no regex). */
export const trimTrailingSlashes = (value: string): string => {
  let end = value.length;
  while (end > 0 && value.charCodeAt(end - 1) === 0x2f) end--;
  return value.slice(0, end);
};
