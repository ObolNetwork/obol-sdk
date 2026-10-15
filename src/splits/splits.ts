import {
  formatRecipientsForSplitV2,
  predictSplitV2Address,
  isSplitV2Deployed,
  deployOVMContract,
  deployOVMAndSplitV2,
  requestWithdrawalFromOVM,
  depositOVM,
} from './splitHelpers.js';
import {
  CHAIN_CONFIGURATION,
  SPLITS_V2_SALT,
  DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
  isChainSupportedForSplitters,
} from '../constants.js';
import { SignerRequiredError, UnsupportedChainError } from '../errors.js';
import {
  ovmRewardsSplitPayloadSchema,
  ovmTotalSplitPayloadSchema,
  ovmRequestWithdrawalPayloadSchema,
  ovmDepositPayloadSchema,
} from '../schema.js';
import { validatePayload } from '../ajv.js';
import { assertSignerChain, isContractAvailable } from '../utils.js';
import {
  getWithdrawalRequestFee,
  resolveWithdrawalFee,
} from '../withdrawalFee.js';
import { verifyDepositsBeforeSend } from '../deposits/depositGuard.js';
import {
  type ClusterValidator,
  type ProviderType,
  type SignerType,
  type OVMRewardsSplitPayload,
  type OVMTotalSplitPayload,
  type OVMRequestWithdrawalPayload,
  type OVMDepositPayload,
} from '../types.js';

/**
 * Deploys and manages Obol Validator Manager (OVM) and SplitV2 contracts
 * for automated reward and principal splitting among cluster participants.
 *
 * Do not instantiate directly; access via `client.splits`.
 *
 * Available methods:
 * - {@link ObolSplits.createValidatorManagerAndRewardsSplit} – rewards-only split (single principal recipient)
 * - {@link ObolSplits.createValidatorManagerAndTotalSplit} – total split (principal also split)
 * - {@link ObolSplits.requestWithdrawal} – request withdrawal from an OVM contract
 * - {@link ObolSplits.deposit} – deposit to an OVM contract
 *
 * All write methods send on-chain transactions and require a signer with ETH for gas.
 *
 * @example
 * ```typescript
 * const client = new Client({ chainId: 560048 }, signer);
 *
 * const { withdrawal_address, fee_recipient_address } =
 *   await client.splits.createValidatorManagerAndRewardsSplit({
 *     rewardSplitRecipients: [
 *       { address: "0xOp1...", percentAllocation: 50 },
 *       { address: "0xOp2...", percentAllocation: 49 },
 *     ],
 *     principalRecipient: "0xPrincipal...",
 *     OVMOwnerAddress: "0xOwner...",
 *   });
 * ```
 */
export class ObolSplits {
  private readonly signer: SignerType | undefined;
  public readonly chainId: number;
  public readonly provider: ProviderType | undefined | null;

  constructor(
    signer: SignerType | undefined,
    chainId: number,
    provider: ProviderType | undefined | null,
  ) {
    this.signer = signer;
    this.chainId = chainId;
    this.provider = provider;
  }

  /**
   * Deploys an OVM and SplitV2 contract for a **rewards-only** split scenario.
   *
   * Principal goes to a single address; only validator rewards are split among
   * the configured recipients. Automatically appends the Obol RAF recipient.
   *
   * - Sends one or more on-chain transactions (irreversible).
   * - Only supported on chains with OVM factory contracts (Mainnet, Hoodi).
   *
   * @param payload - Configuration for the OVM and SplitV2 deployment.
   * @returns The OVM address as `withdrawal_address` and splitter as `fee_recipient_address`.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {UnsupportedChainError} If the chain does not support splitters.
   *
   * @example
   * ```typescript
   * const { withdrawal_address, fee_recipient_address } =
   *   await client.splits.createValidatorManagerAndRewardsSplit({
   *     rewardSplitRecipients: [
   *       { address: "0xOp1...", percentAllocation: 50 },
   *       { address: "0xOp2...", percentAllocation: 49 },
   *     ],
   *     principalRecipient: "0xPrincipal...",
   *     OVMOwnerAddress: "0xOwner...",
   *   });
   * ```
   */
  async createValidatorManagerAndRewardsSplit(
    payload: OVMRewardsSplitPayload,
  ): Promise<ClusterValidator> {
    const salt = SPLITS_V2_SALT;
    if (!this.signer) {
      throw new SignerRequiredError('createValidatorManagerAndRewardsSplit');
    }

    const validatedPayload = validatePayload<Required<OVMRewardsSplitPayload>>(
      payload,
      ovmRewardsSplitPayloadSchema,
    );

    if (!isChainSupportedForSplitters(this.chainId)) {
      throw new UnsupportedChainError(
        this.chainId,
        'createValidatorManagerAndRewardsSplit',
      );
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.OVM_FACTORY_CONTRACT) {
      throw new UnsupportedChainError(
        this.chainId,
        'createValidatorManagerAndRewardsSplit',
      );
    }

    await assertSignerChain(
      this.signer,
      this.chainId,
      'createValidatorManagerAndRewardsSplit',
    );

    if (!this.provider) {
      throw new Error(
        'Provider is required to check OVM factory contract availability',
      );
    }
    const ovmFactoryConfig = chainConfig.OVM_FACTORY_CONTRACT;
    const splitV2FactoryConfig = chainConfig.SPLIT_V2_FACTORY_CONTRACT;
    const multiCall3Config = chainConfig.MULTICALL3_CONTRACT;

    if (
      !ovmFactoryConfig?.address ||
      !ovmFactoryConfig?.bytecode ||
      !splitV2FactoryConfig?.address ||
      !splitV2FactoryConfig?.bytecode ||
      !multiCall3Config?.address ||
      !multiCall3Config?.bytecode
    ) {
      throw new UnsupportedChainError(
        this.chainId,
        'createValidatorManagerAndRewardsSplit',
      );
    }

    const checkOVMFactoryContract = await isContractAvailable(
      ovmFactoryConfig.address,
      this.provider,
      ovmFactoryConfig.bytecode,
    );

    const checkSplitV2FactoryContract = await isContractAvailable(
      splitV2FactoryConfig.address,
      this.provider,
      splitV2FactoryConfig.bytecode,
    );

    const checkMultiCall3Contract = await isContractAvailable(
      multiCall3Config.address,
      this.provider,
      multiCall3Config.bytecode,
    );

    if (
      !checkOVMFactoryContract ||
      !checkSplitV2FactoryContract ||
      !checkMultiCall3Contract
    ) {
      throw new Error(
        `Required factory contracts are not available on chain ${this.chainId}`,
      );
    }

    const retroActiveFundingRecipient = {
      address: chainConfig.RETROACTIVE_FUNDING_CONTRACT.address,
      percentAllocation: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    };

    const copiedRewardsSplitRecipients = [
      ...validatedPayload.rewardSplitRecipients,
    ];
    copiedRewardsSplitRecipients.push(retroActiveFundingRecipient);

    // Format recipients for SplitV2
    const rewardRecipients = formatRecipientsForSplitV2(
      copiedRewardsSplitRecipients,
    );

    const predictedSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
      provider: this.provider,
    });

    const isRewardSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
      provider: this.provider,
    });

    if (isRewardSplitterDeployed) {
      const ovmAddress = await deployOVMContract({
        OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
        principalRecipient: validatedPayload.principalRecipient,
        rewardRecipient: predictedSplitAddress,
        principalThreshold: validatedPayload.principalThreshold,
        signer: this.signer,
        chainId: this.chainId,
        provider: this.provider,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedSplitAddress,
      };
    } else {
      const ovmAddress = await deployOVMAndSplitV2({
        ovmArgs: {
          OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
          rewardRecipient: predictedSplitAddress,
          principalRecipient: validatedPayload.principalRecipient,
          principalThreshold: validatedPayload.principalThreshold,
        },
        rewardRecipients,
        isRewardsSplitterDeployed: isRewardSplitterDeployed,
        distributorFeePercent: validatedPayload.distributorFeePercent,
        salt,
        signer: this.signer,
        chainId: this.chainId,
        splitOwnerAddress: validatedPayload.splitOwnerAddress,
        provider: this.provider,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedSplitAddress,
      };
    }
  }

  /**
   * Deploys an OVM and SplitV2 contract for a **total split** scenario.
   *
   * Both principal and rewards are split among recipients via separate SplitV2
   * contracts. Automatically appends the Obol RAF recipient to rewards.
   *
   * - Sends one or more on-chain transactions (irreversible).
   * - Only supported on chains with OVM factory contracts (Mainnet, Hoodi).
   *
   * @param payload - Configuration for the OVM and SplitV2 deployment.
   * @returns The OVM address as `withdrawal_address` and rewards splitter as `fee_recipient_address`.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {UnsupportedChainError} If the chain does not support splitters.
   *
   * @example
   * ```typescript
   * const { withdrawal_address, fee_recipient_address } =
   *   await client.splits.createValidatorManagerAndTotalSplit({
   *     rewardSplitRecipients: [
   *       { address: "0xOp1...", percentAllocation: 50 },
   *       { address: "0xOp2...", percentAllocation: 49 },
   *     ],
   *     principalSplitRecipients: [
   *       { address: "0xOp1...", percentAllocation: 50 },
   *       { address: "0xOp2...", percentAllocation: 50 },
   *     ],
   *     OVMOwnerAddress: "0xOwner...",
   *   });
   * ```
   */
  async createValidatorManagerAndTotalSplit(
    payload: OVMTotalSplitPayload,
  ): Promise<ClusterValidator> {
    const salt = SPLITS_V2_SALT;
    if (!this.signer) {
      throw new SignerRequiredError('createValidatorManagerAndTotalSplit');
    }

    const validatedPayload = validatePayload<Required<OVMTotalSplitPayload>>(
      payload,
      ovmTotalSplitPayloadSchema,
    );

    if (!isChainSupportedForSplitters(this.chainId)) {
      throw new UnsupportedChainError(
        this.chainId,
        'createValidatorManagerAndTotalSplit',
      );
    }

    const chainConfig = CHAIN_CONFIGURATION[this.chainId];
    if (!chainConfig?.OVM_FACTORY_CONTRACT) {
      throw new UnsupportedChainError(
        this.chainId,
        'createValidatorManagerAndTotalSplit',
      );
    }

    await assertSignerChain(
      this.signer,
      this.chainId,
      'createValidatorManagerAndTotalSplit',
    );

    if (!this.provider) {
      throw new Error(
        'Provider is required to check OVM factory contract availability',
      );
    }

    const ovmFactoryConfig = chainConfig.OVM_FACTORY_CONTRACT;
    const splitV2FactoryConfig = chainConfig.SPLIT_V2_FACTORY_CONTRACT;
    const multiCall3Config = chainConfig.MULTICALL3_CONTRACT;

    if (
      !ovmFactoryConfig?.address ||
      !ovmFactoryConfig?.bytecode ||
      !splitV2FactoryConfig?.address ||
      !splitV2FactoryConfig?.bytecode ||
      !multiCall3Config?.address ||
      !multiCall3Config?.bytecode
    ) {
      throw new UnsupportedChainError(
        this.chainId,
        'createValidatorManagerAndTotalSplit',
      );
    }

    const checkOVMFactoryContract = await isContractAvailable(
      ovmFactoryConfig.address,
      this.provider,
      ovmFactoryConfig.bytecode,
    );

    const checkSplitV2FactoryContract = await isContractAvailable(
      splitV2FactoryConfig.address,
      this.provider,
      splitV2FactoryConfig.bytecode,
    );

    const checkMultiCall3Contract = await isContractAvailable(
      multiCall3Config.address,
      this.provider,
      multiCall3Config.bytecode,
    );

    if (
      !checkOVMFactoryContract ||
      !checkSplitV2FactoryContract ||
      !checkMultiCall3Contract
    ) {
      throw new Error(
        `Required factory contracts are not available on chain ${this.chainId}`,
      );
    }

    const retroActiveFundingRecipient = {
      address: chainConfig.RETROACTIVE_FUNDING_CONTRACT.address,
      percentAllocation: DEFAULT_RETROACTIVE_FUNDING_REWARDS_ONLY_SPLIT,
    };

    const copiedRewardsSplitRecipients = [
      ...validatedPayload.rewardSplitRecipients,
    ];
    copiedRewardsSplitRecipients.push(retroActiveFundingRecipient);

    const rewardsRecipients = formatRecipientsForSplitV2(
      copiedRewardsSplitRecipients,
    );

    const principalSplitRecipients = formatRecipientsForSplitV2(
      validatedPayload.principalSplitRecipients,
    );

    const predictedRewardsSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardsRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
      provider: this.provider,
    });

    const predictedPrincipalSplitAddress = await predictSplitV2Address({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: principalSplitRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
      provider: this.provider,
    });

    const isRewardsSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: rewardsRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
      provider: this.provider,
    });

    const isPrincipalSplitterDeployed = await isSplitV2Deployed({
      splitOwnerAddress: validatedPayload.splitOwnerAddress,
      recipients: principalSplitRecipients,
      distributorFeePercent: validatedPayload.distributorFeePercent,
      salt,
      signer: this.signer,
      chainId: this.chainId,
      provider: this.provider,
    });

    if (isRewardsSplitterDeployed && isPrincipalSplitterDeployed) {
      const ovmAddress = await deployOVMContract({
        OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
        principalRecipient: predictedPrincipalSplitAddress,
        rewardRecipient: predictedRewardsSplitAddress,
        principalThreshold: validatedPayload.principalThreshold,
        signer: this.signer,
        chainId: this.chainId,
        provider: this.provider,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedRewardsSplitAddress,
      };
    } else {
      // Use multicall3 to deploy any contracts that aren't deployed
      const ovmAddress = await deployOVMAndSplitV2({
        ovmArgs: {
          OVMOwnerAddress: validatedPayload.OVMOwnerAddress,
          rewardRecipient: predictedRewardsSplitAddress,
          principalRecipient: predictedPrincipalSplitAddress,
          principalThreshold: validatedPayload.principalThreshold,
        },
        rewardRecipients: rewardsRecipients,
        distributorFeePercent: validatedPayload.distributorFeePercent,
        salt,
        signer: this.signer,
        chainId: this.chainId,
        principalSplitRecipients,
        isPrincipalSplitDeployed: isPrincipalSplitterDeployed,
        splitOwnerAddress: validatedPayload.splitOwnerAddress,
        provider: this.provider,
      });

      return {
        withdrawal_address: ovmAddress,
        fee_recipient_address: predictedRewardsSplitAddress,
      };
    }
  }

  /**
   * Requests withdrawal of validator funds from an OVM contract.
   *
   * Sends an on-chain transaction to the OVM contract requesting withdrawal
   * for the specified validator public keys and amounts.
   *
   * The fee is checked against the current fee read from the EIP-7002
   * withdrawal request contract (using the client provider, or the signer's
   * provider). If `withdrawalFees` is omitted, twice the current fee per
   * request is sent. If it is given, it must cover the current fee and be at
   * most max(10x the current fee, 1 gwei) per request.
   *
   * @param payload - Withdrawal request data including OVM address, validator
   *   public keys, amounts, and optional total fees.
   * @returns The transaction hash of the withdrawal request.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws If no provider is available or `withdrawalFees` is out of range.
   *
   * @example
   * ```typescript
   * const { txHash } = await client.splits.requestWithdrawal({
   *   ovmAddress: "0xOVM...",
   *   pubKeys: ["0xValidatorPubkey..."],
   *   amounts: ["32000000000"],
   * });
   * ```
   */
  async requestWithdrawal(
    payload: OVMRequestWithdrawalPayload,
  ): Promise<{ txHash: string }> {
    if (!this.signer) {
      throw new SignerRequiredError('requestWithdrawal');
    }
    // [TBD] need to move ovm verification to sdk method and use it here
    const validatedPayload = validatePayload<OVMRequestWithdrawalPayload>(
      payload,
      ovmRequestWithdrawalPayloadSchema,
    );

    await assertSignerChain(this.signer, this.chainId, 'requestWithdrawal');

    const provider = this.provider ?? this.signer.provider;
    if (!provider) {
      throw new Error('Provider is required in requestWithdrawal');
    }
    const currentFee = await getWithdrawalRequestFee(provider);
    const withdrawalFees = resolveWithdrawalFee({
      currentFee,
      requestedFee: validatedPayload.withdrawalFees,
      requestCount: validatedPayload.pubKeys.length,
    });

    return await requestWithdrawalFromOVM({
      ovmAddress: validatedPayload.ovmAddress,
      pubKeys: validatedPayload.pubKeys,
      amounts: validatedPayload.amounts,
      withdrawalFees: withdrawalFees.toString(),
      signer: this.signer,
    });
  }

  /**
   * Deposits validators to an OVM contract. Each deposit is sent as a separate
   * on-chain transaction.
   *
   * Before sending, each deposit is checked: withdrawal credentials are 0x01
   * or 0x02 credentials for `ovmAddress`, `amount` (wei) is a whole number of
   * gwei between 1 ETH and 32 ETH (2048 ETH for 0x02 credentials),
   * `deposit_data_root` matches the deposit fields, and the BLS signature is
   * valid for this chain. Set `skipSignatureVerification` only for top-ups to
   * a validator that already exists on the beacon chain.
   *
   * If `beaconUrl` is given, the deposits are first checked against that
   * beacon node (see {@link checkExistingDeposits}): pubkeys with a pending
   * deposit to different withdrawal credentials are refused. For top-ups to
   * existing validators the signature is not checked and the withdrawal
   * credentials may be all zero instead of the expected ones.
   * The output of {@link Client.getDepositData} can be passed as `deposits`.
   *
   * @param payload - Deposit data including the OVM address and an array of
   *   validator deposit objects (pubkey, withdrawal_credentials, signature,
   *   deposit_data_root, amount).
   * @returns An array of transaction hashes, one per deposit.
   * @throws {SignerRequiredError} If no signer was provided.
   * @throws {ChainMismatchError} If the signer is connected to a different chain.
   * @throws {DepositConflictError} If `beaconUrl` is given and a pubkey has a
   *   pending deposit with different withdrawal credentials.
   * @throws If any deposit fails the checks above, or the beacon node check fails.
   *
   * @example
   * ```typescript
   * const { txHashes } = await client.splits.deposit({
   *   ovmAddress: "0xOVM...",
   *   deposits: [{
   *     pubkey: "0x...",
   *     withdrawal_credentials: "0x...",
   *     signature: "0x...",
   *     deposit_data_root: "0x...",
   *     amount: "32000000000000000000",
   *   }],
   * });
   * ```
   */
  async deposit(payload: OVMDepositPayload): Promise<{ txHashes: string[] }> {
    if (!this.signer) {
      throw new SignerRequiredError('deposit');
    }

    const validatedPayload = validatePayload<OVMDepositPayload>(
      payload,
      ovmDepositPayloadSchema,
    );

    await assertSignerChain(this.signer, this.chainId, 'deposit');

    await verifyDepositsBeforeSend(validatedPayload.deposits, {
      chainId: this.chainId,
      expectedWithdrawalAddress: validatedPayload.ovmAddress,
      skipSignatureVerification: validatedPayload.skipSignatureVerification,
      beaconUrl: validatedPayload.beaconUrl,
    });

    return await depositOVM({
      ovmAddress: validatedPayload.ovmAddress,
      deposits: validatedPayload.deposits,
      signer: this.signer,
    });
  }
}
