import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { collectDeploymentEvidence } from '../lib/evidence.js';

// Fake values are assembled at run time, so this file holds no token-shaped strings
const FAKE_TOKEN = 'gh' + 'p_' + 'a1B2c3D4e5'.repeat(4);
const FAKE_PASSWORD = 'k9Xp' + '2mQ7vL';

const dirs: string[] = [];
function project(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'omm-evidence-'));
  dirs.push(dir);
  for (const [rel, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
    fs.writeFileSync(path.join(dir, rel), content);
  }
  return dir;
}
afterEach(() => { for (const d of dirs.splice(0)) fs.rmSync(d, { recursive: true, force: true }); });

describe('collectDeploymentEvidence', () => {
  it('reports a project without deployment files', () => {
    const ev = collectDeploymentEvidence(project({ 'src/index.ts': 'export {}', 'README.md': '# lib', 'package.json': '{"name":"lib","private":true}' }));
    expect(ev.found).toBe(false);
    expect(ev.sources).toEqual([{ path: 'package.json', kind: 'package' }]);
    expect(ev.environments).toEqual([]);
  });

  it('reads a containerized frontend / backend / database app', () => {
    const ev = collectDeploymentEvidence(project({
      'Dockerfile': 'FROM node:20 AS build\nRUN npm ci\nFROM node:20-alpine\nENV PORT=3000 NODE_ENV=production\nEXPOSE 3000\nHEALTHCHECK CMD wget -q localhost:3000/health\nCMD ["node", "dist/server.js"]\n',
      'docker-compose.yml': [
        'services:',
        '  web:',
        '    build: ./web',
        '    ports: ["80:8080"]',
        '    depends_on: [api]',
        '  api:',
        '    build: { context: ., dockerfile: Dockerfile }',
        '    ports: [{ published: 3000, target: 3000 }]',
        '    environment:',
        `      DATABASE_URL: postgres://app:${FAKE_PASSWORD}@db:5432/app`,
        `      API_TOKEN: ${FAKE_TOKEN}`,
        '    depends_on: { db: { condition: service_healthy } }',
        '    networks: [backend]',
        '  db:',
        '    image: postgres:16',
        '    volumes: ["pgdata:/var/lib/postgresql/data"]',
        '    networks: [backend]',
        'networks: { backend: {} }',
        'volumes: { pgdata: {} }',
      ].join('\n'),
      'docker-compose.prod.yml': 'services:\n  api:\n    deploy: { replicas: 3 }\n',
    }));
    expect(ev.found).toBe(true);
    expect(ev.dockerfiles).toEqual([{
      path: 'Dockerfile', stages: [{ image: 'node:20', name: 'build' }, { image: 'node:20-alpine' }],
      expose: ['3000'], cmd: '["node", "dist/server.js"]', envKeys: ['PORT', 'NODE_ENV'], healthcheck: true,
    }]);
    const base = ev.compose.find(c => c.path === 'docker-compose.yml')!;
    const prod = ev.compose.find(c => c.path === 'docker-compose.prod.yml')!;
    expect(base.services.map(s => [s.name, s.image ?? s.build, s.ports, s.dependsOn])).toEqual([
      ['web', './web', ['80:8080'], ['api']],
      ['api', '. · Dockerfile', ['3000:3000'], ['db']],
      ['db', 'postgres:16', [], []],
    ]);
    expect(base.services[1].envKeys).toEqual(['DATABASE_URL', 'API_TOKEN']);
    expect(base.networks).toEqual(['backend']);
    expect(prod).toMatchObject({ variant: 'prod', services: [{ name: 'api', replicas: 3 }] });
    expect(ev.warnings).toEqual([{ path: 'docker-compose.prod.yml', message: 'Service api has neither image nor build' }]);
    expect(ev.environments).toEqual([{ name: 'production', sources: ['docker-compose.prod.yml'] }]);
    // environment values are never part of the result
    const json = JSON.stringify(ev);
    expect(json).not.toContain(FAKE_PASSWORD);
    expect(json).not.toContain(FAKE_TOKEN);
  });

  it('reads Kubernetes objects, and reports routes and selectors that lead nowhere', () => {
    const ev = collectDeploymentEvidence(project({
      'k8s/overlays/staging/app.yaml': [
        'apiVersion: apps/v1', 'kind: Deployment', 'metadata: { name: api, namespace: shop }',
        'spec:', '  replicas: 2', '  template:', '    metadata: { labels: { app: api } }',
        '    spec:', '      containers:', '        - name: api', '          image: ghcr.io/acme/api:1.4', '          ports: [{ containerPort: 8080 }]',
        '---', 'apiVersion: v1', 'kind: Service', 'metadata: { name: api }', 'spec: { selector: { app: api }, ports: [{ port: 80, targetPort: 8080 }] }',
        '---', 'apiVersion: v1', 'kind: Service', 'metadata: { name: old }', 'spec: { type: LoadBalancer, selector: { app: gone }, ports: [{ port: 443 }] }',
        '---', 'apiVersion: networking.k8s.io/v1', 'kind: Ingress', 'metadata: { name: web }',
        'spec:', '  rules:', '    - host: shop.example.com', '      http:', '        paths:',
        '          - { path: /api, backend: { service: { name: api, port: { number: 80 } } } }',
        '          - { path: /, backend: { service: { name: frontend, port: { number: 80 } } } }',
        '---', 'apiVersion: v1', 'kind: Secret', 'metadata: { name: db }', `stringData: { password: ${FAKE_PASSWORD} }`,
        '---', 'apiVersion: batch/v1', 'kind: CronJob', 'metadata: { name: cleanup }',
        'spec: { schedule: "0 3 * * *", jobTemplate: { spec: { template: { spec: { containers: [{ name: c, image: busybox }] } } } } }',
      ].join('\n'),
      'charts/shop/templates/deploy.yaml': 'apiVersion: apps/v1\nkind: Deployment\nmetadata:\n  name: {{ .Release.Name }}\n',
      'charts/shop/Chart.yaml': 'apiVersion: v2\nname: shop\nversion: 0.3.0\nappVersion: "1.4"\ndependencies: [{ name: postgresql, repository: https://charts.example.com }]\n',
      'charts/shop/values-production.yaml': 'replicas: 3\n',
    }));
    const k = Object.fromEntries(ev.kubernetes.map(o => [`${o.kind}/${o.name}`, o]));
    expect(k['Deployment/api']).toMatchObject({ namespace: 'shop', replicas: 2, containers: [{ name: 'api', image: 'ghcr.io/acme/api:1.4', ports: ['8080'] }] });
    expect(k['Service/api']).toMatchObject({ serviceType: 'ClusterIP', ports: ['80→8080'] });
    expect(k['Ingress/web'].rules).toEqual([
      { host: 'shop.example.com', path: '/api', service: 'api', port: '80' },
      { host: 'shop.example.com', path: '/', service: 'frontend', port: '80' },
    ]);
    expect(k['Secret/db']).toMatchObject({ note: 'contents not read' });
    expect(k['CronJob/cleanup']).toMatchObject({ schedule: '0 3 * * *', containers: [{ image: 'busybox' }] });
    expect(JSON.stringify(ev)).not.toContain(FAKE_PASSWORD);
    expect(ev.helm).toEqual([{ path: 'charts/shop/Chart.yaml', name: 'shop', version: '0.3.0', appVersion: '1.4', dependencies: ['postgresql'], valuesFiles: ['charts/shop/values-production.yaml'], hasTemplates: true }]);
    expect(ev.warnings.map(w => w.message)).toEqual(expect.arrayContaining([
      'Service old selects no workload found in the repository',
      'Ingress web routes to Service frontend, which is not in the repository',
      'Template (Helm or similar) not rendered; its objects are not listed',
    ]));
    expect(ev.environments.map(e => e.name)).toEqual(['production', 'staging']);
  });

  it('reads Terraform, serverless, Procfile, platform, proxy and CI files', () => {
    const ev = collectDeploymentEvidence(project({
      'infra/prod/main.tf': 'terraform {\n  backend "s3" {}\n}\nprovider "aws" {}\nresource "aws_db_instance" "main" {\n  password = var.db_password\n}\nmodule "vpc" {\n  source = "terraform-aws-modules/vpc/aws"\n}\n',
      'serverless.yml': 'service: thumbs\nprovider: { name: aws, runtime: nodejs20.x, region: eu-west-1, stage: dev }\nfunctions:\n  resize:\n    handler: src/resize.handler\n    events: [{ http: { method: post, path: /resize } }, { sqs: arn:aws:sqs:queue }]\n',
      'Procfile': 'web: node server.js\nworker: node worker.js\n',
      'fly.toml': 'app = "shop"\nprimary_region = "fra"\n[http_service]\n  internal_port = 8080\n',
      'deploy/nginx/site.conf': 'server {\n  listen 443 ssl;\n  server_name shop.example.com;\n  location / { proxy_pass http://api:3000; }\n}\n',
      '.github/workflows/deploy.yml': 'on: { push: { branches: [main] } }\njobs:\n  test:\n    runs-on: ubuntu-latest\n    steps: [{ run: npm test }]\n  deploy:\n    runs-on: ubuntu-latest\n    environment: production\n    steps:\n      - uses: aws-actions/configure-aws-credentials@v4\n      - run: terraform apply -auto-approve && kubectl rollout restart deploy/api\n',
    }));
    expect(ev.terraform).toEqual([{
      path: 'infra/prod/main.tf', providers: ['aws'], backend: 's3', resources: [{ type: 'aws_db_instance', name: 'main' }],
      modules: [{ name: 'vpc', source: 'terraform-aws-modules/vpc/aws' }], data: [],
    }]);
    expect(ev.serverless[0]).toMatchObject({ service: 'thumbs', provider: 'aws', runtime: 'nodejs20.x', stage: 'dev', functions: [{ name: 'resize', events: ['http post /resize', 'sqs arn:aws:sqs:queue'] }] });
    expect(ev.processes.map(p => `${p.process}: ${p.command}`)).toEqual(['web: node server.js', 'worker: node worker.js']);
    expect(ev.platforms[0]).toMatchObject({ platform: 'Fly.io', facts: { app: 'shop', primary_region: 'fra', internal_port: '8080' } });
    expect(ev.proxies[0]).toMatchObject({ server: 'nginx', sites: ['shop.example.com'], listen: ['443 ssl'], upstreams: ['http://api:3000'] });
    expect(ev.ci[0]).toMatchObject({ system: 'GitHub Actions', triggers: ['push'], deployJobs: [{ job: 'deploy', environment: 'production', uses: ['aws-actions/configure-aws-credentials'], tools: ['kubectl', 'terraform'] }] });
    expect(ev.environments.map(e => e.name)).toEqual(['development', 'production']);
  });

  it('never opens .env files, reads only keys from templates, and redacts secrets that remain', () => {
    const ev = collectDeploymentEvidence(project({
      '.env': `DB_PASSWORD=${FAKE_PASSWORD}\n`,
      '.env.production': `API_TOKEN=${FAKE_TOKEN}\n`,
      '.env.example': 'DB_PASSWORD=\nAPI_URL=http://localhost:3000\n',
      'Procfile': `web: node server.js --token ${FAKE_TOKEN}\n`,
      'docker-compose.yml': `services:\n  api:\n    image: registry.example.com/api\n    command: ["serve", "--db", "postgres://app:${FAKE_PASSWORD}@db/app"]\n`,
    }));
    expect(ev.envFiles).toEqual([
      { path: '.env', read: false, keys: [] },
      { path: '.env.example', read: true, keys: ['DB_PASSWORD', 'API_URL'] },
      { path: '.env.production', read: false, keys: [] },
    ]);
    expect(ev.processes[0].command).toBe('[redacted]');
    expect(ev.compose[0].services[0].command).toBe('[redacted]');
    expect(ev.warnings.at(-1)?.message).toBe('2 values that looked like secrets replaced with [redacted]');
    const json = JSON.stringify(ev);
    expect(json).not.toContain(FAKE_PASSWORD);
    expect(json).not.toContain(FAKE_TOKEN);
    expect(ev.environments).toEqual([{ name: 'production', sources: ['.env.production'] }]);
  });

  it('skips dependency folders and does not follow symlinks', () => {
    const dir = project({ 'node_modules/pkg/Dockerfile': 'FROM evil', 'app/Dockerfile': 'FROM node:20' });
    const outside = project({ 'Dockerfile': 'FROM outside' });
    try { fs.symlinkSync(outside, path.join(dir, 'linked'), 'junction'); } catch { /* symlinks may need privileges */ }
    const ev = collectDeploymentEvidence(dir);
    expect(ev.dockerfiles.map(d => d.path)).toEqual(['app/Dockerfile']);
  });

  it('reports files it cannot parse instead of guessing', () => {
    const ev = collectDeploymentEvidence(project({ 'compose.yaml': 'services:\n  api: [unclosed\n' }));
    expect(ev.compose).toEqual([]);
    expect(ev.warnings[0]).toMatchObject({ path: 'compose.yaml' });
    expect(ev.warnings[0].message).toMatch(/^Could not be parsed/);
  });
});
