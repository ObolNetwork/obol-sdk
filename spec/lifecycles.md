# Lifecycles

States the SDK reports, how a thing moves between them, and which operation or event observes each state. Operation
details are in [`operations.md`](operations.md).

## Cluster

```
            create                 accept (each operator)          (all signed)               DKG (Charon)
 (none) ───────────► created ─────────────────────────► accepting ──────────► definition ready ─────────► lock published
```

| State | Meaning | Observed by |
|---|---|---|
| `created` | `POST /v1/definition` succeeded; the creator signed the config hash. No operator signed yet. | `cluster.create` returns the `configHash`; `cluster.get` |
| `accepting` | Some operators have `config_signature` + `enr_signature`, not all. | `cluster.watch` `operator_signed { address, signed, total }` (once per newly signed operator); `cluster.get` |
| `definition ready` | Every operator signed (group flow). The definition hash is final; operators can run the DKG. | `cluster.watch` `definition_ready` (once) |
| `lock published` | The DKG produced a lock and it was posted to the API. | `cluster.watch` `lock_published { lockHash }`, then ends; `cluster.getLock({ configHash })` stops returning 404 |

Notes:

- Accepting twice with the same ENR is a no-op (`cluster.accept` returns the definition without signing). A different
  ENR re-signs; the API decides whether that is allowed (409 → `API_CONFLICT`).
- The solo flow (creator signs, operators carry ENRs only) and the Charon flow (nothing signed) are created outside
  `cluster.create`; their definitions are `definition ready` as soon as they exist.
- A published lock is not trusted until `cluster.verifyLock` passes. `deposits.fromLock` verifies by default (level
  `attested` plus the signatures of the deposits it returns; `verify: 'full'` for every check).
- The DKG itself and a failed DKG are not visible to the SDK: the cluster stays `definition ready`.

## Transaction

```
 prepareX ──► prepared ──send──► sent ──wait──► mined
                 │                 ├──────────► reverted
                 │                 ├──────────► replaced (cancelled / replaced; repriced is followed)
                 │                 └──────────► unconfirmed (timeout)
                 └── wallet refuses ──► not sent
```

| State | Meaning | Observed by | Safe to retry? |
|---|---|---|---|
| `prepared` | Checked and encoded at one block; nothing sent. | the `Prepared` value (`kind`, `blockNumber`; `isStale(prepared, head, maxAgeBlocks)`) | – |
| not sent | The wallet refused or failed before returning a hash. | `send` throws `TX_REJECTED` | yes |
| `sent` | The wallet returned a hash. | `send` resolves `{ hash, wait }` | no: look the hash up first |
| `mined` | Receipt with `status = 1`. | `wait` resolves the receipt | – |
| `reverted` | Receipt with `status = 0`. Nothing moved (the fee for gas was spent). | `wait` throws `TX_REVERTED` | yes |
| `replaced` | Another transaction with the same nonce was mined instead (viem reason `cancelled` or `replaced`, in `details.reason`), so the prepared call did not run. A `repriced` transaction (same call, higher gas) is followed instead (`onReplaced`, where an app re-keys the hash it keeps) and ends `mined` or `reverted`. | `wait` throws `TX_REPLACED` | yes (the call did not run) |
| `unconfirmed` | No receipt within `timeoutMs`. It may still be mined or dropped. | `wait` throws `TX_UNCONFIRMED` | no: watch the hash |

Notes:

- `send` returns as soon as the wallet gives a hash, so the caller always has the hash before waiting, and every error
  from `wait` carries it. This replaces 2.15's `TransactionSubmissionError` (`pendingStatus: "reverted"` →
  `TX_REVERTED`, `"unconfirmed"` → `TX_UNCONFIRMED`).
- Multi-transaction operations (`prepareDeposit` via OVM, more than 500 batch deposits) return several `Prepared`;
  each goes through this lifecycle on its own. The caller keeps the hashes; the SDK does not loop.
- A Safe returns a `safeTxHash`, which never appears on-chain. `send` detects a contract-wallet account
  (`contractWallet: true`) and `wait` then follows the Safe's `ExecutionSuccess` / `ExecutionFailure` log for that hash
  instead of a receipt; `sent` covers proposal, collecting signatures and execution, and can take a long time.
- Idempotency on retry: deposits are not idempotent (a second deposit adds stake or tops up); creating a split is (same
  CREATE2 address; `prepareOvmWithSplits` skips existing splits); creating an OVM is not (each call deploys a new one);
  distribution is (a second call distributes 0); a withdrawal request is not (each one is queued and charged).

## Deposit

Per validator pubkey, as reported by `deposits.status` (API `/state` including EIP-6110 `pending_deposits`; beacon
fallback with `beaconUrl`).

```
          deposit                 processed by the beacon chain       activation           exit / full withdrawal
 new ─────────────────► queued ──────────────────────────► queued ───────────► active ─────────────────────► exited
                        (pending_deposits)                (registry pending_*)     │ ▲
                                                                                    │ │ top-up processed
                                                                                    ▼ │
                                                                         active + pending top-up
```

| Status | Beacon state | Observed by | What `prepareDeposit` does |
|---|---|---|---|
| `new` | no registry entry, no pending deposit | `deposits.status` | `deposit`: full checks incl. BLS. `topUp`: `DEPOSIT_TOP_UP_TARGET_MISSING` |
| `queued` | in `pending_deposits` (`beaconStatus: "pending_deposit"`), or registry `pending_initialized` / `pending_queued` | `deposits.status` (`pendingDeposits[]`, `beaconStatus`) | same credentials: `DEPOSIT_ALREADY_QUEUED` (info); different or unknown credentials: `DEPOSIT_CONFLICT` |
| `active` | `active_ongoing`, `active_exiting`, `active_slashed` | `deposits.status` (`validatorIndex`, `balance`) | `deposit`: `DEPOSIT_IS_TOP_UP` (warning); `topUp`: allowed |
| `exited` | `exited_*`, `withdrawal_*` | `deposits.status` | `topUp`: `TOP_UP_EXITED_VALIDATOR` (warning) |

Notes:

- **New deposit**: needs a valid BLS signature over the deposit message for the chain and the intended credentials;
  the first processed deposit for a pubkey fixes the credentials for good. That is why a pending deposit with other
  credentials is a conflict, not a warning.
- **Top-up**: a deposit to an existing (or already queued) pubkey. The signature is not checked by the beacon chain and
  the credentials are ignored, so Launchpad sends all-zero credentials and signature. Allowed up to 2048 ETH; the
  effective balance cap is the validator's (32 ETH for `0x01`, 2048 ETH for `0x02`). A top-up to a pubkey that is not
  known is a deposit with an invalid signature: the ETH is lost.
- A deposit through the OVM (`OVM.deposit`) also raises `amountOfPrincipalStake`, which decides how withdrawn funds are
  routed (see `distribution.json` `routing`). A deposit through the batch contract does not.
- **Withdrawal and exit** requests (EIP-7002 via `ovm.prepareWithdraw` / `withdrawals.prepareEoaWithdraw`) move a validator towards
  `exited` (amount 0) or reduce its balance (partial, `0x02` only). The request transaction being mined does not mean
  the beacon chain accepted it; `deposits.status` shows the effect. The beacon chain ignores (and keeps the fee of) a
  request for a validator that is not active, already exiting, activated less than 256 epochs ago, not credentialed to
  the sender, an exit behind pending partial withdrawals, and a partial without `0x02`, below 32 ETH effective balance
  or with no excess: the `prepare*` operations refuse each of these when the status source can tell
  (operations.md `prepareWithdraw` 6), and report the ones they could not check as `VALIDATOR_STATUS_UNCHECKED`.
- Without the API and without `beaconUrl`, there is no status: `prepareDeposit` adds `DEPOSIT_EXISTENCE_UNCHECKED` and
  relies on `kind` alone.
