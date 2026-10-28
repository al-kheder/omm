import { describe, it, expect } from 'vitest';
import { parseClassDiagram, parseClassMember, classRelationKind } from '../lib/class-diagram.js';
import { detectDiagramType } from '../lib/diagram.js';
import { validateDiagram } from '../lib/validate.js';
import { parseMermaid, diffMermaid } from '../lib/diff.js';
import { classNodeRole } from '../lib/palette.js';

// A domain model: inheritance, composition, aggregation, cardinalities, generics, a namespace
const SHOP = `classDiagram
  direction LR
  namespace orders {
    class Order {
      +String id
      -List~LineItem~ items
      +total() Money
      +addItem(Product p, int qty) void
    }
    class LineItem {
      +int quantity
    }
  }
  class Product["Product (catalog)"]
  Product : +String sku
  Product : +Money price
  class Repository~T~ {
    <<interface>>
    +find(id) T
    +save(T entity)$ void
  }
  Order "1" *-- "1..*" LineItem : contains
  LineItem --> Product : refers to
  Customer "1" o-- "*" Order : places
  OrderRepository ..|> Repository
  Customer : +String email`;

// Interfaces, abstract types, dependencies, lollipop interfaces, notes
const SHAPES = `classDiagram
  class Shape {
    <<abstract>>
    +area()* double
    +String name$
  }
  <<interface>> Drawable
  Shape <|-- Circle
  Shape <|-- Square
  Circle ..> Math : uses
  Drawable <|.. Shape
  Canvas ()-- Drawable
  Square --|> Shape
  note for Circle "radius > 0"
  note "Shapes are immutable"`;

describe('parseClassDiagram', () => {
  it('is detected as its own diagram type', () => {
    expect(detectDiagramType(SHOP)).toBe('class');
    expect(detectDiagramType('classDiagram-v2\n  A <|-- B')).toBe('class');
  });

  it('reads types, members, generics, labels and namespaces', () => {
    const cd = parseClassDiagram(SHOP);
    expect(cd.errors).toEqual([]);
    expect(cd.direction).toBe('LR');
    expect([...cd.classes.keys()]).toEqual(['Order', 'LineItem', 'Product', 'Repository', 'Customer', 'OrderRepository']);
    const order = cd.classes.get('Order')!;
    expect(order.namespace).toBe('orders');
    expect(order.attributes.map(m => m.text)).toEqual(['+String id', '-List<LineItem> items']);
    expect(order.methods.map(m => [m.text, m.name])).toEqual([['+total() Money', 'total()'], ['+addItem(Product p, int qty) void', 'addItem()']]);
    expect(cd.classes.get('Product')).toMatchObject({ label: 'Product (catalog)', attributes: [{ name: 'sku' }, { name: 'price' }] });
    expect(cd.classes.get('Repository')).toMatchObject({ generic: 'T', annotations: ['interface'] });
    expect(cd.classes.get('Repository')!.methods[1]).toMatchObject({ text: '+save(T entity) void', static: true });
    expect(cd.namespaces.get('orders')?.classes).toEqual(['Order', 'LineItem']);
  });

  it('reads every relationship end, line style, cardinality and label', () => {
    const cd = parseClassDiagram(SHOP);
    expect(cd.relations.map(r => [r.from, r.fromEnd, r.dashed ? '..' : '--', r.toEnd, r.to, r.fromCard, r.toCard, r.label])).toEqual([
      ['Order', 'composition', '--', 'none', 'LineItem', '1', '1..*', 'contains'],
      ['LineItem', 'none', '--', 'arrow', 'Product', undefined, undefined, 'refers to'],
      ['Customer', 'aggregation', '--', 'none', 'Order', '1', '*', 'places'],
      ['OrderRepository', 'none', '..', 'inheritance', 'Repository', undefined, undefined, ''],
    ]);
    const shapes = parseClassDiagram(SHAPES);
    expect(shapes.errors).toEqual([]);
    expect(shapes.relations.map(r => `${r.from} ${r.arrow} ${r.to} = ${classRelationKind(r)}`)).toEqual([
      'Shape <|-- Circle = inheritance',
      'Shape <|-- Square = inheritance',
      'Circle ..> Math = dependency',
      'Drawable <|.. Shape = realization',
      'Canvas ()-- Drawable = interface',
      'Square --|> Shape = inheritance',
    ]);
  });

  it('reads annotations, abstract and static members and notes', () => {
    const cd = parseClassDiagram(SHAPES);
    expect(cd.classes.get('Shape')).toMatchObject({ annotations: ['abstract'] });
    expect(cd.classes.get('Shape')!.methods[0]).toMatchObject({ text: '+area() double', abstract: true });
    expect(cd.classes.get('Shape')!.attributes[0]).toMatchObject({ text: '+String name', static: true });
    expect(cd.classes.get('Drawable')?.annotations).toEqual(['interface']);
    expect(cd.notes).toEqual([{ text: 'radius > 0', for: 'Circle', line: 14 }, { text: 'Shapes are immutable', line: 15 }]);
  });

  it('parses member lines on their own', () => {
    expect(parseClassMember('-int id$')).toMatchObject({ text: '-int id', name: 'id', visibility: '-', static: true, kind: 'attribute' });
    expect(parseClassMember('#name : String')).toMatchObject({ name: 'name', visibility: '#' });
    expect(parseClassMember('+getItems() List~Item~')).toMatchObject({ text: '+getItems() List<Item>', name: 'getItems()', kind: 'method' });
    expect(parseClassMember('~helper()')).toMatchObject({ visibility: '~', name: 'helper()' });
  });

  it('ignores styling and interaction lines', () => {
    const cd = parseClassDiagram('classDiagram\n  A <|-- B\n  classDef hot fill:#f00\n  cssClass "A" hot\n  style B fill:#0f0\n  click A href "https://example.com"\n  callback B "fn"\n  link A "https://example.com"');
    expect(cd.errors).toEqual([]);
  });

  it('reports what it cannot read, with line numbers', () => {
    const cd = parseClassDiagram('classDiagram\n  class Open {\n    +x\n  A <||-- B\n  note for Ghost "?"\n  <<interface>>\n  what is this');
    // the open body swallows the following lines, as in Mermaid; then it is reported as unclosed
    expect(cd.errors).toEqual([
      { line: 2, message: 'Class Open is missing its closing "}"' },
    ]);
    const cd2 = parseClassDiagram('classDiagram\n  A <||-- B\n  note for Ghost "?"\n  <<interface>>\n  what is this\n  }');
    expect(cd2.errors.map(e => [e.line, e.message.split(' (')[0].split(':')[0]])).toEqual([
      [2, 'Could not read relationship'],
      [4, 'Annotation <<interface>> needs a class'],
      [5, 'Unrecognized statement'],
      [6, '"}" without an open class or namespace'],
      [3, 'Note for unknown class Ghost'],
    ]);
  });
});

describe('validateDiagram on class diagrams', () => {
  it('accepts the fixtures without errors', () => {
    expect(validateDiagram(SHOP).issues.filter(i => i.level === 'error')).toEqual([]);
    expect(validateDiagram(SHAPES).issues.filter(i => i.level === 'error')).toEqual([]);
  });

  it('warns about types without relationships and counts types', () => {
    const r = validateDiagram('classDiagram\n  A <|-- B\n  class Lonely');
    expect(r.issues).toEqual([{ level: 'warning', rule: 'class-orphan', message: 'Lonely has no relationships', line: 3 }]);
    const big = ['classDiagram', ...Array.from({ length: 16 }, (_, i) => `  T${i} <|-- T${i + 1}`)].join('\n');
    expect(validateDiagram(big).issues.find(i => i.rule === 'node-count')?.message).toBe('17 types (recommended: 5-15). Consider splitting into sub-diagrams.');
  });

  it('reports syntax errors as class-syntax', () => {
    const r = validateDiagram('classDiagram\n  A <||-- B');
    expect(r.valid).toBe(false);
    expect(r.issues[0]).toMatchObject({ rule: 'class-syntax', line: 2 });
  });
});

describe('diffMermaid on class diagrams', () => {
  it('reports types, relationships and members', () => {
    expect([...parseMermaid(SHOP).edges]).toContain('Order "1" *-- "1..*" LineItem: contains');
    const after = SHOP.replace('    +int quantity', '    +int quantity\n    +Money discount').replace('  LineItem --> Product : refers to', '  LineItem --> Product : refers to\n  Order --> Coupon');
    const d = diffMermaid(SHOP, after);
    expect(d).toMatchObject({ added_nodes: ['Coupon'], removed_nodes: [], added_edges: ['Order --> Coupon'], removed_edges: [], added_attributes: ['LineItem.discount'], removed_attributes: [], has_changes: true });
  });
});

describe('class diagram colors', () => {
  it('gives interfaces and abstract types their own role', () => {
    expect(classNodeRole(['interface'])).toBe('interface');
    expect(classNodeRole(['Abstract'])).toBe('interface');
    expect(classNodeRole(['service'])).toBe('entity');
    expect(classNodeRole([])).toBe('entity');
  });
});
