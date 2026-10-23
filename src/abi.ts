/**
 * Human-readable ABIs (viem `parseAbi`) for the contracts v3 calls. Sources:
 * obol-splits `src/ovm` (ObolValidatorManager, its factory), 0xSplits v2.1
 * (PullSplit factory, SplitWalletV2, SplitsWarehouse), Multicall3, and the
 * batch deposit contract and Merkle distributor already used by 2.x.
 */
import { parseAbi, parseAbiItem } from 'viem';

export const ovmAbi = parseAbi([
  'struct ConsolidationRequest { bytes[] srcPubKeys; bytes targetPubKey; }',
  'function owner() view returns (address)',
  'function principalRecipient() view returns (address)',
  'function rewardRecipient() view returns (address)',
  'function amountOfPrincipalStake() view returns (uint256)',
  'function fundsPendingWithdrawal() view returns (uint128)',
  'function principalThreshold() view returns (uint64)',
  'function version() view returns (string)',
  'function getPullBalance(address account) view returns (uint256)',
  'function rolesOf(address user) view returns (uint256)',
  'function ownershipHandoverExpiresAt(address pendingOwner) view returns (uint256)',
  'function deposit(bytes pubkey, bytes withdrawal_credentials, bytes signature, bytes32 deposit_data_root) payable',
  'function withdraw(bytes[] pubKeys, uint64[] amounts, uint256 maxFeePerWithdrawal, address excessFeeRecipient) payable',
  'function consolidate(ConsolidationRequest[] requests, uint256 maxFeePerConsolidation, address excessFeeRecipient) payable',
  'function distributeFunds()',
  'function distributeFundsPull()',
  'function grantRoles(address user, uint256 roles) payable',
  'function revokeRoles(address user, uint256 roles) payable',
  'function renounceRoles(uint256 roles) payable',
  'function requestOwnershipHandover() payable',
  'function cancelOwnershipHandover() payable',
  'function completeOwnershipHandover(address pendingOwner) payable',
  'function transfer(address newBeneficiary, address newOwner)',
  'function setBeneficiary(address newBeneficiary)',
  'function setRewardRecipient(address newRewardRecipient)',
  'function setAmountOfPrincipalStake(uint256 newAmount)',
  'function sweep(address beneficiary, uint256 amount)',
  'function withdrawPullBalance(address account)',
  'function recoverFunds(address nonOVMToken, address recipient)',
  'event RolesUpdated(address indexed user, uint256 indexed roles)',
  'event DistributeFunds(uint256 principalPayout, uint256 rewardPayout, uint256 pullOrPush)',
  'event BeneficiaryUpdated(address indexed newBeneficiary)',
  'event RewardRecipientUpdated(address indexed newRewardRecipient)',
  'event PrincipalStakeAmountUpdated(uint256 newPrincipalStakeAmount, uint256 oldPrincipalStakeAmount)',
  'event Swept(address indexed beneficiary, uint256 indexed amount)',
  'event RecoverNonOVMFunds(address indexed nonOVMToken, address indexed recipient, uint256 amount)',
  'event PullBalanceWithdrawn(address indexed account, uint256 amount)',
  'event ConsolidationRequested(bytes srcPubKey, bytes targetPubKey, uint256 indexed fee)',
  'event WithdrawalRequested(bytes pubKey, uint64 indexed amount, uint256 indexed fee)',
  'event UnsentExcessFee(address indexed excessFeeRecipient, uint256 indexed excessFee)',
  'event Transferred(address indexed newBeneficiary, address indexed newOwner)',
  // solady Ownable / OwnableRoles
  'event OwnershipTransferred(address indexed oldOwner, address indexed newOwner)',
  'event OwnershipHandoverRequested(address indexed pendingOwner)',
  'event OwnershipHandoverCanceled(address indexed pendingOwner)',
  'error InvalidRequest_Params()',
  'error InvalidRequest_SystemGetFee()',
  'error InvalidRequest_NotEnoughFee()',
  'error InvalidConsolidation_Failed()',
  'error InvalidWithdrawal_Failed()',
  'error InvalidDistribution_TooLarge()',
  'error Unauthorized()',
  'error NewOwnerIsZeroAddress()',
  'error NoHandoverRequest()',
  'error AlreadyInitialized()',
  // solady SafeTransferLib
  'error ETHTransferFailed()',
  'error TransferFailed()',
]);

export const ovmFactoryAbi = parseAbi([
  'function createObolValidatorManager(address owner, address beneficiary, address rewardRecipient, uint64 principalThreshold) returns (address ovm)',
  'event CreateObolValidatorManager(address indexed ovm, address indexed owner, address beneficiary, address rewardRecipient, uint64 principalThreshold)',
  'error Invalid_Owner()',
  'error Invalid__Recipients()',
  'error Invalid__ZeroThreshold()',
  'error Invalid__ThresholdTooLarge()',
]);

export const createOvmEvent = parseAbiItem(
  'event CreateObolValidatorManager(address indexed ovm, address indexed owner, address beneficiary, address rewardRecipient, uint64 principalThreshold)',
);

export const rolesUpdatedEvent = parseAbiItem(
  'event RolesUpdated(address indexed user, uint256 indexed roles)',
);

const SPLIT =
  '(address[] recipients, uint256[] allocations, uint256 totalAllocation, uint16 distributionIncentive)';

export const pullSplitFactoryAbi = parseAbi([
  `function createSplitDeterministic(${SPLIT} _splitParams, address _owner, address _creator, bytes32 _salt) returns (address split)`,
  `function predictDeterministicAddress(${SPLIT} _splitParams, address _owner, bytes32 _salt) view returns (address)`,
  `function isDeployed(${SPLIT} _splitParams, address _owner, bytes32 _salt) view returns (address split, bool exists)`,
  `event SplitCreated(address indexed split, ${SPLIT} splitParams, address owner, address creator, bytes32 salt)`,
  `event SplitCreated(address indexed split, ${SPLIT} splitParams, address owner, address creator)`,
  `event SplitCreated(address indexed split, ${SPLIT} splitParams, address owner, address creator, uint256 nonce)`,
  'error DeploymentFailed()',
  'error InvalidSplit_TotalAllocationMismatch()',
  'error InvalidSplit_LengthMismatch()',
]);

export const splitCreatedEvents = [
  parseAbiItem(
    `event SplitCreated(address indexed split, ${SPLIT} splitParams, address owner, address creator, bytes32 salt)`,
  ),
  parseAbiItem(
    `event SplitCreated(address indexed split, ${SPLIT} splitParams, address owner, address creator)`,
  ),
] as const;

export const splitUpdatedEvent = parseAbiItem(
  `event SplitUpdated(${SPLIT} _split)`,
);

export const splitWalletAbi = parseAbi([
  'function splitHash() view returns (bytes32)',
  'function paused() view returns (bool)',
  'function owner() view returns (address)',
  'function getSplitBalance(address _token) view returns (uint256 splitBalance, uint256 warehouseBalance)',
  `function distribute(${SPLIT} _split, address _token, address _distributor)`,
  `event SplitUpdated(${SPLIT} _split)`,
  'event SplitDistributed(address indexed token, address indexed distributor, uint256 amount)',
  'event SetPaused(bool paused)',
  // emitted by the split's minimal proxy when it receives ETH without calldata
  'event ReceiveETH(uint256 amount)',
  'event OwnershipTransferred(address indexed oldOwner, address indexed newOwner)',
  'error InvalidSplit()',
  'error UnauthorizedInitializer()',
  'error Paused()',
  'error Unauthorized()',
  'error InvalidSplit_TotalAllocationMismatch()',
  'error InvalidSplit_LengthMismatch()',
]);

export const warehouseAbi = parseAbi([
  'function balanceOf(address owner, uint256 id) view returns (uint256)',
  'function withdrawConfig(address owner) view returns (uint16 incentive, bool paused)',
  'function withdraw(address _owner, address _token)',
  'event Withdraw(address indexed owner, address indexed token, address indexed withdrawer, uint256 amount, uint256 reward)',
  // ERC6909: mint (sender 0), burn (receiver 0) and transfers of Warehouse balances
  'event Transfer(address caller, address indexed sender, address indexed receiver, uint256 indexed id, uint256 amount)',
  'event WithdrawConfigUpdated(address indexed owner, (uint16 incentive, bool paused) config)',
  'error InvalidAmount()',
  'error LengthMismatch()',
  'error WithdrawalPaused(address owner)',
  'error Overflow()',
]);

/** 0xSplits native token marker. */
export const NATIVE_TOKEN =
  '0xEeeeeEeeeEeEeeEeEeEeeEEEeeeeEeeeeeeeEEeE' as const;

export const splitMainAbi = parseAbi([
  'function getETHBalance(address account) view returns (uint256)',
  'function withdraw(address account, uint256 withdrawETH, address[] tokens)',
  'event Withdrawal(address indexed account, uint256 ethAmount, address[] tokens, uint256[] tokenAmounts)',
]);

export const multicall3Abi = parseAbi([
  'struct Call3 { address target; bool allowFailure; bytes callData; }',
  'struct Result { bool success; bytes returnData; }',
  'function aggregate3(Call3[] calls) payable returns (Result[] returnData)',
  'function getEthBalance(address addr) view returns (uint256 balance)',
  'function getBlockNumber() view returns (uint256 blockNumber)',
]);

export const batchDepositAbi = parseAbi([
  'struct Deposit { bytes pubKey; bytes withdrawalCredentials; bytes signature; uint256 amount; }',
  'function batchDeposit(Deposit[] _deposits) payable',
]);

/** The beacon chain deposit contract (same address on mainnet and Hoodi). */
export const DEPOSIT_CONTRACT =
  '0x00000000219ab540356cBB839Cbe05303d7705Fa' as const;

export const depositContractAbi = parseAbi([
  'event DepositEvent(bytes pubkey, bytes withdrawal_credentials, bytes amount, bytes signature, bytes index)',
]);

/** ERC-20 transfers (OBOL incentive claims, recovered tokens). */
export const erc20TransferEvent = parseAbiItem(
  'event Transfer(address indexed from, address indexed to, uint256 value)',
);

export const owrAbi = parseAbi([
  'function getTranches() view returns (address principalRecipient, address rewardRecipient, uint256 amountOfPrincipalStake)',
]);
