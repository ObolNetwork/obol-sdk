/**
 * Recorded JSON-RPC exchanges for the simulate tests. `test/simulate/e2e.spec.ts`
 * records them from an anvil Hoodi fork (SIMULATE_E2E=1 SIMULATE_RECORD=1);
 * the unit tests replay them through a fake EIP-1193 provider.
 */
import { readFileSync } from 'node:fs';
import { createPublicClient, custom, type PublicClient } from 'viem';
import { hoodi } from 'viem/chains';
import { CHAINS } from '../../src/chains.js';
import type { Context } from '../../src/context.js';
import type { AnyPrepared } from '../../src/types.js';
import type { SimulationBackend } from '../../src/simulate/types.js';

export interface Exchange {
  method: string;
  params: unknown[];
  result?: unknown;
  error?: { code: number; message: string; data?: unknown };
}

export interface Recording {
  name: string;
  from: string;
  prepared: AnyPrepared;
  /** Scenario addresses (OVM, splits, recipients). */
  meta: Record<string, string>;
  backends: Partial<Record<SimulationBackend, Exchange[]>>;
}

export const toJson = (value: unknown): string =>
  JSON.stringify(value, (_, v) =>
    typeof v === 'bigint' ? { __bigint: v.toString() } : v,
  );

export const fromJson = <T>(text: string): T =>
  JSON.parse(text, (_, v) =>
    v !== null && typeof v === 'object' && '__bigint' in v
      ? BigInt(v.__bigint)
      : v,
  ) as T;

export const FIXTURES = 'test/simulate/fixtures';

export const loadRecording = (name: string): Recording =>
  fromJson<Recording>(readFileSync(`${FIXTURES}/${name}.json`, 'utf8'));

export const rpcError = (error: {
  code: number;
  message: string;
  data?: unknown;
}): Error => Object.assign(new Error(error.message), error);

/**
 * A client that answers each request from the recorded exchanges (matched
 * by method and params). `overrides` answer first, e.g. to refuse a method.
 */
export const replayClient = (
  exchanges: Exchange[],
  overrides: Record<string, () => unknown> = {},
): { client: PublicClient; calls: string[] } => {
  const byKey = new Map<string, Exchange>();
  for (const e of exchanges) {
    byKey.set(JSON.stringify([e.method, e.params]), e);
  }
  const calls: string[] = [];
  const client = createPublicClient({
    chain: hoodi,
    transport: custom(
      {
        request: async ({ method, params }) => {
          calls.push(method);
          const override = overrides[method];
          if (override !== undefined) return override();
          const exchange = byKey.get(JSON.stringify([method, params ?? []]));
          if (exchange === undefined) {
            throw new Error(
              `No recorded answer for ${method} ${JSON.stringify(params)}`,
            );
          }
          if (exchange.error !== undefined) throw rpcError(exchange.error);
          return exchange.result;
        },
      },
      { retryCount: 0 },
    ),
  });
  return { client, calls };
};

export const contextFor = (client: PublicClient): Context => ({
  chain: CHAINS[560048],
  publicClient: client,
  api: null,
});

/** Refuses a method the way geth does. */
export const methodNotFound = (method: string) => () => {
  throw rpcError({
    code: -32601,
    message: `the method ${method} does not exist/is not available`,
  });
};
