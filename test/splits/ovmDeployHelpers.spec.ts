// @ts-nocheck
import { Interface, id, AbiCoder } from 'ethers';
import { OVMFactoryContract } from '../../src/abi/OVM';
import {
  extractOvmAddressFromReceipt,
  receiptMatchesSafeTx,
} from '../../src/splits/splitHelpers';

const OVM_ADDRESS = '0x1234567890123456789012345678901234567890';
const OWNER = '0x0c89A5ba7FcEfA6e7A67f3F3eC3e2EA9B38924bA';
const SAFE_ADDRESS = '0xAbCdEf0123456789012345678901234567890AbC';
const SAFE_TX_HASH = '0x' + 'aa'.repeat(32);
const SUCCESS_TOPIC = id('ExecutionSuccess(bytes32,uint256)');

const factoryInterface = new Interface(OVMFactoryContract.abi);

const createOvmLog = () => {
  const encoded = factoryInterface.encodeEventLog(
    'CreateObolValidatorManager',
    [OVM_ADDRESS, OWNER, OWNER, OWNER, 16n],
  );
  return { topics: encoded.topics, data: encoded.data };
};

describe('extractOvmAddressFromReceipt', () => {
  it('finds the factory event among interleaved foreign logs', () => {
    const receipt = {
      logs: [
        { topics: ['0x' + 'ab'.repeat(32)], data: '0x' }, // e.g. a Safe ExecutionSuccess
        createOvmLog(),
        { topics: ['0x' + 'cd'.repeat(32)], data: '0x01' },
      ],
    };
    expect(extractOvmAddressFromReceipt(receipt)).toBe(OVM_ADDRESS);
  });

  it('throws when the event is missing', () => {
    expect(() =>
      extractOvmAddressFromReceipt({
        logs: [{ topics: ['0x' + 'ab'.repeat(32)], data: '0x' }],
      }),
    ).toThrow('CreateObolValidatorManager event not found');
  });
});

describe('receiptMatchesSafeTx', () => {
  it('matches Safe v1.4.1 ExecutionSuccess (indexed safeTxHash)', () => {
    const receipt = {
      logs: [
        {
          address: SAFE_ADDRESS,
          topics: [SUCCESS_TOPIC, SAFE_TX_HASH],
          data: '0x',
        },
      ],
    };
    expect(receiptMatchesSafeTx(receipt, SAFE_ADDRESS, SAFE_TX_HASH)).toBe(
      true,
    );
  });

  it('matches Safe v1.3.0 ExecutionSuccess (safeTxHash in data)', () => {
    const data = AbiCoder.defaultAbiCoder().encode(
      ['bytes32', 'uint256'],
      [SAFE_TX_HASH, 0],
    );
    const receipt = {
      logs: [{ address: SAFE_ADDRESS, topics: [SUCCESS_TOPIC], data }],
    };
    expect(receiptMatchesSafeTx(receipt, SAFE_ADDRESS, SAFE_TX_HASH)).toBe(
      true,
    );
  });

  it('rejects a different safeTxHash (concurrent deployment by same owner)', () => {
    const receipt = {
      logs: [
        {
          address: SAFE_ADDRESS,
          topics: [SUCCESS_TOPIC, '0x' + 'bb'.repeat(32)],
          data: '0x',
        },
      ],
    };
    expect(receiptMatchesSafeTx(receipt, SAFE_ADDRESS, SAFE_TX_HASH)).toBe(
      false,
    );
  });

  it('rejects ExecutionSuccess emitted by a different Safe', () => {
    const receipt = {
      logs: [
        {
          address: '0x9999999999999999999999999999999999999999',
          topics: [SUCCESS_TOPIC, SAFE_TX_HASH],
          data: '0x',
        },
      ],
    };
    expect(receiptMatchesSafeTx(receipt, SAFE_ADDRESS, SAFE_TX_HASH)).toBe(
      false,
    );
  });

  it('rejects a receipt without Safe logs (third-party factory call)', () => {
    const receipt = { logs: [createOvmLog()] };
    expect(receiptMatchesSafeTx(receipt, SAFE_ADDRESS, SAFE_TX_HASH)).toBe(
      false,
    );
    expect(receiptMatchesSafeTx(null, SAFE_ADDRESS, SAFE_TX_HASH)).toBe(false);
  });
});
