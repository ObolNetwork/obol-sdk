// SDK side of the differential fuzzer: reads case file paths from stdin (one
// per line), runs cluster.verifyLock(lock, { level: 'full' }) with the chosen
// backend, writes one JSON result per line.
//
//   node sdkRunner.mjs noble|blst [--hashes] < paths
//
// --hashes also records the SDK's one-shot and sliced config / definition /
// lock hashes (compared with Charon's and with each other by the driver).
import { readFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { fromHexString } from '@chainsafe/ssz';
import { nobleBls, type BlsBackend } from '../../src/cluster/blsBackend.js';
import { verifyLock } from '../../src/cluster/verifyLock.js';
import {
  clusterConfigOrDefinitionHash,
  clusterConfigOrDefinitionHashSliced,
  clusterLockHash,
  clusterLockHashSliced,
} from '../../src/internal/verification/common.js';
import { blstBackend } from '../helpers/blstBackend.js';

export interface SdkResult {
  id: string;
  ok: boolean;
  step?: string;
  issue?: string;
  validator?: number;
  /** Message of an unexpected throw (anything but PAYLOAD_INVALID). */
  thrown?: string;
  ms: number;
  hashes?: Record<string, string | null>;
}

const tryHash = async (
  fn: () => string | Promise<string>,
): Promise<string | null> => {
  try {
    return (await fn()).toLowerCase();
  } catch {
    return null;
  }
};

export const sdkHashes = async (
  lock: any,
): Promise<Record<string, string | null>> => {
  const def = lock?.cluster_definition;
  const noTick = async (): Promise<void> => {};
  const definitionHash = await tryHash(() =>
    clusterConfigOrDefinitionHash(def, false),
  );
  return {
    config: await tryHash(() => clusterConfigOrDefinitionHash(def, true)),
    config_sliced: await tryHash(
      async () => await clusterConfigOrDefinitionHashSliced(def, true, noTick),
    ),
    definition: definitionHash,
    definition_sliced: await tryHash(
      async () => await clusterConfigOrDefinitionHashSliced(def, false, noTick),
    ),
    lock: await tryHash(() => clusterLockHash(lock)),
    lock_sliced:
      definitionHash === null
        ? null
        : await tryHash(
            async () =>
              await clusterLockHashSliced(
                lock,
                fromHexString(definitionHash),
                noTick,
              ),
          ),
  };
};

export const runSdk = async (
  id: string,
  lock: unknown,
  bls: BlsBackend,
): Promise<SdkResult> => {
  const t0 = performance.now();
  try {
    const r = await verifyLock(lock, { level: 'full', bls, yieldMs: 0 });
    return {
      id,
      ok: r.ok,
      ...(r.step !== undefined ? { step: r.step } : {}),
      ...(r.issue !== undefined ? { issue: r.issue } : {}),
      ...(r.validator !== undefined ? { validator: r.validator } : {}),
      ms: Math.round(performance.now() - t0),
    };
  } catch (error: any) {
    if (error?.code === 'PAYLOAD_INVALID') {
      const issue = error?.details?.issues?.[0];
      return {
        id,
        ok: false,
        step: 'PAYLOAD_INVALID',
        issue: issue ? `${issue.path ?? ''} ${issue.message ?? ''}`.trim() : '',
        ms: Math.round(performance.now() - t0),
      };
    }
    return {
      id,
      ok: false,
      step: 'THROW',
      thrown: String(error?.stack ?? error),
      ms: Math.round(performance.now() - t0),
    };
  }
};

export const BACKENDS: Record<string, BlsBackend> = {
  noble: nobleBls,
  blst: blstBackend as BlsBackend,
};

const main = async (): Promise<void> => {
  const backend = BACKENDS[process.argv[2]];
  if (backend === undefined) {
    console.error('usage: sdkRunner noble|blst [--hashes]');
    process.exit(2);
  }
  const hashes = process.argv.includes('--hashes');
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  for await (const line of rl) {
    const path = line.trim();
    if (path === '') continue;
    const file = JSON.parse(readFileSync(path, 'utf8'));
    const result = await runSdk(path, file.lock, backend);
    if (hashes) result.hashes = await sdkHashes(file.lock);
    process.stdout.write(JSON.stringify(result) + '\n');
  }
};

if (process.argv[1]?.endsWith('sdkRunner.mjs')) {
  main().catch(error => {
    console.error(error);
    process.exit(1);
  });
}
