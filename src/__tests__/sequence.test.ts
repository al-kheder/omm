import { describe, it, expect } from 'vitest';
import { parseSequenceDiagram, messageStyle } from '../lib/sequence.js';
import { validateDiagram } from '../lib/validate.js';
import { diffMermaid, formatDiff, parseMermaid } from '../lib/diff.js';

const LOGIN = `sequenceDiagram
    %% login flow
    autonumber
    actor user as User
    participant web as Web App
    participant api-gateway as API
    participant db
    user->>web: submit credentials
    web->>+api-gateway: POST /login
    api-gateway->>db: find user by email
    db-->>api-gateway: user row
    alt password matches
        api-gateway-->>web: 200 + session cookie
    else wrong password
        api-gateway--xweb: 401
    end
    api-gateway-->>-web: done
    Note over web,api-gateway: session stored in Redis
    loop every 5 min
        web-)api-gateway: refresh token
    end
`;

describe('parseSequenceDiagram', () => {
  const seq = parseSequenceDiagram(LOGIN);

  it('parses without errors', () => {
    expect(seq.errors).toEqual([]);
    expect(seq.autonumber).toBe(true);
  });

  it('collects participants in order, with kind and label', () => {
    expect([...seq.participants.keys()]).toEqual(['user', 'web', 'api-gateway', 'db']);
    expect(seq.participants.get('user')).toEqual({ id: 'user', kind: 'actor', label: 'User' });
    expect(seq.participants.get('db')).toEqual({ id: 'db', kind: 'participant' });
  });

  it('parses messages with arrows, text and activation markers', () => {
    const messages = seq.events.filter(e => e.kind === 'message');
    expect(messages).toHaveLength(8);
    expect(messages[0]).toMatchObject({ from: 'user', to: 'web', arrow: '->>', text: 'submit credentials' });
    expect(messages[1]).toMatchObject({ from: 'web', to: 'api-gateway', arrow: '->>', activate: true });
    expect(messages[5]).toMatchObject({ arrow: '--x', text: '401' });
    expect(messages[6]).toMatchObject({ from: 'api-gateway', arrow: '-->>', deactivate: true });
    expect(messages[7]).toMatchObject({ arrow: '-)', text: 'refresh token' });
  });

  it('keeps hyphenated participant names whole', () => {
    expect(seq.participants.has('api')).toBe(false);
  });

  it('records notes and blocks in order', () => {
    const kinds = seq.events.map(e => e.kind === 'block' ? `block:${e.type}` : e.kind);
    expect(kinds).toEqual([
      'message', 'message', 'message', 'message',
      'block:alt', 'message', 'branch', 'message', 'end',
      'message', 'note', 'block:loop', 'message', 'end',
    ]);
    expect(seq.events.find(e => e.kind === 'note')).toMatchObject({ placement: 'over', participants: ['web', 'api-gateway'] });
  });

  it('does not read arrows inside notes or block labels as messages', () => {
    const d = parseSequenceDiagram('sequenceDiagram\n  a->>b: x\n  Note right of b: retry -> fail: give up\n  alt status -> ok: yes\n  b-->>a: y\n  end');
    expect(d.errors).toEqual([]);
    expect(d.events.filter(e => e.kind === 'message')).toHaveLength(2);
  });

  it('collects participants in boxes', () => {
    const d = parseSequenceDiagram('sequenceDiagram\n  box Backend\n    participant api\n    participant db\n  end\n  api->>db: query');
    expect(d.errors).toEqual([]);
    expect(d.boxes).toEqual([{ label: 'Backend', participants: ['api', 'db'] }]);
  });

  it('reports unbalanced blocks, misplaced branches and bad activations with line numbers', () => {
    const d = parseSequenceDiagram('sequenceDiagram\n  a->>b: x\n  else nope\n  end\n  deactivate a\n  loop forever\n  what is this');
    expect(d.errors.map(e => e.line)).toEqual([3, 4, 5, 7, 6]);
    expect(d.errors[0].message).toMatch(/only allowed inside "alt"/);
    expect(d.errors[1].message).toMatch(/without an open block/);
    expect(d.errors[2].message).toMatch(/not active/);
    expect(d.errors[3].message).toMatch(/Unrecognized statement/);
    expect(d.errors[4].message).toMatch(/"loop" is missing its closing "end"/);
  });

  it('reports messages without a colon', () => {
    expect(parseSequenceDiagram('sequenceDiagram\n  a->>b').errors[0].message).toMatch(/Message without text/);
  });

  it('requires the sequenceDiagram declaration', () => {
    expect(parseSequenceDiagram('graph LR\n a->>b: x').errors[0].message).toMatch(/must start with "sequenceDiagram"/);
  });
});

describe('messageStyle', () => {
  it('maps arrows to line style and head', () => {
    expect(messageStyle('->>')).toEqual({ dashed: false, head: 'filled', bidirectional: false });
    expect(messageStyle('-->>')).toEqual({ dashed: true, head: 'filled', bidirectional: false });
    expect(messageStyle('->')).toEqual({ dashed: false, head: 'none', bidirectional: false });
    expect(messageStyle('--x')).toEqual({ dashed: true, head: 'cross', bidirectional: false });
    expect(messageStyle('-)')).toEqual({ dashed: false, head: 'async', bidirectional: false });
    expect(messageStyle('<<-->>')).toEqual({ dashed: true, head: 'filled', bidirectional: true });
  });
});

describe('validateDiagram on sequence diagrams', () => {
  it('accepts a valid sequence diagram with no flowchart-rule noise', () => {
    const r = validateDiagram(LOGIN);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('reports syntax errors with line numbers', () => {
    const r = validateDiagram('sequenceDiagram\n  a->>b: x\n  end');
    expect(r.valid).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'error', rule: 'seq-syntax', line: 3 }));
  });

  it('warns about unused participants and messages without text', () => {
    const r = validateDiagram('sequenceDiagram\n  participant idle\n  a->>b:');
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'seq-unused-participant', level: 'warning' }));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'seq-message-label', level: 'warning', line: 3 }));
  });

  it('warns about very long sequences and counts participants', () => {
    const msgs = Array.from({ length: 31 }, (_, i) => `  p${i % 17}->>p${(i + 1) % 17}: m${i}`).join('\n');
    const r = validateDiagram(`sequenceDiagram\n${msgs}`);
    expect(r.issues.find(i => i.rule === 'message-count')?.message).toMatch(/31 messages/);
    expect(r.issues.find(i => i.rule === 'node-count')?.message).toMatch(/17 participants/);
  });

  it('does not warn about small sequence diagrams', () => {
    expect(validateDiagram('sequenceDiagram\n  a->>b: ping\n  b-->>a: pong').issues).toEqual([]);
  });

  it('checks @refs in sequence diagrams too', () => {
    const r = validateDiagram('sequenceDiagram\n  a->>b: see @storage/missing', { className: 'request-lifecycle', allClasses: ['request-lifecycle'] });
    expect(r.issues.find(i => i.rule === 'ref-exists')).toBeDefined();
  });
});

describe('diffMermaid on sequence diagrams', () => {
  const before = 'sequenceDiagram\n  a->>b: ping\n  b-->>a: pong';

  it('treats participants as nodes and messages as edges', () => {
    const p = parseMermaid(before);
    expect([...p.nodes]).toEqual(['a', 'b']);
    expect([...p.edges]).toEqual(['a ->> b: ping', 'b -->> a: pong']);
  });

  it('reports added participants and changed messages', () => {
    const after = 'sequenceDiagram\n  a->>b: ping\n  b->>c: forward\n  b-->>a: pong!';
    const d = diffMermaid(before, after);
    expect(d.added_nodes).toEqual(['c']);
    expect(d.added_edges.sort()).toEqual(['b -->> a: pong!', 'b ->> c: forward']);
    expect(d.removed_edges).toEqual(['b -->> a: pong']);
    expect(formatDiff(d)).toMatch(/Added edges:/);
  });

  it('counts repeated messages and ignores reordering', () => {
    const repeated = 'sequenceDiagram\n  a->>b: ping\n  a->>b: ping\n  b-->>a: pong';
    expect(diffMermaid(before, repeated).added_edges).toEqual(['a ->> b: ping (2)']);
    expect(diffMermaid(before, 'sequenceDiagram\n  b-->>a: pong\n  a->>b: ping').has_changes).toBe(false);
  });
});
