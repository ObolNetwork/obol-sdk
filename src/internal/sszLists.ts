/**
 * The SSZ list types the SDK hashes with, without `Buffer`.
 *
 * `@chainsafe/ssz` 0.14.3 (pinned: 0.15+ is ESM-only) computes a list's
 * root as `mixInLength(root, length)`, and its `mixInLength` calls
 * `Buffer.alloc`. Browsers have no `Buffer` (only some bundlers polyfill
 * it), so every cluster hash failed there. These subclasses change nothing
 * but that one step: the chunks are merkleized by the library as before, and
 * the length is mixed in here with plain `Uint8Array`s.
 *
 * Every list type in `src/` must come from this file, not from
 * `@chainsafe/ssz` (`.eslintrc.js` enforces it). `test/internal/sszLists.spec.ts`
 * compares the roots with the library's own, and `test/package/browserNoBuffer.spec.ts`
 * runs the browser build with no `Buffer`.
 */
import {
  ByteListType as SszByteListType,
  ByteVectorType,
  ContainerType,
  ListBasicType as SszListBasicType,
  ListCompositeType as SszListCompositeType,
  type BasicType,
  type CompositeType,
  type CompositeView,
  type CompositeViewDU,
  type ValueOf,
} from '@chainsafe/ssz';

type RootOf = (this: unknown, value: unknown) => Uint8Array;

/** The root of the chunks alone: the `hashTreeRoot` of each list type's parent class. */
const chunksRootOf = (listClass: { prototype: object }): RootOf =>
  (Object.getPrototypeOf(listClass.prototype) as { hashTreeRoot: RootOf })
    .hashTreeRoot;

const byteListChunksRoot = chunksRootOf(SszByteListType);
const listBasicChunksRoot = chunksRootOf(SszListBasicType);
const listCompositeChunksRoot = chunksRootOf(SszListCompositeType);

// hash_tree_root of two 32-byte fields is sha256(a ‖ b): the library's
// `hash64`, reached through its public API.
const pairType = new ContainerType({
  root: new ByteVectorType(32),
  length: new ByteVectorType(32),
});

/**
 * SSZ `mix_in_length`: sha256(root ‖ length as a little-endian 32-byte
 * chunk). The length is written into 6 bytes, as the library does
 * (`writeUIntLE(length, 0, 6)`).
 */
export const mixInLength = (root: Uint8Array, length: number): Uint8Array => {
  if (!Number.isSafeInteger(length) || length < 0 || length >= 2 ** 48) {
    throw new Error('SSZ list length out of range');
  }
  const chunk = new Uint8Array(32);
  let rest = length;
  for (let i = 0; i < 6; i++) {
    chunk[i] = rest % 256;
    rest = Math.floor(rest / 256);
  }
  return pairType.hashTreeRoot({ root, length: chunk });
};

export class ByteListType extends SszByteListType {
  hashTreeRoot(value: Uint8Array): Uint8Array {
    return mixInLength(byteListChunksRoot.call(this, value), value.length);
  }
}

export class ListBasicType<
  ElementType extends BasicType<unknown>,
> extends SszListBasicType<ElementType> {
  hashTreeRoot(value: Array<ValueOf<ElementType>>): Uint8Array {
    return mixInLength(listBasicChunksRoot.call(this, value), value.length);
  }
}

export class ListCompositeType<
  ElementType extends CompositeType<
    any,
    CompositeView<ElementType>,
    CompositeViewDU<ElementType>
  >,
> extends SszListCompositeType<ElementType> {
  hashTreeRoot(value: Array<ValueOf<ElementType>>): Uint8Array {
    return mixInLength(listCompositeChunksRoot.call(this, value), value.length);
  }
}
