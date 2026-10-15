// verifyExitPayloadSignature against real secp256k1 signatures and ENRs
// (exit.spec.ts mocks the curve).
import { secp256k1 } from '@noble/curves/secp256k1.js';
import { SignableENR } from '@chainsafe/enr';
import type { ExitValidationPayload } from '../../src/types';
import { Exit } from '../../src/exits/exit.js';

const toHex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const basePayload: ExitValidationPayload = {
  partial_exits: [
    {
      public_key: '0x' + 'cd'.repeat(48),
      signed_exit_message: {
        message: { epoch: '1', validator_index: '10' },
        signature: '0x' + 'ab'.repeat(96),
      },
    },
  ],
  share_idx: 1,
  signature: '',
};

/** Signs the payload root like charon: r || s || v (65 bytes). */
const signPayload = (
  payload: ExitValidationPayload,
  secretKey: Uint8Array,
): string => {
  const root = (Exit as any).computeExitPayloadRoot(payload) as string;
  const recovered = secp256k1.sign(Buffer.from(root, 'hex'), secretKey, {
    prehash: false,
    format: 'recovered',
  });
  // noble puts the recovery id first; charon appends it.
  return '0x' + toHex(recovered.slice(1)) + toHex(recovered.slice(0, 1));
};

describe('Exit.verifyExitPayloadSignature (real secp256k1)', () => {
  const exit = new Exit(1, null);
  const { secretKey } = secp256k1.keygen();
  const enr = SignableENR.createV4(secretKey).encodeTxt();
  const payload = {
    ...basePayload,
    signature: signPayload(basePayload, secretKey),
  };

  it('accepts a valid 65-byte signature', async () => {
    await expect(exit.verifyExitPayloadSignature(enr, payload)).resolves.toBe(
      true,
    );
  });

  it('accepts a 64-byte signature without the recovery id', async () => {
    await expect(
      exit.verifyExitPayloadSignature(enr, {
        ...payload,
        signature: payload.signature.slice(0, 130),
      }),
    ).resolves.toBe(true);
  });

  it('returns false for a signature from another key', async () => {
    const other = secp256k1.keygen().secretKey;
    await expect(
      exit.verifyExitPayloadSignature(enr, {
        ...payload,
        signature: signPayload(basePayload, other),
      }),
    ).resolves.toBe(false);
  });

  it('returns false when the payload changed after signing', async () => {
    await expect(
      exit.verifyExitPayloadSignature(enr, { ...payload, share_idx: 2 }),
    ).resolves.toBe(false);
  });

  it('returns false for a high-s signature', async () => {
    const hex = payload.signature.slice(2);
    const s = BigInt('0x' + hex.slice(64, 128));
    const highS = (secp256k1.Point.CURVE().n - s)
      .toString(16)
      .padStart(64, '0');
    await expect(
      exit.verifyExitPayloadSignature(enr, {
        ...payload,
        signature: '0x' + hex.slice(0, 64) + highS + hex.slice(128),
      }),
    ).resolves.toBe(false);
  });

  it('throws on a signature with the wrong length', async () => {
    await expect(
      exit.verifyExitPayloadSignature(enr, {
        ...payload,
        signature: payload.signature + '00',
      }),
    ).rejects.toThrow('Invalid signature length');
  });

  it('throws on a non-hex signature', async () => {
    await expect(
      exit.verifyExitPayloadSignature(enr, {
        ...payload,
        signature: '0x' + 'zz'.repeat(65),
      }),
    ).rejects.toThrow('Expected a hex string');
  });
});
