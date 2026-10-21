### Changelog

All notable changes to this project will be documented in this file. Dates are displayed in UTC.

#### Unreleased

- fix(verification): require each signature in a batched BLS check (cluster lock deposit and builder registration signatures, deposit payloads) to be valid on its own; batches are now checked with random weights
- fix(verification): reject non-canonical BLS point encodings (field elements ≥ p), which consensus clients reject

#### [v2.15.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.14.0...v2.15.0)

> 17 October 2026

Fixes:

- fix(verification): cluster definition and lock hashes match the distributed-validator-specs `cluster_hashing` test vectors: deposit amounts are hashed as uint64 bigints (amounts above 2^53 lost precision with `parseInt`), and null or missing lists (operators, validators, `deposit_amounts`, `partial_deposit_data`, Charon's Go nil slices) and missing name / timestamp hash as empty instead of throwing. Malformed deposit amounts (empty, non-decimal, out of the uint64 range) are rejected instead of hashing as `NaN`
- fix(verification): `validateClusterLock` recomputes the definition's `config_hash` and rejects locks where it does not match the config fields
- fix(verification): node (ENR) and exit payload secp256k1 signatures are verified with `@noble/curves` instead of `elliptic`; signatures must be 64 or 65 bytes of hex with low-s, malformed signatures return `false` instead of throwing, and `verifyExitPayloadSignature` decodes the ENR public key correctly
- fix(validation): stricter cluster definition and split payload validation. Split allocations must be within (0, 100] and are summed at contract precision (1e4 per percent) instead of as floats; V1 SplitMain recipients must sum to exactly 100%, OVM / SplitV2 recipients may be off by one 1e-4 % unit per recipient (SplitV2 takes the sum as its total, e.g. three shares of 33.3333...%). Recipient and operator addresses must be hex addresses without case-insensitive duplicates; zero withdrawal and fee recipient addresses and unknown definition fields are rejected
- fix: `createClusterDefinition` only accepts the definition versions in `SUPPORTED_DEFINITION_VERSIONS` (`InvalidArgumentError` otherwise)
- fix: `getClusterDefinition`, `getClusterLock`, `getClusterLockByHash`, `acceptClusterDefinition`, `hasAcceptedTerms` and `incentives.getIncentivesByAddress` validate hash and address arguments before calling the API and URL-encode them
- fix: `acceptClusterDefinition` fetches and verifies the definition before signing (returned and recomputed `config_hash` match, network matches the client) and checks the signer is an operator (`DefinitionVerificationError`, `NotAnOperatorError`); it fills `version` from the definition when omitted (a different `version` is rejected) and returns the definition unchanged if this operator already accepted with the same ENR
- fix: methods that send transactions or sign chain-bound EIP-712 data throw `ChainMismatchError` when the signer's provider is on a different chain than the client
- fix: the `Client` constructor throws `UnsupportedChainError` for chain IDs other than Mainnet (1), Hoodi (560048), Gnosis (100) and Sepolia (11155111); Gnosis and Sepolia are for cluster definitions and locks only (no splitter contracts)
- fix: conflicts are detected by HTTP status 409, and `ConflictError` carries the API's message
- fix(eoa, splits): `eoa.deposit` and `splits.deposit` verify deposit data before sending ETH: recomputed `deposit_data_root`, BLS signature for the chain, amount between 1 ETH and 32 ETH (2048 ETH for 0x02 credentials), withdrawal credentials pointing at the OVM / optional `expectedWithdrawalAddress`. Signatures that are not valid curve points are reported as an invalid deposit signature
- fix(eoa, splits): top-ups to existing validators are sent with `kind: 'topUp'` (default `'deposit'`): no BLS check, the expected or all-zero withdrawal credentials, up to 2048 ETH. Without it, a deposit with an all-zero signature is refused with an `ObolSdkError` coded `DEPOSIT_LOOKS_LIKE_TOP_UP`, since it would be lost if the validator does not exist
- fix(eoa, splits): `requestWithdrawal` checks fees against the current EIP-7002 fee read from the withdrawal request contract; `requiredFee` / `withdrawalFees` are optional, and `allocation` is converted to gwei without float precision loss
- fix(eoa): when `requiredFee` is omitted, `eoa.requestWithdrawal` sends exactly the current EIP-7002 fee, since the EIP-7002 contract keeps any excess (`splits.requestWithdrawal` keeps its 2× default, as the OVM refunds the excess); `resolveWithdrawalFee` takes an optional `defaultMultiplier`
- fix(eoa): correct the batch deposit error message and keep the original error as `cause`
- fix(exits): `recombineExitBlobs` threshold-aggregates partial exit signatures like Charon's `tbls.ThresholdAggregate`, weighting each by its Lagrange coefficient for the share indices present (operator index + 1); it previously summed them, which does not produce the validator's signature. Share index keys that are not non-negative integers and signatures that are not valid G2 points are rejected. The result matches the distributed-validator-specs `bls_threshold` test vectors
- fix(splits): OVM deployment only reads the `CreateObolValidatorManager` event from logs emitted by the chain's configured OVM factory; `extractOvmAddressFromReceipt` takes the factory address as a second argument
- fix(splits): `splits.requestWithdrawal` refunds unused EIP-7002 fees to a new optional `excessFeeRecipient`, defaulting to the signer; refunds were previously sent to the OVM and distributed as rewards
- fix(splits): `splits.deposit` and `splits.requestWithdrawal` from a contract wallet (e.g. a Safe over WalletConnect) wait for the Safe's execution instead of the wallet-returned hash, which never appears on-chain, as the `eoa` methods already do
- fix(splits): `distributorFeePercent` is converted to SplitV2's `distributionIncentive` scale (1e6 = 100%); it was passed through unscaled, so 1 meant 0.0001% and fractional values failed to encode. The maximum is now 6.5535% (the uint16 limit) instead of 10%, and the default stays 0. Split addresses predicted with a non-zero fee change
- fix(incentives): `claimIncentives` runs a pre-flight check first, also available read-only as `incentives.preflightClaim(address)`: the API data is for the requested address, the Merkle proof matches the distributor's on-chain root, the distributor matches the reference `MerkleDistributorWithDeadline` build and pays out OBOL for the chain, and the claim window is open. Failures throw `IncentivesPreflightError` (with `issues`); addresses without incentives are reported as `NO_INCENTIVES` instead of failing inside the contract call, and API errors other than 404 as `INCENTIVES_FETCH_FAILED`. `isClaimed` validates its arguments, and incentive helpers no longer log to the console

Additions:

- feat(errors): typed Obol API errors (`ObolApiError` with `NotFoundError`, `ValidationError`, `UnauthorizedError`, `ConflictError`, `RateLimitError`) carrying `status`, `endpoint`, `method`, `body` and a `hint`; error body fields stay readable on the error, and non-JSON error bodies no longer cause a parse error
- feat(errors): `ObolSdkError` base class (with `code` and `hint`) for local check errors (`ChainMismatchError`, `DefinitionVerificationError`, `NotAnOperatorError`, `IncentivesPreflightError`); payload validation throws `PayloadValidationError` (code `PAYLOAD_INVALID`, with the AJV `errors`) and malformed hash / address arguments throw `InvalidArgumentError` (code `INVALID_ARGUMENT`), both keeping their previous messages
- feat(errors): when `splits.deposit`, `splits.requestWithdrawal`, `eoa.deposit`, `eoa.requestWithdrawal` or `incentives.claimIncentives` fails after a transaction was broadcast, it throws `TransactionSubmissionError` (code `TX_FAILED_AFTER_SEND`) with the mined `txHashes`, the unconfirmed `pendingTxHash`, `pendingStatus` (`reverted`: nothing moved; `unconfirmed`: it may still be mined) and the original `cause`; its message is unchanged
- feat: the same methods take an optional second argument `{ onSent }` (`WriteOptions`), called with each transaction hash as soon as it is broadcast (for a contract wallet, the wallet's own hash)
- feat: configurable request timeout (`timeoutMs`, default 30s, `0` disables it) that throws `RequestTimeoutError`
- feat: `hasAcceptedTerms(address?)` and `acceptObolLatestTermsAndConditions({ ifNotAccepted: true })`
- feat(deposits): `getDepositData(lockHash, { verify?, amount? })` returns validated deposit payloads (wei) from a cluster lock, ready for `eoa.deposit` / `splits.deposit` (shared `ValidatorDeposit` type); `depositDataFromLock` does the same for a lock already in hand
- feat: export the EIP-7002 withdrawal fee helpers `getWithdrawalRequestFee`, `resolveWithdrawalFee` and `WITHDRAWAL_REQUEST_CONTRACT_ADDRESS`
- feat: `getOWRTranches` works with a provider and no signer
- feat: accept any ethers v6 `Signer` / `Provider` (`HDNodeWallet`, `NonceManager`, custom `AbstractSigner`) without casts; remove the unused `cross-fetch` and `elliptic` dependencies; relax `engines.node` to `>= 20`
- note: `SignerType` is now the ethers `Signer` interface. TypeScript callers that read members specific to `Wallet` / `JsonRpcSigner` from `client.signer` (e.g. `client.signer.address`) need a narrowing check such as `instanceof Wallet`; this is a type-only change with no runtime effect
- docs: `splits.requestWithdrawal` amounts are in gwei; `createObolRewardsSplit` and `createObolTotalSplit` are deprecated for new clusters in favour of the OVM methods (they have no EIP-7002 withdrawal path)

#### [v2.14.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.2...v2.14.0)

> 21 July 2026

- chore(release): v2.14.0 [`#232`](https://github.com/ObolNetwork/obol-sdk/pull/232)
- fix(safe): use Client provider for reads and Safe gas estimation [`#231`](https://github.com/ObolNetwork/obol-sdk/pull/231)

#### [v2.13.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.1...v2.13.2)

> 17 July 2026

- chore(release): v2.13.2 [`#230`](https://github.com/ObolNetwork/obol-sdk/pull/230)
- fix: support Safe wallets in EOA withdrawal/exit and batch deposit [`#228`](https://github.com/ObolNetwork/obol-sdk/pull/228)

#### [v2.13.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.13.0...v2.13.1)

> 10 July 2026

- chore(release): v2.13.1 [`#227`](https://github.com/ObolNetwork/obol-sdk/pull/227)
- fix: support Safe wallets in OVM/splitter deployment flows [`#226`](https://github.com/ObolNetwork/obol-sdk/pull/226)

#### [v2.13.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.6...v2.13.0)

> 8 July 2026

- chore(release): v2.13.0 [`#225`](https://github.com/ObolNetwork/obol-sdk/pull/225)
- Add v1.11.0 cluster definition hashing with List[Bytes65,32] signatures. [`#220`](https://github.com/ObolNetwork/obol-sdk/pull/220)

#### [v2.12.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.5...v2.12.6)

> 2 June 2026

- chore(release): v2.12.6 [`#219`](https://github.com/ObolNetwork/obol-sdk/pull/219)
- fix: move @noble/curves to devDependencies to prevent consumer dep conflicts [`#218`](https://github.com/ObolNetwork/obol-sdk/pull/218)

#### [v2.12.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.4...v2.12.5)

> 22 May 2026

- chore(release): v2.12.5 [`#217`](https://github.com/ObolNetwork/obol-sdk/pull/217)
- fix: raise lock validation worker timeouts for large clusters [`#216`](https://github.com/ObolNetwork/obol-sdk/pull/216)

#### [v2.12.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.3...v2.12.4)

> 21 May 2026

- chore(release): v2.12.4 [`#215`](https://github.com/ObolNetwork/obol-sdk/pull/215)
- Hanan/worker timeout [`#214`](https://github.com/ObolNetwork/obol-sdk/pull/214)

#### [v2.12.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.2...v2.12.3)

> 21 May 2026

- chore(release): v2.12.3 [`#213`](https://github.com/ObolNetwork/obol-sdk/pull/213)
- Hanan/timeoutError+ConcurrentRequests [`#212`](https://github.com/ObolNetwork/obol-sdk/pull/212)

#### [v2.12.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.1...v2.12.2)

> 21 May 2026

- chore(release): v2.12.2 [`#211`](https://github.com/ObolNetwork/obol-sdk/pull/211)
- fix(security): stop auto-loading .env and allowlist Obol API baseUrl [`#210`](https://github.com/ObolNetwork/obol-sdk/pull/210)

#### [v2.12.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.12.0...v2.12.1)

> 20 May 2026

- chore(release): v2.12.1 [`#209`](https://github.com/ObolNetwork/obol-sdk/pull/209)
- perf: run lock validation off main thread, parallelize BLS operations [`#208`](https://github.com/ObolNetwork/obol-sdk/pull/208)

#### [v2.12.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.13...v2.12.0)

> 15 May 2026

- chore(release): v2.12.0 [`#207`](https://github.com/ObolNetwork/obol-sdk/pull/207)
- Fix/lock share binding validation [`#199`](https://github.com/ObolNetwork/obol-sdk/pull/199)

#### [v2.11.13](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.12...v2.11.13)

> 11 May 2026

- chore(release): v2.11.13 [`#206`](https://github.com/ObolNetwork/obol-sdk/pull/206)
- Feat/export enr [`#204`](https://github.com/ObolNetwork/obol-sdk/pull/204)
- fix: sign release PR commits for branch protection compliance [`#205`](https://github.com/ObolNetwork/obol-sdk/pull/205)

#### [v2.11.12](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.11...v2.11.12)

> 8 May 2026

- chore(release): v2.11.12 [`#203`](https://github.com/ObolNetwork/obol-sdk/pull/203)
- Fix/release pr lockfile sync [`#202`](https://github.com/ObolNetwork/obol-sdk/pull/202)

#### [v2.11.11](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.10...v2.11.11)

> 8 May 2026

- fix(release): sync subproject lockfiles before dependency upgrades [`#201`](https://github.com/ObolNetwork/obol-sdk/pull/201)
- Chore/update dependencies [`#198`](https://github.com/ObolNetwork/obol-sdk/pull/198)
- chore: update dependencies to latest stable versions [`#193`](https://github.com/ObolNetwork/obol-sdk/pull/193)
- fix: pin GitHub Actions to SHA for supply chain security [`#183`](https://github.com/ObolNetwork/obol-sdk/pull/183)
- fix: enforce semantic commits in Renovate config [`#186`](https://github.com/ObolNetwork/obol-sdk/pull/186)
- fix: enforce node signatures count equals operators count in validate… [`#189`](https://github.com/ObolNetwork/obol-sdk/pull/189)
- Update actions/github-script action to v9 [`#187`](https://github.com/ObolNetwork/obol-sdk/pull/187)
- Updates claude.md to consider outside parties [`#188`](https://github.com/ObolNetwork/obol-sdk/pull/188)
- Update peter-evans/create-pull-request action to v8 [`#175`](https://github.com/ObolNetwork/obol-sdk/pull/175)
- Update ffurrer2/extract-release-notes action to v3 [`#169`](https://github.com/ObolNetwork/obol-sdk/pull/169)
- Update actions/checkout action to v6 [`#168`](https://github.com/ObolNetwork/obol-sdk/pull/168)
- Update actions/setup-node action to v6 [`#158`](https://github.com/ObolNetwork/obol-sdk/pull/158)
- Update README.md [`#64`](https://github.com/ObolNetwork/obol-sdk/pull/64)
- Update ffurrer2/extract-release-notes action to v2.3.0 [`#106`](https://github.com/ObolNetwork/obol-sdk/pull/106)
- fix: use Node 24 with --ignore-scripts for OIDC publishing [`#192`](https://github.com/ObolNetwork/obol-sdk/pull/192)
- fix: use Node 22.x for @chainsafe/blst compatibility [`#191`](https://github.com/ObolNetwork/obol-sdk/pull/191)
- chore: migrate npm publishing to OIDC trusted publishers [`#190`](https://github.com/ObolNetwork/obol-sdk/pull/190)
- update claude.md [`#184`](https://github.com/ObolNetwork/obol-sdk/pull/184)
- chore: use yarn cache in release-pr workflow [`248de15`](https://github.com/ObolNetwork/obol-sdk/commit/248de15f0f942b174570f62bea2363698ec06a3a)

#### [v2.11.10](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.9...v2.11.10)

> 16 March 2026

- chore(release): v2.11.10 [`#182`](https://github.com/ObolNetwork/obol-sdk/pull/182)
- remove holesky [`#181`](https://github.com/ObolNetwork/obol-sdk/pull/181)
- improve sdk docs and error handling [`#180`](https://github.com/ObolNetwork/obol-sdk/pull/180)

#### [v2.11.9](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.8...v2.11.9)

> 30 January 2026

- chore(release): v2.11.9 [`#179`](https://github.com/ObolNetwork/obol-sdk/pull/179)
- support delegated EOA [`#178`](https://github.com/ObolNetwork/obol-sdk/pull/178)
- fix docs [`#176`](https://github.com/ObolNetwork/obol-sdk/pull/176)
- Fix: Correct method name in signature validator [`#177`](https://github.com/ObolNetwork/obol-sdk/pull/177)

#### [v2.11.8](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.7...v2.11.8)

> 9 December 2025

- chore(release): v2.11.8 [`#174`](https://github.com/ObolNetwork/obol-sdk/pull/174)
- Hanan/fix ovm deposit [`#173`](https://github.com/ObolNetwork/obol-sdk/pull/173)

#### [v2.11.7](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.6...v2.11.7)

> 5 December 2025

- chore(release): v2.11.7 [`#172`](https://github.com/ObolNetwork/obol-sdk/pull/172)
- new ovm [`#171`](https://github.com/ObolNetwork/obol-sdk/pull/171)
- Hanna/recombine signature fix [`#170`](https://github.com/ObolNetwork/obol-sdk/pull/170)

#### [v2.11.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5...v2.11.6)

> 11 November 2025

- chore(release): v2.11.6 [`#167`](https://github.com/ObolNetwork/obol-sdk/pull/167)
- accept 0 for full withdrawal [`#166`](https://github.com/ObolNetwork/obol-sdk/pull/166)

#### [v2.11.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.2...v2.11.5)

> 7 November 2025

- chore(release): v2.11.5 [`#165`](https://github.com/ObolNetwork/obol-sdk/pull/165)
- return checksummed ovm address [`#164`](https://github.com/ObolNetwork/obol-sdk/pull/164)

#### [v2.11.5-rc.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.1...v2.11.5-rc.2)

> 23 October 2025

- [Release] v2.11.5-rc.2 [`#162`](https://github.com/ObolNetwork/obol-sdk/pull/162)
- add js extension to missed files [`#161`](https://github.com/ObolNetwork/obol-sdk/pull/161)

#### [v2.11.5-rc.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.5-rc.0...v2.11.5-rc.1)

> 16 October 2025

- [Release] v2.11.5 [`#160`](https://github.com/ObolNetwork/obol-sdk/pull/160)
- remove ot used function [`#159`](https://github.com/ObolNetwork/obol-sdk/pull/159)
- Hanan/browser bundler config [`#157`](https://github.com/ObolNetwork/obol-sdk/pull/157)

#### [v2.11.5-rc.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.4...v2.11.5-rc.0)

> 3 October 2025

- [Release] v2.11.5-rc.0 [`#156`](https://github.com/ObolNetwork/obol-sdk/pull/156)
- fix critical vulnerabilities [`#155`](https://github.com/ObolNetwork/obol-sdk/pull/155)

#### [v2.11.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.3...v2.11.4)

> 19 September 2025

- chore(release): v2.11.4 [`#154`](https://github.com/ObolNetwork/obol-sdk/pull/154)
- update ovm factory info [`#153`](https://github.com/ObolNetwork/obol-sdk/pull/153)

#### [v2.11.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.2...v2.11.3)

> 18 September 2025

- chore(release): v2.11.3 [`#152`](https://github.com/ObolNetwork/obol-sdk/pull/152)
- update  validation for deposit_amounts [`#151`](https://github.com/ObolNetwork/obol-sdk/pull/151)

#### [v2.11.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.1...v2.11.2)

> 15 August 2025

- chore(release): v2.11.2 [`#148`](https://github.com/ObolNetwork/obol-sdk/pull/148)
- Hanan/deposit methods [`#147`](https://github.com/ObolNetwork/obol-sdk/pull/147)

#### [v2.11.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.11.0...v2.11.1)

> 15 August 2025

- chore(release): v2.11.1 [`#146`](https://github.com/ObolNetwork/obol-sdk/pull/146)
- Hanan/deposit methods [`#145`](https://github.com/ObolNetwork/obol-sdk/pull/145)

#### [v2.11.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.2...v2.11.0)

> 14 August 2025

- chore(release): v2.11.0 [`#144`](https://github.com/ObolNetwork/obol-sdk/pull/144)
- Hanan/deposit methods [`#143`](https://github.com/ObolNetwork/obol-sdk/pull/143)

#### [v2.10.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.1...v2.10.2)

> 12 August 2025

- chore(release): v2.10.2 [`#141`](https://github.com/ObolNetwork/obol-sdk/pull/141)
- hoodi support [`#139`](https://github.com/ObolNetwork/obol-sdk/pull/139)

#### [v2.10.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.10.0...v2.10.1)

> 7 August 2025

- chore(release): v2.10.1 [`#138`](https://github.com/ObolNetwork/obol-sdk/pull/138)
- Hanan/await tx [`#137`](https://github.com/ObolNetwork/obol-sdk/pull/137)

#### [v2.10.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.9.1...v2.10.0)

> 6 August 2025

- chore(release): v2.10.0 [`#136`](https://github.com/ObolNetwork/obol-sdk/pull/136)
- Hanan/eoa withdrawal [`#135`](https://github.com/ObolNetwork/obol-sdk/pull/135)

#### [v2.9.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.9.0...v2.9.1)

> 26 July 2025

- chore(release): v2.9.1 [`#134`](https://github.com/ObolNetwork/obol-sdk/pull/134)
- Hanan/ovm request withdrawal [`#133`](https://github.com/ObolNetwork/obol-sdk/pull/133)

#### [v2.9.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.8.1...v2.9.0)

> 25 July 2025

- chore(release): v2.9.0 [`#132`](https://github.com/ObolNetwork/obol-sdk/pull/132)
- Hanan/ovm request withdrawal [`#131`](https://github.com/ObolNetwork/obol-sdk/pull/131)

#### [v2.8.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.8.0...v2.8.1)

> 27 June 2025

- chore(release): v2.8.1 [`#130`](https://github.com/ObolNetwork/obol-sdk/pull/130)
- use splitv2Factory contract instead of sdk [`#129`](https://github.com/ObolNetwork/obol-sdk/pull/129)

#### [v2.8.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.7.0...v2.8.0)

> 25 June 2025

- chore(release): v2.8.0 [`#128`](https://github.com/ObolNetwork/obol-sdk/pull/128)
- Hanan/ovm methods [`#126`](https://github.com/ObolNetwork/obol-sdk/pull/126)

#### [v2.7.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.6.0...v2.7.0)

> 11 June 2025

- chore(release): v2.7.0 [`#125`](https://github.com/ObolNetwork/obol-sdk/pull/125)
- Adding BLS aggregation for exits [`#123`](https://github.com/ObolNetwork/obol-sdk/pull/123)

#### [v2.6.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.5.1...v2.6.0)

> 6 June 2025

- chore(release): v2.6.0 [`#122`](https://github.com/ObolNetwork/obol-sdk/pull/122)
- Update release-pr.yml [`#121`](https://github.com/ObolNetwork/obol-sdk/pull/121)
- Exit sdk commands [`#120`](https://github.com/ObolNetwork/obol-sdk/pull/120)

#### [v2.5.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.5.0...v2.5.1)

> 30 May 2025

- chore(release): v2.5.1 [`#117`](https://github.com/ObolNetwork/obol-sdk/pull/117)
- default compounding to false [`#116`](https://github.com/ObolNetwork/obol-sdk/pull/116)

#### [v2.5.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.6...v2.5.0)

> 23 May 2025

- chore(release): v2.5.0 [`#114`](https://github.com/ObolNetwork/obol-sdk/pull/114)
- default to v1.10.0 [`#111`](https://github.com/ObolNetwork/obol-sdk/pull/111)

#### [v2.4.6](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.5...v2.4.6)

> 24 March 2025

- chore(release): v2.4.6 [`#105`](https://github.com/ObolNetwork/obol-sdk/pull/105)
- fix incentives type and accept rpcul in validateClusterLock [`#104`](https://github.com/ObolNetwork/obol-sdk/pull/104)

#### [v2.4.5](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.4...v2.4.5)

> 20 March 2025

- chore(release): v2.4.5 [`#103`](https://github.com/ObolNetwork/obol-sdk/pull/103)
- Hanna/small fix [`#102`](https://github.com/ObolNetwork/obol-sdk/pull/102)

#### [v2.4.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.3...v2.4.4)

> 19 March 2025

- chore(release): v2.4.4 [`#101`](https://github.com/ObolNetwork/obol-sdk/pull/101)
- remove not needed assignment [`#100`](https://github.com/ObolNetwork/obol-sdk/pull/100)

#### [v2.4.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.2...v2.4.3)

> 18 March 2025

- chore(release): v2.4.3 [`#98`](https://github.com/ObolNetwork/obol-sdk/pull/98)
- add hoodi [`#97`](https://github.com/ObolNetwork/obol-sdk/pull/97)

#### [v2.4.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.1...v2.4.2)

> 14 March 2025

- chore(release): v2.4.2 [`#96`](https://github.com/ObolNetwork/obol-sdk/pull/96)
- fetch incentives by network [`#95`](https://github.com/ObolNetwork/obol-sdk/pull/95)

#### [v2.4.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.4.0...v2.4.1)

> 13 March 2025

- chore(release): v2.4.1 [`#94`](https://github.com/ObolNetwork/obol-sdk/pull/94)
- expect a provider in client [`#93`](https://github.com/ObolNetwork/obol-sdk/pull/93)

#### [v2.4.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.3.0...v2.4.0)

> 13 March 2025

- chore(release): v2.4.0 [`#92`](https://github.com/ObolNetwork/obol-sdk/pull/92)
- incentives methods [`#90`](https://github.com/ObolNetwork/obol-sdk/pull/90)

#### [v2.3.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.4...v2.3.0)

> 6 March 2025

- chore(release): v2.3.0 [`#89`](https://github.com/ObolNetwork/obol-sdk/pull/89)
- feat: add getIncentivesByAddress method to fetch incentives for a given address [`#77`](https://github.com/ObolNetwork/obol-sdk/pull/77)

#### [v2.2.4](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.3...v2.2.4)

> 24 February 2025

- chore(release): v2.2.4 [`#87`](https://github.com/ObolNetwork/obol-sdk/pull/87)
- Hanan/v1.10.0 [`#86`](https://github.com/ObolNetwork/obol-sdk/pull/86)

#### [v2.2.3](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.2...v2.2.3)

> 21 February 2025

- chore(release): v2.2.3 [`#85`](https://github.com/ObolNetwork/obol-sdk/pull/85)
- v1.10.0 [`#81`](https://github.com/ObolNetwork/obol-sdk/pull/81)
- feat: add renovate.json [`#75`](https://github.com/ObolNetwork/obol-sdk/pull/75)

#### [v2.2.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.1...v2.2.2)

> 7 February 2025

- chore(release): v2.2.2 [`#74`](https://github.com/ObolNetwork/obol-sdk/pull/74)
- fix environment variable check and update readme [`#73`](https://github.com/ObolNetwork/obol-sdk/pull/73)

#### [v2.2.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.2.0...v2.2.1)

> 7 February 2025

- chore(release): v2.2.1 [`#72`](https://github.com/ObolNetwork/obol-sdk/pull/72)
- fix verify eoa and safe signatures when publishing a lock [`#71`](https://github.com/ObolNetwork/obol-sdk/pull/71)

#### [v2.2.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.2...v2.2.0)

> 7 February 2025

- chore(release): v2.2.0 [`#69`](https://github.com/ObolNetwork/obol-sdk/pull/69)
- Hanan/support safe [`#68`](https://github.com/ObolNetwork/obol-sdk/pull/68)

#### [v2.1.2](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.1...v2.1.2)

> 8 January 2025

- chore(release): v2.1.2 [`#66`](https://github.com/ObolNetwork/obol-sdk/pull/66)
- Hanan/safe fix [`#65`](https://github.com/ObolNetwork/obol-sdk/pull/65)

#### [v2.1.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.1.0...v2.1.1)

> 23 October 2024

- chore(release): v2.1.1 [`#62`](https://github.com/ObolNetwork/obol-sdk/pull/62)
- Add owr tranch function [`#61`](https://github.com/ObolNetwork/obol-sdk/pull/61)

#### [v2.1.0](https://github.com/ObolNetwork/obol-sdk/compare/v2.0.1...v2.1.0)

> 10 October 2024

- chore(release): v2.1.0 [`#60`](https://github.com/ObolNetwork/obol-sdk/pull/60)
- a warning and some improvements [`#59`](https://github.com/ObolNetwork/obol-sdk/pull/59)
- Hanan/create split [`#57`](https://github.com/ObolNetwork/obol-sdk/pull/57)

#### [v2.0.1](https://github.com/ObolNetwork/obol-sdk/compare/v2.0.0...v2.0.1)

> 6 August 2024

- chore(release): v2.0.1 [`#55`](https://github.com/ObolNetwork/obol-sdk/pull/55)
- Hanan/null deposit amounts [`#54`](https://github.com/ObolNetwork/obol-sdk/pull/54)
- accept a null value for deposit_amounts [`#52`](https://github.com/ObolNetwork/obol-sdk/pull/52)

### [v2.0.0](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.17...v2.0.0)

> 30 July 2024

- [Release] v2.0.0 [`#50`](https://github.com/ObolNetwork/obol-sdk/pull/50)

#### [v1.0.17](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.16...v1.0.17)

> 2 July 2024

- fix release action [`#49`](https://github.com/ObolNetwork/obol-sdk/pull/49)
- [Release] v1.0.17 [`#48`](https://github.com/ObolNetwork/obol-sdk/pull/48)
- use v1.8.0 in cluster creation [`#32`](https://github.com/ObolNetwork/obol-sdk/pull/32)
- chore(release): v1.0.17 [`#47`](https://github.com/ObolNetwork/obol-sdk/pull/47)
- revert back to using git changelog [`#46`](https://github.com/ObolNetwork/obol-sdk/pull/46)
- Hanan/ta nd c [`#44`](https://github.com/ObolNetwork/obol-sdk/pull/44)

#### [v1.0.16](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.15...v1.0.16)

> 24 May 2024

- chore(release): v1.0.16 [`#43`](https://github.com/ObolNetwork/obol-sdk/pull/43)
- Hanan/tandc [`#42`](https://github.com/ObolNetwork/obol-sdk/pull/42)

#### [v1.0.15](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.14...v1.0.15)

> 22 May 2024

- chore(release): v1.0.15 [`#41`](https://github.com/ObolNetwork/obol-sdk/pull/41)
- add acceptTermsAndConditions method [`#39`](https://github.com/ObolNetwork/obol-sdk/pull/39)

#### [v1.0.14](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.13...v1.0.14)

> 6 May 2024

- chore(release): v1.0.14 [`#40`](https://github.com/ObolNetwork/obol-sdk/pull/40)
- Fix publish step in release [`#38`](https://github.com/ObolNetwork/obol-sdk/pull/38)

#### [v1.0.13](https://github.com/ObolNetwork/obol-sdk/compare/v1.0.12...v1.0.13)

> 18 March 2024

- Update changelog [`#37`](https://github.com/ObolNetwork/obol-sdk/pull/37)
- Fix release WF [`#36`](https://github.com/ObolNetwork/obol-sdk/pull/36)
- chore(release): v1.0.13 [`#35`](https://github.com/ObolNetwork/obol-sdk/pull/35)
- add contribution guidelines [`#34`](https://github.com/ObolNetwork/obol-sdk/pull/34)
- support v1.8.0 [`#31`](https://github.com/ObolNetwork/obol-sdk/pull/31)
- update e2e during release [`#25`](https://github.com/ObolNetwork/obol-sdk/pull/25)
- Luke/Fix changelog [`#24`](https://github.com/ObolNetwork/obol-sdk/pull/24)
- Add a workflow to create a release PR [`#19`](https://github.com/ObolNetwork/obol-sdk/pull/19)
- fix changelog generation [`c16e588`](https://github.com/ObolNetwork/obol-sdk/commit/c16e5881773b47b7b7e02f3241888c49ed70077c)
- Create label-issues.yml [`0f1252f`](https://github.com/ObolNetwork/obol-sdk/commit/0f1252f24badba89251a3595cb5d57a0790e5faf)
- change to upgrade [`430bbc0`](https://github.com/ObolNetwork/obol-sdk/commit/430bbc05325f5b5f713b52952fd16954cf1396d6)

#### v1.0.12

> 27 February 2024

- Fix sdk deployment [`#18`](https://github.com/ObolNetwork/obol-sdk/pull/18)
- Hanan/update sdk [`#17`](https://github.com/ObolNetwork/obol-sdk/pull/17)
- Hanan/update sdk [`#16`](https://github.com/ObolNetwork/obol-sdk/pull/16)
- Hanan/update sdk [`#15`](https://github.com/ObolNetwork/obol-sdk/pull/15)
- Hanan/get cluster lock [`#12`](https://github.com/ObolNetwork/obol-sdk/pull/12)
- Hanan/config cluster method [`#3`](https://github.com/ObolNetwork/obol-sdk/pull/3)
- poc for obol-sdk [`#1`](https://github.com/ObolNetwork/obol-sdk/pull/1)
- Bump json5 from 2.2.1 to 2.2.3 [`#3`](https://github.com/ObolNetwork/obol-sdk/pull/3)
- add artifacts files [`76fe25c`](https://github.com/ObolNetwork/obol-sdk/commit/76fe25cf95733651b70d2e0d99f593994364a8c3)
- drop build info [`7265292`](https://github.com/ObolNetwork/obol-sdk/commit/7265292cb6b9264f4fe61bd4929a6d1acf495a15)
- add typechain files [`5e29b6a`](https://github.com/ObolNetwork/obol-sdk/commit/5e29b6adad0bc630d301a6274a58a678276ee773)
