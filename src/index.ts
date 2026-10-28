/**
 * obol-sdk v3 entry. The client binds every module to one chain, viem
 * clients and the optional Obol API; the modules are also exported as
 * namespaces (and as subpath entries, `@obolnetwork/obol-sdk/ovm` …), so
 * pure functions (hashing, verification, share math, routing) can be used
 * without a client.
 */
export { createObolClient } from './client.js';
export { createObolContext } from './clientContext.js';
export type {
  ExperimentalModule,
  ObolClient,
  ObolClientConfig,
} from './client.js';
export { ObolError, ObolApiError, isObolError } from './errors.js';
export type { DetailsOf, ObolErrorOptions } from './errors.js';
export { FINDING_CODES, OBOL_ERROR_CODES } from './codes.js';
export type {
  ApiErrorCode,
  ApiErrorDetails,
  FindingCode,
  Issue,
  ObolErrorCode,
  ObolErrorDetails,
} from './codes.js';
export { PREPARED_KINDS } from './types.js';
export type {
  AnyPrepared,
  Deposit,
  DepositInput,
  DepositKind,
  Finding,
  FindingSubject,
  PendingRetry,
  Prepared,
  PreparedKind,
  PreparedRequest,
  PreviewByKind,
  PreviewResult,
  Source,
  SplitParams,
  SplitParamsInput,
  StatusSource,
} from './types.js';
export { CHAINS, currentEpoch, getObolChain } from './chains.js';
export type { ChainContracts, ObolChain, PublicForwarder } from './chains.js';
export { isAddressInput } from './schema.js';
export { isStale, send, waitForContractWalletExecution } from './send.js';
export type { Sent, WaitOptions } from './send.js';
export type { Context } from './context.js';
export type { BlsBackend, BlsBatch } from './cluster/blsBackend.js';
export { isValidLock } from './cluster/verifyLock.js';
export { verifyTypedDataSignature } from './cluster/eip712.js';
export type {
  EIP712TypedData,
  PublicClients,
  SignatureClients,
} from './cluster/eip712.js';

export * as cluster from './cluster/index.js';
export * as deposits from './deposits/index.js';
export * as ovm from './ovm/index.js';
export * as splits from './splits/index.js';
export * as setup from './setup/index.js';
export * as incentives from './incentives/index.js';
export * as exits from './exits/index.js';
export * as terms from './terms/index.js';
export * as withdrawals from './withdrawals/index.js';
export * as experimental from './experimental/index.js';
