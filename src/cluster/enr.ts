/**
 * Ethereum Node Records (EIP-778) as Charon writes them (`enr:-…`): parsing
 * and validation over the bundled `@chainsafe/enr`. The 2.x root export
 * `ENR` (the `@chainsafe/enr` class) is replaced by these two functions.
 */
import { ENR } from '@chainsafe/enr';
import { bytesToHex, type Hex } from 'viem';
import { invalid } from '../schema.js';

export interface ParsedEnr {
  /** The node's secp256k1 public key, compressed (33 bytes): the key that signs `lock_hash`. */
  publicKey: Hex;
  /** keccak256 of the uncompressed public key (32 bytes). */
  nodeId: Hex;
  seq: bigint;
  ip?: string;
  tcp?: number;
  udp?: number;
}

const decodeEnr = (enr: unknown): ENR | null => {
  if (typeof enr !== 'string' || !enr.startsWith('enr:')) return null;
  try {
    return ENR.decodeTxt(enr);
  } catch {
    return null;
  }
};

/**
 * parseEnr (pure): decodes a text ENR and checks its signature (the 2.x
 * `ENR.decodeTxt(enr)`; `publicKey` is that `publicKey` as hex).
 *
 * @throws PAYLOAD_INVALID (`enr`) for anything that is not a validly signed
 *   `enr:` record.
 */
export const parseEnr = (enr: string): ParsedEnr => {
  const record = decodeEnr(enr);
  if (record === null) throw invalid('enr', 'must be a valid ENR');
  const { ip, tcp, udp } = record;
  const nodeId = record.nodeId.startsWith('0x')
    ? record.nodeId
    : `0x${record.nodeId}`;
  return {
    publicKey: bytesToHex(record.publicKey),
    nodeId: nodeId.toLowerCase() as Hex,
    seq: BigInt(record.seq),
    ...(ip !== undefined ? { ip } : {}),
    ...(tcp !== undefined ? { tcp } : {}),
    ...(udp !== undefined ? { udp } : {}),
  };
};

/**
 * isValidEnr (pure): whether `enr` is a validly signed text ENR (`enr:-…`).
 * Never throws. Whitespace is not trimmed: a record with surrounding
 * whitespace is not valid.
 */
export const isValidEnr = (enr: unknown): boolean => decodeEnr(enr) !== null;
