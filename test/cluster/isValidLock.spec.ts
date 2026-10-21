// isValidLock (the 2.x validateClusterLock as a boolean), config_hash
// binding, the bound client's clients, and the 2.x signature / ENR helpers.
import { jest } from '@jest/globals';
import { ENR } from '@chainsafe/enr';
import {
  bytesToHex,
  decodeFunctionData,
  encodeAbiParameters,
  hashTypedData,
  parseAbi,
  toFunctionSelector,
  type Hex,
} from 'viem';
import { hoodi } from 'viem/chains';
import { createObolClient } from '../../src/client.js';
import {
  computeConfigHash,
  computeDefinitionHash,
  computeLockHash,
  creatorConfigHashTypedData,
  isValidEnr,
  isValidLock,
  parseEnr,
  verifyLock,
  verifyTypedDataSignature,
} from '../../src/cluster/index.js';
import * as root from '../../src/index.js';
import { clusterConfigOrDefinitionHash } from '../../src/internal/verification/common.js';
import type { BlsBackend } from '../../src/cluster/blsBackend.js';
import { nobleBls } from '../../src/cluster/blsBackend.js';
import { clusterLockV1X10, clusterLockV1X11, enr } from '../fixtures.js';
import { fakeChain } from '../helpers/fakeChain.js';
import { syntheticLock } from '../helpers/syntheticLock.js';
import { accountOf, KEYS } from './wallet.js';

jest.setTimeout(60_000);

const copy = <T>(value: T): any => JSON.parse(JSON.stringify(value));
const quick = { yieldMs: 0 };

describe('cluster.isValidLock', () => {
  it('is exported from the root, the namespace and the bound client', () => {
    expect(root.isValidLock).toBe(isValidLock);
    expect(root.cluster.isValidLock).toBe(isValidLock);
    const obol = createObolClient({
      chain: hoodi,
      publicClient: fakeChain().publicClient,
      api: false,
    });
    expect(typeof obol.cluster.isValidLock).toBe('function');
  });

  it('is true for a valid lock and false for an invalid one', async () => {
    expect(await isValidLock(copy(clusterLockV1X10))).toBe(true);
    const lock = copy(clusterLockV1X10);
    lock.lock_hash = `0x${'00'.repeat(32)}`;
    expect(await isValidLock(lock)).toBe(false);
  });

  it('is false (not a throw) for a malformed lock', async () => {
    for (const input of [null, {}, 'lock', { cluster_definition: 1 }]) {
      expect(await isValidLock(input)).toBe(false);
    }
  });

  it('throws PAYLOAD_INVALID for malformed options; a failing backend fails its step', async () => {
    await expect(
      isValidLock(copy(clusterLockV1X10), { signatures: 'none' }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
    const broken: BlsBackend = {
      ...nobleBls,
      createBatch: () => {
        throw new Error('backend down');
      },
    };
    // A throw inside a step fails that step, it is not an error...
    expect(await isValidLock(copy(clusterLockV1X10), { bls: broken })).toBe(
      false,
    );
    // ...but a backend missing a method is a caller error.
    await expect(
      isValidLock(copy(clusterLockV1X10), {
        bls: { ...nobleBls, verify: undefined } as never,
      }),
    ).rejects.toMatchObject({ code: 'PAYLOAD_INVALID' });
  });

  it('runs at full by default (attested only when asked)', async () => {
    const { lock, seal } = syntheticLock(2, 4, 3);
    const edited = seal(structuredClone(lock));
    // A wrong signature_aggregate (not in lock_hash) is a full-only failure.
    edited.signature_aggregate =
      edited.distributed_validators[0].builder_registration.signature;
    expect(await isValidLock(structuredClone(edited), quick)).toBe(false);
    expect(
      await isValidLock(structuredClone(edited), { level: 'attested' }),
    ).toBe(true);
  });
});

describe('config_hash binds the definition (verifyLock step 4)', () => {
  it('fails at hash_mismatch / config_hash for an edited definition whose config_hash was not recomputed', async () => {
    const { lock, seal } = syntheticLock(2, 4, 3);
    const edited = structuredClone(lock);
    const definition = edited.cluster_definition;
    definition.validators[0].withdrawal_address =
      definition.validators[1].withdrawal_address;
    definition.definition_hash = clusterConfigOrDefinitionHash(
      definition,
      false,
    );
    seal(edited); // lock_hash, node signatures and aggregate over the edit
    expect(await verifyLock(edited, quick)).toEqual({
      ok: false,
      level: 'full',
      step: 'hash_mismatch',
      issue: 'config_hash',
    });
  });

  it("fails at hash_mismatch / config_hash for a self-consistent lock carrying another cluster's config_hash", async () => {
    const a = syntheticLock(2, 4, 3);
    const b = syntheticLock(2, 4, 3);
    const lock = structuredClone(a.lock);
    const definition = lock.cluster_definition;
    expect(definition.config_hash).not.toBe(
      b.lock.cluster_definition.config_hash,
    );
    definition.config_hash = b.lock.cluster_definition.config_hash;
    // Everything over the contents is recomputed and re-sealed.
    definition.definition_hash = clusterConfigOrDefinitionHash(
      definition,
      false,
    );
    a.seal(lock);
    expect(computeLockHash(lock)).toBe(lock.lock_hash);
    expect(await verifyLock(structuredClone(lock), quick)).toEqual({
      ok: false,
      level: 'full',
      step: 'hash_mismatch',
      issue: 'config_hash',
    });
    expect(
      await verifyLock(structuredClone(lock), { level: 'attested' }),
    ).toMatchObject({ step: 'hash_mismatch', issue: 'config_hash' });
    expect(await isValidLock(lock, quick)).toBe(false);
  });

  it('fails at the definition signatures when config_hash is recomputed over an edit', async () => {
    const lock = copy(clusterLockV1X10);
    const definition = lock.cluster_definition;
    definition.name = 'renamed';
    definition.config_hash = computeConfigHash(definition);
    definition.definition_hash = computeDefinitionHash(definition);
    lock.lock_hash = computeLockHash(lock);
    // The creator and operators signed the old config_hash.
    expect(
      await verifyLock(lock, { publicClient: fakeChain().publicClient }),
    ).toEqual({
      ok: false,
      level: 'full',
      step: 'definition_signature_invalid',
      issue: 'creator config_signature',
    });
  });
});

describe('contract-wallet signatures through the bound client', () => {
  const definition = clusterLockV1X11.cluster_definition;
  const abi = parseAbi([
    'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
  ]);
  const expected = hashTypedData(
    creatorConfigHashTypedData(definition.config_hash, 560048),
  );
  const safe = fakeChain({
    contracts: {
      [definition.creator.address]: {
        abi,
        read: {
          isValidSignature: ([hash, signature]) =>
            hash === expected &&
            signature === definition.creator.config_signature
              ? '0x1626ba7e'
              : '0xffffffff',
        },
      },
    },
  });
  const obol = createObolClient({
    chain: hoodi,
    publicClient: safe.publicClient,
    api: false,
  });

  it('uses its own publicClient for its chain', async () => {
    expect(await obol.cluster.isValidLock(copy(clusterLockV1X11))).toBe(true);
    expect(await isValidLock(copy(clusterLockV1X11))).toBe(false);
  });

  it('keeps its own client when publicClients has none for its chain', async () => {
    const mainnet = fakeChain({ chainId: 1 }).publicClient;
    expect(
      await obol.cluster.verifyLock(copy(clusterLockV1X11), {
        publicClients: { 1: mainnet },
      }),
    ).toEqual({ ok: true, level: 'full' });
    expect(
      await obol.cluster.verifyLock(copy(clusterLockV1X11), {
        publicClients: () => undefined,
      }),
    ).toEqual({ ok: true, level: 'full' });
  });
});

describe('verifyTypedDataSignature (2.x validateAddressSignature / validateEOASignature)', () => {
  const account = accountOf(KEYS.creator);
  const other = accountOf(KEYS.other);
  // As obol-api builds the terms message: EIP712Domain in types, no chainId.
  const typedData = {
    types: {
      EIP712Domain: [
        { name: 'name', type: 'string' },
        { name: 'version', type: 'string' },
      ],
      TermsAndConditions: [
        { name: 'terms_and_conditions_hash', type: 'string' },
        { name: 'version', type: 'uint256' },
      ],
    },
    primaryType: 'TermsAndConditions',
    domain: { name: 'Obol', version: '1' },
    message: { terms_and_conditions_hash: '0xabcd', version: 1 },
  };

  it('accepts an account signature and refuses another signer', async () => {
    const signature = await account.signTypedData(typedData as never);
    expect(
      await verifyTypedDataSignature({
        address: account.address,
        signature,
        typedData,
      }),
    ).toBe(true);
    expect(
      await verifyTypedDataSignature({
        address: other.address,
        signature,
        typedData,
        chainId: 560048,
        publicClient: fakeChain().publicClient,
      }),
    ).toBe(false);
    expect(
      await verifyTypedDataSignature({
        address: account.address,
        signature: 'not hex',
        typedData,
      }),
    ).toBe(false);
    expect(root.verifyTypedDataSignature).toBe(verifyTypedDataSignature);
  });

  it("accepts eth-sig-util's TypedMessage (salt as bytes)", async () => {
    // eth-sig-util's TypedMessage<MessageTypes>, as obol-api types it.
    interface MessageTypes {
      EIP712Domain: Array<{ name: string; type: string }>;
      [additionalProperties: string]: Array<{ name: string; type: string }>;
    }
    interface TypedMessage<T extends MessageTypes> {
      types: T;
      primaryType: keyof T;
      domain: {
        name?: string;
        version?: string;
        chainId?: number;
        verifyingContract?: string;
        salt?: ArrayBuffer;
      };
      message: Record<string, unknown>;
    }
    const salt = new Uint8Array(32).fill(7);
    const message: TypedMessage<MessageTypes> = {
      types: {
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'salt', type: 'bytes32' },
        ],
        Mail: [{ name: 'contents', type: 'string' }],
      },
      primaryType: 'Mail',
      domain: { name: 'Obol', salt: salt.buffer },
      message: { contents: 'hi' },
    };
    const signature = await account.signTypedData({
      ...message,
      domain: { name: 'Obol', salt: bytesToHex(salt) },
    } as never);
    expect(
      await verifyTypedDataSignature({
        address: account.address,
        signature,
        typedData: message,
      }),
    ).toBe(true);
    // A typed array works too; another salt does not verify.
    expect(
      await verifyTypedDataSignature({
        address: account.address,
        signature,
        typedData: { ...message, domain: { ...message.domain, salt } },
      }),
    ).toBe(true);
    expect(
      await verifyTypedDataSignature({
        address: account.address,
        signature,
        typedData: {
          ...message,
          domain: { name: 'Obol', salt: new Uint8Array(32).buffer },
        },
      }),
    ).toBe(false);
    expect(
      await verifyTypedDataSignature({
        address: account.address,
        signature,
        typedData: null as never,
      }),
    ).toBe(false);
  });

  it('checks a contract wallet with the client for chainId (EIP-1271)', async () => {
    const data = creatorConfigHashTypedData(definition().config_hash, 560048);
    const args = {
      address: definition().creator.address,
      signature: definition().creator.config_signature,
      typedData: data as never,
    };
    const chain = fakeChain({
      contracts: {
        [definition().creator.address]: {
          abi: parseAbi([
            'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
          ]),
          read: {
            isValidSignature: ([hash]) =>
              hash === hashTypedData(data) ? '0x1626ba7e' : '0xffffffff',
          },
        },
      },
    });
    expect(await verifyTypedDataSignature(args)).toBe(false);
    expect(
      await verifyTypedDataSignature({
        ...args,
        publicClients: { 560048: chain.publicClient },
      }),
    ).toBe(true);
  });

  it('accepts the legacy EIP-1271 magic of Safes before 1.3.0, and refuses others', async () => {
    const data = creatorConfigHashTypedData(definition().config_hash, 560048);
    const args = {
      address: definition().creator.address,
      signature: definition().creator.config_signature,
      typedData: data as never,
      chainId: 560048,
    };
    const abi = parseAbi([
      'function isValidSignature(bytes32 hash, bytes signature) view returns (bytes4)',
      'function isValidSignature(bytes data, bytes signature) view returns (bytes4)',
    ]);
    const [current, legacy] = abi.map(toFunctionSelector);
    // Answers per selector; the data a pre-1.3.0 Safe takes is the 32-byte
    // hash as bytes (Safe 1.3.0's CompatibilityFallbackHandler forwards
    // abi.encode(hash)).
    const wallet = (answers: Record<Hex, Hex>): ReturnType<typeof fakeChain> =>
      fakeChain({
        raw: {
          [definition().creator.address]: callData => {
            const selector = callData.slice(0, 10) as Hex;
            const { args: called } = decodeFunctionData({
              abi,
              data: callData,
            });
            const answer =
              called?.[0] === hashTypedData(data)
                ? (answers[selector] ?? '0xffffffff')
                : '0xffffffff';
            return encodeAbiParameters([{ type: 'bytes4' }], [answer]);
          },
        },
      });
    const verify = async (answers: Record<Hex, Hex>): Promise<boolean> =>
      await verifyTypedDataSignature({
        ...args,
        publicClient: wallet(answers).publicClient,
      });
    expect(await verify({ [legacy]: '0x20c13b0b' })).toBe(true);
    expect(await verify({ [current]: '0x1626ba7e' })).toBe(true);
    // Each magic only from its own function; a refusal from both.
    expect(await verify({ [legacy]: '0x1626ba7e' })).toBe(false);
    expect(await verify({ [current]: '0x20c13b0b' })).toBe(false);
    expect(await verify({})).toBe(false);
  });

  const definition = (): typeof clusterLockV1X11.cluster_definition =>
    clusterLockV1X11.cluster_definition;
});

describe('parseEnr / isValidEnr (2.x ENR)', () => {
  it('parses a record as ENR.decodeTxt does', () => {
    const parsed = parseEnr(enr);
    expect(parsed.publicKey).toBe(bytesToHex(ENR.decodeTxt(enr).publicKey));
    expect(parsed.publicKey).toMatch(/^0x0[23][0-9a-f]{64}$/);
    expect(parsed.nodeId).toMatch(/^0x[0-9a-f]{64}$/);
    expect(typeof parsed.seq).toBe('bigint');
    expect(isValidEnr(enr)).toBe(true);
  });

  it.each<[string, unknown]>([
    ['not a string', 42],
    ['empty', ''],
    ['no prefix', enr.slice(4)],
    ['surrounding whitespace', ` ${enr}`],
    [
      'a changed character',
      `${enr.slice(0, 20)}${enr[20] === 'a' ? 'b' : 'a'}${enr.slice(21)}`,
    ],
  ])('refuses %s', (_name, input) => {
    expect(isValidEnr(input)).toBe(false);
    expect(() => parseEnr(input as string)).toThrow(
      expect.objectContaining({ code: 'PAYLOAD_INVALID' }) as never,
    );
  });

  it('is exported from the cluster namespace', () => {
    expect(root.cluster.parseEnr).toBe(parseEnr);
    expect(root.cluster.isValidEnr).toBe(isValidEnr);
    const hex: Hex = parseEnr(enr).publicKey;
    expect(hex.length).toBe(68);
  });
});
