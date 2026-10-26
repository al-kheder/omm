import type { DiffResult } from '../types.js';
import { detectDiagramType, parseErDiagram } from './er.js';

interface MermaidElement {
  nodes: Set<string>;
  edges: Set<string>;
  /** ER diagrams only: "entity.attribute" entries, so diffs report attribute changes */
  attributes?: Set<string>;
}

/** ER diagram as nodes (entities), edges ("a ||--o{ b") and attributes ("a.id") */
function parseEr(text: string): MermaidElement {
  const er = parseErDiagram(text);
  const nodes = new Set(er.entities.keys());
  const edges = new Set(er.relationships.map(r => `${r.from} ${r.fromCard}${r.identifying ? '--' : '..'}${r.toCard} ${r.to}`));
  const attributes = new Set<string>();
  for (const entity of er.entities.values()) {
    for (const attr of entity.attributes) attributes.add(`${entity.name}.${attr.name}`);
  }
  return { nodes, edges, attributes };
}

const SKIP_LINE = /^(graph|flowchart|sequenceDiagram|classDiagram|erDiagram|stateDiagram|gantt|pie|gitGraph|classDef|class\s|click\s|style\s|linkStyle|subgraph|end$|direction\s|%%)/i;

// Arrow forms: -->, --->, ---, -.->, -.-, ==>, ===, --o, --x, ~~~ (optionally bidirectional with a leading <)
const ARROW = /^<?(?:-{2,}>|-{3,}|-\.+->|-\.+-|={2,}>|={3,}|-{2,}[ox]|={2,}[ox]|~{3,})/;
// Inline text form: A -- text --> B, A == text ==> B, A -. text .-> B
const INLINE_ARROW = /^<?(--|==|-\.)\s+(?:"[^"]*"|[^"]*?)\s+(-{2,}>|-{3,}|={2,}>|={3,}|\.-+>|\.-+|-{2,}[ox])/;
const PIPE_LABEL = /^\s*\|[^|]*\|/;
const SHAPE_OPEN = '[({';
const SHAPE_CLOSE: Record<string, string> = { '[': ']', '(': ')', '{': '}' };

/** Split a line on `;` outside quoted text (Mermaid allows several statements per line). */
function splitStatements(line: string): string[] {
  const out: string[] = [];
  let current = '';
  let inQuote = false;
  for (const ch of line) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ';' && !inQuote) {
      out.push(current);
      current = '';
    } else {
      current += ch;
    }
  }
  out.push(current);
  return out.map(s => s.trim()).filter(Boolean);
}

/** Length of the shape starting at s[0] ("[...]", "((...))", "[(...)]", ">...]"), or 0 if malformed. */
function shapeLength(s: string): number {
  if (s[0] === '>') {
    const end = s.indexOf(']');
    return end < 0 ? 0 : end + 1;
  }
  const stack: string[] = [];
  let inQuote = false;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (ch === '"') { inQuote = !inQuote; continue; }
    if (inQuote) continue;
    if (SHAPE_OPEN.includes(ch)) stack.push(SHAPE_CLOSE[ch]);
    else if (ch === stack[stack.length - 1]) {
      stack.pop();
      if (stack.length === 0) return i + 1;
    }
  }
  return 0;
}

/**
 * Read a node reference at the start of s: an ID, an optional shape and an optional
 * `:::class`. Returns the ID and the number of characters consumed, or null.
 */
function readNode(s: string): { id: string; length: number } | null {
  let i = 0;
  // IDs end at whitespace, a shape opener, `&`, `:::` or the start of an arrow
  while (i < s.length && !/[\s[({>&;|]/.test(s[i]) && !s.startsWith(':::', i) && !ARROW.test(s.slice(i)) && !INLINE_ARROW.test(s.slice(i))) {
    i++;
  }
  if (i === 0) return null;
  const id = s.slice(0, i).replace(/["']/g, '');
  if (i < s.length && (SHAPE_OPEN.includes(s[i]) || s[i] === '>')) {
    const len = shapeLength(s.slice(i));
    if (len === 0) return null;
    i += len;
  }
  const cls = s.slice(i).match(/^:::[\w-]+/);
  if (cls) i += cls[0].length;
  return { id, length: i };
}

/** Read one or more `&`-joined nodes. */
function readNodeGroup(s: string): { ids: string[]; length: number } | null {
  const ids: string[] = [];
  let pos = 0;
  for (;;) {
    pos += s.slice(pos).length - s.slice(pos).trimStart().length;
    const node = readNode(s.slice(pos));
    if (!node) return ids.length ? { ids, length: pos } : null;
    ids.push(node.id);
    pos += node.length;
    const amp = s.slice(pos).match(/^\s*&\s*/);
    if (!amp) return { ids, length: pos };
    pos += amp[0].length;
  }
}

/** Read an arrow (with optional |label| or inline text). Returns the normalized arrow. */
function readArrow(s: string): { arrow: string; length: number } | null {
  const lead = s.length - s.trimStart().length;
  const rest = s.slice(lead);
  const inline = rest.match(INLINE_ARROW);
  if (inline) {
    const open = inline[1];
    const close = inline[2];
    // "-- text -->" is the same edge type as "-->"; "-. text .->" as "-.->"
    const arrow = open === '-.' ? `-${close}` : close;
    return { arrow, length: lead + inline[0].length };
  }
  const plain = rest.match(ARROW);
  if (!plain) return null;
  let length = lead + plain[0].length;
  const label = s.slice(length).match(PIPE_LABEL);
  if (label) length += label[0].length;
  return { arrow: plain[0], length };
}

/**
 * Flowchart parser — extracts node IDs and edges from Mermaid text.
 * Handles quoted labels, all common shapes, `-->|label|` and `-- label -->` edges,
 * chains (`A --> B --> C`), `&` fan-out and `:::class` suffixes.
 * Edge identity is `src arrow dst`; labels are not part of it.
 */
export function parseMermaid(text: string): MermaidElement {
  if (detectDiagramType(text) === 'er') return parseEr(text);

  const nodes = new Set<string>();
  const edges = new Set<string>();

  const lines = text.split('\n').map(l => l.trim()).filter(l => l && !SKIP_LINE.test(l));

  for (const statement of lines.flatMap(splitStatements)) {
    if (SKIP_LINE.test(statement)) continue;

    let pos = 0;
    let group = readNodeGroup(statement);
    if (!group) continue;
    group.ids.forEach(id => nodes.add(id));
    pos += group.length;

    for (;;) {
      const arrow = readArrow(statement.slice(pos));
      if (!arrow) break;
      pos += arrow.length;
      const next = readNodeGroup(statement.slice(pos));
      if (!next) break;
      pos += next.length;
      for (const src of group.ids) {
        for (const dst of next.ids) {
          nodes.add(dst);
          edges.add(`${src} ${arrow.arrow} ${dst}`);
        }
      }
      group = next;
    }
  }

  return { nodes, edges };
}

export function diffMermaid(before: string, after: string): DiffResult {
  const prev = parseMermaid(before);
  const curr = parseMermaid(after);

  const added_nodes = [...curr.nodes].filter(n => !prev.nodes.has(n));
  const removed_nodes = [...prev.nodes].filter(n => !curr.nodes.has(n));
  const added_edges = [...curr.edges].filter(e => !prev.edges.has(e));
  const removed_edges = [...prev.edges].filter(e => !curr.edges.has(e));

  const result: DiffResult = {
    added_nodes,
    removed_nodes,
    added_edges,
    removed_edges,
    has_changes: added_nodes.length > 0 || removed_nodes.length > 0 || added_edges.length > 0 || removed_edges.length > 0,
  };

  // ER diagrams: also report attribute changes
  if (prev.attributes || curr.attributes) {
    const prevAttrs = prev.attributes ?? new Set<string>();
    const currAttrs = curr.attributes ?? new Set<string>();
    result.added_attributes = [...currAttrs].filter(a => !prevAttrs.has(a));
    result.removed_attributes = [...prevAttrs].filter(a => !currAttrs.has(a));
    result.has_changes ||= result.added_attributes.length > 0 || result.removed_attributes.length > 0;
  }

  return result;
}

export function formatDiff(diff: DiffResult): string {
  if (!diff.has_changes) return 'No changes detected.\n';

  const lines: string[] = [];
  if (diff.added_nodes.length) {
    lines.push('Added nodes:');
    diff.added_nodes.forEach(n => lines.push(`  + ${n}`));
  }
  if (diff.removed_nodes.length) {
    lines.push('Removed nodes:');
    diff.removed_nodes.forEach(n => lines.push(`  - ${n}`));
  }
  if (diff.added_edges.length) {
    lines.push('Added edges:');
    diff.added_edges.forEach(e => lines.push(`  + ${e}`));
  }
  if (diff.removed_edges.length) {
    lines.push('Removed edges:');
    diff.removed_edges.forEach(e => lines.push(`  - ${e}`));
  }
  if (diff.added_attributes?.length) {
    lines.push('Added attributes:');
    diff.added_attributes.forEach(a => lines.push(`  + ${a}`));
  }
  if (diff.removed_attributes?.length) {
    lines.push('Removed attributes:');
    diff.removed_attributes.forEach(a => lines.push(`  - ${a}`));
  }
  return lines.join('\n') + '\n';
}
