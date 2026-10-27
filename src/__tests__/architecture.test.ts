import { describe, it, expect } from 'vitest';
import { parseArchitectureDiagram, archGroupDepth } from '../lib/architecture.js';
import { detectDiagramType } from '../lib/diagram.js';
import { validateDiagram } from '../lib/validate.js';
import { parseMermaid, diffMermaid } from '../lib/diff.js';
import { archEdgeMotion } from '../lib/flow-motion.js';
import { archServiceRole } from '../lib/palette.js';
import { extractRefs } from '../lib/refs.js';

// A single containerized app: compose with an app container and a database container
const CONTAINER = `architecture-beta
  service browser(internet)[Browser]
  group host(server)[Docker host]
  service app(server)["Web app\\napp/"] in host
  service db(database)[Postgres 16] in host
  browser:R -[HTTP 8080]-> L:app
  app:R -[SQL 5432]-> L:db`;

// Frontend, backend and database across public and private network zones
const ZONES = `architecture-beta
  title Production
  %% @overall-architecture/server
  service user(internet)[User browser]
  group cloud(cloud)[Cloud account]
  group public(cloud)[Public zone] in cloud
  group private(cloud)[Private zone] in cloud
  service cdn(server)[CDN static site] in public
  service api(server)["API\\nserver/"] in private
  service db(database)[Managed Postgres] in private
  service mail(internet)[Mail provider]
  user:R -[HTTPS]-> L:cdn
  user:B -[HTTPS /api]-> T:api
  api:R -[SQL]-> L:db
  api{group}:R -[SMTP]-> L:mail`;

// Development and production side by side, each as a group
const ENVIRONMENTS = `architecture-beta
  group dev(server)[Development: docker compose]
  group prod(cloud)[Production: Kubernetes]
  service devApi(server)[API] in dev
  service devDb(database)[Postgres] in dev
  service prodApi(server)[API x3] in prod
  service prodDb(database)[Managed Postgres] in prod
  junction lb in prod
  devApi:R -[SQL]-> L:devDb
  lb:R -[HTTP]-> L:prodApi
  prodApi:R -[SQL]-> L:prodDb`;

describe('parseArchitectureDiagram', () => {
  it('is detected as its own diagram type', () => {
    expect(detectDiagramType(CONTAINER)).toBe('architecture');
    expect(detectDiagramType('%% deployment\narchitecture-beta\n  service a[A]')).toBe('architecture');
  });

  it('reads hosts, what runs on them and the connections (containerized app)', () => {
    const a = parseArchitectureDiagram(CONTAINER);
    expect(a.errors).toEqual([]);
    expect([...a.groups.values()]).toEqual([{ id: 'host', icon: 'server', title: 'Docker host', parent: undefined, line: 3 }]);
    expect(a.services.get('app')).toMatchObject({ icon: 'server', title: 'Web app', detail: 'app/', parent: 'host' });
    expect(a.services.get('browser')?.parent).toBeUndefined();
    expect(a.edges.map(e => [e.from, e.fromSide, e.to, e.toSide, e.head, e.tail, e.title])).toEqual([
      ['browser', 'R', 'app', 'L', true, false, 'HTTP 8080'],
      ['app', 'R', 'db', 'L', true, false, 'SQL 5432'],
    ]);
  });

  it('reads nested zones and {group} edges (frontend / backend / database)', () => {
    const a = parseArchitectureDiagram(ZONES);
    expect(a.errors).toEqual([]);
    expect(a.title).toBe('Production');
    expect(archGroupDepth(a, 'cloud')).toBe(0);
    expect(archGroupDepth(a, 'private')).toBe(1);
    expect(a.services.get('api')).toMatchObject({ parent: 'private', title: 'API', detail: 'server/' });
    expect(a.edges.at(-1)).toMatchObject({ from: 'api', fromGroup: true, to: 'mail', toGroup: false, title: 'SMTP' });
  });

  it('reads environments as separate groups, with junctions', () => {
    const a = parseArchitectureDiagram(ENVIRONMENTS);
    expect(a.errors).toEqual([]);
    expect([...a.services.values()].filter(s => s.parent === 'prod').map(s => s.id)).toEqual(['prodApi', 'prodDb']);
    expect(a.junctions.get('lb')).toMatchObject({ parent: 'prod' });
  });

  it('reads every arrow form, quoted titles, icon text, align and accessibility lines', () => {
    const a = parseArchitectureDiagram(`architecture-beta
      accTitle: Deployment
      accDescr {
        Two services
      }
      service a "λ"[Function]
      service b(logos:aws-s3)["Bucket [raw]"]
      service c[Plain]
      a:R --> L:b
      a:B <-- T:c
      b:L <--> R:c
      b:B -- T:c
      a:T -[fan out]- B:c
      align row a b`);
    expect(a.errors).toEqual([]);
    expect(a.services.get('a')).toMatchObject({ iconText: 'λ', title: 'Function' });
    expect(a.services.get('b')).toMatchObject({ icon: 'logos:aws-s3', title: 'Bucket [raw]' });
    expect(a.edges.map(e => `${e.tail ? '<' : ''}--${e.head ? '>' : ''}${e.title ? ' ' + e.title : ''}`)).toEqual(['-->', '<--', '<-->', '--', '-- fan out']);
    expect(a.aligns).toEqual([{ axis: 'row', ids: ['a', 'b'], line: 14 }]);
  });

  it('reports what Mermaid would reject, with line numbers', () => {
    const a = parseArchitectureDiagram(`architecture-beta
      service a[A] in nowhere
      group g[G]
      service b[B] in g
      service c[C]
      a:R --> L:missing
      a:R --> L:g
      c{group}:R --> L:b
      b:R ==> L:c
      service a[Again]
      something else`);
    expect(a.errors.map(e => [e.line, e.message.split(' (')[0]])).toEqual([
      [2, 'Group nowhere is not declared before it is used'],
      [6, 'missing is not declared before this edge'],
      [7, 'Edges connect services or junctions, not groups: g. Use a service inside it with {group}'],
      [8, 'c{group} needs c to be inside a group'],
      [9, 'Could not read edge'],
      [10, 'a is declared twice'],
      [11, 'Unrecognized statement: something else'],
    ]);
  });
});

describe('validateDiagram on architecture diagrams', () => {
  it('accepts the fixtures without errors', () => {
    for (const text of [CONTAINER, ZONES, ENVIRONMENTS]) {
      expect(validateDiagram(text).issues.filter(i => i.level === 'error'), text).toEqual([]);
    }
  });

  it('reports syntax errors, unconnected services and unlabelled connections', () => {
    const r = validateDiagram('architecture-beta\n  service a[A]\n  service b[B]\n  service c[C]\n  a:R --> L:b\n  a:R --> L:zzz');
    expect(r.valid).toBe(false);
    expect(r.issues.map(i => [i.rule, i.line])).toEqual([
      ['arch-syntax', 6],
      ['arch-orphan', 4],
      ['arch-edge-label', 5],
    ]);
  });

  it('resolves @references written in a %% comment, without drawing them', () => {
    expect(extractRefs(ZONES)).toEqual(['overall-architecture/server']);
    const ok = validateDiagram(ZONES, { className: 'deployment', allClasses: ['deployment', 'overall-architecture', 'overall-architecture/server'] });
    expect(ok.issues.filter(i => i.rule.startsWith('ref'))).toEqual([]);
    const broken = validateDiagram(ZONES, { className: 'deployment', allClasses: ['deployment'] });
    expect(broken.issues.map(i => i.rule)).toContain('ref-exists');
    expect(parseArchitectureDiagram(ZONES).services.has('overall-architecture')).toBe(false);
  });
});

describe('diffMermaid on architecture diagrams', () => {
  it('reports groups, services and connections; sides are layout only', () => {
    expect([...parseMermaid(CONTAINER).nodes].sort()).toEqual(['app', 'browser', 'db', 'host']);
    expect([...parseMermaid(CONTAINER).edges]).toEqual(['browser --> app: HTTP 8080', 'app --> db: SQL 5432']);
    const moved = CONTAINER.replace('app:R -[SQL 5432]-> L:db', 'app:B -[SQL 5432]-> T:db');
    expect(diffMermaid(CONTAINER, moved)).toMatchObject({ added_nodes: [], removed_nodes: [], added_edges: [], removed_edges: [] });
    const cache = CONTAINER + '\n  service cache(database)[Redis] in host\n  app:B -[RESP]-> T:cache';
    expect(diffMermaid(CONTAINER, cache)).toMatchObject({ added_nodes: ['cache'], added_edges: ['app --> cache: RESP'] });
  });
});

describe('architecture flow motion and colors', () => {
  it('moves one-way connections only', () => {
    expect(archEdgeMotion({ head: true, tail: false })).toBe('normal');
    expect(archEdgeMotion({ head: false, tail: true })).toBe('normal');
    expect(archEdgeMotion({ head: true, tail: true })).toBeNull();
    expect(archEdgeMotion({ head: false, tail: false })).toBeNull();
  });

  it('colors data stores and the internet by icon, other services stay neutral', () => {
    expect(archServiceRole('database')).toBe('data');
    expect(archServiceRole('disk')).toBe('data');
    expect(archServiceRole('logos:aws-s3')).toBe('data');
    expect(archServiceRole('internet')).toBe('external');
    expect(archServiceRole('server')).toBe('neutral');
    expect(archServiceRole(undefined)).toBe('neutral');
  });
});
