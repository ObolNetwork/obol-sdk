/** Stops the anvil started by globalSetup.cjs. */
module.exports = async () => {
  const child = globalThis.__E2E_ANVIL__;
  if (child === undefined || child.exitCode !== null) return;
  await new Promise(resolve => {
    const timer = setTimeout(() => {
      child.kill('SIGKILL');
      resolve();
    }, 5_000);
    child.once('exit', () => {
      clearTimeout(timer);
      resolve();
    });
    child.kill('SIGTERM');
  });
};
