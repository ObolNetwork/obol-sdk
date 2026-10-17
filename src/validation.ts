import { InvalidArgumentError } from './errors.js';

const ADDRESS_REGEX = /^0x[0-9a-fA-F]{40}$/;
const HASH_32_REGEX = /^0x[0-9a-fA-F]{64}$/;

/**
 * Throws if `value` is not a 0x-prefixed 32-byte hex string (e.g. a
 * config_hash or lock_hash). Used before putting the value in a URL path.
 */
export const assertHash32 = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !HASH_32_REGEX.test(value)) {
    throw new InvalidArgumentError(
      `Invalid ${name}: expected a 0x-prefixed 32-byte hex string`,
      name,
    );
  }
  return value;
};

/**
 * Throws if `value` is not a 0x-prefixed 20-byte hex address. Used before
 * putting the value in a URL path.
 */
export const assertAddress = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !ADDRESS_REGEX.test(value)) {
    throw new InvalidArgumentError(
      `Invalid ${name}: expected a 0x-prefixed 20-byte address`,
      name,
    );
  }
  return value;
};
