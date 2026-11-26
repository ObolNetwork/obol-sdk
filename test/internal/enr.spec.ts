/**
 * src/internal/enr.ts against @chainsafe/enr (a devDependency kept for this
 * comparison only): every ENR in the test fixtures and spec vectors, the
 * EIP-778 example record, and byte-level mutations of them must be accepted
 * or refused alike, with the same key, node id, seq, ip and ports.
 */
import { ENR } from '@chainsafe/enr';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { bytesToHex, hexToBytes, keccak256 } from 'viem';
import { decodeEnrText, enrIp, enrPort } from '../../src/internal/enr.js';

// EIP-778 "Test Vectors" example record (private key b71c71a6…, 127.0.0.1:30303).
const EIP778_EXAMPLE =
  'enr:-IS4QHCYrYZbAKWCBRlAy5zzaDZXJBGkcnh4MHcBFZntXNFrdvJjX04jRzjzCBOonrkTfj499SZuOh8R33Ls8RRcy5wBgmlkgnY0gmlwhH8AAAGJc2VjcDI1NmsxoQPKY0yuDUmstAHYpMa2_oxVtw0RW_QAdpzBQA8yWM0xOIN1ZHCCdl8';

const collectEnrs = (dir: string, found: Set<string>): void => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      collectEnrs(path, found);
    } else if (/\.(ts|json)$/.test(name)) {
      for (const m of readFileSync(path, 'utf8').matchAll(
        /enr:-[A-Za-z0-9_-]+/g,
      )) {
        found.add(m[0]);
      }
    }
  }
};

const FIXTURES = (() => {
  const found = new Set<string>([EIP778_EXAMPLE]);
  collectEnrs(join(process.cwd(), 'test'), found);
  collectEnrs(join(process.cwd(), 'spec'), found);
  return [...found];
})();

type Outcome =
  | { ok: false }
  | {
      ok: true;
      publicKey: string;
      nodeId: string;
      seq: bigint;
      ip?: string;
      tcp?: number;
      udp?: number;
    };

const ours = (text: string): Outcome => {
  try {
    const r = decodeEnrText(text);
    return {
      ok: true,
      publicKey: bytesToHex(r.publicKey),
      nodeId: bytesToHex(r.nodeId),
      seq: r.seq,
      ip: enrIp(r),
      tcp: enrPort(r, 'tcp'),
      udp: enrPort(r, 'udp'),
    };
  } catch {
    return { ok: false };
  }
};

const theirs = (text: string): Outcome => {
  try {
    const r = ENR.decodeTxt(text);
    return {
      ok: true,
      publicKey: bytesToHex(r.publicKey),
      nodeId: `0x${r.nodeId.replace(/^0x/, '')}`.toLowerCase(),
      seq: BigInt(r.seq),
      ip: r.ip,
      tcp: r.tcp,
      udp: r.udp,
    };
  } catch {
    return { ok: false };
  }
};

const toBytes = (text: string): Uint8Array =>
  new Uint8Array(Buffer.from(text.slice(4), 'base64url'));
const toText = (bytes: Uint8Array): string =>
  `enr:${Buffer.from(bytes).toString('base64url')}`;

/** A small deterministic PRNG, so a failure reproduces. */
const rng = (seed: number) => () => {
  seed = (seed * 1103515245 + 12345) & 0x7fffffff;
  return seed;
};

describe('decodeEnrText', () => {
  it('has fixtures to compare', () => {
    expect(FIXTURES.length).toBeGreaterThan(50);
  });

  it('decodes the EIP-778 example record', () => {
    const r = decodeEnrText(EIP778_EXAMPLE);
    expect(bytesToHex(r.publicKey)).toBe(
      '0x03ca634cae0d49acb401d8a4c6b6fe8c55b70d115bf400769cc1400f3258cd3138',
    );
    expect(bytesToHex(r.nodeId)).toBe(
      '0xa448f24c6d18e575453db13171562b71999873db5b286df957af199ec94617f7',
    );
    expect(r.seq).toBe(1n);
    expect(enrIp(r)).toBe('127.0.0.1');
    expect(enrPort(r, 'udp')).toBe(30303);
  });

  it('agrees with @chainsafe/enr on every fixture ENR', () => {
    let repeatedKeys = 0;
    for (const text of FIXTURES) {
      // The one deliberate difference: a repeated key (Charon refuses the
      // record; @chainsafe/enr keeps the last value). test/fuzz/regressions
      // holds a lock with such an ENR.
      if (!ours(text).ok && theirs(text).ok) {
        expect(() => decodeEnrText(text)).toThrow(/duplicate key/);
        repeatedKeys++;
        continue;
      }
      expect({ text, outcome: ours(text) }).toEqual({
        text,
        outcome: theirs(text),
      });
    }
    expect(repeatedKeys).toBeLessThanOrEqual(1);
  });

  it('agrees with @chainsafe/enr on byte mutations of the fixtures', () => {
    const next = rng(778);
    let refused = 0;
    for (const text of FIXTURES) {
      const bytes = toBytes(text);
      for (let n = 0; n < 40; n++) {
        const mutated = bytes.slice();
        const kind = next() % 3;
        const at = next() % mutated.length;
        let candidate: Uint8Array;
        if (kind === 0) {
          mutated[at] ^= 1 << (next() % 8);
          candidate = mutated;
        } else if (kind === 1) {
          candidate = mutated.slice(0, at);
        } else {
          candidate = new Uint8Array([...mutated, next() % 256]);
        }
        const mutatedText = toText(candidate);
        const a = ours(mutatedText);
        const b = theirs(mutatedText);
        expect({ mutatedText, a }).toEqual({ mutatedText, a: b });
        if (!a.ok) refused++;
      }
    }
    // Nearly every mutation breaks the signature or the encoding.
    expect(refused).toBeGreaterThan(FIXTURES.length * 35);
  });

  it.each([
    ['no prefix', EIP778_EXAMPLE.slice(4)],
    ['bad base64url', 'enr:-IS4Q+/='],
    ['empty', 'enr:'],
  ])('refuses %s', (_name, text) => {
    expect(() => decodeEnrText(text)).toThrow(/invalid ENR/);
    expect(theirs(text)).toEqual({ ok: false });
  });

  it('refuses a high-s form of a valid signature', () => {
    const bytes = toBytes(EIP778_EXAMPLE);
    // The record starts f8 84 b8 40 <64-byte signature>.
    const sig = bytes.slice(4, 68);
    const n = BigInt(
      '0xfffffffffffffffffffffffffffffffebaaedce6af48a03bbfd25e8cd0364141',
    );
    const s = BigInt(bytesToHex(sig.slice(32)));
    const high = (n - s).toString(16).padStart(64, '0');
    const mutated = bytes.slice();
    mutated.set(Buffer.from(high, 'hex'), 36);
    const text = toText(mutated);
    expect(ours(text)).toEqual({ ok: false });
    expect(theirs(text)).toEqual({ ok: false });
  });

  // Found by differential testing against Charon: a record with two
  // `secp256k1` entries, signed by
  // the second key. @chainsafe/enr and the SDK before this fix kept the last
  // entry and accepted it; Charon's enr.Parse refuses any repeated key, so a
  // lock with such an operator ENR passed verifyLock but cannot be loaded by
  // Charon. Built at run time so the fixture scan above does not pick it up.
  it('refuses a record with a repeated key (Charon does)', () => {
    const rlpList = (items: Uint8Array[]): Uint8Array => {
      const len = (n: number, base: number): number[] =>
        n < 56 ? [base + n] : [base + 56, n];
      const body: number[] = [];
      for (const it of items) {
        if (it.length === 1 && it[0] < 0x80) body.push(it[0]);
        else body.push(...len(it.length, 0x80), ...it);
      }
      return Uint8Array.from([...len(body.length, 0xc0), ...body]);
    };
    const te = new TextEncoder();
    const first = new Uint8Array(32).fill(1);
    const second = new Uint8Array(32).fill(2);
    const BOM = Uint8Array.of(0xef, 0xbb, 0xbf);
    const record = (
      keys: Uint8Array[],
      signer: Uint8Array,
      names: Uint8Array[] = keys.map(() => te.encode('secp256k1')),
    ): string => {
      const content = [
        new Uint8Array(0),
        te.encode('id'),
        te.encode('v4'),
        ...keys.flatMap((k, i) => [names[i], secp256k1.getPublicKey(k, true)]),
      ];
      const digest = hexToBytes(keccak256(rlpList(content)));
      const sig = secp256k1.sign(digest, signer, {
        prehash: false,
        lowS: true,
      });
      return toText(rlpList([sig, ...content]));
    };
    // The same construction with one key is a valid record.
    expect(ours(record([second], second)).ok).toBe(true);
    const duplicated = record([first, second], second);
    expect(ours(duplicated)).toEqual({ ok: false });
    expect(() => decodeEnrText(duplicated)).toThrow(/duplicate key/);
    // A UTF-8 BOM before `secp256k1` makes another key for Charon (raw
    // bytes); a default TextDecoder strips it and the SDK took that entry as
    // the node key. Signed by the BOM entry's key, Charon refuses the record.
    const bomKey = new Uint8Array([...BOM, ...te.encode('secp256k1')]);
    const aliased = record([first, second], second, [
      te.encode('secp256k1'),
      bomKey,
    ]);
    expect(ours(aliased)).toEqual({ ok: false });
    // Signed by the plain entry's key it is a valid record bound to that key.
    const plain = ours(
      record([first, second], first, [te.encode('secp256k1'), bomKey]),
    );
    expect(plain).toMatchObject({
      ok: true,
      publicKey: bytesToHex(secp256k1.getPublicKey(first, true)),
    });
  });
});
