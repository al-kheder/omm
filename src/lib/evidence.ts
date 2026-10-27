/**
 * `omm evidence deployment`: find the files that say how and where a project is deployed,
 * and read the facts /omm-scan needs for a deployment diagram. Facts only, no guesses:
 * what cannot be read is reported as a warning.
 *
 * Safety: `.env` files are listed but never opened (only `.env.example`-style templates are
 * read, keys only); environment variables, ConfigMaps and Secrets contribute names, never
 * values; any remaining value that looks like a secret is replaced with "[redacted]".
 * Symlinks are not followed and nothing outside the project directory is read.
 */

import fs from 'node:fs';
import path from 'node:path';
import YAML from 'yaml';
import { findSecrets } from './secrets.js';

export type EvidenceKind =
  | 'dockerfile' | 'compose' | 'kubernetes' | 'kustomize' | 'helm' | 'terraform' | 'pulumi' | 'cdk'
  | 'serverless' | 'procfile' | 'platform' | 'proxy' | 'ci' | 'package' | 'env';

export interface EvidenceSource { path: string; kind: EvidenceKind }

export interface DockerfileFacts { path: string; stages: { image: string; name?: string }[]; expose: string[]; cmd?: string; entrypoint?: string; envKeys: string[]; healthcheck: boolean }
export interface ComposeService {
  name: string; image?: string; build?: string; ports: string[]; expose: string[]; dependsOn: string[];
  networks: string[]; volumes: string[]; envKeys: string[]; envFiles: string[]; command?: string;
  replicas?: number; profiles: string[]; healthcheck: boolean;
}
export interface ComposeFacts { path: string; variant?: string; services: ComposeService[]; networks: string[]; volumes: string[]; secrets: string[] }
export interface KubeContainer { name: string; image?: string; ports: string[] }
export interface KubeObject {
  path: string; kind: string; name: string; namespace?: string;
  replicas?: number; schedule?: string; containers?: KubeContainer[]; labels?: Record<string, string>;
  serviceType?: string; ports?: string[]; selector?: Record<string, string>;
  rules?: { host?: string; path?: string; service?: string; port?: string }[];
  note?: string;
}
export interface HelmFacts { path: string; name?: string; version?: string; appVersion?: string; dependencies: string[]; valuesFiles: string[]; hasTemplates: boolean }
export interface TerraformFacts { path: string; providers: string[]; backend?: string; resources: { type: string; name: string }[]; modules: { name: string; source?: string }[]; data: { type: string; name: string }[] }
export interface ServerlessFacts { path: string; service?: string; provider?: string; runtime?: string; region?: string; stage?: string; functions: { name: string; handler?: string; events: string[] }[] }
export interface ProcessFacts { path: string; process: string; command: string }
export interface PlatformFacts { path: string; platform: string; facts: Record<string, string | string[]> }
export interface ProxyFacts { path: string; server: 'nginx' | 'caddy'; sites: string[]; listen: string[]; upstreams: string[] }
export interface CiJob { job: string; environment?: string; uses: string[]; tools: string[] }
export interface CiFacts { path: string; system: string; triggers: string[]; deployJobs: CiJob[] }
export interface PackageFacts { path: string; name?: string; bin: string[]; private?: boolean; scripts: { name: string; tools: string[] }[]; publish: boolean }
export interface EnvFileFacts { path: string; read: boolean; keys: string[] }

export interface DeploymentEvidence {
  /** True when anything describes where or how the software is deployed */
  found: boolean;
  scannedFiles: number;
  sources: EvidenceSource[];
  dockerfiles: DockerfileFacts[];
  compose: ComposeFacts[];
  kubernetes: KubeObject[];
  helm: HelmFacts[];
  terraform: TerraformFacts[];
  serverless: ServerlessFacts[];
  processes: ProcessFacts[];
  platforms: PlatformFacts[];
  proxies: ProxyFacts[];
  ci: CiFacts[];
  packages: PackageFacts[];
  envFiles: EnvFileFacts[];
  /** Environment names (development, staging, production …) and the files that mention them */
  environments: { name: string; sources: string[] }[];
  warnings: { path?: string; message: string }[];
}

const SKIP_DIRS = new Set([
  'node_modules', '.git', 'dist', 'build', 'out', 'vendor', '.venv', 'venv', '__pycache__', 'target',
  '.next', '.nuxt', 'coverage', '.omm', '.terraform', '.cache', '.turbo', '.idea', '.vscode', '.pnpm-store',
]);
const MAX_DEPTH = 6;
const MAX_FILES = 20000;
const MAX_BYTES = 512 * 1024;
const REDACTED = '[redacted]';

const ENV_WORDS: Record<string, string> = {
  dev: 'development', development: 'development', local: 'local', test: 'test', testing: 'test', qa: 'qa', uat: 'uat',
  stage: 'staging', staging: 'staging', preprod: 'preprod', prod: 'production', production: 'production',
  demo: 'demo', sandbox: 'sandbox', preview: 'preview',
};

const PLATFORM_FILES: Record<string, string> = {
  'vercel.json': 'Vercel', 'now.json': 'Vercel', 'netlify.toml': 'Netlify', 'fly.toml': 'Fly.io', 'render.yaml': 'Render',
  'railway.json': 'Railway', 'railway.toml': 'Railway', 'firebase.json': 'Firebase', 'wrangler.toml': 'Cloudflare Workers',
  'wrangler.json': 'Cloudflare Workers', 'dockerrun.aws.json': 'AWS Elastic Beanstalk', 'skaffold.yaml': 'Skaffold',
  '.platform.app.yaml': 'Platform.sh', 'amplify.yml': 'AWS Amplify', 'apprunner.yaml': 'AWS App Runner', 'app.yaml': 'Google App Engine',
};

const CI_FILES: Record<string, string> = {
  '.gitlab-ci.yml': 'GitLab CI', 'azure-pipelines.yml': 'Azure Pipelines', 'bitbucket-pipelines.yml': 'Bitbucket Pipelines',
  'jenkinsfile': 'Jenkins', 'cloudbuild.yaml': 'Google Cloud Build', 'cloudbuild.yml': 'Google Cloud Build', 'buildspec.yml': 'AWS CodeBuild',
};

// Commands that deploy or publish something, by the tool they use
const DEPLOY_TOOLS: [RegExp, string][] = [
  [/\bkubectl\s+(apply|rollout|set\s+image|create)\b/, 'kubectl'],
  [/\bhelm\s+(upgrade|install)\b/, 'helm'],
  [/\bdocker\s+(push|buildx\s+build[^\n]*--push)\b|\bdocker\/build-push-action\b/, 'docker push'],
  [/\bterraform\s+apply\b/, 'terraform'],
  [/\b(npm|pnpm|yarn)\s+publish\b/, 'npm publish'],
  [/\b(flyctl|fly)\s+deploy\b/, 'flyctl'],
  [/\bvercel\b(\s+--prod|\s+deploy)?/, 'vercel'],
  [/\bnetlify\s+deploy\b/, 'netlify'],
  [/\b(serverless|sls)\s+deploy\b/, 'serverless'],
  [/\bgh\s+release\b/, 'gh release'],
  [/\baws\s+(s3\s+(sync|cp)|ecs|lambda|cloudformation|deploy)\b/, 'aws cli'],
  [/\bgcloud\s+(run|app|functions)\s+deploy\b/, 'gcloud'],
  [/\baz\s+(webapp|containerapp|functionapp)\b/, 'az'],
  [/\bwrangler\s+(deploy|publish)\b/, 'wrangler'],
  [/\bpulumi\s+up\b/, 'pulumi'],
  [/\bcdk\s+deploy\b/, 'cdk'],
  [/\b(rsync|scp)\s/, 'file copy'],
  [/\bssh\s/, 'ssh'],
];
const DEPLOY_ACTION = /deploy|publish|release|aws-actions\/|azure\/|google-github-actions\/|docker\/(build-push|login)|helm|kubectl|vercel|netlify|superfly|pages|pypi|gh-release/i;

const toPosix = (p: string) => p.split(path.sep).join('/');
const asArray = (v: unknown): unknown[] => (Array.isArray(v) ? v : v === undefined || v === null ? [] : [v]);
const keysOf = (v: unknown): string[] => (Array.isArray(v) ? v.map(String) : v && typeof v === 'object' ? Object.keys(v) : []);
const str = (v: unknown): string | undefined => (v === undefined || v === null ? undefined : String(v));
const short = (s: string, n = 160) => (s.length > n ? s.slice(0, n - 1) + '…' : s);
const record = (v: unknown): Record<string, string> | undefined =>
  v && typeof v === 'object' && !Array.isArray(v) ? Object.fromEntries(Object.entries(v).map(([k, x]) => [k, String(x)])) : undefined;

function toolsIn(text: string): string[] {
  return [...new Set(DEPLOY_TOOLS.filter(([re]) => re.test(text)).map(([, name]) => name))];
}

/** Environment name in a file or directory name, e.g. docker-compose.prod.yml, overlays/staging/ */
function envFromPath(rel: string): string | undefined {
  for (const part of rel.toLowerCase().split(/[/._-]+/)) if (ENV_WORDS[part]) return ENV_WORDS[part];
  return undefined;
}

function listFiles(root: string, warnings: DeploymentEvidence['warnings']): string[] {
  const out: string[] = [];
  const visit = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (out.length >= MAX_FILES) return;
      if (e.isSymbolicLink()) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (!SKIP_DIRS.has(e.name) && depth < MAX_DEPTH) visit(full, depth + 1);
      } else if (e.isFile()) {
        out.push(toPosix(path.relative(root, full)));
      }
    }
  };
  visit(root, 0);
  if (out.length >= MAX_FILES) warnings.push({ message: `Stopped after ${MAX_FILES} files; some deployment files may be missing` });
  return out;
}

function classify(rel: string): EvidenceKind | null {
  const base = path.posix.basename(rel);
  const lower = base.toLowerCase();
  if (/^(dockerfile|containerfile)(\.[\w.-]+)?$/i.test(base) || lower.endsWith('.dockerfile')) return 'dockerfile';
  if (/^(docker-)?compose(\.[\w.-]+)?\.ya?ml$/i.test(base)) return 'compose';
  if (lower === 'chart.yaml') return 'helm';
  if (/^kustomization\.ya?ml$/.test(lower)) return 'kustomize';
  if (lower.endsWith('.tf')) return 'terraform';
  if (/^pulumi\.ya?ml$/.test(lower)) return 'pulumi';
  if (lower === 'cdk.json') return 'cdk';
  if (/^serverless\.ya?ml$/.test(lower)) return 'serverless';
  if (base === 'Procfile') return 'procfile';
  if (PLATFORM_FILES[lower]) return 'platform';
  if (lower === 'caddyfile' || lower === 'nginx.conf' || (lower.endsWith('.conf') && /(^|\/)(nginx|conf\.d|sites-(available|enabled))\//.test(rel))) return 'proxy';
  if (/^\.github\/workflows\/[^/]+\.ya?ml$/.test(rel) || CI_FILES[lower] || rel === '.circleci/config.yml') return 'ci';
  if (lower === 'package.json' && rel.split('/').length <= 3) return 'package';
  if (/^\.env(\..+)?$/.test(lower)) return 'env';
  return null;
}

function readText(root: string, rel: string, warnings: DeploymentEvidence['warnings']): string | null {
  const full = path.join(root, rel);
  try {
    const st = fs.statSync(full);
    if (st.size > MAX_BYTES) { warnings.push({ path: rel, message: `Not read: larger than ${MAX_BYTES / 1024} KB` }); return null; }
    return fs.readFileSync(full, 'utf8');
  } catch {
    warnings.push({ path: rel, message: 'Could not be read' });
    return null;
  }
}

// --- per-format readers ---

function readDockerfile(rel: string, text: string): DockerfileFacts {
  const facts: DockerfileFacts = { path: rel, stages: [], expose: [], envKeys: [], healthcheck: false };
  const lines = text.replace(/\\\r?\n/g, ' ').split(/\r?\n/).map(l => l.trim()).filter(l => l && !l.startsWith('#'));
  for (const l of lines) {
    const [instr, ...rest] = l.split(/\s+/);
    const args = rest.join(' ');
    switch (instr.toUpperCase()) {
      case 'FROM': {
        const parts = rest.filter(p => !p.startsWith('--'));
        const as = parts.findIndex(p => p.toLowerCase() === 'as');
        facts.stages.push({ image: parts[0], ...(as > 0 && parts[as + 1] ? { name: parts[as + 1] } : {}) });
        break;
      }
      case 'EXPOSE': facts.expose.push(...rest); break;
      case 'CMD': facts.cmd = short(args); break;
      case 'ENTRYPOINT': facts.entrypoint = short(args); break;
      case 'ENV': {
        const keys = args.includes('=') ? [...args.matchAll(/([A-Za-z_][\w]*)=/g)].map(m => m[1]) : [rest[0]];
        facts.envKeys.push(...keys.filter(Boolean));
        break;
      }
      case 'HEALTHCHECK': facts.healthcheck = !/^none$/i.test(args); break;
    }
  }
  return facts;
}

function portString(p: unknown): string {
  if (p && typeof p === 'object') {
    const o = p as Record<string, unknown>;
    return [o.published, o.target].filter(x => x !== undefined).join(':') + (o.protocol ? `/${o.protocol}` : '');
  }
  return String(p);
}

function readCompose(rel: string, doc: unknown): ComposeFacts {
  const d = (doc ?? {}) as Record<string, unknown>;
  const services = Object.entries((d.services ?? {}) as Record<string, Record<string, unknown>>).map(([name, s]) => {
    s = s ?? {};
    const build = typeof s.build === 'string' ? s.build : s.build && typeof s.build === 'object'
      ? [str((s.build as Record<string, unknown>).context), str((s.build as Record<string, unknown>).dockerfile)].filter(Boolean).join(' · ')
      : undefined;
    const env = s.environment;
    const envKeys = Array.isArray(env) ? env.map(e => String(e).split('=')[0]) : keysOf(env);
    const deploy = (s.deploy ?? {}) as Record<string, unknown>;
    const svc: ComposeService = {
      name, image: str(s.image), build,
      ports: asArray(s.ports).map(portString), expose: asArray(s.expose).map(String),
      dependsOn: keysOf(s.depends_on), networks: keysOf(s.networks), volumes: asArray(s.volumes).map(v => (typeof v === 'string' ? v : str((v as Record<string, unknown>)?.source) ?? '')).filter(Boolean),
      envKeys, envFiles: asArray(s.env_file).map(v => (typeof v === 'string' ? v : str((v as Record<string, unknown>)?.path) ?? '')).filter(Boolean),
      command: s.command !== undefined ? short(Array.isArray(s.command) ? s.command.join(' ') : String(s.command)) : undefined,
      replicas: typeof deploy.replicas === 'number' ? deploy.replicas : undefined,
      profiles: asArray(s.profiles).map(String), healthcheck: !!s.healthcheck,
    };
    return svc;
  });
  const variant = path.posix.basename(rel).replace(/^(docker-)?compose\.?/i, '').replace(/\.ya?ml$/i, '') || undefined;
  return { path: rel, variant, services, networks: keysOf(d.networks), volumes: keysOf(d.volumes), secrets: keysOf(d.secrets) };
}

function containersOf(spec: unknown): KubeContainer[] {
  const s = (spec ?? {}) as Record<string, unknown>;
  return [...asArray(s.initContainers), ...asArray(s.containers)].map(c => {
    const o = (c ?? {}) as Record<string, unknown>;
    return { name: String(o.name ?? ''), image: str(o.image), ports: asArray(o.ports).map(p => String((p as Record<string, unknown>)?.containerPort ?? p)) };
  });
}

function readKubernetes(rel: string, doc: Record<string, unknown>): KubeObject {
  const meta = (doc.metadata ?? {}) as Record<string, unknown>;
  const spec = (doc.spec ?? {}) as Record<string, unknown>;
  const obj: KubeObject = { path: rel, kind: String(doc.kind), name: String(meta.name ?? ''), namespace: str(meta.namespace) };
  const template = (spec.template ?? {}) as Record<string, unknown>;
  switch (obj.kind) {
    case 'Deployment': case 'StatefulSet': case 'DaemonSet': case 'ReplicaSet': case 'Job':
      obj.containers = containersOf(template.spec);
      obj.labels = record((template.metadata as Record<string, unknown>)?.labels);
      if (typeof spec.replicas === 'number') obj.replicas = spec.replicas;
      break;
    case 'CronJob': {
      const job = ((spec.jobTemplate as Record<string, unknown>)?.spec ?? {}) as Record<string, unknown>;
      obj.schedule = str(spec.schedule);
      obj.containers = containersOf((job.template as Record<string, unknown>)?.spec);
      break;
    }
    case 'Pod':
      obj.containers = containersOf(spec);
      obj.labels = record(meta.labels);
      break;
    case 'Service':
      obj.serviceType = str(spec.type) ?? 'ClusterIP';
      obj.ports = asArray(spec.ports).map(p => {
        const o = (p ?? {}) as Record<string, unknown>;
        return `${o.port}${o.targetPort !== undefined ? `→${o.targetPort}` : ''}${o.protocol && o.protocol !== 'TCP' ? `/${o.protocol}` : ''}`;
      });
      obj.selector = record(spec.selector);
      break;
    case 'Ingress': {
      obj.rules = [];
      for (const r of asArray(spec.rules)) {
        const rule = (r ?? {}) as Record<string, unknown>;
        const paths = asArray(((rule.http ?? {}) as Record<string, unknown>).paths);
        for (const p of paths.length ? paths : [{}]) {
          const po = (p ?? {}) as Record<string, unknown>;
          const backend = (po.backend ?? {}) as Record<string, unknown>;
          const svc = (backend.service ?? {}) as Record<string, unknown>;
          const port = (svc.port ?? {}) as Record<string, unknown>;
          obj.rules.push({
            host: str(rule.host), path: str(po.path),
            service: str(svc.name ?? backend.serviceName), port: str(port.number ?? port.name ?? backend.servicePort),
          });
        }
      }
      break;
    }
    case 'Secret': case 'ConfigMap':
      obj.note = 'contents not read';
      break;
  }
  return obj;
}

function readTerraform(rel: string, text: string): TerraformFacts {
  const facts: TerraformFacts = { path: rel, providers: [], resources: [], modules: [], data: [] };
  for (const m of text.matchAll(/^\s*resource\s+"([\w-]+)"\s+"([\w-]+)"/gm)) facts.resources.push({ type: m[1], name: m[2] });
  for (const m of text.matchAll(/^\s*data\s+"([\w-]+)"\s+"([\w-]+)"/gm)) facts.data.push({ type: m[1], name: m[2] });
  for (const m of text.matchAll(/^\s*provider\s+"([\w-]+)"/gm)) facts.providers.push(m[1]);
  for (const m of text.matchAll(/^\s*module\s+"([\w-]+)"\s*\{([^}]*)/gm)) {
    facts.modules.push({ name: m[1], source: m[2].match(/source\s*=\s*"([^"]+)"/)?.[1] });
  }
  facts.backend = text.match(/backend\s+"([\w-]+)"/)?.[1];
  return facts;
}

function readServerless(rel: string, doc: unknown): ServerlessFacts {
  const d = (doc ?? {}) as Record<string, unknown>;
  const provider = (typeof d.provider === 'object' && d.provider ? d.provider : { name: d.provider }) as Record<string, unknown>;
  const functions = Object.entries((d.functions ?? {}) as Record<string, Record<string, unknown>>).map(([name, f]) => ({
    name, handler: str(f?.handler),
    events: asArray(f?.events).map(ev => {
      const [type, cfg] = Object.entries((ev ?? {}) as Record<string, unknown>)[0] ?? ['?', undefined];
      if ((type === 'http' || type === 'httpApi') && cfg && typeof cfg === 'object') {
        const c = cfg as Record<string, unknown>;
        return `${type} ${c.method ?? ''} ${c.path ?? ''}`.replace(/\s+/g, ' ').trim();
      }
      return typeof cfg === 'string' ? `${type} ${cfg}` : type;
    }),
  }));
  return { path: rel, service: str(typeof d.service === 'object' ? (d.service as Record<string, unknown>)?.name : d.service), provider: str(provider.name), runtime: str(provider.runtime), region: str(provider.region), stage: str(provider.stage), functions };
}

function readPlatform(rel: string, platform: string, text: string): PlatformFacts {
  const facts: Record<string, string | string[]> = {};
  const toml = (key: string) => [...text.matchAll(new RegExp(`^\\s*${key}\\s*=\\s*["']?([^"'\\n]+?)["']?\\s*$`, 'gm'))].map(m => m[1]);
  const lower = path.posix.basename(rel).toLowerCase();
  try {
    if (lower.endsWith('.json')) {
      const j = JSON.parse(text) as Record<string, unknown>;
      facts.keys = Object.keys(j);
      if (Array.isArray(j.containerDefinitions)) facts.containers = j.containerDefinitions.map(c => `${(c as Record<string, unknown>).name}: ${(c as Record<string, unknown>).image}`);
      if (Array.isArray(j.regions)) facts.regions = j.regions.map(String);
    } else if (lower.endsWith('.toml')) {
      for (const key of ['app', 'name', 'main', 'primary_region', 'internal_port', 'publish', 'command', 'functions']) {
        const v = toml(key);
        if (v.length) facts[key] = v.length === 1 ? v[0] : v;
      }
    } else {
      const y = (YAML.parse(text) ?? {}) as Record<string, unknown>;
      facts.keys = Object.keys(y);
      if (Array.isArray(y.services)) facts.services = y.services.map(s => [(s as Record<string, unknown>).type, (s as Record<string, unknown>).name].filter(Boolean).join(' '));
      if (Array.isArray(y.databases)) facts.databases = y.databases.map(s => String((s as Record<string, unknown>).name));
      for (const key of ['runtime', 'service', 'env']) if (typeof y[key] === 'string') facts[key] = y[key] as string;
    }
  } catch {
    facts.error = 'could not be parsed';
  }
  return { path: rel, platform, facts };
}

function readProxy(rel: string, text: string): ProxyFacts {
  if (path.posix.basename(rel).toLowerCase() === 'caddyfile') {
    return {
      path: rel, server: 'caddy',
      sites: [...text.matchAll(/^([^\s#{][^{\n]*?)\s*\{\s*$/gm)].map(m => m[1].trim()).filter(s => !s.startsWith('(')),
      listen: [],
      upstreams: [...text.matchAll(/reverse_proxy\s+([^\n{]+)/g)].flatMap(m => m[1].trim().split(/\s+/)),
    };
  }
  return {
    path: rel, server: 'nginx',
    sites: [...text.matchAll(/server_name\s+([^;]+);/g)].flatMap(m => m[1].trim().split(/\s+/)),
    listen: [...text.matchAll(/listen\s+([^;]+);/g)].map(m => m[1].trim()),
    upstreams: [...text.matchAll(/proxy_pass\s+([^;]+);/g)].map(m => m[1].trim()),
  };
}

function readCi(rel: string, system: string, text: string): CiFacts {
  const facts: CiFacts = { path: rel, system, triggers: [], deployJobs: [] };
  if (system === 'Jenkins') {
    const tools = toolsIn(text);
    if (tools.length) facts.deployJobs.push({ job: 'Jenkinsfile', uses: [], tools });
    return facts;
  }
  const doc = (YAML.parse(text) ?? {}) as Record<string, unknown>;
  if (system === 'GitHub Actions') {
    facts.triggers = keysOf(doc.on ?? doc.true); // YAML 1.1 reads a bare `on` as true
    for (const [job, j] of Object.entries((doc.jobs ?? {}) as Record<string, Record<string, unknown>>)) {
      const env = j?.environment;
      const environment = typeof env === 'string' ? env : str((env as Record<string, unknown>)?.name);
      const steps = asArray(j?.steps) as Record<string, unknown>[];
      const uses = [...new Set(steps.map(s => str(s?.uses)?.replace(/@.*$/, '')).filter((u): u is string => !!u && DEPLOY_ACTION.test(u)))];
      const tools = toolsIn(steps.map(s => str(s?.run) ?? '').join('\n'));
      if (environment || uses.length || tools.length) facts.deployJobs.push({ job, ...(environment ? { environment } : {}), uses, tools });
    }
    return facts;
  }
  // GitLab and others: jobs are top-level keys with a script
  for (const [job, j] of Object.entries(doc)) {
    if (!j || typeof j !== 'object' || Array.isArray(j)) continue;
    const o = j as Record<string, unknown>;
    const env = o.environment;
    const environment = typeof env === 'string' ? env : str((env as Record<string, unknown>)?.name);
    const tools = toolsIn([o.script, o.before_script].flatMap(asArray).map(String).join('\n'));
    if (environment || tools.length) facts.deployJobs.push({ job, ...(environment ? { environment } : {}), uses: [], tools });
  }
  return facts;
}

function readPackage(rel: string, text: string): PackageFacts | null {
  let p: Record<string, unknown>;
  try { p = JSON.parse(text); } catch { return null; }
  const bin = typeof p.bin === 'string' ? [String(p.name ?? 'bin')] : keysOf(p.bin);
  const scripts = Object.entries((p.scripts ?? {}) as Record<string, string>)
    .map(([name, cmd]) => ({ name, tools: toolsIn(String(cmd)) }))
    .filter(s => s.tools.length || /^(start|serve|deploy|release|publish)(:|$)/.test(s.name));
  return { path: rel, name: str(p.name), bin, private: typeof p.private === 'boolean' ? p.private : undefined, scripts, publish: !p.private && !!p.name };
}

// Replace values that look like secrets, everywhere in the result
function redact<T>(value: T, count: { n: number }): T {
  if (typeof value === 'string') {
    if (findSecrets(value).length) { count.n++; return REDACTED as unknown as T; }
    return value;
  }
  if (Array.isArray(value)) return value.map(v => redact(v, count)) as unknown as T;
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, redact(v, count)])) as T;
  }
  return value;
}

/** Collect deployment evidence from the project at `root` */
export function collectDeploymentEvidence(root: string): DeploymentEvidence {
  const ev: DeploymentEvidence = {
    found: false, scannedFiles: 0, sources: [], dockerfiles: [], compose: [], kubernetes: [], helm: [], terraform: [],
    serverless: [], processes: [], platforms: [], proxies: [], ci: [], packages: [], envFiles: [], environments: [], warnings: [],
  };
  const files = listFiles(root, ev.warnings);
  ev.scannedFiles = files.length;
  const envs = new Map<string, Set<string>>();
  const addEnv = (name: string | undefined, source: string) => {
    if (!name) return;
    const n = ENV_WORDS[name.toLowerCase()] ?? name.toLowerCase();
    if (!envs.has(n)) envs.set(n, new Set());
    envs.get(n)!.add(source);
  };
  const add = (rel: string, kind: EvidenceKind) => ev.sources.push({ path: rel, kind });

  for (const rel of files) {
    let kind = classify(rel);
    const lower = rel.toLowerCase();
    if (kind === 'platform' && path.posix.basename(lower) === 'app.yaml') {
      // app.yaml is App Engine config only when it has a runtime; otherwise it may be a manifest
      if (!/^runtime:/m.test(readText(root, rel, []) ?? '')) kind = null;
    }
    if (!kind && /\.ya?ml$/.test(lower) && !lower.startsWith('.github/')) {
      // Kubernetes manifests have no fixed name: look for apiVersion + kind
      const text = readText(root, rel, []);
      if (text && /^apiVersion:\s*\S/m.test(text) && /^kind:\s*\w+/m.test(text)) kind = 'kubernetes';
    }
    if (!kind) continue;

    if (kind === 'env') {
      const template = /\.(example|sample|template|dist|defaults)$/.test(lower);
      const keys = template ? (readText(root, rel, ev.warnings) ?? '').split(/\r?\n/).map(l => l.match(/^\s*(?:export\s+)?([A-Za-z_][\w]*)\s*=/)?.[1]).filter((k): k is string => !!k) : [];
      ev.envFiles.push({ path: rel, read: template, keys });
      if (!template) addEnv(envFromPath(path.posix.basename(rel).replace(/^\.env\.?/, '')), rel);
      continue; // an env file alone is not deployment evidence
    }

    const text = readText(root, rel, ev.warnings);
    if (text === null) continue;
    try {
      switch (kind) {
        case 'dockerfile': ev.dockerfiles.push(readDockerfile(rel, text)); break;
        case 'compose': {
          const c = readCompose(rel, YAML.parse(text));
          ev.compose.push(c);
          addEnv(c.variant ? envFromPath(c.variant) : undefined, rel);
          for (const s of c.services) if (!s.image && !s.build) ev.warnings.push({ path: rel, message: `Service ${s.name} has neither image nor build` });
          break;
        }
        case 'kubernetes': case 'kustomize': {
          if (text.includes('{{')) { ev.warnings.push({ path: rel, message: 'Template (Helm or similar) not rendered; its objects are not listed' }); break; }
          for (const doc of YAML.parseAllDocuments(text)) {
            const d = doc.toJS() as Record<string, unknown> | null;
            if (d && typeof d === 'object' && d.kind && d.kind !== 'Kustomization') {
              const obj = readKubernetes(rel, d);
              ev.kubernetes.push(obj);
              addEnv(obj.namespace ? envFromPath(obj.namespace) : undefined, rel);
            }
          }
          addEnv(envFromPath(path.posix.dirname(rel)), rel);
          break;
        }
        case 'helm': {
          const c = (YAML.parse(text) ?? {}) as Record<string, unknown>;
          const dir = path.posix.dirname(rel);
          const inDir = files.filter(f => path.posix.dirname(f) === dir);
          const valuesFiles = inDir.filter(f => /^values([.-][\w.-]+)?\.ya?ml$/i.test(path.posix.basename(f)));
          ev.helm.push({
            path: rel, name: str(c.name), version: str(c.version), appVersion: str(c.appVersion),
            dependencies: asArray(c.dependencies).map(x => String((x as Record<string, unknown>)?.name)),
            valuesFiles, hasTemplates: files.some(f => f.startsWith((dir === '.' ? '' : dir + '/') + 'templates/')),
          });
          for (const v of valuesFiles) addEnv(envFromPath(path.posix.basename(v).replace(/^values/i, '')), v);
          break;
        }
        case 'terraform': ev.terraform.push(readTerraform(rel, text)); addEnv(envFromPath(path.posix.dirname(rel)), rel); break;
        case 'pulumi': case 'cdk': ev.platforms.push(readPlatform(rel, kind === 'pulumi' ? 'Pulumi' : 'AWS CDK', text)); break;
        case 'serverless': {
          const s = readServerless(rel, YAML.parse(text));
          ev.serverless.push(s);
          addEnv(s.stage && !s.stage.includes('$') ? s.stage : undefined, rel);
          break;
        }
        case 'procfile':
          for (const m of text.matchAll(/^([\w-]+):\s*(.+)$/gm)) ev.processes.push({ path: rel, process: m[1], command: short(m[2].trim()) });
          break;
        case 'platform': ev.platforms.push(readPlatform(rel, PLATFORM_FILES[path.posix.basename(lower)], text)); break;
        case 'proxy': ev.proxies.push(readProxy(rel, text)); break;
        case 'ci': {
          const system = rel.startsWith('.github/') ? 'GitHub Actions' : rel.startsWith('.circleci/') ? 'CircleCI' : CI_FILES[path.posix.basename(lower)];
          const ci = readCi(rel, system, text);
          ev.ci.push(ci);
          for (const j of ci.deployJobs) addEnv(j.environment, rel);
          break;
        }
        case 'package': { const p = readPackage(rel, text); if (p) ev.packages.push(p); break; }
      }
      add(rel, kind);
    } catch (e) {
      ev.warnings.push({ path: rel, message: `Could not be parsed: ${(e as Error).message.split('\n')[0]}` });
    }
  }

  // Cross-checks between Kubernetes objects
  const workloads = ev.kubernetes.filter(k => k.labels);
  for (const svc of ev.kubernetes.filter(k => k.kind === 'Service' && k.selector)) {
    const matches = workloads.some(w => Object.entries(svc.selector!).every(([k, v]) => w.labels![k] === v));
    if (!matches) ev.warnings.push({ path: svc.path, message: `Service ${svc.name} selects no workload found in the repository` });
  }
  const serviceNames = new Set(ev.kubernetes.filter(k => k.kind === 'Service').map(k => k.name));
  for (const ing of ev.kubernetes.filter(k => k.kind === 'Ingress')) {
    for (const r of ing.rules ?? []) if (r.service && !serviceNames.has(r.service)) ev.warnings.push({ path: ing.path, message: `Ingress ${ing.name} routes to Service ${r.service}, which is not in the repository` });
  }

  ev.environments = [...envs].map(([name, s]) => ({ name, sources: [...s].sort() })).sort((a, b) => a.name.localeCompare(b.name));
  const infra = ev.sources.some(s => s.kind !== 'package' && s.kind !== 'ci');
  const deployCi = ev.ci.some(c => c.deployJobs.length);
  const distributed = ev.packages.some(p => p.bin.length || p.scripts.some(s => s.tools.length));
  ev.found = infra || deployCi || distributed;

  const count = { n: 0 };
  const safe = redact(ev, count);
  if (count.n) safe.warnings.push({ message: `${count.n} value${count.n === 1 ? '' : 's'} that looked like secrets replaced with ${REDACTED}` });
  return safe;
}
