import type { DiffResult } from '../types.js';
import { detectDiagramType } from './diagram.js';
import { parseErDiagram } from './er.js';
import { parseSequenceDiagram } from './sequence.js';
import { parseStateDiagram, stateDisplayId } from './state.js';
import { parseFlowchart } from './flowchart.js';

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

/**
 * Sequence diagram as nodes (participants) and edges ("a ->> b: text").
 * The message text is part of the identity; a repeated message gets a " (2)", " (3)" … suffix.
 * Reordering messages is not reported.
 */
function parseSequence(text: string): MermaidElement {
  const seq = parseSequenceDiagram(text);
  const nodes = new Set(seq.participants.keys());
  const edges = new Set<string>();
  const seen = new Map<string, number>();
  for (const e of seq.events) {
    if (e.kind !== 'message') continue;
    const key = `${e.from} ${e.arrow} ${e.to}: ${e.text}`;
    const n = (seen.get(key) ?? 0) + 1;
    seen.set(key, n);
    edges.add(n === 1 ? key : `${key} (${n})`);
  }
  return { nodes, edges };
}

/**
 * State diagram as nodes (states, without the [*] pseudo-states) and edges ("a --> b: event").
 * The trigger is part of the identity: two transitions between the same states are different events.
 */
function parseState(text: string): MermaidElement {
  const sd = parseStateDiagram(text);
  const nodes = new Set([...sd.states.values()].filter(s => s.kind !== 'start' && s.kind !== 'end').map(s => s.id));
  const edges = new Set(sd.transitions.map(t => {
    const edge = `${stateDisplayId(t.from)} --> ${stateDisplayId(t.to)}`;
    return t.label ? `${edge}: ${t.label}` : edge;
  }));
  return { nodes, edges };
}

// Headers of diagram types without their own parser; dropped so they are not read as a node
const OTHER_HEADER = /^(classDiagram(-v2)?|gantt|pie|gitGraph|journey|mindmap|timeline|quadrantChart|requirementDiagram|C4\w*|block(-beta)?|sankey(-beta)?|xychart(-beta)?|packet(-beta)?|architecture(-beta)?|kanban)\b.*$/;

/**
 * Flowchart as nodes and edges, using the shared parser in flowchart.ts.
 * Edge identity is `src arrow dst`; labels are not part of it. Legacy `@id` nodes keep their `@`.
 */
function parseFlow(text: string): MermaidElement {
  const fc = parseFlowchart(text);
  const raw = (id: string) => fc.nodes.get(id)?.rawId ?? id;
  const nodes = new Set([...fc.nodes.values()].map(n => n.rawId));
  const edges = new Set(fc.edges.map(e => `${raw(e.from)} ${e.arrow} ${raw(e.to)}`));
  return { nodes, edges };
}

/** Parse any supported diagram into nodes and edges for diffing and size checks. */
export function parseMermaid(text: string): MermaidElement {
  const type = detectDiagramType(text);
  if (type === 'er') return parseEr(text);
  if (type === 'sequence') return parseSequence(text);
  if (type === 'state') return parseState(text);
  if (type === 'unknown') {
    const lines = text.split('\n');
    const first = lines.findIndex(l => l.trim() && !l.trim().startsWith('%%'));
    if (first >= 0 && OTHER_HEADER.test(lines[first].trim())) lines.splice(first, 1);
    return parseFlow(lines.join('\n'));
  }
  return parseFlow(text);
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
