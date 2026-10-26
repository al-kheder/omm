import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { handleApi } from './api.js';
import { addSSEClient, startWatcher } from './watcher.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const require = createRequire(import.meta.url);

export const DEFAULT_HOST = '127.0.0.1';

/** Browser libraries served from node_modules so the viewer works offline */
const VENDOR_FILES: Record<string, string> = {
  'dagre.js': 'dagre/dist/dagre.min.js',
  'marked.js': 'marked/marked.min.js',
  'dompurify.js': 'dompurify/dist/purify.min.js',
};

const SECURITY_HEADERS: Record<string, string> = {
  // No other site may frame the viewer (it posts its data to the parent frame)
  'Content-Security-Policy': "frame-ancestors 'none'",
  'X-Content-Type-Options': 'nosniff',
};

const LOOPBACK_HOSTNAMES = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
const WILDCARD_HOSTS = new Set(['0.0.0.0', '::', '[::]']);

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTNAMES.has(host) || host.startsWith('127.');
}

/**
 * Reject requests whose Host header names another site (DNS rebinding).
 * When bound to a wildcard address the user opted into network access, so any Host is accepted.
 */
function isAllowedHostHeader(hostHeader: string | undefined, bindHost: string): boolean {
  if (WILDCARD_HOSTS.has(bindHost)) return true;
  if (!hostHeader) return false;
  let hostname: string;
  try {
    hostname = new URL(`http://${hostHeader}`).hostname;
  } catch {
    return false;
  }
  return LOOPBACK_HOSTNAMES.has(hostname) || hostname === bindHost || hostname === `[${bindHost}]`;
}

function getViewerHtml(): string {
  // Try dist/ first, then src/server/ for dev
  const candidates = [
    path.join(__dirname, 'viewer.html'),
    path.join(__dirname, '..', 'server', 'viewer.html'),
    path.join(__dirname, '..', 'src', 'server', 'viewer.html'),
  ];
  for (const p of candidates) {
    if (fs.existsSync(p)) {
      return fs.readFileSync(p, 'utf-8');
    }
  }
  return '<html><body><h1>viewer.html not found</h1></body></html>';
}

function serveVendor(name: string, res: http.ServerResponse): void {
  const modulePath = VENDOR_FILES[name];
  if (!modulePath) {
    res.writeHead(404);
    res.end('Not Found');
    return;
  }
  res.writeHead(200, {
    'Content-Type': 'application/javascript; charset=utf-8',
    'Cache-Control': 'max-age=86400',
  });
  res.end(fs.readFileSync(require.resolve(modulePath)));
}

export function createViewerServer(bindHost: string = DEFAULT_HOST): http.Server {
  return http.createServer((req, res) => {
    for (const [name, value] of Object.entries(SECURITY_HEADERS)) {
      res.setHeader(name, value);
    }

    if (!isAllowedHostHeader(req.headers.host, bindHost)) {
      res.writeHead(403, { 'Content-Type': 'text/plain' });
      res.end('Forbidden: unexpected Host header');
      return;
    }

    const url = new URL(req.url || '/', 'http://localhost');

    // SSE endpoint
    if (url.pathname === '/events') {
      addSSEClient(res);
      return;
    }

    // Bundled browser libraries
    if (url.pathname.startsWith('/vendor/')) {
      serveVendor(url.pathname.slice('/vendor/'.length), res);
      return;
    }

    // API endpoints
    if (url.pathname.startsWith('/api/')) {
      try {
        if (handleApi(req, res)) return;
      } catch (err) {
        // Invalid element paths are client errors; never let them crash the server
        const message = err instanceof Error ? err.message : String(err);
        res.writeHead(message.startsWith('invalid element path') ? 400 : 500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: message }));
        return;
      }
      res.writeHead(404, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ error: 'not found' }));
      return;
    }

    // Serve viewer HTML
    if (url.pathname === '/' || url.pathname === '/index.html') {
      let html = getViewerHtml();
      const projectName = path.basename(process.cwd());
      html = html.replace('</head>', `<script>window.__projectName=${JSON.stringify(projectName)};</script>\n</head>`);
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(html);
      return;
    }

    res.writeHead(404);
    res.end('Not Found');
  });
}

export function startServer(port: number, host: string = DEFAULT_HOST): void {
  startWatcher();

  if (!isLoopbackHost(host)) {
    process.stderr.write(`warning: listening on ${host} — anyone who can reach this address can read your architecture docs.\n`);
  }

  const server = createViewerServer(host);

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      process.stderr.write(`Port ${port} in use, trying ${port + 1}...\n`);
      server.close();
      startServer(port + 1, host);
    } else {
      throw err;
    }
  });

  server.listen(port, host, () => {
    const shown = isLoopbackHost(host) || WILDCARD_HOSTS.has(host) ? 'localhost' : host;
    process.stderr.write(`oh-my-mermaid viewer running at http://${shown}:${port}\n`);
  });
}
