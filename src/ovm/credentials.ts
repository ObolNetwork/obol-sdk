/** Withdrawal credential helpers (pure). */
import { Type } from '@sinclair/typebox';
import type { Address, Hex } from 'viem';
import { decode, sameAddress, T } from '../schema.js';

const ZERO_11_BYTES = '00'.repeat(11);

/**
 * ovm.expectedWithdrawalCredentials (`pure`): the credentials that point a
 * validator at `ovm`: `prefix ‖ 11 zero bytes ‖ ovm`, lowercase.
 * PAYLOAD_INVALID for a malformed address or a prefix other than 0x01 / 0x02.
 */
export const expectedWithdrawalCredentials = (
  ovm: Address,
  prefix: '0x01' | '0x02',
): Hex => {
  const address = decode(T.Address, ovm, 'ovm');
  decode(
    Type.Union([Type.Literal('0x01'), Type.Literal('0x02')]),
    prefix,
    'prefix',
  );
  return `${prefix}${ZERO_11_BYTES}${address.slice(2).toLowerCase()}` as Hex;
};

/** The credentials' prefix byte, lowercase (`0x00`, `0x01`, `0x02`, ...). */
export const credentialsPrefix = (credentials: Hex): string =>
  credentials.slice(0, 4).toLowerCase();

/**
 * Whether `credentials` are `0x01` / `0x02` credentials of `address`
 * (prefix, 11 zero bytes, then the address).
 */
export const credentialsPointAt = (
  credentials: Hex,
  address: Address,
): boolean => {
  const prefix = credentialsPrefix(credentials);
  return (
    (prefix === '0x01' || prefix === '0x02') &&
    credentials.slice(4, 26) === ZERO_11_BYTES &&
    sameAddress(`0x${credentials.slice(26)}`, address)
  );
};

/** The address part (last 20 bytes) of credentials, lowercase. */
export const credentialsAddress = (credentials: Hex): string =>
  `0x${credentials.slice(26).toLowerCase()}`;
