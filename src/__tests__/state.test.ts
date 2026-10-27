import { describe, it, expect } from 'vitest';
import { parseStateDiagram, pseudoStateId, stateDisplayId } from '../lib/state.js';
import { detectDiagramType } from '../lib/diagram.js';
import { validateDiagram } from '../lib/validate.js';
import { diffMermaid, parseMermaid } from '../lib/diff.js';

const ORDER = `stateDiagram-v2
    %% order lifecycle
    direction LR
    [*] --> draft
    draft --> submitted : submit
    submitted --> check
    state check <<choice>>
    check --> paid : payment ok
    check --> failed : payment declined
    state "Payment failed" as failed
    failed --> draft : retry
    state paid {
        [*] --> packing
        packing --> shipped : hand to carrier
        shipped --> [*]
    }
    paid --> delivered : delivered
    delivered --> [*]
    paid : money captured
    note right of failed : customer is emailed
    note left of draft
        editable by the customer
        until submitted
    end note
`;

describe('detectDiagramType', () => {
  it('detects state diagrams', () => {
    expect(detectDiagramType('stateDiagram-v2\n [*] --> a')).toBe('state');
    expect(detectDiagramType('stateDiagram\n [*] --> a')).toBe('state');
  });
});

describe('parseStateDiagram', () => {
  const sd = parseStateDiagram(ORDER);

  it('parses without errors and reads the direction', () => {
    expect(sd.errors).toEqual([]);
    expect(sd.direction).toBe('LR');
  });

  it('collects states with kind, label, description and parent', () => {
    expect(sd.states.get('check')?.kind).toBe('choice');
    expect(sd.states.get('failed')?.label).toBe('Payment failed');
    expect(sd.states.get('paid')).toMatchObject({ composite: true, descriptions: ['money captured'] });
    expect(sd.states.get('packing')?.parent).toBe('paid');
    expect(sd.states.get('draft')?.parent).toBeUndefined();
  });

  it('scopes [*] to the enclosing composite state', () => {
    expect(sd.states.get(pseudoStateId(undefined, 'start'))?.kind).toBe('start');
    expect(sd.states.get(pseudoStateId(undefined, 'end'))?.kind).toBe('end');
    expect(sd.states.get(pseudoStateId('paid', 'start'))?.parent).toBe('paid');
    expect(sd.transitions[0]).toMatchObject({ from: '[*]start', to: 'draft', label: '' });
    expect(sd.transitions.find(t => t.to === 'packing')?.from).toBe('paid/[*]start');
  });

  it('parses transitions with triggers', () => {
    expect(sd.transitions).toHaveLength(11);
    expect(sd.transitions[1]).toMatchObject({ from: 'draft', to: 'submitted', label: 'submit', line: 5 });
  });

  it('parses single-line and multi-line notes', () => {
    expect(sd.notes).toEqual([
      { state: 'failed', placement: 'right of', text: 'customer is emailed' },
      { state: 'draft', placement: 'left of', text: 'editable by the customer\nuntil submitted' },
    ]);
  });

  it('accepts fork, join, concurrent regions and :::class suffixes', () => {
    const d = parseStateDiagram('stateDiagram-v2\n  state f <<fork>>\n  state j <<join>>\n  [*] --> f\n  f --> a:::hot\n  f --> b\n  state both {\n    x --> y : go\n    --\n    p --> q : go\n  }\n  a --> j\n  b --> j\n  classDef hot fill:#f00');
    expect(d.errors).toEqual([]);
    expect(d.states.get('f')?.kind).toBe('fork');
    expect(d.states.get('j')?.kind).toBe('join');
    expect(d.states.get('a')).toBeDefined();
  });

  it('reports invalid lines and unclosed blocks with line numbers', () => {
    const d = parseStateDiagram('stateDiagram-v2\n  a -> b\n  }\n  what is this\n  state c {\n  note left of a\n    text');
    expect(d.errors.map(e => e.line)).toEqual([2, 3, 4, 6, 5]);
    expect(d.errors[0].message).toMatch(/Invalid transition/);
    expect(d.errors[1].message).toMatch(/without an open composite/);
    expect(d.errors[2].message).toMatch(/Unrecognized statement/);
    expect(d.errors[3].message).toMatch(/end note/);
    expect(d.errors[4].message).toMatch(/c is missing its closing/);
  });

  it('requires the stateDiagram declaration', () => {
    expect(parseStateDiagram('graph LR\n a --> b').errors[0].message).toMatch(/must start with "stateDiagram-v2"/);
  });
});

describe('stateDisplayId', () => {
  it('shows pseudo-states as [*]', () => {
    expect(stateDisplayId('[*]start')).toBe('[*]');
    expect(stateDisplayId('[*]end')).toBe('[*]');
    expect(stateDisplayId('paid/[*]start')).toBe('paid/[*]');
    expect(stateDisplayId('draft')).toBe('draft');
  });
});

describe('validateDiagram on state diagrams', () => {
  it('accepts a valid state diagram with no flowchart-rule noise', () => {
    const r = validateDiagram(ORDER);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('reports syntax errors with line numbers', () => {
    const r = validateDiagram('stateDiagram-v2\n  [*] --> a\n  a -> b');
    expect(r.valid).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'error', rule: 'state-syntax', line: 3 }));
  });

  it('warns about states without transitions and transitions without triggers', () => {
    const r = validateDiagram('stateDiagram-v2\n  [*] --> a\n  a --> b\n  lonely');
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'state-orphan', message: 'State lonely has no transitions' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'state-transition-label', line: 3 }));
    // transitions from [*] need no trigger
    expect(r.issues.filter(i => i.rule === 'state-transition-label')).toHaveLength(1);
  });

  it('counts states (not [*]) for node-count and does not warn about small diagrams', () => {
    expect(validateDiagram('stateDiagram-v2\n  [*] --> on\n  on --> off : toggle\n  off --> on : toggle').issues).toEqual([]);
    const chain = Array.from({ length: 16 }, (_, i) => `  s${i} --> s${i + 1} : next`).join('\n');
    expect(validateDiagram(`stateDiagram-v2\n${chain}`).issues.find(i => i.rule === 'node-count')?.message).toMatch(/17 states/);
  });
});

describe('diffMermaid on state diagrams', () => {
  const before = 'stateDiagram-v2\n  [*] --> idle\n  idle --> running : start\n  running --> [*]';

  it('treats states as nodes and transitions (with trigger) as edges', () => {
    const p = parseMermaid(before);
    expect([...p.nodes]).toEqual(['idle', 'running']);
    expect([...p.edges]).toEqual(['[*] --> idle', 'idle --> running: start', 'running --> [*]']);
  });

  it('reports added states and changed triggers', () => {
    const after = 'stateDiagram-v2\n  [*] --> idle\n  idle --> running : run\n  running --> paused : pause\n  running --> [*]';
    const d = diffMermaid(before, after);
    expect(d.added_nodes).toEqual(['paused']);
    expect(d.added_edges.sort()).toEqual(['idle --> running: run', 'running --> paused: pause']);
    expect(d.removed_edges).toEqual(['idle --> running: start']);
  });
});
