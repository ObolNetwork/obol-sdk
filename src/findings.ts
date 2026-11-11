/**
 * The catalogue of findings: every code a `Finding` can carry, its severity,
 * what it means and what acknowledging it accepts. `FindingCode` is the union
 * of its keys; `test/spec/findings.spec.ts` keeps it in step with
 * spec/errors.md, the README table and the codes each operation emits.
 *
 * A finding does not stop a `prepare*`. A `warning` stops `send` until its
 * code is acknowledged (spec/operations.md "send"); an `info` never does.
 */
import type { PreparedKind } from './types.js';

/** `warning`: `send` needs it acknowledged. `info`: for the record. */
export type FindingSeverity = 'warning' | 'info';

/**
 * - `unchecked`: a safety check could not run (no data source, a failed
 *   read). Nothing is known to be wrong; nothing was shown to be right.
 * - `risk`: the transaction will do something that is often not intended.
 * - `note`: information; never needs acknowledgement.
 * - `claim`: an `incentives.preflight` issue (never on a `Prepared`).
 */
export type FindingGroup = 'unchecked' | 'risk' | 'note' | 'claim';

export interface FindingInfo {
  severity: FindingSeverity;
  group: FindingGroup;
  /** What the finding means. */
  meaning: string;
  /** What the caller accepts by acknowledging it, or what to do about it. */
  guidance: string;
}

/**
 * The finding codes whose severity is `info`; every other code is a
 * `warning`. Kept apart from {@link FINDINGS} (which repeats each severity;
 * `FindingSeveritiesAgree` and test/spec/findings.spec.ts check they agree)
 * so that code which only emits findings does not carry the catalogue's
 * texts.
 */
export const INFO_FINDING_CODES = [
  'DEPOSIT_ALREADY_QUEUED',
  'WITHDRAW_AMOUNT_CAPPED',
  'ROLE_HOLDERS_UNCHECKED',
  'RECIPIENT_WITHDRAW_PAUSED',
  'RAF_LEFT_IN_WAREHOUSE',
  'SPLIT_REUSED',
  'RECIPIENT_NOT_CONTRACT',
  'SIMULATION_CONTRACT_WALLET',
] as const;

/** The severity of a finding code: one per code, wherever it is emitted. */
export const findingSeverity = (code: string): FindingSeverity =>
  (INFO_FINDING_CODES as readonly string[]).includes(code) ? 'info' : 'warning';

/**
 * Every finding code. Hover a key for its meaning; use the keys where a
 * `FindingCode` is wanted (`acknowledge: ['VALIDATOR_STATUS_UNCHECKED']`).
 */
export const FINDINGS = {
  /**
   * Deposits. No deposit status source (no Obol API route, no `beaconUrl`),
   * so the SDK could not check whether the validators already exist or with
   * which withdrawal credentials. Accepting it means you checked that
   * yourself: a deposit to a validator someone else created first is lost
   * to their withdrawal address.
   */
  DEPOSIT_EXISTENCE_UNCHECKED: {
    severity: 'warning',
    group: 'unchecked',
    meaning:
      'No deposit status source: whether the validators already exist, and with which withdrawal credentials, was not checked.',
    guidance:
      'Pass `beaconUrl` or enable the Obol API so it is checked. Acknowledge only after checking each pubkey yourself (a beacon explorer): a deposit to a validator someone else created first goes to their withdrawal address.',
  },
  /**
   * Deposits. Deposits with the same withdrawal credentials are already in
   * the beacon chain's queue for this pubkey. Normal for a deposit made in
   * parts; otherwise it may be a repeat.
   */
  DEPOSIT_ALREADY_QUEUED: {
    severity: 'info',
    group: 'note',
    meaning:
      'Deposits with the same credentials are already queued for the pubkey.',
    guidance: 'Make sure this is not a repeat of a deposit already sent.',
  },
  /**
   * Deposits. Validly signed deposits queued for a pubkey carry different
   * withdrawal credentials; the first one applies, and it is this deposit's.
   * Someone queued a deposit for your validator key with their credentials.
   */
  QUEUED_CREDENTIALS_CONFLICT: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'Validly signed deposits queued for the pubkey carry different withdrawal credentials; the first one (yours) applies.',
    guidance:
      'Find out who queued the other deposits. Acknowledge only if you accept adding ETH to a validator others have also deposited to.',
  },
  /**
   * Deposits. The validator has 0x00 / 0x01 credentials and this deposit
   * takes it above 32 ETH: the excess is not staked and is swept back to the
   * withdrawal address.
   */
  TOP_UP_ABOVE_EFFECTIVE_CAP: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'The deposit takes a 0x00 / 0x01 validator above 32 ETH; the excess is swept back to the withdrawal address, not staked.',
    guidance:
      'Deposit at most up to 32 ETH, or switch the validator to 0x02 first. Acknowledge if the round trip of the excess is acceptable.',
  },
  /**
   * Deposits. A top-up to a validator that has exited: the ETH is not staked
   * and is swept back to the withdrawal address.
   */
  TOP_UP_EXITED_VALIDATOR: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'Top-up to an exited validator: the ETH is swept back to its withdrawal address, not staked.',
    guidance:
      'Do not top up an exited validator. Acknowledging sends ETH on a round trip to the withdrawal address.',
  },
  /**
   * Deposits. A top-up to a validator whose withdrawal credentials are not
   * the expected address's (the OVM, or `expectedWithdrawalAddress`). The
   * ETH can only ever be withdrawn to those credentials: a donation.
   */
  TOP_UP_CREDENTIALS_FOREIGN: {
    severity: 'warning',
    group: 'risk',
    meaning:
      "Top-up to a validator whose withdrawal credentials are not the expected address's: the ETH can only be withdrawn to those credentials.",
    guidance:
      'Acknowledge only for a deliberate top-up of a validator you do not control. The ETH cannot be recovered.',
  },
  /**
   * Deposits via the batch contract to credentials of an Obol OVM. The OVM's
   * `amountOfPrincipalStake` is not raised, so this principal would later be
   * paid out as rewards.
   */
  OVM_STAKE_NOT_TRACKED: {
    severity: 'warning',
    group: 'risk',
    meaning:
      "Deposit to an OVM's credentials through the batch contract: the OVM does not count it as principal, so it would later be paid out as rewards.",
    guidance:
      'Deposit via the OVM instead. Acknowledge only if the owner will call `setAmountOfPrincipalStake` afterwards.',
  },
  /**
   * OVM writes and distributions. Whether the contract was created by the
   * Obol OVM factory could not be checked (RPC refused the log scan, API
   * down). (`prepareDeposit` throws instead.)
   */
  PROVENANCE_UNKNOWN: {
    severity: 'warning',
    group: 'unchecked',
    meaning:
      'Could not check that the contract was created by the Obol OVM factory.',
    guidance:
      'Retry `ovm.getProvenance`, or use an RPC that serves `eth_getLogs`. Acknowledge only if you know the contract by other means (you deployed it).',
  },
  /**
   * Withdrawals and consolidations. The beacon chain's request rules could
   * not all be checked (no status source, or it lacked a field; `details.checks`
   * names them). A request that breaks a rule is ignored and its fee kept;
   * for a consolidation the target's withdrawal address was not compared.
   */
  VALIDATOR_STATUS_UNCHECKED: {
    severity: 'warning',
    group: 'unchecked',
    meaning:
      'The beacon chain request rules could not all be checked (`details.checks`); for a consolidation the withdrawal addresses were not compared.',
    guidance:
      "Pass `beaconUrl` or enable the Obol API. Acknowledging accepts that the request may be ignored (fee lost) and, for a consolidation, that you checked the target's withdrawal address yourself.",
  },
  /**
   * Withdrawals. A partial amount above what the validator can withdraw now
   * was capped to it; the beacon chain would cap it the same way.
   */
  WITHDRAW_AMOUNT_CAPPED: {
    severity: 'info',
    group: 'note',
    meaning:
      'The partial withdrawal amount was capped to what the validator can withdraw now.',
    guidance: 'None; the preview carries the capped amount.',
  },
  /**
   * Withdrawals. The beacon chain's pending partial withdrawal queue is full:
   * a partial request sent now is ignored and its fee kept.
   */
  PARTIAL_WITHDRAWAL_QUEUE_FULL: {
    severity: 'warning',
    group: 'risk',
    meaning:
      "The beacon chain's pending partial withdrawal queue is full: the request would be ignored and the fee kept.",
    guidance:
      'Wait for the queue to drain. Acknowledging spends the fee for a request that is likely to be dropped.',
  },
  /**
   * Consolidations. The target validator has another withdrawal address than
   * the source: the stake leaves this OVM for that address and cannot be
   * moved back.
   */
  CONSOLIDATION_CREDENTIALS_DIFFER: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'Source and target validators have different withdrawal addresses: the stake moves out of this OVM and cannot be moved back.',
    guidance:
      'Acknowledge only if the target validator and its withdrawal address (`details.targetWithdrawalAddress`) are yours.',
  },
  /**
   * `ovm.getState`. `amountOfPrincipalStake` differs by more than 1 ETH from
   * the principal on the beacon chain: distributions may pay principal out
   * as rewards, or the reverse. Not carried by a `Prepared`.
   */
  PRINCIPAL_STAKE_MISMATCH: {
    severity: 'warning',
    group: 'risk',
    meaning:
      "The OVM's `amountOfPrincipalStake` differs from the principal on the beacon chain by more than 1 ETH.",
    guidance:
      'Have the owner correct it with `prepareSetAmountOfPrincipalStake` before distributing.',
  },
  /**
   * `ovm.getState` / `getRoleHolders`. The owner or a role holder is a public
   * forwarder (Multicall3 and the like): anyone can use its roles. Not
   * carried by a `Prepared`.
   */
  PUBLIC_FORWARDER_HOLDS_ROLE: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'The owner or a role holder is a public forwarder: anyone can call the role-gated functions through it.',
    guidance: 'Revoke its roles, or transfer ownership away from it, now.',
  },
  /**
   * Ownership changes. The current role holders keep their roles under the
   * new owner (`details.holders`).
   */
  ROLES_SURVIVE_TRANSFER: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'A change of owner does not revoke roles: the listed holders keep theirs.',
    guidance:
      'Revoke the roles that should not survive, before or after. Acknowledge if the new owner knows the holders.',
  },
  /**
   * Ownership changes. The role holders could not be read, so whether roles
   * survive the transfer is unknown.
   */
  ROLE_HOLDERS_UNCHECKED: {
    severity: 'info',
    group: 'note',
    meaning:
      'Role holders could not be read, so surviving roles were not checked.',
    guidance: 'Check `ovm.getRoleHolders` afterwards.',
  },
  /**
   * Role grants. `CONSOLIDATION` lets its holder move the whole stake into a
   * validator it controls.
   */
  ROLE_GRANT_CONSOLIDATION: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'Granting CONSOLIDATION: the holder can move the whole stake into a validator it controls.',
    guidance: 'Acknowledge only for an address you would trust with the stake.',
  },
  /**
   * Role grants. `DEPOSIT` for the principal recipient lets it raise
   * `amountOfPrincipalStake` and take rewards as principal.
   */
  ROLE_GRANT_DEPOSIT_TO_PRINCIPAL: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'Granting DEPOSIT to the principal recipient: it can raise the principal stake and take rewards as principal.',
    guidance:
      'Grant DEPOSIT to another address. Acknowledge only if the reward recipients accept that.',
  },
  /**
   * Distributions. A recipient paused Warehouse withdrawals and the sender
   * cannot bypass it; its withdrawal leg is left out.
   */
  RECIPIENT_WITHDRAW_PAUSED: {
    severity: 'info',
    group: 'note',
    meaning:
      'A recipient paused its Warehouse withdrawals; its withdrawal is left out of this transaction.',
    guidance: 'None; the recipient withdraws itself.',
  },
  /**
   * Distributions. The Obol RAF address keeps a Warehouse balance because it
   * is not in the withdrawal set.
   */
  RAF_LEFT_IN_WAREHOUSE: {
    severity: 'info',
    group: 'note',
    meaning:
      'The Obol RAF balance stays in the Warehouse (it is not in the withdrawal set).',
    guidance: 'None; anyone can withdraw it later.',
  },
  /**
   * Setup. A split already exists at the predicted address and is reused
   * instead of created.
   */
  SPLIT_REUSED: {
    severity: 'info',
    group: 'note',
    meaning: 'The split already exists at the predicted address and is reused.',
    guidance: 'None.',
  },
  /**
   * Setup. An OVM recipient has no contract code: an EOA, or a split that
   * was not created yet.
   */
  RECIPIENT_NOT_CONTRACT: {
    severity: 'info',
    group: 'note',
    meaning:
      'An OVM recipient has no contract code (an EOA, or a split not created yet).',
    guidance:
      'If it should be a split, create it first or use `setup.prepareOvmWithSplits`.',
  },
  /**
   * Simulation. The node has neither `eth_simulateV1` nor `debug_traceCall`
   * (or refused them): only success or revert was checked, not what the
   * transaction moves.
   */
  SIMULATION_UNAVAILABLE: {
    severity: 'warning',
    group: 'unchecked',
    meaning:
      'The node could not simulate the request in full: only success or revert was checked, not what it moves.',
    guidance:
      'Use an RPC with `eth_simulateV1`. Acknowledging sends on the strength of the preview alone.',
  },
  /** Simulation. The transaction reverts when simulated (`details.revertReason`). */
  SIMULATION_REVERTED: {
    severity: 'warning',
    group: 'risk',
    meaning: 'The transaction reverts when simulated.',
    guidance:
      'Do not send; prepare again, or fix the sender or state. Acknowledging sends a transaction expected to fail (gas lost).',
  },
  /**
   * Simulation. What the node simulated differs from the operation's
   * preview (`details.differences`); the state may have moved since prepare.
   */
  SIMULATION_PREVIEW_MISMATCH: {
    severity: 'warning',
    group: 'risk',
    meaning: "The simulation differs from the operation's preview.",
    guidance:
      'Prepare again and simulate the new transaction. Acknowledging sends a transaction whose effect is not the one previewed.',
  },
  /**
   * Simulation. A balance or state read before or after the simulated
   * transaction failed (`details.unread`): the changes shown are incomplete
   * and were not fully compared with the preview.
   */
  SIMULATION_READS_INCOMPLETE: {
    severity: 'warning',
    group: 'unchecked',
    meaning:
      'Some balances or state could not be read while simulating: the changes shown are incomplete and not fully compared with the preview.',
    guidance:
      'Simulate again, or on another RPC. Acknowledging sends without the full comparison; a missing change is not "no change".',
  },
  /**
   * Simulation. A contract with no known role in the transaction emitted a
   * decodable event; it is listed but not interpreted.
   */
  SIMULATION_UNTRUSTED_EVENT: {
    severity: 'warning',
    group: 'risk',
    meaning:
      'A contract with no known role in this transaction emitted events; they were not interpreted.',
    guidance:
      'Look at the listed contracts. Acknowledge if they are expected (a recipient contract reacting to ETH).',
  },
  /**
   * Simulation. The sender is a contract wallet (a Safe): its own signature,
   * owner, threshold and nonce checks were not simulated.
   */
  SIMULATION_CONTRACT_WALLET: {
    severity: 'info',
    group: 'note',
    meaning:
      'The sender is a contract wallet: its own signature and threshold checks were not simulated.',
    guidance: 'Check the transaction in the Safe app as well.',
  },
  /** Incentive claim issue: the address has nothing to claim. */
  NO_INCENTIVES: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The address has no incentives to claim.',
    guidance: 'Nothing to do.',
  },
  /** Incentive claim issue: the Obol API has no record for the address. */
  INCENTIVES_NOT_FOUND: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The Obol API has no incentives record for the address.',
    guidance: 'Check the address and the chain.',
  },
  /** Incentive claim issue: the Obol API request failed. */
  INCENTIVES_FETCH_FAILED: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The incentives record could not be fetched from the Obol API.',
    guidance: 'Retry later.',
  },
  /** Incentive claim issue: the record is for another operator address. */
  OPERATOR_ADDRESS_MISMATCH: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The incentives record is for another operator address.',
    guidance: 'Report it; do not claim.',
  },
  /** Incentive claim issue: the record is malformed. */
  INCENTIVES_DATA_INVALID: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The incentives record is malformed.',
    guidance: 'Report it; do not claim.',
  },
  /** Incentive claim issue: no contract at the distributor address. */
  CONTRACT_NOT_DEPLOYED: {
    severity: 'warning',
    group: 'claim',
    meaning: 'There is no contract at the distributor address.',
    guidance: 'Check the chain; do not claim.',
  },
  /** Incentive claim issue: the contract is not an Obol Merkle distributor. */
  DISTRIBUTOR_UNKNOWN: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The distributor contract does not have the expected code.',
    guidance: 'Do not claim; report it.',
  },
  /** Incentive claim issue: the chain has no Obol incentives. */
  UNSUPPORTED_CHAIN: {
    severity: 'warning',
    group: 'claim',
    meaning: 'Incentives are not available on this chain.',
    guidance: 'Use mainnet or Hoodi.',
  },
  /** Incentive claim issue: the distributor pays another token than OBOL. */
  TOKEN_MISMATCH: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The distributor pays a token other than OBOL.',
    guidance: 'Do not claim; report it.',
  },
  /** Incentive claim issue: the Merkle proof does not verify against the on-chain root. */
  PROOF_INVALID: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The Merkle proof does not verify against the on-chain root.',
    guidance: 'Do not claim; report it.',
  },
  /** Incentive claim issue: already claimed. */
  ALREADY_CLAIMED: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The incentives were already claimed.',
    guidance: 'Nothing to do.',
  },
  /** Incentive claim issue: the claim window has closed. */
  CLAIM_WINDOW_CLOSED: {
    severity: 'warning',
    group: 'claim',
    meaning: 'The claim window of the distributor has closed.',
    guidance: 'Nothing can be claimed from it any more.',
  },
  /** Incentive claim issue: a chain read needed for a check failed. */
  CHAIN_READ_FAILED: {
    severity: 'warning',
    group: 'claim',
    meaning: 'A chain read needed for a claim check failed.',
    guidance: 'Retry, or use another RPC.',
  },
} as const satisfies Record<string, FindingInfo>;

/** Every finding code (`Finding.code`); documented on the keys of {@link FINDINGS}. */
export type FindingCode = keyof typeof FINDINGS;

/** Every finding code, for runtime checks. */
export const FINDING_CODES = /* @__PURE__ */ Object.keys(
  FINDINGS,
) as FindingCode[];

type SeverityMismatch = {
  [C in FindingCode]: (typeof FINDINGS)[C]['severity'] extends (
    C extends (typeof INFO_FINDING_CODES)[number] ? 'info' : 'warning'
  )
    ? never
    : C;
}[FindingCode];
/**
 * `true` when `INFO_FINDING_CODES` and the severities in `FINDINGS` agree,
 * else the codes that differ (a compile error where it is asserted).
 */
export type FindingSeveritiesAgree = [SeverityMismatch] extends [never]
  ? true
  : SeverityMismatch;

/** The codes whose findings are warnings: the ones `send` asks to be acknowledged. */
export type WarningCode = {
  [C in FindingCode]: (typeof FINDINGS)[C]['severity'] extends 'warning'
    ? C
    : never;
}[FindingCode];

/** The codes a `simulate` result can carry. */
export const SIMULATION_FINDING_CODES = [
  'SIMULATION_UNAVAILABLE',
  'SIMULATION_REVERTED',
  'SIMULATION_PREVIEW_MISMATCH',
  'SIMULATION_READS_INCOMPLETE',
  'SIMULATION_UNTRUSTED_EVENT',
  'SIMULATION_CONTRACT_WALLET',
] as const satisfies readonly FindingCode[];
export type SimulationFindingCode = (typeof SIMULATION_FINDING_CODES)[number];

/**
 * The warnings that only say "a check could not run" (group `unchecked`):
 * nothing is known to be wrong. For a script that states its policy up
 * front:
 *
 *   await obol.send(tx, { acknowledge: UNCHECKED_WARNING_CODES });
 *
 * accepts every "could not check" warning and nothing else: a warning about
 * what the transaction does (`TOP_UP_CREDENTIALS_FOREIGN`,
 * `CONSOLIDATION_CREDENTIALS_DIFFER`, ...) is still refused. It is a list
 * like any other; read it before you use it.
 */
export const UNCHECKED_WARNING_CODES = [
  'DEPOSIT_EXISTENCE_UNCHECKED',
  'VALIDATOR_STATUS_UNCHECKED',
  'PROVENANCE_UNKNOWN',
  'SIMULATION_UNAVAILABLE',
  'SIMULATION_READS_INCOMPLETE',
] as const satisfies readonly WarningCode[];

/**
 * The finding codes each kind of prepared transaction can carry
 * (`Prepared<K>['checks'][number]['code']`). The compiler holds every
 * `prepare*` to its list.
 */
export const FINDING_CODES_BY_KIND = {
  deposit: [
    'DEPOSIT_EXISTENCE_UNCHECKED',
    'DEPOSIT_ALREADY_QUEUED',
    'QUEUED_CREDENTIALS_CONFLICT',
    'TOP_UP_ABOVE_EFFECTIVE_CAP',
    'TOP_UP_EXITED_VALIDATOR',
    'TOP_UP_CREDENTIALS_FOREIGN',
    'OVM_STAKE_NOT_TRACKED',
  ],
  withdraw: [
    'PROVENANCE_UNKNOWN',
    'VALIDATOR_STATUS_UNCHECKED',
    'WITHDRAW_AMOUNT_CAPPED',
    'PARTIAL_WITHDRAWAL_QUEUE_FULL',
  ],
  consolidate: [
    'PROVENANCE_UNKNOWN',
    'VALIDATOR_STATUS_UNCHECKED',
    'CONSOLIDATION_CREDENTIALS_DIFFER',
  ],
  distribute: ['PROVENANCE_UNKNOWN'],
  distributeAll: [
    'PROVENANCE_UNKNOWN',
    'RECIPIENT_WITHDRAW_PAUSED',
    'RAF_LEFT_IN_WAREHOUSE',
  ],
  createOvm: ['RECIPIENT_NOT_CONTRACT'],
  ovmWithSplits: ['SPLIT_REUSED', 'RECIPIENT_NOT_CONTRACT'],
  createSplit: [],
  claim: [],
  eoaWithdraw: [
    'VALIDATOR_STATUS_UNCHECKED',
    'WITHDRAW_AMOUNT_CAPPED',
    'PARTIAL_WITHDRAWAL_QUEUE_FULL',
  ],
  role: [
    'PROVENANCE_UNKNOWN',
    'ROLE_GRANT_CONSOLIDATION',
    'ROLE_GRANT_DEPOSIT_TO_PRINCIPAL',
  ],
  ownership: [
    'PROVENANCE_UNKNOWN',
    'ROLES_SURVIVE_TRANSFER',
    'ROLE_HOLDERS_UNCHECKED',
  ],
  recipient: ['PROVENANCE_UNKNOWN'],
  principalStake: ['PROVENANCE_UNKNOWN'],
  sweep: ['PROVENANCE_UNKNOWN'],
  withdrawPullBalance: ['PROVENANCE_UNKNOWN'],
  recoverFunds: ['PROVENANCE_UNKNOWN'],
} as const satisfies Record<PreparedKind, readonly FindingCode[]>;

/** The finding codes a `Prepared<K>` can carry. */
export type FindingCodeFor<K extends PreparedKind = PreparedKind> =
  (typeof FINDING_CODES_BY_KIND)[K][number];
