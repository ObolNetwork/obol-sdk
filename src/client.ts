import type { ObolChain } from './chains.js';
import { createObolContext, type ObolClientConfig } from './clientContext.js';
import { send, type Sent } from './send.js';
import {
  simulate,
  type SimulateOptions,
  type Simulation,
} from './simulate/index.js';
import type { AnyPrepared } from './types.js';
import { createClusterModule, type ClusterModule } from './cluster/index.js';
import { createDepositsModule, type DepositsModule } from './deposits/index.js';
import { createExitsModule, type ExitsModule } from './exits/index.js';
import {
  createIncentivesModule,
  type IncentivesModule,
} from './incentives/index.js';
import { createLegacyModule, type LegacyModule } from './legacy/index.js';
import { createOvmModule, type OvmModule } from './ovm/index.js';
import { createSetupModule, type SetupModule } from './setup/index.js';
import { createSplitsModule, type SplitsModule } from './splits/index.js';
import { createTermsModule, type TermsModule } from './terms/index.js';
import {
  createWithdrawalsModule,
  type WithdrawalsModule,
} from './withdrawals/index.js';

export type { ObolClientConfig };

/** Features whose shapes may still change before they are declared stable. */
export interface ExperimentalModule {
  /**
   * Runs a prepared request on the node without sending it and reports what
   * it would do (spec/operations.md "simulate").
   */
  simulate: (
    prepared: AnyPrepared,
    options?: SimulateOptions,
  ) => Promise<Simulation>;
  /** Reads of 2.x-era OWR contracts. */
  legacy: LegacyModule;
}

/** The client: every module bound to one chain, viem clients and API. */
export interface ObolClient {
  chain: ObolChain;
  cluster: ClusterModule;
  deposits: DepositsModule;
  ovm: OvmModule;
  splits: SplitsModule;
  setup: SetupModule;
  incentives: IncentivesModule;
  exits: ExitsModule;
  terms: TermsModule;
  withdrawals: WithdrawalsModule;
  /** Sends `prepared.request` with the wallet; see `send`. */
  send: (prepared: AnyPrepared) => Promise<Sent>;
  experimental: ExperimentalModule;
}

/**
 * createObolClient (spec/operations.md "Client"): `createObolContext` checks
 * the chain, the viem clients and the API settings, then every module is
 * bound to that one context.
 */
export const createObolClient = (config: ObolClientConfig): ObolClient => {
  const ctx = createObolContext(config);
  const chain = ctx.chain;
  return {
    chain,
    cluster: createClusterModule(ctx),
    deposits: createDepositsModule(ctx),
    ovm: createOvmModule(ctx),
    splits: createSplitsModule(ctx),
    setup: createSetupModule(ctx),
    incentives: createIncentivesModule(ctx),
    exits: createExitsModule(ctx),
    terms: createTermsModule(ctx),
    withdrawals: createWithdrawalsModule(ctx),
    send: async prepared => await send(ctx, prepared),
    experimental: {
      simulate: async (prepared, options) =>
        await simulate(ctx, prepared, options),
      legacy: createLegacyModule(ctx),
    },
  };
};
