// Runs isValidClusterLock in a worker thread so obol-api's main thread stays responsive.
import { parentPort, workerData } from 'node:worker_threads';
import { ClusterLockValidationTimeoutError } from '../errors.js';
import type { ClusterLock, SafeRpcUrl } from '../types.js';
import { isValidClusterLock } from './common.js';

const input = workerData as {
  lock: ClusterLock;
  safeRpcUrl?: SafeRpcUrl;
};

if (parentPort) {
  const port = parentPort;
  void isValidClusterLock(input.lock, input.safeRpcUrl)
    .then(ok => {
      port.postMessage(ok);
    })
    .catch(err => {
      if (err instanceof ClusterLockValidationTimeoutError) {
        port.postMessage({ validationTimeoutMs: err.timeoutMs });
        return;
      }
      port.postMessage(false);
    });
}
