import { describe, it, expect } from 'vitest';
import { parseErDiagram, detectDiagramType, cardinalityText } from '../lib/er.js';

const SHOP = `erDiagram
    %% online shop
    customer ||--o{ order : places
    order ||--|{ line-item : contains
    product ||--o{ line-item : "ordered in"
    customer }|..|{ address : uses
    customer {
        string id PK
        string email UK "login name"
        string name
    }
    order {
        int id PK
        string customer_id FK
        decimal(10,2) total
        string[] tags
    }
    product["Product catalog"] {
        int *sku
        string name
    }
    line-item {
        int order_id PK, FK
        int sku PK, FK
    }
    address
`;

describe('detectDiagramType', () => {
  it('detects flowcharts, ER diagrams and others', () => {
    expect(detectDiagramType('graph LR\n a --> b')).toBe('flowchart');
    expect(detectDiagramType('flowchart TD\n a --> b')).toBe('flowchart');
    expect(detectDiagramType('%% comment\nerDiagram\n a ||--o{ b : x')).toBe('er');
    expect(detectDiagramType('---\ntitle: Shop\n---\nerDiagram\n a ||--o{ b : x')).toBe('er');
    expect(detectDiagramType('sequenceDiagram\n a->>b: hi')).toBe('unknown');
    expect(detectDiagramType('')).toBe('unknown');
  });
});

describe('parseErDiagram', () => {
  const er = parseErDiagram(SHOP);

  it('parses without errors', () => {
    expect(er.errors).toEqual([]);
  });

  it('collects entities from relationships, blocks and bare declarations', () => {
    expect([...er.entities.keys()].sort()).toEqual(['address', 'customer', 'line-item', 'order', 'product']);
  });

  it('parses relationships with cardinality, identifying flag and labels', () => {
    expect(er.relationships).toHaveLength(4);
    expect(er.relationships[0]).toEqual({ from: 'customer', to: 'order', fromCard: '||', toCard: 'o{', identifying: true, label: 'places' });
    expect(er.relationships[2].label).toBe('ordered in');
    expect(er.relationships[3]).toMatchObject({ fromCard: '}|', toCard: '|{', identifying: false });
  });

  it('parses attributes with types, keys and comments', () => {
    expect(er.entities.get('customer')!.attributes).toEqual([
      { type: 'string', name: 'id', keys: ['PK'] },
      { type: 'string', name: 'email', keys: ['UK'], comment: 'login name' },
      { type: 'string', name: 'name', keys: [] },
    ]);
    expect(er.entities.get('order')!.attributes.map(a => a.type)).toEqual(['int', 'string', 'decimal(10,2)', 'string[]']);
    expect(er.entities.get('line-item')!.attributes[0].keys).toEqual(['PK', 'FK']);
  });

  it('supports aliases and the *name primary-key shorthand', () => {
    const product = er.entities.get('product')!;
    expect(product.alias).toBe('Product catalog');
    expect(product.attributes[0]).toEqual({ type: 'int', name: 'sku', keys: ['PK'] });
  });

  it('reads direction and quoted entity names', () => {
    const d = parseErDiagram('erDiagram\n  direction LR\n  "user account" ||--o{ session : opens');
    expect(d.direction).toBe('LR');
    expect(d.entities.has('user account')).toBe(true);
    expect(d.errors).toEqual([]);
  });

  it('reports invalid relationships, attributes and unclosed blocks with line numbers', () => {
    const d = parseErDiagram('erDiagram\n  a ||--> b : x\n  c {\n    not valid here !\n  d ||--o{ e');
    expect(d.errors.map(e => e.line)).toEqual([2, 4, 5, 3]);
    expect(d.errors[0].message).toMatch(/Invalid relationship/);
    expect(d.errors[1].message).toMatch(/Invalid attribute/);
    expect(d.errors[3].message).toMatch(/missing its closing/);
  });

  it('requires the erDiagram declaration', () => {
    expect(parseErDiagram('graph LR\n a ||--o{ b : x').errors[0].message).toMatch(/must start with "erDiagram"/);
  });
});

describe('cardinalityText', () => {
  it('maps markers to readable text', () => {
    expect(['||', '|o', 'o|', '}|', '|{', '}o', 'o{'].map(cardinalityText)).toEqual(['1', '0..1', '0..1', '1..*', '1..*', '0..*', '0..*']);
  });
});

describe('validateDiagram on ER diagrams', async () => {
  const { validateDiagram } = await import('../lib/validate.js');

  it('accepts a valid ER diagram with no flowchart-rule noise', () => {
    const r = validateDiagram(SHOP);
    expect(r.valid).toBe(true);
    expect(r.issues).toEqual([]);
  });

  it('reports ER syntax errors with line numbers', () => {
    const r = validateDiagram('erDiagram\n  a ||--> b : x\n  c ||--o{ a : y');
    expect(r.valid).toBe(false);
    expect(r.issues).toContainEqual(expect.objectContaining({ level: 'error', rule: 'er-syntax', line: 2 }));
  });

  it('warns about entities without relationships', () => {
    const r = validateDiagram('erDiagram\n  a ||--o{ b : has\n  lonely { int id PK }'.replace('{ int id PK }', '{\n int id PK\n }'));
    expect(r.issues).toContainEqual(expect.objectContaining({ rule: 'er-orphan-entity', level: 'warning' }));
  });

  it('checks @refs in ER diagrams too', () => {
    const r = validateDiagram('erDiagram\n  a ||--o{ b : "see @storage/missing"', { className: 'data-model', allClasses: ['data-model'] });
    expect(r.issues.find(i => i.rule === 'ref-exists')).toBeDefined();
  });

  it('counts entities for node-count', () => {
    const rels = Array.from({ length: 16 }, (_, i) => `  e${i} ||--o{ e${i + 1} : r`).join('\n');
    const r = validateDiagram(`erDiagram\n${rels}`);
    expect(r.issues.find(i => i.rule === 'node-count')?.message).toMatch(/17 entities/);
  });
});

describe('diffMermaid on ER diagrams', async () => {
  const { diffMermaid, formatDiff } = await import('../lib/diff.js');
  const before = 'erDiagram\n  user ||--o{ order : places\n  user {\n    int id PK\n    string email\n  }';

  it('reports entity, relationship and attribute changes', () => {
    const after = 'erDiagram\n  user ||--|{ order : places\n  order ||--o{ item : has\n  user {\n    int id PK\n    string name\n  }';
    const d = diffMermaid(before, after);
    expect(d.added_nodes).toEqual(['item']);
    expect(d.added_edges.sort()).toEqual(['order ||--o{ item', 'user ||--|{ order']);
    expect(d.removed_edges).toEqual(['user ||--o{ order']);
    expect(d.added_attributes).toEqual(['user.name']);
    expect(d.removed_attributes).toEqual(['user.email']);
    expect(formatDiff(d)).toMatch(/Added attributes:\n  \+ user\.name/);
  });

  it('reports no change when only a relationship label changes', () => {
    const after = before.replace('places', 'submits');
    expect(diffMermaid(before, after).has_changes).toBe(false);
  });
});
