import { describe, it, expect } from 'vitest';
import { parseFlowchart, cleanFlowLabel, arrowStyle } from '../lib/flowchart.js';
import { detectDiagramType } from '../lib/diagram.js';
import { validateDiagram } from '../lib/validate.js';
import { parseMermaid, diffMermaid } from '../lib/diff.js';

// The example from the feature brief: start, process, decision with labelled answers, end
const ORDER = `flowchart TD
    A([Start]) --> B[Receive Order]
    B --> C{Payment Successful?}
    C -- Yes --> D[Confirm Order]
    C -- No --> E[Handle Payment Failure]
    D --> F([End])
    E --> F`;

const edgeList = (text: string) => parseFlowchart(text).edges.map(e => `${e.from}->${e.to}${e.label ? `|${e.label}` : ''}`);

describe('detectDiagramType', () => {
  it('detects flowcharts with and without a direction', () => {
    expect(detectDiagramType('flowchart TD\n a --> b')).toBe('flowchart');
    expect(detectDiagramType('flowchart\n a --> b')).toBe('flowchart');
    expect(detectDiagramType('graph LR\n a --> b')).toBe('flowchart');
  });
});

describe('parseFlowchart', () => {
  it('parses the brief example: sequence, decision and labelled branches', () => {
    const fc = parseFlowchart(ORDER);
    expect(fc.errors).toEqual([]);
    expect(fc.direction).toBe('TB');
    expect(fc.nodes.get('A')).toMatchObject({ shape: 'stadium', label: 'Start' });
    expect(fc.nodes.get('C')).toMatchObject({ shape: 'diamond', label: 'Payment Successful?' });
    expect(fc.nodes.get('D')).toMatchObject({ shape: 'rect', label: 'Confirm Order' });
    expect(edgeList(ORDER)).toEqual(['A->B', 'B->C', 'C->D|Yes', 'C->E|No', 'D->F', 'E->F']);
  });

  it('reads every flowchart symbol', () => {
    const fc = parseFlowchart(`flowchart LR
      start([Start])
      step[Calculate total]
      ask{Valid?}
      io[/Enter email/]
      out[\\Show error\\]
      doc@{ shape: doc, label: "Invoice PDF" }
      sub[[Authenticate user]]
      con((A))
      db[(Orders)]
      hex{{Prepare}}
      flag>Flag]
      round(Rounded)
      stop(((Stop)))
      trap[/Manual\\]
      trapb[\\Priority/]
      s1@{ shape: start }`);
    expect(fc.errors).toEqual([]);
    const shapes = Object.fromEntries([...fc.nodes.values()].map(n => [n.id, n.shape]));
    expect(shapes).toEqual({
      start: 'stadium', step: 'rect', ask: 'diamond', io: 'lean-right', out: 'lean-left', doc: 'document',
      sub: 'subroutine', con: 'circle', db: 'cylinder', hex: 'hexagon', flag: 'asymmetric', round: 'round',
      stop: 'double-circle', trap: 'trapezoid', trapb: 'trapezoid-alt', s1: 'small-circle',
    });
    expect(fc.nodes.get('doc')?.label).toBe('Invoice PDF');
    expect(fc.nodes.get('io')?.label).toBe('Enter email');
  });

  it('keeps a slash inside an ordinary label', () => {
    expect(parseFlowchart('flowchart LR\n  a[/api/users]').nodes.get('a')).toMatchObject({ shape: 'rect', label: '/api/users' });
  });

  it('reads chains, & fan-out and a later definition of an earlier node', () => {
    const text = 'flowchart LR\n  a --> b --> c\n  a & b --> d\n  d\n  d[Done]';
    expect(edgeList(text)).toEqual(['a->b', 'b->c', 'a->d', 'b->d']);
    expect(parseFlowchart(text).nodes.get('d')?.label).toBe('Done');
  });

  it('represents loops as edges back to an earlier node', () => {
    const text = 'flowchart TD\n  p[Process next item] --> m{More items?}\n  m -->|Yes| p\n  m -->|No| done([Done])';
    expect(edgeList(text)).toEqual(['p->m', 'm->p|Yes', 'm->done|No']);
  });

  it('reads every label form', () => {
    const text = 'flowchart LR\n  a -->|"quoted"| b\n  b -- plain words --> c\n  c -. maybe .-> d\n  d == sure ==> e';
    expect(edgeList(text)).toEqual(['a->b|quoted', 'b->c|plain words', 'c->d|maybe', 'd->e|sure']);
  });

  it('reads line styles, arrow ends and lengths', () => {
    const fc = parseFlowchart('flowchart LR\n  a -.-> b\n  b ==> c\n  c --- d\n  d --o e\n  e --x f\n  f <--> g\n  g ~~~ h\n  h ----> i\n  i o--o j');
    expect(fc.edges.map(e => [e.arrow, e.style, e.tail, e.head, e.length])).toEqual([
      ['-.->', 'dotted', 'none', 'arrow', 1],
      ['==>', 'thick', 'none', 'arrow', 1],
      ['---', 'solid', 'none', 'none', 1],
      ['--o', 'solid', 'none', 'circle', 1],
      ['--x', 'solid', 'none', 'cross', 1],
      ['<-->', 'solid', 'arrow', 'arrow', 1],
      ['~~~', 'invisible', 'none', 'none', 1],
      ['---->', 'solid', 'none', 'arrow', 3],
      ['o--o', 'solid', 'circle', 'circle', 1],
    ]);
  });

  it('does not read an ID ending in o or x as an arrow end', () => {
    expect(edgeList('flowchart LR\n  info-->box\n  x-->o')).toEqual(['info->box', 'x->o']);
  });

  it('turns <br>, \\n and entity codes into label text', () => {
    expect(cleanFlowLabel('"Line one<br/>line two"')).toBe('Line one\nline two');
    expect(cleanFlowLabel('Store\\nsrc/lib/store.ts')).toBe('Store\nsrc/lib/store.ts');
    expect(cleanFlowLabel('Say #quot;hi#quot; #35;1')).toBe('Say "hi" #1');
    expect(cleanFlowLabel('"`**Bold** step`"')).toBe('Bold step');
  });

  it('keeps the omm-scan "\\n" detail line apart from <br> label lines', () => {
    const fc = parseFlowchart('graph LR\n  store["Store\\nsrc/lib/store.ts"]\n  step["Check stock<br>and reserve"]');
    expect(fc.nodes.get('store')).toMatchObject({ label: 'Store', detail: 'src/lib/store.ts' });
    expect(fc.nodes.get('step')).toMatchObject({ label: 'Check stock\nand reserve', detail: undefined });
  });

  it('keeps @ references and classes', () => {
    const fc = parseFlowchart('graph LR\n  a["@auth-flow\\nsrc/auth/"] --> @billing\n  b:::store\n  class a external');
    expect(fc.nodes.get('a')).toMatchObject({ isRef: true, refTarget: 'auth-flow', cls: 'external' });
    expect(fc.nodes.get('billing')).toMatchObject({ isRef: true, refTarget: 'billing', rawId: '@billing' });
    expect(fc.nodes.get('b')?.cls).toBe('store');
  });

  it('reads subgraphs with labels, nesting and direction', () => {
    const fc = parseFlowchart('flowchart LR\n  subgraph customer [Customer]\n    direction TB\n    a[Place order]\n  end\n  subgraph team["Our team"]\n    subgraph inner\n      b[Pack]\n    end\n  end\n  a --> b\n  a --> team');
    expect(fc.errors).toEqual([]);
    expect(fc.subgraphs.get('customer')).toMatchObject({ label: 'Customer', direction: 'TB' });
    expect(fc.subgraphs.get('inner')?.parent).toBe('team');
    expect(fc.nodes.get('a')?.subgraph).toBe('customer');
    expect(fc.nodes.get('b')?.subgraph).toBe('inner');
    // an edge to a subgraph does not create a node
    expect(fc.nodes.has('team')).toBe(false);
  });

  it('joins a multi-line @{ } block', () => {
    const fc = parseFlowchart('flowchart LR\n  r@{\n    shape: doc\n    label: "Report"\n  }\n  r --> s');
    expect(fc.errors).toEqual([]);
    expect(fc.nodes.get('r')).toMatchObject({ shape: 'document', label: 'Report' });
  });

  it('ignores styling statements', () => {
    const fc = parseFlowchart('flowchart LR\n  a --> b\n  classDef hot fill:#f00\n  style a fill:#fff\n  linkStyle 0 stroke:#f00\n  click a "https://example.com"\n  accTitle: Orders');
    expect(fc.errors).toEqual([]);
    expect(fc.nodes.size).toBe(2);
  });

  it('reports unreadable statements with line numbers', () => {
    const fc = parseFlowchart('flowchart LR\n  a --> b\n  a -->\n  c[unclosed\n  end\n  subgraph open');
    expect(fc.errors.map(e => e.line)).toEqual([3, 4, 5, 6]);
    expect(fc.errors[0].message).toMatch(/without a target/);
    expect(fc.errors[1].message).toMatch(/unclosed bracket/);
    expect(fc.errors[2].message).toMatch(/without an open subgraph/);
    expect(fc.errors[3].message).toMatch(/missing its closing "end"/);
  });

  it('describes arrows', () => {
    expect(arrowStyle('-..->')).toMatchObject({ style: 'dotted', length: 2 });
    expect(arrowStyle('===')).toMatchObject({ style: 'thick', head: 'none', length: 1 });
  });
});

describe('validateDiagram on flowcharts', () => {
  it('accepts the brief example without warnings', () => {
    expect(validateDiagram(ORDER).issues).toEqual([]);
  });

  it('accepts a flowchart declaration without a direction', () => {
    const r = validateDiagram('flowchart\n  a([Start]) --> b[Step one] --> c[Step two] --> d([End])');
    expect(r.issues.find(i => i.rule === 'graph-declaration')).toBeUndefined();
  });

  it('in a process flowchart, asks for labels only on decision branches', () => {
    const r = validateDiagram('flowchart TD\n  s([Start]) --> a[Check stock]\n  a --> q{In stock?}\n  q --> ship[Ship]\n  q -->|No| wait[Back-order]\n  ship --> e([End])\n  wait --> e');
    const labels = r.issues.filter(i => i.rule === 'edge-label');
    expect(labels).toHaveLength(1);
    expect(labels[0]).toMatchObject({ line: 4, message: 'Decision branch without label (e.g. Yes / No): q --> ship' });
  });

  it('warns about a decision with fewer than two branches', () => {
    const r = validateDiagram('flowchart TD\n  s([Start]) --> q{Approved?}\n  q -->|Yes| e([End])');
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'decision-branches', line: 2 }));
  });

  it('keeps the architecture edge-label rule, recognising inline labels', () => {
    const r = validateDiagram('graph LR\n  api -- "reads" --> db\n  api --> cache\n  api --- logs\n  a((1)) --> api');
    const labels = r.issues.filter(i => i.rule === 'edge-label');
    expect(labels.map(i => i.message)).toEqual(['Edge without label: api --> cache']);
  });

  it('reports unreadable statements as flowchart-syntax errors', () => {
    const r = validateDiagram('flowchart LR\n  a([Start]) --> b[Go]\n  b -->\n  b --> c([End])');
    expect(r.valid).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'error', rule: 'flowchart-syntax', line: 3 }));
  });

  it('does not read the flag shape as an unbalanced bracket', () => {
    const r = validateDiagram('graph LR\n  a -->|"tags"| k>Flag]');
    expect(r.issues.filter(i => i.rule === 'balanced-brackets')).toEqual([]);
  });

  it('does not report an unbalanced line twice', () => {
    const r = validateDiagram('graph LR\n  a["unclosed');
    expect(r.issues.filter(i => i.rule === 'balanced-brackets')).toHaveLength(1);
    expect(r.issues.filter(i => i.rule === 'flowchart-syntax')).toHaveLength(0);
  });
});

describe('diffMermaid on flowcharts', () => {
  it('reports the decision branches the old viewer dropped', () => {
    const p = parseMermaid(ORDER);
    expect([...p.edges]).toContain('C --> D');
    expect([...p.nodes].sort()).toEqual(['A', 'B', 'C', 'D', 'E', 'F']);
  });

  it('reports a new shape-only node and edge', () => {
    const d = diffMermaid('flowchart LR\n  a --> b', 'flowchart LR\n  a --> b\n  b --> doc@{ shape: doc, label: "Invoice" }');
    expect(d.added_nodes).toEqual(['doc']);
    expect(d.added_edges).toEqual(['b --> doc']);
  });

  it('does not read the header of other diagram types as a node', () => {
    expect(parseMermaid('pie\n  "a" : 1').nodes.has('pie')).toBe(false);
  });
});

describe('edge IDs and animation', () => {
  const FLOW = `flowchart LR
    web[Web] e1@-->|upload| api[API]
    api e2@-.-> store[(Files)]
    store --> web
    e1@{ animate: true }
    e2@{ animation: slow }`;

  it('reads edge IDs and their animation settings', () => {
    const fc = parseFlowchart(FLOW);
    expect(fc.errors).toEqual([]);
    expect([...fc.nodes.keys()]).toEqual(['web', 'api', 'store']);
    expect(fc.edges.map(e => [e.from, e.to, e.id, e.animate, e.animation])).toEqual([
      ['web', 'api', 'e1', true, undefined],
      ['api', 'store', 'e2', true, 'slow'],
      ['store', 'web', undefined, undefined, undefined],
    ]);
    expect(fc.edges[0]).toMatchObject({ label: 'upload', style: 'solid', head: 'arrow' });
    expect(fc.edges[1]).toMatchObject({ style: 'dotted', head: 'arrow' });
  });

  it('accepts settings before the edge, inline labels, chains and animate: false', () => {
    const fc = parseFlowchart('flowchart TD\n  e1@{ animate: false }\n  a e1@-- sends --> b e2@==> c\n  e2@{ animate: true, curve: linear }');
    expect(fc.errors).toEqual([]);
    expect(fc.edges.map(e => [e.from, e.to, e.label, e.id, e.animate])).toEqual([
      ['a', 'b', 'sends', 'e1', false],
      ['b', 'c', '', 'e2', true],
    ]);
  });

  it('keeps node shapes written with @{ }', () => {
    const fc = parseFlowchart('flowchart TD\n  a --> d\n  d@{ shape: doc, label: "Invoice" }');
    expect(fc.nodes.get('d')).toMatchObject({ shape: 'document', label: 'Invoice' });
  });

  it('does not take an ID without whitespace as an edge ID', () => {
    expect(parseFlowchart('flowchart TD\n  a@-->b').edges[0]).toMatchObject({ from: 'a@', to: 'b' });
  });

  it('reports settings for an edge ID that does not exist', () => {
    const fc = parseFlowchart('flowchart TD\n  a e1@--> b\n  e9@{ animate: true }');
    expect(fc.errors).toEqual([{ line: 3, message: 'No edge with ID e9 (write it as: a e9@--> b)' }]);
  });

  it('is accepted by omm validate, and omm diff ignores the IDs', () => {
    expect(validateDiagram(FLOW).issues.filter(i => i.level === 'error')).toEqual([]);
    expect([...parseMermaid(FLOW).edges].sort()).toEqual(['api -.-> store', 'store --> web', 'web --> api']);
    expect(diffMermaid(FLOW.replace(/ e1@/, ' '), FLOW)).toMatchObject({ added_edges: [], removed_edges: [], added_nodes: [] });
  });
});
