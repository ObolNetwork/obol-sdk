/**
 * Starts anvil forked from Hoodi (or, with E2E_CHAIN=mainnet, mainnet) at
 * head on a free local port. The fork URL is RPC_HOODI / RPC_MAINNET, else a
 * public RPC. When anvil is missing or the RPC is unreachable, sets
 * E2E_SKIP_REASON so every suite is skipped with that note instead of
 * failing.
 */
const { spawn, spawnSync } = require('node:child_process');
const net = require('node:net');

const NETWORKS = {
  hoodi: {
    chainId: 560048,
    env: 'RPC_HOODI',
    ovmFactory: '0x5754C8665B7e7BF15E83fCdF6d9636684B782b12',
    ovmFactoryBlock: 1735335,
    // Serve eth_getLogs over 50,000 blocks, which ovm.verify and getSplit need.
    rpcs: ['https://ethereum-hoodi-rpc.publicnode.com', 'https://0xrpc.io/hoodi'],
  },
  mainnet: {
    chainId: 1,
    env: 'RPC_MAINNET',
    ovmFactory: '0x2c26B5A373294CaccBd3DE817D9B7C6aea7De584',
    ovmFactoryBlock: 23919948,
    // publicnode refuses historic eth_getLogs without a token ("archive
    // requests"), so the next one is tried.
    rpcs: ['https://ethereum-rpc.publicnode.com', 'https://rpc.mevblocker.io'],
  },
};
const NETWORK = process.env.E2E_CHAIN === 'mainnet' ? 'mainnet' : 'hoodi';
const {
  chainId: CHAIN_ID,
  env: RPC_ENV,
  rpcs: DEFAULT_RPCS,
  ovmFactory: OVM_FACTORY,
  ovmFactoryBlock: OVM_FACTORY_BLOCK,
} = NETWORKS[NETWORK];

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
  console.warn(`\n[e2e] Skipping the ${NETWORK} fork suites: ${reason}\n`);
};

const pickRpc = async () => {
  const candidates =
    process.env[RPC_ENV] !== undefined && process.env[RPC_ENV] !== ''
      ? [process.env[RPC_ENV]]
      : DEFAULT_RPCS;
  const errors = [];
  for (const url of candidates) {
    try {
      const chainId = Number(await rpc(url, 'eth_chainId'));
      if (chainId !== CHAIN_ID) {
        errors.push(`${url}: chain ${chainId}, expected ${CHAIN_ID}`);
        continue;
      }
      // The SDK scans the factory logs from its deployment block, shrinking
      // the window down to 1,000 blocks for RPCs that cap ranges: the RPC must
      // serve historic logs at that size (publicnode mainnet refuses them
      // without a token).
      const logs = await rpc(
        url,
        'eth_getLogs',
        [
          {
            address: OVM_FACTORY,
            fromBlock: `0x${OVM_FACTORY_BLOCK.toString(16)}`,
            toBlock: `0x${(OVM_FACTORY_BLOCK + 999).toString(16)}`,
          },
        ],
        30_000,
      );
      if (Array.isArray(logs)) return url;
      errors.push(`${url}: no eth_getLogs answer for historic blocks`);
    } catch (error) {
      errors.push(`${url}: ${error.message}`);
    }
  }
  throw new Error(`no reachable ${NETWORK} RPC (${errors.join('; ')})`);
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
      String(CHAIN_ID),
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
  // E2E_ANVIL_LOG=<file> keeps anvil's stderr (to see why a fork stopped).
  const log =
    process.env.E2E_ANVIL_LOG !== undefined
      ? require('node:fs').createWriteStream(process.env.E2E_ANVIL_LOG)
      : undefined;
  child.stderr.on('data', chunk => {
    stderr = (stderr + chunk.toString()).slice(-4000);
    log?.write(chunk);
  });
  child.on('exit', (code, signal) => {
    log?.write(`\n[anvil exited: code ${code}, signal ${signal}]\n`);
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
    `\n[e2e] ${version.stdout.split('\n')[0]} forking ${NETWORK} at block ${forkBlock} from ${forkUrl} on ${url}\n`,
  );
};
