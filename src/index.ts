/**
 * obol-sdk v3 entry. The client binds every module to one chain, viem
 * clients and the optional Obol API; the modules are also exported as
 * namespaces, so pure functions (hashing, verification, share math, routing)
 * can be used without a client.
 */
export { createObolClient } from './client.js';
export type { ObolClient, ObolClientConfig } from './client.js';
export { ObolError, ObolApiError, isObolError } from './errors.js';
export type { Issue } from './errors.js';
export type {
  Deposit,
  DepositKind,
  Finding,
  Prepared,
  Source,
  SplitParams,
} from './types.js';
export { CHAINS, getObolChain } from './chains.js';
export type { ChainContracts, ObolChain, PublicForwarder } from './chains.js';
export { isAddressInput } from './schema.js';
export { send, waitForContractWalletExecution } from './send.js';
export type { Sent, WaitOptions } from './send.js';
export { simulate, formatEth } from './simulate/index.js';
export type {
  BalanceChange,
  FullSimulation,
  LimitedSimulation,
  OvmValueName,
  PreviewComparison,
  RevertReason,
  SimulatedEvent,
  SimulateOptions,
  Simulation,
  SimulationBackend,
  StateChange,
} from './simulate/index.js';
export type { Context } from './context.js';
export type { BlsBackend, BlsBatch } from './cluster/blsBackend.js';

export * as cluster from './cluster/index.js';
export * as deposits from './deposits/index.js';
export * as ovm from './ovm/index.js';
export * as splits from './splits/index.js';
export * as setup from './setup/index.js';
export * as incentives from './incentives/index.js';
export * as exits from './exits/index.js';
export * as terms from './terms/index.js';
export * as withdrawals from './withdrawals/index.js';
export * as legacy from './legacy/index.js';
