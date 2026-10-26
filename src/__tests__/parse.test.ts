import { describe, it, expect } from 'vitest';
import { parseMermaid, diffMermaid } from '../lib/diff.js';
import { validateDiagram } from '../lib/validate.js';

// Copied from this repository's own .omm/overall-architecture/diagram.mmd (format produced by /omm-scan)
const SCANNED = `graph LR
    cli["CLI Dispatcher\\nsrc/cli.ts"]
    commands["Commands\\nsrc/commands/"]
    store["Store\\nsrc/lib/store.ts"]
    cloud["Cloud Client\\nsrc/lib/cloud.ts"]
    diff-engine["Diff Engine\\nsrc/lib/diff.ts"]
    refs["Ref Tracker\\nsrc/lib/refs.ts"]
    validator["Validator\\nsrc/lib/validate.ts"]
    meta["Meta Tracker\\nsrc/lib/meta.ts"]
    cloud-paths["Cloud Paths\\nsrc/lib/cloud-paths.ts"]
    platforms["Platform Integrations\\nsrc/lib/platforms/"]
    server["Web Viewer\\nsrc/server/"]
    public-api["Public API\\nsrc/index.ts"]

    cli -->|"dispatches args to"| commands
    commands -->|"read/write .omm/"| store
    commands -->|"push/pull via REST"| cloud
    commands -->|"compare diagrams"| diff-engine
    commands -->|"cross-references"| refs
    commands -->|"validate mermaid"| validator
    commands -->|"register skills"| platforms
    commands -->|"start HTTP server"| server
    store -->|"update timestamps + git"| meta
    cloud -->|"safe path resolution"| cloud-paths
    server -->|"read classes"| store
    server -->|"compare diagrams"| diff-engine
    server -->|"resolve refs"| refs
    public-api -->|"re-exports"| store
    public-api -->|"re-exports"| diff-engine
    public-api -->|"re-exports"| refs
    public-api -->|"re-exports"| validator

    classDef external fill:#585b70,stroke:#585b70,color:#cdd6f4
    classDef entry fill:#89b4fa,stroke:#89b4fa,color:#1e1e2e

    class cli,public-api entry
`;

const sorted = (s: Set<string>) => [...s].sort();

describe('parseMermaid', () => {
  it('parses a diagram produced by /omm-scan exactly', () => {
    const { nodes, edges } = parseMermaid(SCANNED);
    expect(nodes.size).toBe(12);
    expect(edges.size).toBe(17);
    expect(nodes.has('diff-engine')).toBe(true);
    expect(edges.has('cli --> commands')).toBe(true);
    expect(edges.has('public-api --> validator')).toBe(true);
    expect([...nodes].some(n => n.includes('|'))).toBe(false);
  });

  it('handles labelled edges with inline node definitions', () => {
    const { nodes, edges } = parseMermaid('graph LR\n  a["A [x]"] -->|"uses (y)"| b["B"]');
    expect(sorted(nodes)).toEqual(['a', 'b']);
    expect(sorted(edges)).toEqual(['a --> b']);
  });

  it('handles kebab-case IDs without spaces around arrows', () => {
    const { edges } = parseMermaid('graph LR\n  main-process-->data-store\n  a-.->b\n  c==>d');
    expect(sorted(edges)).toEqual(['a -.-> b', 'c ==> d', 'main-process --> data-store']);
  });

  it('handles inline text edges', () => {
    const { edges } = parseMermaid('graph LR\n  APP -- "HTTP API" --> SERVER\n  x -- plain text --- y\n  p -. maybe .-> q');
    expect(sorted(edges)).toEqual(['APP --> SERVER', 'p -.-> q', 'x --- y']);
  });

  it('handles chains, fan-out and class suffixes', () => {
    const { nodes, edges } = parseMermaid('graph TD\n  a --> b --> c\n  d & e --> f:::store\n  g --> h & i');
    expect(sorted(edges)).toEqual(['a --> b', 'b --> c', 'd --> f', 'e --> f', 'g --> h', 'g --> i']);
    expect(nodes.has('f')).toBe(true);
    expect(nodes.has('f:::store')).toBe(false);
  });

  it('handles all common shapes', () => {
    const { nodes } = parseMermaid('graph LR\n  a((Circle))\n  b[(Database)]\n  c([Stadium])\n  d{Decision}\n  e{{Hex}}\n  f>Flag]\n  g[[Sub]]\n  h(Round)');
    expect(sorted(nodes)).toEqual(['a', 'b', 'c', 'd', 'e', 'f', 'g', 'h']);
  });

  it('handles several statements on one line and other arrow types', () => {
    const { edges } = parseMermaid('graph LR\n  a --> b; b --o c; c --x d; d <--> e; e ~~~ f;');
    expect(sorted(edges)).toEqual(['a --> b', 'b --o c', 'c --x d', 'd <--> e', 'e ~~~ f']);
  });

  it('ignores directives, subgraphs and comments but keeps nodes inside subgraphs', () => {
    const { nodes, edges } = parseMermaid('graph LR\n  %% comment\n  subgraph grp ["Group"]\n    direction TB\n    a --> b\n  end\n  style a fill:#fff\n  click a "http://x"');
    expect(sorted(nodes)).toEqual(['a', 'b']);
    expect(sorted(edges)).toEqual(['a --> b']);
  });

  it('keeps @refs as node IDs', () => {
    const { nodes } = parseMermaid('graph LR\n  a -->|"uses"| @auth-flow');
    expect(nodes.has('@auth-flow')).toBe(true);
  });
});

describe('diffMermaid', () => {
  const before = 'graph LR\n  d["D"] -->|"x"| e["E"]\n  e -->|"y"| g["G"]';

  it('reports a changed edge target as removed + added', () => {
    const after = 'graph LR\n  d["D"] -->|"x"| f["F"]\n  e -->|"y"| g["G"]';
    const diff = diffMermaid(before, after);
    expect(diff.added_nodes).toEqual(['f']);
    expect(diff.added_edges).toEqual(['d --> f']);
    expect(diff.removed_edges).toEqual(['d --> e']);
    expect(diff.removed_nodes).toEqual([]);
  });

  it('reports no change when only a label changes', () => {
    const after = 'graph LR\n  d["D renamed"] -->|"x changed"| e["E"]\n  e -->|"y"| g["G"]';
    expect(diffMermaid(before, after).has_changes).toBe(false);
  });
});

describe('node-count validation on scanned diagrams', () => {
  it('counts real nodes only (no false "too many nodes" warning)', () => {
    const result = validateDiagram(SCANNED);
    expect(result.issues.filter(i => i.rule === 'node-count')).toEqual([]);
  });
});
