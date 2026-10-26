import fs from 'node:fs';
import type { ServerResponse } from 'node:http';
import { getOmmDir } from '../lib/store.js';

const clients = new Set<ServerResponse>();

export function addSSEClient(res: ServerResponse): void {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });
  res.write('data: connected\n\n');
  clients.add(res);

  res.on('close', () => {
    clients.delete(res);
  });
}

function broadcast(event: string, data: string): void {
  for (const client of clients) {
    client.write(`event: ${event}\ndata: ${data}\n\n`);
  }
}

let watcher: fs.FSWatcher | null = null;
let debounceTimer: ReturnType<typeof setTimeout> | null = null;

export function startWatcher(): void {
  if (watcher) return;

  const dir = getOmmDir();
  if (!fs.existsSync(dir)) return;

  const onChange = (_event: string, filename: string | Buffer | null) => {
    // Debounce rapid changes
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
      broadcast('change', JSON.stringify({ file: filename?.toString() ?? null, time: Date.now() }));
    }, 300);
  };

  try {
    watcher = fs.watch(dir, { recursive: true }, onChange);
  } catch {
    // Recursive watching is unsupported on Linux before Node 20: fall back to top-level changes only
    process.stderr.write('note: live reload only tracks top-level changes on this platform (Node 20+ tracks all)\n');
    watcher = fs.watch(dir, onChange);
  }

  watcher.on('error', () => {
    // Silently handle watcher errors
  });
}

export function stopWatcher(): void {
  if (watcher) {
    watcher.close();
    watcher = null;
  }
}
