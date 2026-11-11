![Obol Logo](https://obol.org/obolnetwork.png)

<h1 align="center">Obol SDK</h1>

TypeScript SDK for creating and managing Obol Distributed Validators: cluster definitions and locks, deposits,
Obol Validator Managers (OVM), splits, incentives and exits. Version 3 is built on [viem](https://viem.sh) and
replaces the 2.x `Client` (ethers) entirely; see the [CHANGELOG](CHANGELOG.md).

## Install

```bash
npm install @obolnetwork/obol-sdk viem
```

`viem@^2.27.0` is a peer dependency. Node 20+ (CommonJS or ESM) and browsers (ESM) are supported; the browser build
needs no `Buffer` or other Node polyfill.

## Create a client

```typescript
import { createObolClient } from '@obolnetwork/obol-sdk';
import { createPublicClient, createWalletClient, custom, http } from 'viem';
import { hoodi } from 'viem/chains';

const publicClient = createPublicClient({ chain: hoodi, transport: http() });
const walletClient = createWalletClient({
  chain: hoodi,
  transport: custom(window.ethereum),
});

const obol = createObolClient({
  chain: hoodi, // mainnet or Hoodi; Gnosis and Sepolia for cluster files only
  publicClient,
  walletClient, // optional: needed for EIP-712 signatures and sends
  // api: false  // chain-only; the default is the Obol API at api.obol.tech
});
```

TypeScript with `module: commonjs` and `moduleResolution: node10` (a NestJS default): `viem/chains` pulls ox's `.ts`
sources into `tsc`, whose errors `skipLibCheck` does not hide. Use `moduleResolution: bundler`, or build the chain with
viem's `defineChain` (the SDK matches chains by `id`); see [MIGRATION.md](MIGRATION.md) "Verifying locks on a
server".

Every module is also exported as a namespace (`cluster`, `deposits`, `ovm`, `splits`, `setup`, `incentives`,
`exits`, `terms`, `withdrawals`, and `experimental` for `simulate` and `legacy`), so the pure functions (hashing, lock
verification, share math, exit aggregation) work without a client. Each module is also its own entry point, so a page
that needs one module loads only that one (a reads-only `ovm` import has no BLS or SSZ code):

```typescript
import { createObolContext, createOvmModule } from '@obolnetwork/obol-sdk/ovm';

const ovm = createOvmModule(createObolContext({ chain: hoodi, publicClient }));
const state = await ovm.getState(ovmAddress); // null when the address is not an OVM
```

## Naming

Operation names say what they do with a problem:

| Prefix | What it does | Examples |
|---|---|---|
| `prepare*` | builds a checked transaction (`Prepared`); throws for an error, reports findings in `checks`; sends nothing | `deposits.prepareDeposit`, `ovm.prepareWithdraw`, `splits.prepareDistributeAll` |
| `preview*` | the same reads and checks as its `prepare*`, returning `{ preview, checks, blockNumber }` and no transaction | `ovm.previewDistribute`, `splits.previewDistributeAll` |
| `verify*` | checks untrusted input and **returns** a result object (always truthy: read `.ok`); throws only for malformed input | `cluster.verifyLock`, `cluster.verifyDefinition` |
| `isValid*` | the same as a boolean | `isValidLock`, `cluster.isValidEnr`, `isValidTypedDataSignature` |
| `assert*` | checks and **throws** when the check fails; for use before a write | `deposits.assertDepositData`, `exits.assertPartialExit` |
| `get*` | reads | `ovm.getState`, `ovm.getProvenance`, `splits.getSplit`, `cluster.getLock` |
| `compute*` | pure hashing | `cluster.computeConfigHash` |

## Prepare, then send

Writes are split in two. A `prepare*` operation runs every check, reads what it needs from the chain and the API,
and returns `Prepared` values: a `kind` (which operation), an encoded `request` (`to`, `data`, `value`, `chainId`),
`checks` (findings with a `severity` and, when about one item, a `subject`), a `preview` typed by
`kind`, and the `blockNumber` it read (`isStale(prepared, head, maxAgeBlocks)` tells when to prepare again). Every
`preview*` operation returns `{ preview, checks, blockNumber }`. Nothing is sent until you pass it to `send`, or to your own wallet
layer (wagmi, a Safe, a relayer).

```typescript
import { parseEther } from 'viem';

const lock = await obol.cluster.getLock({ configHash });

// Verified deposits from the lock (amounts in wei). A lock made with Charon's defaults holds a 1 ETH and a 32 ETH
// deposit per validator, so say which one: without `amount` such a lock throws DEPOSIT_AMOUNT_REQUIRED.
const { deposits } = await obol.deposits.fromLock(lock, { amount: parseEther('32') });

// Checks credentials, signatures, OVM provenance (on chain) and roles, and that the validators do not exist yet.
const prepared = await obol.deposits.prepareDeposit({ deposits, via: { ovm: ovmAddress } });

for (const tx of prepared) {
  const sent = await obol.send(tx); // throws FINDINGS_NOT_ACKNOWLEDGED if tx.checks has a warning
  await sent.wait();
}
```

### Acknowledging warnings

An error stops `prepare*`. A finding does not. A finding with `severity: 'info'` is for the record. One with
`severity: 'warning'` means the transaction may not do what you intend (a top-up of someone else's validator, a
consolidation into another withdrawal address) or that a safety check could not run, and **`send` refuses it**
(`FINDINGS_NOT_ACKNOWLEDGED`, before the wallet is asked) until you acknowledge its code. Most transactions carry
no warning and need nothing: `await obol.send(tx)`.

Three helpers do the work, all pure:

| Helper | Returns | For |
|---|---|---|
| `warningsOf(tx, sim?)` | the warnings (`code`, `message`, `hint`, `subject`, `details`) | showing them |
| `warningCodes(tx, sim?)` | their distinct codes | `acknowledge`, once they were shown and accepted |
| `findingsToAcknowledge(tx, { acknowledge, simulation })` | the warnings still open | gating your own wallet layer |

`acknowledge` is always a list of codes (`readonly FindingCode[]`), typed and documented: hover a code, or a key of
`FINDINGS`, for its meaning. There is deliberately no `true` or `'all'`: a value that would also cover warnings
nobody has looked at is the one thing `send` does not accept. `warningCodes(tx, sim)` is the honest one-liner: it
acknowledges exactly the warnings this transaction carries now.

**1. A confirmation dialog (React, wagmi or `obol.send`).** Show the warnings; confirming acknowledges what was
shown.

```tsx
import { warningCodes, warningsOf, type AnyPrepared } from '@obolnetwork/obol-sdk';
import type { Simulation } from '@obolnetwork/obol-sdk/experimental';

function ConfirmDialog({ tx, sim, onSent }: { tx: AnyPrepared; sim?: Simulation; onSent: (hash: string) => void }) {
  const warnings = warningsOf(tx, sim); // [] for most transactions
  const [accepted, setAccepted] = useState(false);
  return (
    <Dialog>
      {warnings.map((w, i) => (
        <Warning key={i} title={w.message} detail={w.hint} />
      ))}
      {warnings.length > 0 && (
        <Checkbox checked={accepted} onChange={setAccepted} label="I understand these warnings and want to continue" />
      )}
      <Button
        disabled={warnings.length > 0 && !accepted}
        onClick={async () => {
          // Exactly the warnings rendered above. With wagmi, send tx.request yourself instead.
          const sent = await obol.send(tx, { simulation: sim, acknowledge: warningCodes(tx, sim) });
          onSent(sent.hash);
        }}
      >
        Confirm
      </Button>
    </Dialog>
  );
}
```

**2. A headless script with a fixed policy.** Name the codes the script accepts; anything else still throws, which
is what you want from a script.

```typescript
import { UNCHECKED_WARNING_CODES, isObolError, type FindingCodeFor } from '@obolnetwork/obol-sdk';

// This operator runs without a beacon node, so "could not check the validator status" is expected.
// Annotating with the kind makes the editor offer only the codes a withdrawal can carry.
const policy: FindingCodeFor<'withdraw'>[] = ['VALIDATOR_STATUS_UNCHECKED'];

const tx = await obol.ovm.prepareWithdraw({ ovm, requests });
try {
  await (await obol.send(tx, { acknowledge: policy })).wait();
} catch (error) {
  if (!isObolError(error, 'FINDINGS_NOT_ACKNOWLEDGED')) throw error;
  // Typed: error.details.codes is WarningCode[], error.details.findings is Finding<WarningCode>[].
  console.error(error.message); // one numbered line per warning, with its hint
  process.exit(2); // a warning the policy does not cover: a person decides
}

// A ready-made list: every warning that only means "a check could not run" (never one about what the
// transaction does). Read it before you use it.
await obol.send(tx, { acknowledge: UNCHECKED_WARNING_CODES });
```

**3. An AI agent.** The agent prepares, reports the warnings to its operator and sends only with the codes the
operator accepted. It never acknowledges on its own.

```typescript
import { warningsOf, warningCodes, FINDINGS, type WarningCode } from '@obolnetwork/obol-sdk';

const tx = await obol.ovm.prepareConsolidate({ ovm, requests });
const sim = await obol.experimental.simulate(tx, { from: account });
const warnings = warningsOf(tx, sim);

let accepted: WarningCode[] = [];
if (warnings.length > 0) {
  // Report in the operator's terms: what it is, what it means, what accepting it accepts.
  const report = warnings.map(w => ({
    code: w.code,
    message: w.message,
    about: w.subject,
    meaning: FINDINGS[w.code].meaning,
    beforeAccepting: FINDINGS[w.code].guidance,
  }));
  accepted = await askOperator(report); // the codes the operator accepted; [] to stop
  if (accepted.length === 0) throw new Error('Operator declined');
}
// If the operator accepted only some, send throws FINDINGS_NOT_ACKNOWLEDGED naming the rest: report again.
await obol.send(tx, { simulation: sim, acknowledge: accepted });
```

The same rule, if `send` throws first: `error.message` lists each open warning, `error.details.findings` has them
as objects, and `error.hint` gives the exact call. An agent that reads the hint and resubmits with the codes
without asking anyone has ignored the warnings; the hint says so.

Every warning `send` can refuse (the same text as `FINDINGS[code]`; `info` findings are in
[`spec/errors.md`](spec/errors.md)):

| Warning | Meaning | Before you acknowledge |
|---|---|---|
| `DEPOSIT_EXISTENCE_UNCHECKED` | No deposit status source: whether the validators already exist, and with which withdrawal credentials, was not checked. | Pass `beaconUrl` or enable the Obol API so it is checked. Acknowledge only after checking each pubkey yourself (a beacon explorer): a deposit to a validator someone else created first goes to their withdrawal address. |
| `QUEUED_CREDENTIALS_CONFLICT` | Validly signed deposits queued for the pubkey carry different withdrawal credentials; the first one (yours) applies. | Find out who queued the other deposits. Acknowledge only if you accept adding ETH to a validator others have also deposited to. |
| `TOP_UP_ABOVE_EFFECTIVE_CAP` | The deposit takes a 0x00 / 0x01 validator above 32 ETH; the excess is swept back to the withdrawal address, not staked. | Deposit at most up to 32 ETH, or switch the validator to 0x02 first. Acknowledge if the round trip of the excess is acceptable. |
| `TOP_UP_EXITED_VALIDATOR` | Top-up to an exited validator: the ETH is swept back to its withdrawal address, not staked. | Do not top up an exited validator. Acknowledging sends ETH on a round trip to the withdrawal address. |
| `TOP_UP_CREDENTIALS_FOREIGN` | Top-up to a validator whose withdrawal credentials are not the expected address's: the ETH can only be withdrawn to those credentials. | Acknowledge only for a deliberate top-up of a validator you do not control. The ETH cannot be recovered. |
| `OVM_STAKE_NOT_TRACKED` | Deposit to an OVM's credentials through the batch contract: the OVM does not count it as principal, so it would later be paid out as rewards. | Deposit via the OVM instead. Acknowledge only if the owner will call `setAmountOfPrincipalStake` afterwards. |
| `PROVENANCE_UNKNOWN` | Could not check that the contract was created by the Obol OVM factory. | Retry `ovm.getProvenance`, or use an RPC that serves `eth_getLogs`. Acknowledge only if you know the contract by other means (you deployed it). |
| `VALIDATOR_STATUS_UNCHECKED` | The beacon chain request rules could not all be checked (`details.checks`); for a consolidation the withdrawal addresses were not compared. | Pass `beaconUrl` or enable the Obol API. Acknowledging accepts that the request may be ignored (fee lost) and, for a consolidation, that you checked the target's withdrawal address yourself. |
| `PARTIAL_WITHDRAWAL_QUEUE_FULL` | The beacon chain's pending partial withdrawal queue is full: the request would be ignored and the fee kept. | Wait for the queue to drain. Acknowledging spends the fee for a request that is likely to be dropped. |
| `CONSOLIDATION_CREDENTIALS_DIFFER` | Source and target validators have different withdrawal addresses: the stake moves out of this OVM and cannot be moved back. | Acknowledge only if the target validator and its withdrawal address (`details.targetWithdrawalAddress`) are yours. |
| `ROLE_GRANT_CONSOLIDATION` | Granting CONSOLIDATION: the holder can move the whole stake into a validator it controls. | Acknowledge only for an address you would trust with the stake. |
| `ROLE_GRANT_DEPOSIT_TO_PRINCIPAL` | Granting DEPOSIT to the principal recipient: it can raise the principal stake and take rewards as principal. | Grant DEPOSIT to another address. Acknowledge only if the reward recipients accept that. |
| `ROLES_SURVIVE_TRANSFER` | A change of owner does not revoke roles: the listed holders keep theirs. | Revoke the roles that should not survive, before or after. Acknowledge if the new owner knows the holders. |
| `SIMULATION_UNAVAILABLE` | The node could not simulate the request in full: only success or revert was checked, not what it moves. | Use an RPC with `eth_simulateV1`. Acknowledging sends on the strength of the preview alone. |
| `SIMULATION_REVERTED` | The transaction reverts when simulated. | Do not send; prepare again, or fix the sender or state. Acknowledging sends a transaction expected to fail (gas lost). |
| `SIMULATION_PREVIEW_MISMATCH` | The simulation differs from the operation's preview. | Prepare again and simulate the new transaction. Acknowledging sends a transaction whose effect is not the one previewed. |
| `SIMULATION_READS_INCOMPLETE` | Some balances or state could not be read while simulating: the changes shown are incomplete and not fully compared with the preview. | Simulate again, or on another RPC. Acknowledging sends without the full comparison; a missing change is not "no change". |
| `SIMULATION_UNTRUSTED_EVENT` | A contract with no known role in this transaction emitted events; they were not interpreted. | Look at the listed contracts. Acknowledge if they are expected (a recipient contract reacting to ETH). |

Sending `tx.request` yourself (wagmi, a Safe app, a relayer)? `send` is not involved, so gate on
`findingsToAcknowledge(tx, { acknowledge, simulation })`: send only when it returns `[]`.

A deposit to a validator that already exists is not a warning but an error: `DEPOSIT_VALIDATOR_EXISTS` (use
`kind: 'topUp'` to add stake), or `DEPOSIT_CONFLICT` when it exists with withdrawal credentials that are not yours
(someone deposited first; the ETH would be theirs).

To show what a transaction will do before the user signs it, simulate it (experimental: the result shape may still
change). `simulate` runs the request on the node without sending it and returns the balance changes, gas, events,
state changes, plain-language `summary` lines and a comparison with the operation's own `preview`:

```typescript
const prepared = await obol.ovm.prepareDistribute({ ovm: ovmAddress });
const sim = await obol.experimental.simulate(prepared, { from: account });

if (!sim.success) throw new Error(sim.summary[0]); // "Reverts: Unauthorized()"
sim.summary.forEach(line => console.log(line));
// 0x1234…abcd (principal recipient) receives 32.000000 ETH
// 0x5678…ef01 (reward recipient) receives 1.200000 ETH
if (!sim.limited && sim.matchesPreview.status !== 'match') console.warn(sim.matchesPreview);

// Pass the simulation to send: its warnings then need acknowledging too (a revert, a difference from the preview,
// reads that failed, or a node that could not simulate at all).
await obol.send(prepared, { simulation: sim });
```

It uses `eth_simulateV1` (geth, Nethermind, Erigon, Reth, anvil and most public RPCs), else `debug_traceCall`; on a
node with neither, the result is `limited` (success or revert only) with the warning `SIMULATION_UNAVAILABLE`.
`matchesPreview.status` is `match`, `mismatch` or `notCompared`; `matchesPreview.ok` is true only for `match`, never
when nothing was compared or a balance read failed (`SIMULATION_READS_INCOMPLETE`). A Safe is simulated as the Safe
calling; its own signature checks are not. Simulate just before sending: the state can change before the
transaction is mined.

Failures throw `ObolError` (or `ObolApiError` for API responses) with a stable `code`, a `hint` and `details`:

```typescript
import { isObolError } from '@obolnetwork/obol-sdk';

try {
  await obol.deposits.fromLock(lock);
} catch (error) {
  if (isObolError(error, 'LOCK_INVALID')) {
    // do not deposit: error.details.step says which check failed (typed per code)
  }
}
```

`isObolError` recognises an error from any copy of the SDK (the CommonJS and ESM builds loaded together, or two
installed versions); `instanceof ObolError` does not, so prefer it.

Inputs and options are strict: a key an operation does not know is `PAYLOAD_INVALID` (the message names the key and
the allowed ones), so a misspelt option is never silently ignored. Documents (cluster definitions and locks,
deposits, the Obol API's exit objects) may carry extra fields.

### Lock verification

`cluster.verifyLock` runs on the calling thread and yields to the event loop every `yieldMs` (default 50), so pages
and servers stay responsive. `level: 'full'` (default) runs every check; `level: 'attested'` relies on the node
signatures over `lock_hash` for the BLS checks Charon ran during the DKG and checks the deposit signatures of the
validators you name, which is what `deposits.fromLock` does for the deposits it returns:

```typescript
const result = await obol.cluster.verifyLock(lock, { level: 'attested', signatures: [0, 1] });
// { ok: false, level: 'attested', step: 'deposit_data_invalid', issue: 'signature_invalid', validator: 1 }
```

Cluster definition and lock versions v1.6.0, v1.7.0, v1.8.0, v1.10.0 and v1.11.0 are supported (new ones are created
at v1.10.0 or later). v1.9.0 is not, as in the Obol API: `verifyLock` reports `{ step: 'hash_mismatch', issue:
'version_unsupported' }` and the hash functions throw `DEFINITION_INVALID`.

BLS is pure JavaScript by default (about 25 ms per signature), which suits pages and scripts. Contract-wallet
(Safe) definition signatures are checked with EIP-1271 through a public client on the lock's chain: the bound client
uses its own; standalone calls take `publicClient` or `publicClients` (by chain id). Without one, such a signature
fails as `definition_signature_unverifiable`.

### Servers

A Node server that verifies locks from users (the Obol API does) should:

- call `isValidLock` (a boolean; `verifyLock` returns an object, always truthy) or check `verifyLock(...).ok`, and map
  `PAYLOAD_INVALID` (a malformed lock) to a 400;
- keep `level: 'full'` (the default). **Never `attested` on a server:** it skips share binding and the aggregate
  signature;
- pass the native BLS backend from `@obolnetwork/obol-sdk/blst` (install the optional peer `@chainsafe/blst`): a 1k
  validator lock at `full` takes about 1.3 s instead of 80 s of event-loop time;
- pass `publicClients` for every chain it serves, so Safe-created clusters verify (2.x had built-in RPCs; v3 has
  none);
- bound the CPU per request with `signal` (`AbortSignal.timeout(ms)`, or the request's own signal): the run stops at
  the next yield point with `ABORTED` (map it to a 503, not to "invalid"); racing the promise would leave the work
  running. Apply a concurrency limit around the call (there are no workers);
- warm the BLS backend at boot (`await loadBlstBackend()`): there is no fallback if the native binding fails to load
  (`BLS_BACKEND_UNAVAILABLE`), so fail the deploy rather than the first request.

```typescript
import { isValidLock } from '@obolnetwork/obol-sdk';
import { loadBlstBackend } from '@obolnetwork/obol-sdk/blst';

const bls = await loadBlstBackend(); // once; BLS_BACKEND_UNAVAILABLE if @chainsafe/blst is missing
const publicClients = { 1: mainnetClient, 560048: hoodiClient };

const ok = await isValidLock(lock, {
  bls,
  publicClients,
  signal: AbortSignal.timeout(10_000), // ABORTED after 10 s
});
if (!ok) throw new BadRequestException('Invalid lock');
```

`isValidTypedDataSignature({ address, signature, typedData, chainId?, publicClients })` checks an EIP-712 bearer
signature (an account by recovery, a Safe by EIP-1271), and `cluster.isValidEnr` / `cluster.parseEnr` validate ENRs.

## Specification

What each operation checks, reads and returns, every error and finding code, and the test vectors are in
[`spec/`](spec/README.md): [`operations.md`](spec/operations.md), [`errors.md`](spec/errors.md),
[`lifecycles.md`](spec/lifecycles.md), [`schemas/`](spec/schemas/) and [`vectors/`](spec/vectors/README.md). Moving
from 2.x, or from an earlier 3.0 release candidate: [MIGRATION.md](MIGRATION.md).

## Terms and Conditions

Creating a cluster definition or accepting an invite needs the [latest Obol terms and conditions](https://obol.org/terms.pdf)
accepted once per address: `obol.terms.hasAccepted()` and `obol.terms.accept()`.

## Security

- **API host:** `api.baseUrl` must be one of `https://api.obol.tech`, `https://obol-api-nonprod-dev.dev.obol.tech`
  or `https://obol-api-nonprod-qa.dev.obol.tech`, because EIP-712 signatures are sent to it as bearer tokens. Any
  other value throws `BASE_URL_INVALID`, except `http(s)://localhost[:port]` and `http(s)://127.0.0.1[:port]` with
  `api: { baseUrl, allowLocal: true }`, for a local obol-api.
- **Keys:** the SDK never sees private keys; it uses the viem `walletClient` you pass. Keep backend keys in a KMS or
  HSM and never commit them.

## Contributing

Report bugs and propose features in [Issues](https://github.com/ObolNetwork/obol-sdk/issues). For changes, fork the
repo, branch, and open a pull request with a clear description; every PR is reviewed before merge. Development
notes for humans and agents are in [AGENTS.md](AGENTS.md).
