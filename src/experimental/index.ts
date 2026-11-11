/**
 * Experimental: features whose shapes may still change in a minor release.
 * Import them from `@obolnetwork/obol-sdk/experimental` (or the
 * `experimental` namespace); the client binds them as `obol.experimental`.
 *
 * - `simulate`: run a `Prepared` request on the node before signing.
 * - `legacy`: reads of 2.x-era OWR contracts.
 */
export {
  formatEth,
  simulate,
  type BalanceChange,
  type FullSimulation,
  type LimitedSimulation,
  type OvmValueName,
  type PreviewComparison,
  type RevertReason,
  type SimulatedEvent,
  type SimulatedGas,
  type SimulateOptions,
  type Simulation,
  type SimulationBackend,
  type StateChange,
} from '../simulate/index.js';
export * as legacy from '../legacy/index.js';
export type { ExperimentalModule } from '../client.js';
