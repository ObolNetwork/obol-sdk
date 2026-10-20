/**
 * Starts anvil forked from Hoodi at head on a free local port. The fork URL
 * is RPC_HOODI, else a public Hoodi RPC. When anvil is missing or the RPC
 * is unreachable, sets E2E_SKIP_REASON so every suite is skipped with that
 * note instead of failing.
 */
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

const HOODI_CHAIN_ID = 560048;
const DEFAULT_RPCS = [
  // Serves eth_getLogs over 50,000 blocks, which ovm.verify and getSplit need.
  'https://ethereum-hoodi-rpc.publicnode.com',
  'https://0xrpc.io/hoodi',
];

const rpc = async (url, method, params = [], timeoutMs = 10_000) => {
  const response = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json();
  if (body.error !== undefined) throw new Error(JSON.stringify(body.error));
  return body.result;
};

const freePort = async () =>
  await new Promise((resolve, reject) => {
    const server = net.createServer();
    server.unref();
    server.on('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address();
      server.close(() => resolve(port));
    });
  });

const skip = reason => {
  process.env.E2E_SKIP_REASON = reason;
  console.warn(`\n[e2e] Skipping the Hoodi fork suites: ${reason}\n`);
};

const pickRpc = async () => {
  const candidates =
    process.env.RPC_HOODI !== undefined && process.env.RPC_HOODI !== ''
      ? [process.env.RPC_HOODI]
      : DEFAULT_RPCS;
  const errors = [];
  for (const url of candidates) {
    try {
      const chainId = Number(await rpc(url, 'eth_chainId'));
      if (chainId === HOODI_CHAIN_ID) return url;
      errors.push(`${url}: chain ${chainId}, expected ${HOODI_CHAIN_ID}`);
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`no reachable Hoodi RPC (${errors.join('; ')})`);
};

module.exports = async () => {
  const anvil = process.env.ANVIL_BIN ?? 'anvil';
  const version = spawnSync(anvil, ['--version'], { encoding: 'utf8' });
  if (version.error !== undefined || version.status !== 0) {
    skip(`anvil not found (${anvil}); install Foundry or set ANVIL_BIN`);
    return;
  }
  let forkUrl;
  try {
    forkUrl = await pickRpc();
  } catch (error) {
    skip(error.message);
    return;
  }

  const port = await freePort();
  const url = `http://127.0.0.1:${port}`;
  const child = spawn(
    anvil,
    [
      '--fork-url',
      forkUrl,
      '--chain-id',
      String(HOODI_CHAIN_ID),
      '--host',
      '127.0.0.1',
      '--port',
      String(port),
      '--retries',
      '10',
      '--fork-retry-backoff',
      '1000',
      '--silent',
    ],
    { stdio: ['ignore', 'ignore', 'pipe'] },
  );
  let stderr = '';
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk.toString()).slice(-4000);
  });
  globalThis.__E2E_ANVIL__ = child;

  const deadline = Date.now() + 90_000;
  let forkBlock;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) break;
    try {
      forkBlock = BigInt(await rpc(url, 'eth_blockNumber', [], 2_000));
      break;
    } catch {
      await new Promise(resolve => setTimeout(resolve, 500));
    }
  }
  if (forkBlock === undefined) {
    child.kill('SIGKILL');
    skip(`anvil did not start (${stderr.trim() || 'no output'})`);
    return;
  }
  process.env.E2E_ANVIL_URL = url;
  process.env.E2E_FORK_RPC = forkUrl;
  process.env.E2E_FORK_BLOCK = forkBlock.toString();
  console.log(
    `\n[e2e] ${version.stdout.split('\n')[0]} forking Hoodi at block ${forkBlock} from ${forkUrl} on ${url}\n`,
  );
};
