// @ts-nocheck
import { Interface, id, AbiCoder } from 'ethers';
import { OVMFactoryContract } from '../../src/abi/OVM';
import { splitMainEthereumAbi } from '../../src/abi/SplitMain';
import {
  extractOvmAddressFromReceipt,
  extractSplitAddressFromReceipt,
  predictSplitterAddress,
  receiptMatchesSafeTx,
  resolveOvmAddressFromListenerArgs,
} from '../../src/splits/splitHelpers';
import { CHAIN_CONFIGURATION } from '../../src/constants';
import { TEST_ADDRESSES } from '../fixtures';

const OVM_ADDRESS = '0x1234567890123456789012345678901234567890';
const OWNER = '0x0c89A5ba7FcEfA6e7A67f3F3eC3e2EA9B38924bA';
const SAFE_ADDRESS = '0xAbCdEf0123456789012345678901234567890AbC';
const SAFE_TX_HASH = '0x' + 'aa'.repeat(32);
const SUCCESS_TOPIC = id('ExecutionSuccess(bytes32,uint256)');

const factoryInterface = new Interface(OVMFactoryContract.abi);
// Hoodi OVM factory
const FACTORY_ADDRESS =
  CHAIN_CONFIGURATION[560048].OVM_FACTORY_CONTRACT.address;

const createOvmLog = (ovm = OVM_ADDRESS, address = FACTORY_ADDRESS) => {
  const encoded = factoryInterface.encodeEventLog(
    'CreateObolValidatorManager',
    [ovm, OWNER, OWNER, OWNER, 16n],
  );
  return { address, topics: encoded.topics, data: encoded.data };
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
    expect(extractOvmAddressFromReceipt(receipt, FACTORY_ADDRESS)).toBe(
      OVM_ADDRESS,
    );
  });

  it('ignores a matching event emitted by another contract', () => {
    const decoyOvm = TEST_ADDRESSES.REWARD_RECIPIENT_2;
    const receipt = {
      logs: [
        createOvmLog(decoyOvm, TEST_ADDRESSES.SPLIT_OWNER),
        createOvmLog(),
      ],
    };
    expect(extractOvmAddressFromReceipt(receipt, FACTORY_ADDRESS)).toBe(
      OVM_ADDRESS,
    );
  });

  it('throws when the only matching event is from another contract', () => {
    const receipt = {
      logs: [createOvmLog(OVM_ADDRESS, TEST_ADDRESSES.SPLIT_OWNER)],
    };
    expect(() =>
      extractOvmAddressFromReceipt(receipt, FACTORY_ADDRESS),
    ).toThrow('CreateObolValidatorManager event not found');
  });

  it('matches the factory address case-insensitively', () => {
    const receipt = {
      logs: [createOvmLog(OVM_ADDRESS, FACTORY_ADDRESS.toLowerCase())],
    };
    expect(
      extractOvmAddressFromReceipt(
        receipt,
        FACTORY_ADDRESS.toUpperCase().replace('0X', '0x'),
      ),
    ).toBe(OVM_ADDRESS);
  });

  it('throws when the event is missing', () => {
    expect(() =>
      extractOvmAddressFromReceipt(
        {
          logs: [
            {
              address: FACTORY_ADDRESS,
              topics: ['0x' + 'ab'.repeat(32)],
              data: '0x',
            },
          ],
        },
        FACTORY_ADDRESS,
      ),
    ).toThrow('CreateObolValidatorManager event not found');
  });
});

describe('resolveOvmAddressFromListenerArgs', () => {
  const TX_HASH = '0x' + 'bb'.repeat(32);

  it('reads ovm from payload.args when deferred filter only passes payload', () => {
    // ethers deferred filters invoke the listener with ONLY ContractEventPayload
    const payload = {
      log: { transactionHash: TX_HASH },
      args: { ovm: OVM_ADDRESS, 0: OVM_ADDRESS },
    };
    expect(resolveOvmAddressFromListenerArgs([payload])).toEqual({
      ovm: OVM_ADDRESS,
      txHash: TX_HASH,
    });
  });

  it('does not stringify the payload into "[object Object]"', () => {
    const payload = {
      log: { transactionHash: TX_HASH },
      args: { ovm: OVM_ADDRESS },
    };
    const resolved = resolveOvmAddressFromListenerArgs([payload]);
    expect(resolved?.ovm).not.toBe('[object Object]');
    expect(resolved?.ovm).toBe(OVM_ADDRESS);
  });

  it('prefers a leading address string when present', () => {
    const payload = {
      log: { transactionHash: TX_HASH },
      args: { ovm: OVM_ADDRESS },
    };
    expect(
      resolveOvmAddressFromListenerArgs([OVM_ADDRESS, OWNER, payload]),
    ).toEqual({ ovm: OVM_ADDRESS, txHash: TX_HASH });
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

describe('extractSplitAddressFromReceipt', () => {
  const splitMainInterface = new Interface(splitMainEthereumAbi);
  const SPLIT_MAIN = CHAIN_CONFIGURATION[560048].SPLITMAIN_CONTRACT.address;
  const SPLIT = '0x0c89A5ba7FcEfA6e7A67f3F3eC3e2EA9B38924bA';
  const createSplitLog = (split = SPLIT, address = SPLIT_MAIN) => {
    const encoded = splitMainInterface.encodeEventLog('CreateSplit', [split]);
    return { address, topics: encoded.topics, data: encoded.data };
  };

  it('reads the split from SplitMain among other logs', () => {
    const receipt = {
      logs: [
        { address: TEST_ADDRESSES.SPLIT_OWNER, topics: [id('Other()')] },
        createSplitLog(),
      ],
    };
    expect(extractSplitAddressFromReceipt(receipt, SPLIT_MAIN)).toBe(SPLIT);
  });

  it('ignores a CreateSplit event emitted by another contract', () => {
    const receipt = {
      logs: [
        createSplitLog(
          TEST_ADDRESSES.REWARD_RECIPIENT_1,
          TEST_ADDRESSES.SPLIT_OWNER,
        ),
        createSplitLog(),
      ],
    };
    expect(extractSplitAddressFromReceipt(receipt, SPLIT_MAIN)).toBe(SPLIT);
  });

  it('throws when SplitMain emitted no CreateSplit event', () => {
    const receipt = {
      logs: [createSplitLog(SPLIT, TEST_ADDRESSES.SPLIT_OWNER)],
    };
    expect(() => extractSplitAddressFromReceipt(receipt, SPLIT_MAIN)).toThrow(
      'could not be extracted',
    );
  });
});

describe('predictSplitterAddress', () => {
  it('refuses to predict a mutable split address', async () => {
    await expect(
      predictSplitterAddress({
        signer: {},
        accounts: [TEST_ADDRESSES.REWARD_RECIPIENT_1],
        percentAllocations: [1e6],
        chainId: 560048,
        distributorFee: 0,
        controllerAddress: TEST_ADDRESSES.SPLIT_OWNER,
        provider: {},
      }),
    ).rejects.toThrow('mutable splits');
  });
});
