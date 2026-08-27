import { spawn, ChildProcess } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { resolve, dirname } from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const JAR = resolve(__dirname, '../../../target/query.jar');
const LOG_FILE = resolve(__dirname, '../../../../../jdklogs/data/head.G1.log');
const PORT = 4244;
const PID_FILE = '/tmp/jvmlog-e2e-server.pid';
const MAX_WAIT_MS = 30_000;

async function waitForServer(): Promise<void> {
  const deadline = Date.now() + MAX_WAIT_MS;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://localhost:${PORT}/`);
      if (res.status < 500) return;
    } catch { /* not ready yet */ }
    await new Promise(r => setTimeout(r, 500));
  }
  throw new Error(`jvmlog server did not start within ${MAX_WAIT_MS}ms`);
}

export default async function globalSetup(): Promise<void> {
  if (!existsSync(JAR)) {
    throw new Error(`query.jar not found at ${JAR} — run: cd core && mvn package -DskipTests`);
  }
  if (!existsSync(LOG_FILE)) {
    console.warn(`[jvmlog-setup] Log file not found: ${LOG_FILE} — skipping server start`);
    return;
  }
  const proc: ChildProcess = spawn(
    'java',
    ['-jar', JAR, 'serve', LOG_FILE, '--no-open', '-p', String(PORT)],
    { stdio: ['ignore', 'pipe', 'pipe'], detached: false }
  );
  proc.stdout?.on('data', (d: Buffer) => process.stdout.write(`[jvmlog-srv] ${d}`));
  proc.stderr?.on('data', (d: Buffer) => process.stderr.write(`[jvmlog-srv] ${d}`));
  proc.on('error', (err: Error) => { throw err; });

  if (proc.pid) writeFileSync(PID_FILE, String(proc.pid));
  try {
    await waitForServer();
  } catch (e) {
    proc.kill();
    throw e;
  }
  console.log(`[jvmlog-setup] Server ready on port ${PORT} (pid ${proc.pid})`);
  (globalThis as Record<string, unknown>).__jvmlogServer = proc;
}
