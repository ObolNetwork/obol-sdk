export const OWRFactoryContract = {
  abi: [
    {
      inputs: [
        {
          internalType: 'string',
          name: '_ensName',
          type: 'string',
        },
        {
          internalType: 'address',
          name: '_ensReverseRegistrar',
          type: 'address',
        },
        {
          internalType: 'address',
          name: '_ensOwner',
          type: 'address',
        },
      ],
      stateMutability: 'nonpayable',
      type: 'constructor',
    },
    {
      inputs: [],
      name: 'Invalid__Recipients',
      type: 'error',
    },
    {
      inputs: [
        {
          internalType: 'uint256',
          name: 'threshold',
          type: 'uint256',
        },
      ],
      name: 'Invalid__ThresholdTooLarge',
      type: 'error',
    },
    {
      inputs: [],
      name: 'Invalid__ZeroThreshold',
      type: 'error',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: true,
          internalType: 'address',
          name: 'owr',
          type: 'address',
        },
        {
          indexed: false,
          internalType: 'address',
          name: 'recoveryAddress',
          type: 'address',
        },
        {
          indexed: false,
          internalType: 'address',
          name: 'principalRecipient',
          type: 'address',
        },
        {
          indexed: false,
          internalType: 'address',
          name: 'rewardRecipient',
          type: 'address',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'threshold',
          type: 'uint256',
        },
      ],
      name: 'CreateOWRecipient',
      type: 'event',
    },
    {
      inputs: [
        {
          internalType: 'address',
          name: 'recoveryAddress',
          type: 'address',
        },
        {
          internalType: 'address',
          name: 'principalRecipient',
          type: 'address',
        },
        {
          internalType: 'address',
          name: 'rewardRecipient',
          type: 'address',
        },
        {
          internalType: 'uint256',
          name: 'amountOfPrincipalStake',
          type: 'uint256',
        },
      ],
      name: 'createOWRecipient',
      outputs: [
        {
          internalType: 'contract OptimisticWithdrawalRecipient',
          name: 'owr',
          type: 'address',
        },
      ],
      stateMutability: 'nonpayable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'owrImpl',
      outputs: [
        {
          internalType: 'contract OptimisticWithdrawalRecipient',
          name: '',
          type: 'address',
        },
      ],
      stateMutability: 'view',
      type: 'function',
    },
  ],
};

export const OWRContract = {
  abi: [
    { inputs: [], stateMutability: 'nonpayable', type: 'constructor' },
    { inputs: [], name: 'InvalidDistribution_TooLarge', type: 'error' },
    {
      inputs: [],
      name: 'InvalidTokenRecovery_InvalidRecipient',
      type: 'error',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'uint256',
          name: 'principalPayout',
          type: 'uint256',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'rewardPayout',
          type: 'uint256',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'pullFlowFlag',
          type: 'uint256',
        },
      ],
      name: 'DistributeFunds',
      type: 'event',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'uint256',
          name: 'amount',
          type: 'uint256',
        },
      ],
      name: 'ReceiveETH',
      type: 'event',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'address',
          name: 'recoveryAddressToken',
          type: 'address',
        },
        {
          indexed: false,
          internalType: 'address',
          name: 'recipient',
          type: 'address',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'amount',
          type: 'uint256',
        },
      ],
      name: 'RecoverNonOWRecipientFunds',
      type: 'event',
    },
    {
      anonymous: false,
      inputs: [
        {
          indexed: false,
          internalType: 'address',
          name: 'account',
          type: 'address',
        },
        {
          indexed: false,
          internalType: 'uint256',
          name: 'amount',
          type: 'uint256',
        },
      ],
      name: 'Withdrawal',
      type: 'event',
    },
    {
      inputs: [],
      name: 'claimedPrincipalFunds',
      outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
      stateMutability: 'view',
      type: 'function',
    },
    {
      inputs: [],
      name: 'distributeFunds',
      outputs: [],
      stateMutability: 'payable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'distributeFundsPull',
      outputs: [],
      stateMutability: 'payable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'fundsPendingWithdrawal',
      outputs: [{ internalType: 'uint128', name: '', type: 'uint128' }],
      stateMutability: 'view',
      type: 'function',
    },
    {
      inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
      name: 'getPullBalance',
      outputs: [{ internalType: 'uint256', name: '', type: 'uint256' }],
      stateMutability: 'view',
      type: 'function',
    },
    {
      inputs: [],
      name: 'getTranches',
      outputs: [
        {
          internalType: 'address',
          name: 'principalRecipient',
          type: 'address',
        },
        { internalType: 'address', name: 'rewardRecipient', type: 'address' },
        {
          internalType: 'uint256',
          name: 'amountOfPrincipalStake',
          type: 'uint256',
        },
      ],
      stateMutability: 'pure',
      type: 'function',
    },
    {
      inputs: [
        { internalType: 'address', name: 'nonOWRToken', type: 'address' },
        { internalType: 'address', name: 'recipient', type: 'address' },
      ],
      name: 'recoverFunds',
      outputs: [],
      stateMutability: 'payable',
      type: 'function',
    },
    {
      inputs: [],
      name: 'recoveryAddress',
      outputs: [{ internalType: 'address', name: '', type: 'address' }],
      stateMutability: 'pure',
      type: 'function',
    },
    {
      inputs: [{ internalType: 'address', name: 'account', type: 'address' }],
      name: 'withdraw',
      outputs: [],
      stateMutability: 'nonpayable',
      type: 'function',
    },
  ],
};
