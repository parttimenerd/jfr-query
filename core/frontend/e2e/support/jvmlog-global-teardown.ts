import { existsSync, unlinkSync } from 'fs';
import { ChildProcess } from 'child_process';

const PID_FILE = '/tmp/jvmlog-e2e-server.pid';

export default async function globalTeardown(): Promise<void> {
  const proc = (globalThis as Record<string, unknown>).__jvmlogServer as ChildProcess | undefined;
  if (proc) {
    proc.kill('SIGTERM');
    console.log('[jvmlog-teardown] Server stopped');
    (globalThis as Record<string, unknown>).__jvmlogServer = undefined;
  }
  if (existsSync(PID_FILE)) unlinkSync(PID_FILE);
}
