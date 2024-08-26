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
