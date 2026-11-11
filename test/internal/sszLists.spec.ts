/**
 * The SDK's Buffer-free list types hash exactly as @chainsafe/ssz's own
 * (which need `Buffer`, present here under Node), and as the SSZ spec says.
 */
import { createHash, randomBytes } from 'node:crypto';
import {
  ByteListType as SszByteListType,
  ByteVectorType,
  ContainerType,
  ListBasicType as SszListBasicType,
  ListCompositeType as SszListCompositeType,
  UintBigintType,
} from '@chainsafe/ssz';
import {
  ByteListType,
  ListBasicType,
  ListCompositeType,
  mixInLength,
} from '../../src/internal/sszLists.js';

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('Buffer-free SSZ list types', () => {
  it('mixInLength is sha256(root ‖ little-endian length chunk) (SSZ mix_in_length)', () => {
    for (const length of [
      0,
      1,
      255,
      256,
      65_535,
      65_536,
      2 ** 32,
      2 ** 40 + 7,
    ]) {
      const root = randomBytes(32);
      const chunk = Buffer.alloc(32);
      chunk.writeBigUInt64LE(BigInt(length), 0);
      const expected = createHash('sha256').update(root).update(chunk).digest();
      expect(hex(mixInLength(root, length))).toBe(hex(expected));
    }
    expect(() => mixInLength(new Uint8Array(32), -1)).toThrow();
    expect(() => mixInLength(new Uint8Array(32), 2 ** 48)).toThrow();
  });

  it('an empty List[uint64, 4] has the spec root', () => {
    // merkleize of no chunks with limit 1 chunk = the zero chunk; mixed in
    // with length 0: sha256 of 64 zero bytes.
    const expected = createHash('sha256').update(Buffer.alloc(64)).digest();
    expect(
      hex(new ListBasicType(new UintBigintType(8), 4).hashTreeRoot([])),
    ).toBe(hex(expected));
  });

  it('ByteListType matches the library for every length around the chunk boundaries', () => {
    const ours = new ByteListType(1024);
    const theirs = new SszByteListType(1024);
    for (const length of [0, 1, 31, 32, 33, 63, 64, 65, 255, 256, 257, 1024]) {
      const value = new Uint8Array(randomBytes(length));
      expect(hex(ours.hashTreeRoot(value))).toBe(
        hex(theirs.hashTreeRoot(value)),
      );
    }
  });

  it('ListBasicType matches the library', () => {
    const element = new UintBigintType(8);
    const ours = new ListBasicType(element, 256);
    const theirs = new SszListBasicType(element, 256);
    for (const length of [0, 1, 3, 4, 5, 8, 100, 256]) {
      const value = Array.from(
        { length },
        (_, i) => BigInt(i) * 1_000_000_007n,
      );
      expect(hex(ours.hashTreeRoot(value))).toBe(
        hex(theirs.hashTreeRoot(value)),
      );
    }
  });

  it('ListCompositeType matches the library, nested lists included', () => {
    const inner = (List: any, Bytes: any): any =>
      new ContainerType({
        key: new ByteVectorType(48),
        name: new Bytes(64),
        shares: new List(new ByteVectorType(48), 16),
      });
    const ours = new ListCompositeType(
      inner(ListCompositeType, ByteListType),
      65536,
    );
    const theirs = new SszListCompositeType(
      inner(SszListCompositeType, SszByteListType),
      65536,
    );
    for (const length of [0, 1, 2, 3, 7, 33]) {
      const value = Array.from({ length }, (_, i) => ({
        key: new Uint8Array(randomBytes(48)),
        name: new Uint8Array(randomBytes(i % 65)),
        shares: Array.from(
          { length: i % 17 },
          () => new Uint8Array(randomBytes(48)),
        ),
      }));
      expect(hex(ours.hashTreeRoot(value))).toBe(
        hex(theirs.hashTreeRoot(value)),
      );
    }
  });

  it('they are subclasses, so code that checks the library type still works', () => {
    expect(new ByteListType(8)).toBeInstanceOf(SszByteListType);
    expect(new ListCompositeType(new ByteVectorType(32), 4)).toBeInstanceOf(
      SszListCompositeType,
    );
  });
});
