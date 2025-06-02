import {
  computeDomain,
  signingRoot,
  GENESIS_VALIDATOR_ROOT_HEX_STRING,
} from '../../src/exits/verificationHelpers';
import { CAPELLA_FORK_MAPPING } from '../../src/constants'; // Assuming this contains fork versions
import { fromHexString } from '@chainsafe/ssz';

// Mock data similar to what's used in obol-api tests or common scenarios
const DOMAIN_VOLUNTARY_EXIT_HEX = '0x04000000';
const MAINNET_BASE_FORK_VERSION = '0x00000000';
const MAINNET_CAPELLA_FORK_VERSION =
  CAPELLA_FORK_MAPPING[MAINNET_BASE_FORK_VERSION]; // '0x03000000'

// Sample SSZ Object Root (32 bytes, replace with a realistic one if available from other tests)
const MOCK_SSZ_OBJECT_ROOT_HEX =
  '0x1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef';

describe('verificationHelpers', () => {
  describe('computeDomain', () => {
    it('should compute a domain with default genesis root', () => {
      const domainType = fromHexString(DOMAIN_VOLUNTARY_EXIT_HEX.substring(2));
      const domain = computeDomain(domainType, MAINNET_CAPELLA_FORK_VERSION);
      expect(domain).toBeInstanceOf(Uint8Array);
      expect(domain.length).toBe(32);
      // Add more specific expectation if a known domain value exists for these inputs
    });

    it('should compute a domain with a custom genesis root', () => {
      const domainType = fromHexString(DOMAIN_VOLUNTARY_EXIT_HEX.substring(2));
      const customGenesisRoot = fromHexString(
        MOCK_SSZ_OBJECT_ROOT_HEX.substring(2),
      ); // Using a mock root
      const domain = computeDomain(
        domainType,
        MAINNET_CAPELLA_FORK_VERSION,
        customGenesisRoot,
      );
      expect(domain).toBeInstanceOf(Uint8Array);
      expect(domain.length).toBe(32);
      // Add more specific expectation if a known domain value exists
    });

    it('should use GENESIS_VALIDATOR_ROOT_HEX_STRING when override is undefined', () => {
      const domainType = fromHexString(DOMAIN_VOLUNTARY_EXIT_HEX.substring(2));
      const domain1 = computeDomain(domainType, MAINNET_CAPELLA_FORK_VERSION);
      const domain2 = computeDomain(
        domainType,
        MAINNET_CAPELLA_FORK_VERSION,
        fromHexString(GENESIS_VALIDATOR_ROOT_HEX_STRING.substring(2)),
      );
      expect(domain1).toEqual(domain2);
    });

    it('should handle fork versions with or without 0x prefix', () => {
      const domainType = fromHexString(DOMAIN_VOLUNTARY_EXIT_HEX.substring(2));
      const domainWithPrefix = computeDomain(
        domainType,
        MAINNET_CAPELLA_FORK_VERSION,
      );
      const domainWithoutPrefix = computeDomain(
        domainType,
        MAINNET_CAPELLA_FORK_VERSION.substring(2),
      );
      expect(domainWithPrefix).toEqual(domainWithoutPrefix);
    });

    it('should throw an error for invalid fork version hex string (e.g. too short)', () => {
      const domainType = fromHexString(DOMAIN_VOLUNTARY_EXIT_HEX.substring(2));
      // Example of an invalid (too short) fork version string
      const invalidForkVersion = '0x0300';
      expect(() => computeDomain(domainType, invalidForkVersion)).toThrow();
    });

    it('should throw an error for invalid domainType (e.g. not 4 bytes)', () => {
      const invalidDomainType = fromHexString('010203'); // 3 bytes
      expect(() =>
        computeDomain(invalidDomainType, MAINNET_CAPELLA_FORK_VERSION),
      ).toThrow();
    });
  });

  describe('signingRoot', () => {
    it('should compute a signing root', () => {
      const domainType = fromHexString(DOMAIN_VOLUNTARY_EXIT_HEX.substring(2));
      const domain = computeDomain(domainType, MAINNET_CAPELLA_FORK_VERSION);
      const messageBuffer = Buffer.from(
        MOCK_SSZ_OBJECT_ROOT_HEX.substring(2),
        'hex',
      );
      const root = signingRoot(domain, messageBuffer);
      expect(root).toBeInstanceOf(Uint8Array);
      expect(root.length).toBe(32);
      // Add more specific expectation if a known signing root value exists
    });

    it('should throw if domain is not 32 bytes', () => {
      const invalidDomain = new Uint8Array(31); // Not 32 bytes
      const messageBuffer = Buffer.from(
        MOCK_SSZ_OBJECT_ROOT_HEX.substring(2),
        'hex',
      );
      expect(() => signingRoot(invalidDomain, messageBuffer)).toThrow();
    });

    it('should throw if messageBuffer is not 32 bytes', () => {
      const domainType = fromHexString(DOMAIN_VOLUNTARY_EXIT_HEX.substring(2));
      const domain = computeDomain(domainType, MAINNET_CAPELLA_FORK_VERSION);
      const invalidMessageBuffer = Buffer.from('0102030405060708', 'hex'); // Not 32 bytes
      expect(() => signingRoot(domain, invalidMessageBuffer)).toThrow();
    });
  });
});
