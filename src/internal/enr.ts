/**
 * Ethereum Node Records (EIP-778), "v4" identity scheme only: the text form
 * Charon writes (`enr:` + base64url of the RLP list `[signature, seq, k, v,
 * ...]`). Replaces the bundled `@chainsafe/enr` (and its libp2p /
 * multiformats tree), which the SDK used only to decode a record and check
 * its signature. The rules match `@chainsafe/enr` 6.x `decodeTxt`, except
 * that keys are compared as raw bytes, as Charon does: a repeated key is
 * refused (`@chainsafe/enr` keeps the last value) and a key with a leading
 * UTF-8 BOM is not read as the key without it. test/internal/enr.spec.ts
 * compares the two on fixtures and mutations.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256 } from 'viem';

export interface DecodedEnr {
  /** The `secp256k1` entry as stored (Charon: compressed, 33 bytes). */
  publicKey: Uint8Array;
  /** keccak256 of the uncompressed public key without its 0x04 prefix. */
  nodeId: Uint8Array;
  seq: bigint;
  /** Every key / value pair, as stored. */
  entries: Map<string, Uint8Array>;
}

type RlpItem = Uint8Array | RlpItem[];

const fail = (reason: string): never => {
  throw new Error(`invalid ENR: ${reason}`);
};

const BASE64URL = /^[A-Za-z0-9_-]*$/;

/** base64url without padding (RFC 4648 §5), as EIP-778 text records use. */
const fromBase64url = (text: string): Uint8Array => {
  if (!BASE64URL.test(text) || text.length % 4 === 1) fail('not base64url');
  const base64 = text.replace(/-/g, '+').replace(/_/g, '/');
  const padded = base64 + '='.repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
};

/**
 * Strict RLP decoding (as `@ethereumjs/rlp`): the shortest form only (no
 * single byte below 0x80 in a string prefix, no length with leading zeros,
 * no long form for a length under 56), and nothing after the item.
 */
const decodeRlp = (input: Uint8Array): RlpItem => {
  const lengthAt = (offset: number, size: number): number => {
    if (offset + size > input.length) fail('truncated RLP length');
    if (input[offset] === 0) fail('RLP length with leading zeros');
    let length = 0;
    for (let i = 0; i < size; i++) length = length * 256 + input[offset + i];
    if (length < 56) fail('non-canonical RLP length');
    return length;
  };
  const item = (offset: number): [RlpItem, number] => {
    if (offset >= input.length) fail('truncated RLP');
    const prefix = input[offset];
    if (prefix < 0x80) return [input.slice(offset, offset + 1), offset + 1];
    if (prefix <= 0xbf) {
      const long = prefix > 0xb7;
      const size = long ? prefix - 0xb7 : 0;
      const length = long ? lengthAt(offset + 1, size) : prefix - 0x80;
      const start = offset + 1 + size;
      const end = start + length;
      if (end > input.length) fail('truncated RLP string');
      if (!long && length === 1 && input[start] < 0x80) {
        fail('non-canonical RLP single byte');
      }
      return [input.slice(start, end), end];
    }
    const long = prefix > 0xf7;
    const size = long ? prefix - 0xf7 : 0;
    const length = long ? lengthAt(offset + 1, size) : prefix - 0xc0;
    const start = offset + 1 + size;
    const end = start + length;
    if (end > input.length) fail('truncated RLP list');
    const items: RlpItem[] = [];
    let cursor = start;
    while (cursor < end) {
      const [child, next] = item(cursor);
      items.push(child);
      cursor = next;
    }
    if (cursor !== end) fail('RLP list overruns its length');
    return [items, end];
  };
  const [decoded, end] = item(0);
  if (end !== input.length) fail('bytes after the RLP item');
  return decoded;
};

const encodeLength = (length: number, base: number): Uint8Array => {
  if (length < 56) return Uint8Array.of(base + length);
  const bytes: number[] = [];
  for (let n = length; n > 0; n = Math.floor(n / 256)) bytes.unshift(n % 256);
  return Uint8Array.of(base + 55 + bytes.length, ...bytes);
};

const concat = (parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((sum, p) => sum + p.length, 0));
  let offset = 0;
  for (const p of parts) {
    out.set(p, offset);
    offset += p.length;
  }
  return out;
};

/** RLP encoding of a list of byte strings (what the record signs). */
const encodeRlpList = (items: Uint8Array[]): Uint8Array => {
  const body = concat(
    items.map(b =>
      b.length === 1 && b[0] < 0x80
        ? b
        : concat([encodeLength(b.length, 0x80), b]),
    ),
  );
  return concat([encodeLength(body.length, 0xc0), body]);
};

const bytesToBigint = (bytes: Uint8Array): bigint =>
  bytes.reduce((n, b) => (n << 8n) | BigInt(b), 0n);

/**
 * Decodes a text ENR and checks its "v4" signature: secp256k1 (low-s) over
 * keccak256 of the RLP list `[seq, k, v, ...]`.
 *
 * @throws Error for anything that is not a validly signed v4 record.
 */
export const decodeEnrText = (text: string): DecodedEnr => {
  if (typeof text !== 'string' || !text.startsWith('enr:')) {
    fail("must start with 'enr:'");
  }
  const decoded = decodeRlp(fromBase64url(text.slice(4)));
  if (!Array.isArray(decoded)) fail('not an RLP list');
  const list = decoded as RlpItem[];
  if (list.length % 2 !== 0) fail('odd number of elements');
  const [signature, seq] = list;
  if (!(signature instanceof Uint8Array) || signature.length === 0) {
    fail('signature must be a byte string');
  }
  // seq 0 is the empty string (0x80), as RLP encodes integer 0.
  if (!(seq instanceof Uint8Array)) {
    fail('sequence number must be a byte string');
  }
  const entries = new Map<string, Uint8Array>();
  const signed: Uint8Array[] = [seq as Uint8Array];
  // ignoreBOM: a default TextDecoder drops a leading UTF-8 BOM, so a key
  // "\uFEFFsecp256k1" would read as `secp256k1` (Charon keeps them apart).
  const utf8 = new TextDecoder('utf-8', { ignoreBOM: true });
  // EIP-778: keys are unique. Charon (eth2util/enr.Parse) refuses a record
  // with a repeated key; a Map would silently keep the last value (so with
  // two `secp256k1` entries, the last key would be the node's key here and
  // the record unusable in Charon). Compared as raw bytes, as Charon does.
  const seenKeys = new Set<string>();
  for (let i = 2; i < list.length; i += 2) {
    const key = list[i];
    const value = list[i + 1];
    if (!(key instanceof Uint8Array) || !(value instanceof Uint8Array)) {
      fail('keys and values must be byte strings');
    }
    const rawKey = Array.from(key as Uint8Array, b =>
      b.toString(16).padStart(2, '0'),
    ).join('');
    if (seenKeys.has(rawKey)) fail('duplicate key');
    seenKeys.add(rawKey);
    entries.set(utf8.decode(key as Uint8Array), value as Uint8Array);
    signed.push(key as Uint8Array, value as Uint8Array);
  }
  const id = entries.get('id');
  if (id === undefined || utf8.decode(id) !== 'v4') {
    fail('identity scheme must be v4');
  }
  const publicKey = entries.get('secp256k1');
  if (publicKey === undefined) fail('no secp256k1 key');
  let verified = false;
  let uncompressed: Uint8Array | undefined;
  try {
    const digest = keccak256(encodeRlpList(signed), 'bytes');
    verified = secp256k1.verify(
      signature as Uint8Array,
      digest,
      publicKey as Uint8Array,
      { prehash: false, lowS: true },
    );
    uncompressed = secp256k1.Point.fromBytes(publicKey as Uint8Array).toBytes(
      false,
    );
  } catch {
    verified = false;
  }
  if (!verified || uncompressed === undefined) {
    fail('signature does not verify');
  }
  return {
    publicKey: publicKey as Uint8Array,
    nodeId: keccak256((uncompressed as Uint8Array).slice(1), 'bytes'),
    seq: bytesToBigint(seq as Uint8Array),
    entries,
  };
};

/** `ip` as dotted IPv4, when it is 4 bytes. */
export const enrIp = (record: DecodedEnr): string | undefined => {
  const ip = record.entries.get('ip');
  return ip?.length === 4 ? ip.join('.') : undefined;
};

/** A port entry (`tcp`, `udp`): a big-endian unsigned integer of 1–2 bytes. */
export const enrPort = (
  record: DecodedEnr,
  key: 'tcp' | 'udp',
): number | undefined => {
  const value = record.entries.get(key);
  if (value === undefined || value.length === 0 || value.length > 2) {
    return undefined;
  }
  return Number(bytesToBigint(value));
};
