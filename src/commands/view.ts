import { ensureOmmForRead } from '../lib/store.js';
import { startServer, DEFAULT_HOST } from '../server/index.js';

export function commandView(port: number = 3000, host: string = DEFAULT_HOST): void {
  if (!ensureOmmForRead()) return;
  startServer(port, host);
}
