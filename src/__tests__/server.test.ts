import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import { createViewerServer, isLoopbackHost, DEFAULT_HOST } from '../server/index.js';

let server: http.Server;
let port: number;

function request(path: string, host = `127.0.0.1:${port}`): Promise<{ status: number; headers: http.IncomingHttpHeaders; body: string }> {
  return new Promise((resolve, reject) => {
    const req = http.request({ host: '127.0.0.1', port, path, headers: { host } }, (res) => {
      let body = '';
      res.on('data', (c) => { body += c; });
      res.on('end', () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
    });
    req.on('error', reject);
    req.end();
  });
}

beforeAll(async () => {
  server = createViewerServer(DEFAULT_HOST);
  await new Promise<void>((resolve) => server.listen(0, DEFAULT_HOST, resolve));
  port = (server.address() as AddressInfo).port;
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
});

describe('viewer server', () => {
  it('listens on the loopback address by default', () => {
    expect(DEFAULT_HOST).toBe('127.0.0.1');
    expect((server.address() as AddressInfo).address).toBe('127.0.0.1');
  });

  it('sends no CORS header and sets framing protection', async () => {
    const res = await request('/api/classes');
    expect(res.status).toBe(200);
    expect(res.headers['access-control-allow-origin']).toBeUndefined();
    expect(res.headers['content-security-policy']).toBe("frame-ancestors 'none'");
    expect(res.headers['x-content-type-options']).toBe('nosniff');
  });

  it('accepts localhost Host headers', async () => {
    expect((await request('/api/classes', `localhost:${port}`)).status).toBe(200);
    expect((await request('/api/classes', `[::1]:${port}`)).status).toBe(200);
  });

  it('rejects foreign Host headers (DNS rebinding)', async () => {
    expect((await request('/api/classes', 'evil.example')).status).toBe(403);
    expect((await request('/', `evil.example:${port}`)).status).toBe(403);
  });

  it.each(['dagre.js', 'marked.js', 'dompurify.js'])('serves bundled /vendor/%s offline', async (name) => {
    const res = await request(`/vendor/${name}`);
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toMatch(/javascript/);
    expect(res.body.length).toBeGreaterThan(1000);
  });

  it('serves nothing else under /vendor/', async () => {
    expect((await request('/vendor/yaml.js')).status).toBe(404);
    expect((await request('/vendor/../package.json')).status).not.toBe(200);
  });

  it('returns 400 instead of crashing on unsafe element paths', async () => {
    const res = await request('/api/class/persp/node/..');
    expect([400, 404]).toContain(res.status);
    expect((await request('/api/classes')).status).toBe(200);
  });

  it('viewer HTML loads no scripts from a CDN', async () => {
    const res = await request('/');
    expect(res.status).toBe(200);
    expect(res.body).not.toMatch(/<script[^>]+src="https?:/);
    expect(res.body).toContain('/vendor/dompurify.js');
  });
});

describe('isLoopbackHost', () => {
  it('classifies hosts', () => {
    expect(isLoopbackHost('127.0.0.1')).toBe(true);
    expect(isLoopbackHost('localhost')).toBe(true);
    expect(isLoopbackHost('::1')).toBe(true);
    expect(isLoopbackHost('0.0.0.0')).toBe(false);
    expect(isLoopbackHost('192.168.1.5')).toBe(false);
  });
});
